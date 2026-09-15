# 第189天小红书图文真实验证（公开正文三图已目视核验，自动终验未闭环）

2026-09-13 解锁后，已从真实创作后台作品封面打开本次提交的公开页，逐页查看三图并与本地原图对照，正文从开头至末尾及话题一致。Studio Agent 已真实提交一次；本篇公开内容验收通过，但 Studio 自动终验仍缺发布后图片转换映射及轮播翻页能力，不能宣称全自动功能稳定。现有 WebAffair/Attempt 保留，禁止重复发布。

## 验收目标

用户在 Studio 选择 `AIR/2026-09-10/小红书软文.md`、小红书已保存账号，由 Studio Agent 完成原文、三图、字段、保存及单篇公开提交；Studio 从本次提交回执核验公开全文与逐图。执行计划在真实 UI 随事件变化，单独验收。本文不把保存或测试通过算成发布完成。

## 当前事实

- 源文件：`/Users/apple/Desktop/研发日记/AIR/2026-09-10/小红书软文.md`；标题“做AI眼镜第189天，它学会主动找你聊天了”。原文与三图未改动。
- 当前昵称“小眸”，平台 UID `65361844000000000301e75a`，Studio 账号 `49f17596-173a-44b5-a121-2286c2748601`。
- 准备阶段 Agent 在管理页核验未见第189天文章，图文草稿箱原为 0。通过 Studio 上传首图一次，填写原样标题（平台计数 19/20），暂存成功；随后 G2/G3 补齐其余两图和全文。
- 21:28:17 页面显示保存成功，草稿箱为 1，原标题的独立草稿出现。证据：`artifacts/article-xiaohongshu-20260913/first-draft-saved.png`。
- Studio 新增只读草稿识别实际返回 `ab161f12-becc-4b52-bd93-d9d6f1453884`，UID 与标题一致，首图 `01-封面.png` 1086×1448，保存时间戳 `1789306097446`。
- 21:35:53 创建本篇唯一正式 WebAffair `7fe17f76-e0fb-4f21-be3f-1323908065a4`，Attempt `210a2afe-8c8e-41b0-822d-f66e43cefefc`，G1。Studio 从草稿箱重新打开同一 UUID，核验账号、标题及 saved，开始正式 Agent 执行。
- 旧第188天及 B站未知记录未修改；本篇真实提交和最终公开核验分别记录，见下方 G3 结果。
- G1 首次 inspect 后因绑定网页不可见停下。使用 Studio 的网页独立窗口保留同一 Tab，并通过“网页里有这张图”对账首图：main 复核原账号、原稿、saved、唯一未归属图片与原文件名。首图变为 uploaded，上传派发步骤显示无需执行。
- G2 安全续接：同一 Attempt，账号核验完成，第二张图派发一次。13:44:52Z 原生上传后 1 秒内触发“小红书原稿在回读期间变化，旧证据已废弃”，WebAffair 进入结果未知并停止。真实网页已显示 2/18 与第二张设计图；通过 Studio 原稿对账确认 saved 及唯一新增图片，第二张图变为 uploaded，没有重传。
- 真实 UI 计划证据：`artifacts/article-xiaohongshu-20260913/first-image-reconciled.png`、`execution-plan-resumed.png`。已观察恢复步骤核验、首图跳过、第二图等待/派发/结果未知/对账完成；正文、保存和公开结果仍未验收。
- 上传后重查修复加载于 PID 69540；G3 保留同一 Attempt 和前两图，第三图通过 Studio 自动上传（6.3 秒），后置核验唯一新增图片、同原稿保存及加载成功。三图均 uploaded，upload-assets completed，进入 fill-body。证据：`artifacts/article-xiaohongshu-20260913/three-images-uploaded.png`。修复后追加 86 项相关测试、typecheck 和受影响 ESLint 通过。
- G3 完成 fill-body、fill-fields、save-draft 后，21:57:37 Studio 发出唯一发布动作并取得与冻结标题、全文、三图 fileId 顺序一致的请求回执。publish sideEffect verified；publication dispatched，URL `https://www.xiaohongshu.com/explore/6aa6abd10000000011035ccd`。这证明提交发生，不等于公开全文三图核验完成。提交前 Mac 再次锁屏，已请用户解锁；Codex 无法读取此时真实屏幕，但 Studio Runtime 继续执行。
- 21:59:34 Agent 因公开链接 404 结束，WebAffair 正确保留 `execution.status=result-unknown`、`publication.status=result-unknown`，`verify-publication=needs-reconcile`；上传、正文、字段、保存和提交检查点均 completed，publish sideEffect 仍 verified。没有把已提交变成“未发送”。

## 已解决的直接阻塞

1. 普通账号准备会话原先仅允许 www 主站，不能进入官方 creator。仅补充 www/creator 两个精确 HTTPS origin；非官方、其他子域、端口仍拒绝。加载后 Agent 已在真实后台继续操作。
2. “暂存离开”位于闭合 Shadow DOM，普通 text selector 查不到。已有 Studio 专用 `xhs-publish-btn[save-text="暂存离开"]` 有界能力真实保存成功；没有 Codex 手工网站最终点击。
3. 普通准备会话对空文本发布 host 的识别不足：精确最终发布 selector 必须走文章事务授权。保留已有主进程 dispatch 检查。
4. 页面不暴露本地 UUID：`browser_extract` 增加 `xiaohongshuDraftTitle` 只读投影，复用现有平台 image-draft reader。限定 creator origin、完整标题、当前 UID 唯一匹配、已完成上传，前后复核账号和 URL；不读凭证、不写平台或 Studio 持久化状态，不用于替换已有事务原稿。
5. 第二张图的真实失败定位为上传后双快照因图像加载发生变化。只在现有 30 秒上传核验期限内重查这一精确瞬时错误；账号、原稿、运行代次、保存状态和唯一图片增量检查均保留，绝不再次派发文件。不是放宽证据或增加上传次数。

## 工程验证

99 项相关测试通过（browser tools、web resources、Playwright actions、draft discovery）；上传后重查另有 86 项相关测试通过。最终 `pnpm typecheck`、受影响文件 ESLint、`git diff --check` 通过。开发进程 PID 69540 已加载全部源码修复。没有提交、推送或发版。

## 待完成

三图、正文、字段、保存和单次真实提交已由主进程核验。继续核验本次回执对应的公开全文和逐图结果，禁止再次发布。公开图集 fileId 变换仍需真实结果证明，不能仅数三张图宣称成功。

解锁后先读取真实 Studio 与 WebAffair，再通过创作后台 `/new/note-manager` 找到回执 noteId `6aa6abd10000000011035ccd` 对应作品的真实状态及原生访问入口。旧第188天曾出现裸 URL 404、管理页入口可访问的现象，只作为排查线索，不能当成本篇证据。当前源码允许结果核验阶段访问管理页，但恢复协调器仍优先打开已记录的裸回执 URL；若这阻挡结果核验，需要增加具体的同账号、同 noteId 原生入口恢复能力，不能手改持久化 URL/状态。随后处理可信逐图映射及最终 WebAffair 收敛。

执行计划验收只完成了准备、恢复、图片对账/上传等真实 UI 变化；发布和终验阶段因锁屏尚未留到界面截图。现有工程门禁及回执不能替代全流程界面验收。


## 解锁后公开页面与 G4 只读续验

- 创作后台 `/new/note-manager` 真实出现第189天原标题，时间为 2026-09-13 21:57。点击该作品封面，平台打开 noteId `6aa6abd10000000011035ccd` 的真实详情地址，并附加 `xsec_token` 与 `xsec_source=pc_creatormng`。没有点击发布、编辑或删除。
- 这个带平台原生访问参数的链接可打开本次作品；裸回执 URL 的 404 不能用于推断审核状态。关闭“登录后推荐更懂你的笔记”遮罩后，未登录公开页可直接读取正文与图集。
- 公开标题与源文件一致；正文从“第189天，说说这两天最有意思的进展”到“明天第190天，继续干活”，以及全部八个话题，与原文一致。页面作者“小眸”的 profile 路径含原 UID `65361844000000000301e75a`。
- 真实点击轮播下一张，分别看到 1/3 封面、2/3 陪伴设计图、3/3 摄像头暂停真机截图；逐一打开本地三个 PNG 目视对比，内容、顺序一致。公开页附平台“可能含AI生成内容”提示。此为真实界面验收，不是主进程自动图片映射证据。
- 截图：`public-note-first.png`、`public-note-second.png`、`public-note-third.png`、`public-note-body-end.png`，均位于 `artifacts/article-xiaohongshu-20260913/`。
- 将平台生成的完整链接通过 Studio 地址栏打开到原绑定 Tab `tab-2-1789304899403`，通过原任务“核验发布结果”续接同一 Attempt，G4 launch `0211f862-5308-4eb5-b352-9f5e6110d831`，BrowserTask `932df8d9-648a-4097-ac87-724123147434`。未重启、未修改持久化状态、未新建发布任务。
- G4 原生 inspect 识别 published-article、原账号 UID、本次作品 ID、原标题和 405 字符正文。第三图初次 loaded=false；普通滚动和等待节点无法触发轮播图加载，verify-publication 阶段的通用 ArrowRight 被现有只读动作边界拦截。不能将此归咎于未上传或再次发布。
- 源码 `XiaohongshuPublishingAdapter.verifyBody` 仍要求公开 imageList.fileId 与上传 spectrum/fileId 相同。当前真实公开图片尾段已转换为 `1040g34o3252dmalpis1g5p9m3120rpqqi96ualo`、`1040g34o3252ebb0o32105p9m3120rpqqmv4udro`、`1040g34o3252ei9j9j2105p9m3120rpqqhj7gi4g`。轮播 DOM 含重复 slide，不能按 AX 节点出现顺序认领。尚无可信的上传 ID 到公开 ID 转换证据。

### 分开验收的结论

1. 本篇发布：Studio 已提交一次，公开全文与三图真实界面验收通过。用户可从创作后台打开原标题的封面，查看全文并切到 2/3、3/3 复验。
2. 执行计划：已真实显示上传、正文、字段、保存及提交的事件结果，保留中断和等待；`publication-plan-before-verification.png` 记录提交动作完成、公开图片未核验。自动终验和最终成功收敛未通过，不能宣称完整计划闭环。
3. 自动能力缺口：需要同回执 noteId、同账号约束下的原生作品链接恢复；需要只在本作品轮播内翻页加载的有界读取；需要可信上传图片与公开转换图片映射。缺少这些能力时只能保留未知，不应把人工目视检查、图片数量或尺寸直接替代自动成功门禁。

G4 后续事实：Agent 又尝试直接导航公开图片 CDN，被 Studio 登记账号域名边界拒绝，BrowserTask 暂停，WebAffair execution=waiting-human、publication 仍 result-unknown。不是用户还欠一次发布授权，也不是图片未上传；无需让用户重复发布。原始只读状态投影见 `public-verification-g4.json`，实际 UI 见 `publication-plan-g4-waiting.png`。Codex 未派发暂停按钮（取最新 UI 时按钮已消失），未清理保护。Agent 所称“正文空白差异”没有证据，源码显示全文归一化已去除空白，主要已知缺口仍是逐图转换匹配；不得照录推测为根因。
