/**
 * Prompts adapted from Argus `digest.py` (SELECT / RENDER). The system rules and the user
 * payload travel in one text-only message because the internal AI call has no system slot.
 * Differences from Argus: no event-uid registry yet; cross-day duplicates are flagged
 * “⚠已报道过” by URL and listed as recent titles (Argus' fallback mode).
 */

export const SELECT_RULES = `你是科技频道日报的选题编辑。从候选新闻清单中精选当日最重要的科技进展。

精选原则：
1. 重要性排序：对科技行业从业者的影响 > 大公司重大动作 > 重要发布/融资 > 琐碎更新；宁缺毋滥
2. 同一事件多家报道（含中英文不同媒体）必须归为一组：选信息最全或来源最权威的一条为代表（rep），其余编号列入 also
3. 领域覆盖尽量均衡：某领域当日无重要事件不硬凑
4. 「开源热点」（GitHub 高星新星）与「论文前沿」（arXiv 最新）不参与本次精选，系统另行展示
5. 排除：招聘/课程/广告/行情播报/无信源的猜测
6. 跨天事件去重（铁律）：候选标 ⚠已报道过 的，或与“近几日已报道”清单是同一事件的（标题措辞不同、换了角度复述也算同一事件），
   默认不选；仅当出现真正重大新进展（官方最终结论/关键数据披露/实质性反转）才可选，且：最多 1 条、不得做头条、
   标题必须直接陈述新进展本身、reason 以「新进展：」开头。
   事件身份判定：主体相同 + 动作同类（发布/开售/量产/融资/上线）+ 对象相同 = 同一事件。
   例：「Claude Sonnet 5.5 发布」与「Claude Opus 5.5 发布」= 不同事件；「Claude Opus 5.5 发布」与「Claude Opus 5.5 正式上线」= 同一事件
7. 精选条数在 min_items 与 max_items 之间，由当日实际重要事件数决定

只输出严格 JSON（不要任何解释文字、不要 markdown 代码块），字符串里引用词语用中文引号「」：
{
  "items": [
    {"rep": <候选编号整数>, "also": [<候选编号>, ...], "reason": "一句话入选理由",
     "importance": <1-10 整数>, "event_name": "<规范事件名：主体+动作+对象，≤20字>"}
  ],
  "trend_hint": "当日整体观察一句话（可空字符串）"
}`

export const RENDER_RULES = `你是科技日报主笔。基于入选新闻（含原文摘要片段）撰写日报内容。

写作要求：
1. 中文输出；英文信源的公司/产品名保留原名可中英并列
2. 每条：title（中文标题，忠实原意不标题党）+ summary（2 句摘要）+ comment（1 句点评，给从业者的视角）
3. headline：从入选条目中选当日最重要的一条，analysis 写 3~5 句深度解读（背景、影响、后续看什么）；
   headline 的 title 就是新闻标题本身，不得带「今日头条」「头条」等栏目字样
4. trend：一句话总结当日趋势
5. 合规：摘要 + 点评为主，禁止大段复制原文表述
6. JSON 铁律：字符串值内部严禁出现英文双引号——引用词语一律用中文引号「」

只输出严格 JSON（不要任何解释文字、不要 markdown 代码块）：
{
  "headline": {"slot": "<槽位>", "title": "...", "analysis": "..."},
  "sections": [{"slot": "<槽位>", "title": "...", "summary": "...", "comment": "..."}],
  "quick": [{"id": "os#0", "title_zh": "中文标题", "desc_zh": "一句话中文说明"}],
  "trend": "..."
}

槽位格式为 "<domain>#<序号>"，必须原样引用输入中的槽位，不得自造。headline 的条目也要出现在 sections 里。
quick 字段（有速览条目时必填，逐条对应输入 id，不得遗漏）：
- 论文（paper#N）：title_zh = 中文译题（学术术语准确），desc_zh = 一句话中文概括贡献
- 开源项目（os#N）：title_zh = 保留 owner/repo 原名，desc_zh = 中文一句话说明它是什么/为什么火`

export interface SelectCandidate {
  domainName: string
  date: string | null
  title: string
  content: string
  reported: boolean
}

export function selectPrompt(input: {
  candidates: SelectCandidate[]
  minItems: number
  maxItems: number
  recentTitles: string[]
  taste: string
}): string {
  const lines = input.candidates.map(
    (c, i) =>
      `[${i}] (${c.domainName}｜${c.date ?? '无日期'})${c.reported ? ' ⚠已报道过' : ''} ${c.title}｜${c.content.slice(0, 120)}`,
  )
  let prompt = `${SELECT_RULES}\n\n---\n候选清单共 ${input.candidates.length} 条：\n${lines.join('\n')}\n\nmin_items=${input.minItems}，max_items=${input.maxItems}。\n`
  if (input.recentTitles.length)
    prompt += `\n近几日已报道（跨天去重对照组）：\n${input.recentTitles
      .slice(0, 60)
      .map((t) => `- ${t}`)
      .join('\n')}\n`
  if (input.taste.trim())
    prompt += `\n用户口味（优先级高于以上通用原则）：\n${input.taste.trim()}\n`
  return prompt + '\n请精选。'
}

export interface RenderEntry {
  slot: string
  domainName: string
  title: string
  text: string
  sources: number
  reason: string
}

export interface QuickEntry {
  id: string
  kind: 'open_source' | 'paper'
  title: string
  raw: string
}

export function renderPrompt(entries: RenderEntry[], quick: QuickEntry[]): string {
  let prompt = `${RENDER_RULES}\n\n---\n入选条目共 ${entries.length} 条：\n${entries
    .map(
      (e) =>
        `槽位 ${e.slot}｜领域 ${e.domainName}｜标题 ${e.title}｜摘要 ${e.text.slice(0, 600)}｜来源数 ${e.sources}｜入选理由 ${e.reason}`,
    )
    .join('\n')}\n`
  if (quick.length)
    prompt += `\n速览条目（需翻译成中文，见输出格式 quick 字段）：\n${quick
      .map(
        (q) => `${q.id}｜${q.kind === 'open_source' ? '开源项目' : '论文'}｜${q.title}｜${q.raw}`,
      )
      .join('\n')}\n`
  return prompt + '\n请成稿。'
}

export function tasteBlock(blacklist: string[], preferences: string): string {
  const parts: string[] = []
  if (blacklist.length)
    parts.push(`- 一律不选（黑名单品牌，含标题未点名但内容明显相关的）：${blacklist.join('、')}`)
  if (preferences.trim()) parts.push(preferences.trim())
  return parts.join('\n')
}
