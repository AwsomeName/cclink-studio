# 图片调研

> 状态：2026-09-03 已完成 V0 工程实现和自动化门禁，真实小红书账号验收待执行。当前环境没有已保存的小红书账号；未完成登录态真人闭环前，不宣称该能力已交付。

## 1. 产品结论

图片调研 V0 是 Studio 内的轻量 Agent 事务，不是图片下载器，也不是文件管理系统。

用户能够：

1. 在现有“事务”入口配置小红书搜索任务；
2. 让 Agent 在可见浏览器中搜索并停在一张候选图片；
3. 自己使用系统截图或网页已有能力保存图片；
4. 点击“我已自行保存并继续”或“跳过并继续”；
5. 达到目标或主动结束后查看“已自行保存、跳过、待处理”统计。

“我已自行保存”只是用户对本次操作的确认。Studio 不下载、不截图、不检查文件是否存在，也不判断图片授权。

## 2. 当前实现事实与交付条件

- `image-research` 已复用现有 WebAffair、统一事务 Tab、单 Attempt、多 generation、BrowserTask 和账号租约；没有新增 Store、Activity 或 Runtime owner。
- Agent 运行只获得四个图片调研工具，且关闭 builtin tools；适配器只返回标题、作者、有限可见文字和短期引用。
- Store 已改为接收完整 `changedAffairIds`；图片或混合批次不再生成“文章事务子集 + 全局 revision”的恢复 journal。
- 2026-09-03 未登录公开页实测：搜索地址能到达，但页面显示“登录后查看搜索结果”，无法取得真实结果列表。Studio 当前资源中也没有已保存的小红书账号。
- 因此交付前仍必须由真人在现有可见 Browser 中确认：已保存账号对应的 Profile 能登录、搜索、打开一条真实小红书笔记，并能用 `noteId` 重开同一笔记和图片序号。

## 3. V0 用户闭环

1. 用户从现有“事务”入口新建图片调研任务。
2. 用户填写主题、搜索词、一个已保存的小红书 `accountId` 和目标保存数量。
3. Studio 保存任务；用户可以关闭并重新打开同一个 `web-affair` Tab。
4. 用户启动任务，main 根据 `accountId` 解析并打开对应 Profile。实际登录的是谁由用户在可见页面判断，Studio 不声称已自动核验账号。
5. Agent 搜索并定位当前可见笔记中的一张图片，持久化候选后结束本轮运行。
6. 用户自行截图或保存，然后点击“我已自行保存并继续”；或者点击“跳过并继续”。
7. Studio 先幂等保存决定，再启动新的 generation，让 Agent 找下一张。
8. 达到目标保存数量后停止；用户也可以随时点击“结束任务”。两条路径都不再产生浏览器动作，并展示当前统计。

等待用户决定时允许重启 Studio。重启后候选仍在，用户可以点击“打开候选页面”；没有真实运行 owner 时不得显示“搜索中”。

## 4. 入口与界面

V0 不新增独立 Activity、图片专用 Sidebar 或新的 Tab 类型：

- 创建和查找任务：现有“事务”入口；
- 任务页面：统一 `web-affair` Tab；
- Agent 运行与接管：现有 Agent Panel；
- Browser：现有可见浏览器；main 根据任务 `accountId` 解析 Profile。

任务配置只包含：

- 主题；
- 搜索词；
- 一个已保存的小红书 `accountId`；
- 目标保存数量，范围 `1..50`；
- 可选的包含或排除说明。

不配置保存目录。任务页展示配置、当前状态、当前候选和三项统计。

任务第一次开始时，main 冻结本次执行配置：`accountId`、主题、搜索词、目标数量和包含/排除说明。运行中和等待候选决定时都不能修改；用户若要变更，应先结束任务，再创建或重新配置新任务。完成条件只能读取冻结的 `targetCount`。

## 5. 候选身份

V0 只增加小红书专用的 `CandidateProposalToken`，不建设通用 ObservationLease、账号观察或裁剪身份平台。

整个图片调研任务从开始到结束只创建一个 Attempt。每轮搜索只是该 Attempt 的一个 `executionGeneration`；提出候选后，同一 Attempt 进入既有 `waiting-human`，当前 Agent run 和 BrowserTask 结束。用户决定后只替换该 Attempt 的运行代次，不创建新 Attempt。

### 搜索结果引用

Agent 不直接操作 selector。小红书适配器提供两个受限动作：

- `image_research_search(query)`：只接受当前执行配置中冻结的某个完整搜索词，由 main-owned 适配器填写并提交；
- `image_research_open_result(resultRef)`：只接受本轮 inspect 返回的引用，由 main-owned 适配器打开对应笔记。

搜索结果页的 inspect 最多返回 10 条：

```ts
interface ImageResearchSearchResult {
  resultRef: string
  title: string
  authorDisplayName?: string
}
```

`resultRef` 由 main 生成，绑定当前 `affairId + attemptId + generation + tabId + browserTaskRunId + pageBindingGeneration`，并具有短有效期。main 内部记录还必须绑定被观察结果的稳定 `noteId`；该字段不需要返回给 Agent。

它不向 Agent 暴露 selector、DOM、任意 URL 或平台内部定位信息。页面代次、generation、Tab 或 BrowserTask 任一变化后，旧引用必须拒绝。即使这些运行身份没有变化，SPA 局部刷新或虚拟滚动后，`openResult` 也必须在打开详情后重新读取 `noteId`：只有详情 `noteId` 与引用内部记录一致才算成功；不一致时拒绝、不给候选 token，并要求返回搜索页重新 inspect。

### 笔记候选 token

```ts
interface CandidateProposalToken {
  proposalTokenId: string
  affairId: string
  attemptId: string
  generation: number
  tabId: string
  browserTaskRunId: string
  pageBindingGeneration: number
  noteId: string
  imageIndex: number
  sanitizedPageUrl: string
  observedAt: number
  expiresAt: number
}
```

受限的小红书 inspect 命令由 main 从当前 BrowserTask 和页面状态生成 token，并只向 Agent 返回以下信息：

```ts
type ImageResearchPageInspection =
  | {
      pageType: 'search-results'
      results: ImageResearchSearchResult[]
      visibleText: string[]
    }
  | {
      pageType: 'note-detail'
      noteTitle: string
      authorDisplayName?: string
      noteId: string
      imageIndex: number
      imageCount?: number
      visibleText: string[]
      proposalTokenId: string
    }
  | {
      pageType: 'unknown'
      visibleText: string[]
    }
```

`visibleText` 只能来自小红书适配器明确列入白名单、当前确实可见的文字区域，最多 20 段、合计最多 2,000 字符。inspect 不返回截图、HTML、DOM、selector、样式、媒体 URL 或媒体字节。只有稳定取得当前 `noteId + imageIndex` 时才返回笔记详情和 `proposalTokenId`；否则返回 `unknown`。

`imageIndex` 在适配器、token、持久化和复核中统一为从 `0` 开始的整数；已知 `imageCount` 时范围为 `0..imageCount-1`。UI 可以显示为“第 `imageIndex + 1` 张”，但不得把展示序号写回领域状态。

V0 的 Agent 只依据笔记标题、作者显示名、有限可见文字和当前图片序号判断是否符合搜索要求，不声称识别图片的姿势、构图或视觉质量；这些由用户直接查看可见网页后判断。

Agent 提交候选时只传 token ID；main 必须复核：

- Affair、attempt 和 generation 仍是当前值；
- Tab、BrowserTask run 和 page binding generation 未变化；
- 当前 `noteId` 与 `imageIndex` 仍匹配；
- token 未过期、未被使用。

小红书同一 `/explore` URL 切换笔记时，以 `noteId + imageIndex` 区分。无法稳定观察这两个字段时必须停止并要求用户接管，不得猜测或提交候选。

持久化候选的最小结构为：

```ts
interface ImageResearchCandidate {
  candidateId: string
  revision: number
  noteId: string
  imageIndex: number
  sanitizedPageUrl: string
  reopenPath?: string
  proposedAt: number
  decision: 'pending' | 'self-saved' | 'skipped'
  decisionOperationId?: string
  decidedAt?: number
}
```

`sanitizedPageUrl` 默认移除用户名、密码、query 和 fragment，只保留安全路径及产品明确允许的参数。`reopenPath` 只能由 main 的小红书适配器根据已验证的 `noteId` 构造，不能接受 Agent 或 renderer 提供的任意 URL。V0 不保存媒体 URL，不建设通用来源 canonicalizer，也不保存截图、预览或图片缓存。

## 6. Agent 单候选循环

每个 generation 只允许一个结果：

1. Agent 使用 `image_research_search` 执行冻结的一个搜索词；
2. 在搜索结果页调用 inspect，依据最多 10 条有界文字结果选择 `resultRef`；
3. 调用 `image_research_open_result` 进入笔记；
4. 在笔记页调用 inspect 读取有限页面信息；Agent 判断符合搜索要求后取得短期 token；
5. 调用 `image_research_propose`；
6. main 校验 token 并先保存 WebAffair；
7. 保存成功后才向 renderer 显示候选；
8. 同一 Attempt 进入既有 `waiting-human`，本轮 Agent run 和 BrowserTask 立即结束，等待用户决定。

持久化失败时不得显示候选。迟到的 propose、旧 generation、旧 Tab、旧 BrowserTask 或旧页面绑定一律 fail-closed。

搜索结果为空时，本轮 Agent run 和 BrowserTask 必须结束，界面显示“重试搜索”或“结束任务”；没有运行 owner 时不得继续显示“搜索中”。重试使用冻结配置启动新的 generation。

### 登录、验证码与人工处理

登录失效、验证码或 `unknown` 页面时，本轮 Agent 和 BrowserTask 结束，事务进入既有 `needs-attention`。用户通过“打开账号处理登录/验证码”在可见页面处理，再点击“处理完成，重新搜索”。Studio 复用同一 Attempt，并启动一个新的或已持久化待恢复的 generation。

人工处理前签发的所有 `resultRef` 和 `CandidateProposalToken` 必须失效。新 generation 必须重新 inspect，不能沿用处理前的搜索结果、note 身份或 token。V0 不让 Agent 跨人工等待保持假运行，也不允许用户人工提交候选或增加新事务状态。

## 7. 用户决定与继续

界面提供两个主决定和一个辅助动作：

- “我已自行保存并继续”；
- “跳过并继续”；
- “打开候选页面”。

“打开候选页面”不能直接导航。main 必须先通过现有 `acquireAccountRecoveryLease` 取得账号恢复租约，调用时传入完整的 `accountId + profileId + affairId + attemptId + executionGeneration + launchOperationId`，再使用已验证的 `reopenPath` 打开同一 `noteId`，并定位 `imageIndex`。账号已被其他任务占用时只提示“账号正在使用，请稍后重试”，不得创建、激活或导航任何 Tab。

打开后必须重新核对笔记和图片序号。核对失败立即释放租约；核对成功后继续持有，覆盖用户停留页面、自行截图或保存以及提交决定的全过程。持有期间，同账号其他任务必须被拒绝，且不能激活或导航这个候选 Tab。

租约终止规则：

- 用户决定后仍需继续搜索：调用现有 `transferAccountRecoveryLeaseToTask`，把租约直接转交给同一 Attempt 新 generation 的唯一 BrowserTask；禁止先释放再重新获取；
- 用户决定后已达目标：提交完成终态后释放；
- 用户关闭候选 Tab、取消打开或结束任务：立即释放；候选未决定时仍保持 `pending`；
- 打开/核对失败、异常、App/窗口销毁：清理并释放，不能留下假租约。

转交失败时不得启动或导航 BrowserTask；保留可恢复事实并按同一 `launchOperationId + executionGeneration` 重试转交。以上全部复用现有租约，不新增锁、Store 或状态机。

因此确认或跳过完成后，原账号恢复租约必须已转交或释放，不能继续以 recovery lease 形态悬挂。

M0 若证明平台不能构造稳定重开路径，或某个候选重启后无法重开，界面显示“来源不可恢复”。这只禁用或警告“打开候选页面”，不能禁用两个决定。用户仍可确认此前已经自行保存，或选择：

- 重试打开；
- “放弃此候选并重新搜索”，该操作由用户确认后将当前候选记为 `skipped` 并启动下一 generation；
- 直接“跳过并继续”。

不得仅打开 `/explore` 就声称已恢复原候选。

决定命令只携带 `affairId + candidateId + candidateRevision + decision`。main 使用 revision 做 compare-and-set，并在首次接受决定时生成 `decisionOperationId`：

- 相同候选和相同决定重试返回原结果；
- 相同候选提交相反决定时拒绝；
- 已决定的候选不能改判或重复计数；
- 若决定后仍需继续，`decisionOperationId` 同时就是同一 Attempt 替代运行的 `launchOperationId`；
- main 在同一个 WebAffair 快照提交中原子持久化候选决定、同一 Attempt 递增一次后的 `executionGeneration` 及该 `launchOperationId`；成功后才为这个 generation 启动 Agent run 和 BrowserTask；
- 若当前持有账号恢复租约，快照提交成功后必须先通过 `transferAccountRecoveryLeaseToTask` 把它转交给该唯一 BrowserTask，再允许启动或导航；
- 恢复时按同一 Attempt 的 `launchOperationId + executionGeneration` 对账；已持久化的 generation 只能恢复或认领，不能再次递增，也不能创建第二 Attempt；
- 相同 `launchOperationId` 最多对应同一 Attempt 的一个 generation、一个 Agent run 和一个 BrowserTask；
- 若本次决定已达到目标，则同一快照提交决定，并把同一 Attempt/节点置为成功，不再递增 generation；主动结束则把同一 Attempt/节点置为既有 `cancelled`。

不得用只存在内存中的 Promise 表示等待用户决定。

任务页同时提供“结束任务”。它复用 WebAffair 既有取消链路：取消当前 Agent run 和 BrowserTask，持久化既有 `cancelled` 终态，拒绝所有迟到的 propose 和未开始的 continuation，并保留当前三个统计。运行中和等待决定时都能结束；不增加新状态机。取消与候选/决定并发时由 WebAffair mutation queue 串行，取消先完成则迟到写入必须拒绝。

## 8. 状态、恢复与唯一所有者

`WebAffairService` 继续拥有全部图片调研状态和生命周期。V0 不新增 Store、恢复裁判、Runtime owner 或文件 journal。

现有 `WebAffairStore` 需要一个窄修正：

```ts
store.save(snapshot, { changedAffairIds })
```

`changedAffairIds` 必须包含本次快照中全部实际变更的 Affair ID。只有全部变更对象都是需要现有 recovery journal 的活动文章发布事务时，才写文章 journal，而且 journal 内容必须覆盖这些变更对象。单个图片事务、多个图片事务或文章与图片混合批次都只走完整快照的临时文件加原子替换，不能生成“事务子集 + 全局 revision”的 journal。V0 不建设通用 delta journal。

图片候选和决定继续使用现有 WebAffair 快照临时文件加原子替换；不新增候选 journal，不建设通用 delta 系统，也不修改文章发布状态机。

恢复规则：

- `pending` 候选：恢复为等待用户决定；
- `pending` 候选有稳定 `reopenPath`：允许用户打开并在复核后继续决定；
- `pending` 候选无法重开：显示“来源不可恢复”；用户仍可确认已自行保存、重试打开、放弃并重新搜索或跳过；
- 已决定但替代运行尚未启动：按同一 Attempt 的 `launchOperationId + executionGeneration` 恢复或认领，不得再次递增 generation 或创建 Attempt；
- 登录或验证码人工处理中：保留既有 Attempt；处理完成后使旧引用/token 失效，以唯一 generation 重新启动并 inspect；
- 没有运行 owner：不得显示“搜索中”；
- 达到目标：恢复为完成态，不再启动 BrowserTask。
- 已主动结束：恢复为既有 `cancelled`，保留统计且不得恢复 Agent 或 BrowserTask。

## 9. 权限边界

图片调研 Agent 使用逐项工具白名单和 `disableBuiltinTools: true`。只开放 `image_research_search`、`image_research_inspect_page`、`image_research_open_result`、`image_research_propose` 及完成 Affair 本轮生命周期所需的最小工具。

图片调研任务不得调用：

- 截图、下载、上传或文件读写工具；
- shell、任意 evaluate 或任意脚本注入工具；
- 通配的 `browser_*` 工具集合；
- 接受 Agent 提供 selector 或任意 URL 的点击、导航工具；
- 任何自动保存图片、裁剪、缓存或哈希接口。

客户端白名单和工具服务端都必须拒绝这些调用，不能只靠提示词。

## 10. 统计定义

V0 只有三个互斥计数：

- 已自行保存：用户成功点击该决定的候选数；
- 跳过：用户成功点击跳过决定的候选数；
- 待处理：当前仍为 `pending` 的候选数。

三者之和等于已持久化候选总数。完成条件只看“已自行保存”是否达到目标。统计不代表文件存在、内容可打开、图片唯一或拥有使用权。

## 11. V0 明确不做

- 保存目录、自动下载和任何图片文件写入；
- Studio 截图、裁剪、选区、预览和图片缓存；
- `SaveOperation`、文件 journal、原子发布、文件校验和哈希去重；
- 文件可用性或授权统计；
- 实际登录账号自动识别；
- 通用来源 canonicalizer；
- 独立 Activity、图片专用 Sidebar 或新 Tab 类型；
- 地点、动作、景别、机位、构图和热度聚类统计；
- 多账号、多平台、云端服务器和无人值守采集。

产品只做普通提示：来源和权利状态未知，用户自行判断保存与使用范围。该提示不是技术门禁。

## 12. 验收门禁

自动化证据：

- 旧 generation、旧 Tab、旧 BrowserTask、旧页面绑定和迟到 propose 被拒绝；
- 搜索结果只返回最多 10 条有界文字和短期 `resultRef`；旧页面、旧 generation、旧 Tab 和旧 BrowserTask 引用全部拒绝；
- 搜索列表局部刷新或虚拟滚动后，详情 `noteId` 与引用内部 `noteId` 不一致时拒绝打开结果并要求重新 inspect；
- inspect 只返回有限可见信息，不返回截图、HTML、DOM 或媒体字节；
- 候选只有在 WebAffair 持久化成功后才显示；
- 等待决定时重启，候选仍存在且可以打开原笔记和图片序号；无法重开时仍可确认已保存或跳过；
- 重复点击任一决定只计一次、只启动一个新 generation；
- `decisionOperationId` 重放只对应同一 Attempt 的一个持久化 generation、一个 Agent run 和一个 BrowserTask；
- 每次决定只让同一 Attempt 增加一个 generation，整个任务不存在第二 Attempt；
- 候选持久化后、决定/同一 Attempt 新 generation 原子提交后、实际启动前三个崩溃窗口均恢复到唯一结果；取消与候选/决定并发也只产生一个终态；
- 打开候选并核对成功后，账号恢复租约持续覆盖用户查看和自行保存；持有期间同账号其他任务被拒绝且不能激活或导航候选 Tab；
- 用户决定并继续时租约无缝转交给唯一 BrowserTask；达标、关闭候选 Tab、取消、结束、失败和 App/窗口销毁后均正确释放或清理；
- 登录或验证码人工处理后可以重试并继续；处理前所有引用和 token 均失效；
- 搜索结果为空时本轮退出，只显示重试或结束，不保持“搜索中”；
- 主动结束后 Agent、BrowserTask、propose 和 continuation 全部停止，统计保留；
- 任务只保存 `accountId`，Profile 由 main 解析；
- 单 Affair、双 Affair 及文章与图片混合批次的 journal/revision 崩溃测试通过；
- 图片调研代码没有图片文件写入、下载、截图、裁剪或哈希接口；
- 达到目标后不再产生 Browser 动作；
- 文章发布和原有 WebAffair 恢复测试不回归。

真实小红书真人证据：

- 已保存账号对应的 Profile 打开真实登录页面并完成一次搜索；
- Agent 提出当前可见笔记中的一张候选后停止；
- inspect 后刷新或滚动搜索列表，旧结果不能串到另一笔记；
- 登录失效后人工处理，完成后重试 Agent 能够继续；
- 用户自行截图或保存，再点击“我已自行保存并继续”；
- 用户跳过下一张后，Agent 能再次继续；
- 等待候选期间重启，可重开与不可重开两种路径都能标记已保存或跳过；
- 同 URL 切换笔记时，旧候选提交被拒绝；
- 两个任务使用同一账号时，旧任务打开候选不会干扰正在运行的任务；
- 用户打开候选并停留保存期间，第二个同账号任务不能切走页面；关闭候选而不决定后，账号可被其他任务正常使用；
- 运行中和等待决定时都能主动结束，并保留统计；
- 达到目标后，统计与用户点击记录一致。

## 13. 架构判断

V0 不需要 ADR：它复用 `WebAffairService`、统一 `web-affair` Tab、现有 BrowserTask 和 Agent 会话，没有第二状态所有者，也不修改文章发布状态机。

如果后续要增加第二 Store、独立恢复裁判、第二 Browser owner、自动下载、截图或图片文件 API，必须重新做架构评审；违反架构宪法时先提交 ADR。
