# B站图文发布接手事实与约束（2026-09-12）

## 本次接手任务

> 22:38 最新事实：用户已明确允许必要的重复发布测试。同一测试事务 `248d5211-9d05-477c-a8db-50a4d75f0d84` 的 G5 已由 Studio 完成原生多段正文、三图、标题、公开范围核验并自动发送；原生请求正文及逐图匹配，但 B站返回账号类错误 `4126021`（HTTP 200），无成功回执/公开链接。账号个人中心实际显示注册会员/LV0、尚未转正，手机与实名已完成；需要处理账号资格，不能保证转正必然消除该错误。G2/G4/G5 未知历史保留，原 AIR 原稿仍未知。执行计划两处 owner 修复通过测试但尚未重启加载；Studio 账号阻塞提示已真实显示。详见 [最新调试事实](article-publishing-bilibili-confirmation-debug-2026-09-12.md) 末节；下文原始现场属于历史记录。

完成正在运行的真实 B站图文发布闭环，并通过 Studio Agent、主进程有界能力和 WebAffair 执行。当前没有发布成功证据。禁止用 Codex 手工点击平台最终发送替代产品能力，也不能把测试通过或上传完成称为发布完成。

先完整读取仓库 AGENTS.md、docs/architecture.md、docs/features/air-diary-platform-publishing-plan-2026-09-11.md 以及本文件对应的真实源码。文档是线索，实际 HEAD、工作区、WebAffair、Agent 日志与网页状态才是事实。本文件不是操作成功的凭证。

保留全部已有工作区修改和安全修复，不提交、不发版。不顺带扩张其他平台。每项改动直接对应首次确认或安全续接的实际阻塞。

## 用户已有授权和要求

用户已授权用下述文章及三图，按平台逐个发布。账号已登录，无需重新登录或重复询问发布授权。当前平台为 B站图文动态，一个平台一个 Tab。文章写入、图片上传和提交应由 Studio Agent/Studio 有界能力完成；Codex 可以操作 Studio UI 发起任务、观察真实页面、诊断和修复，但不自行点击网站最终发布冒充 Studio 闭环。

WebAffair 是唯一发布进度所有者。每个小步骤必须有执行者、动作、进入条件、实际状态、完成条件、证据、卡点与下一步；写入与核验分开。复用 current operation、transition、长 Agent Run、Runtime handshake。不要新增完整操作账本、claim/report MCP、新调度框架、内容/图片/证据哈希、actionFingerprint 或旧数据迁移。取消后不派发，页面改代重取证据，已完成步骤不倒退，结果未知只核验、不重复发布。

## 文章、图片、账号

- 仓库：`/Users/apple/Desktop/cclink-dev/cclink-studio`
- 本轮基线：main / HEAD `c6c65c37`，package version `0.1.88`；接手时重新核对。
- 工作空间：`/Users/apple/Desktop/研发日记`
- workspaceId：`941ad8a1-aa46-4635-b085-3aaa412fb2c5`
- 文章：`/Users/apple/Desktop/研发日记/2026-09-09/小红书软文.md`
- 标题：做AI眼镜第188天，它开始看懂我的世界
- 原图目录：`/Users/apple/Desktop/研发日记/2026-09-09/素材/`
  - `01-首篇封面.png`，1086×1448
  - `02-导航场景效果图.png`，1846×852
  - `03-城市漫游效果图.png`，1672×941
- Studio accountId：`7c1ef8bb-7770-4c53-ad02-e4943f745fea`
- B站 UID：`3546384070347419`，昵称 `艾瑞_B`
- Profile：`web-draft-67f01554-70b0-4739-ad9f-178437a7b1a3`

## 当前真实任务（不要找错已终止的两条旧任务）

- Affair：`4f0b82aa-a26e-40c0-8e7e-adfefbba2390`
- Attempt：`c84037ef-5ce1-4c64-a0dc-efbe606ba3e5`
- Generation：2
- Launch：`aba6c168-45e1-40fe-a788-21e8bb3e0916`
- AgentRun：`run-aba6c168-45e1-40fe-a788-21e8bb3e0916`
- BrowserTask：`7c780f31-2e52-4e6a-985e-c6f4f168df88`
- Conversation：`article-publishing-4f0b82aa-a26e-40c0-8e7e-adfefbba2390`
- Tab：`tab-1-1789145082433`
- 页面：`https://t.bilibili.com/`，在 Studio 网页独立窗口中。

最后复核 WebAffair updatedAt=`2026-09-12T09:34:52.870Z`（北京时间17:34:52），execution/result= result-unknown，当前 publish，Attempt interrupted。Agent 已结束，不是在后台继续发布。没有 publication.url。

真实已完成：三图在此任务中各上传一次并经 main 逐图核验；17:31正文写入和全文回读通过（原始404字符，归一化期望/实际393）；17:31标题通过；17:32公开范围public；17:33当前现场复核通过。save-draft completed 仅表示复核，无平台保存保证，不代表持久草稿或发布。

三张图的本任务平台地址按顺序：
1. `https://i0.hdslb.com/bfs/new_dyn/190bc2c655b87c1ff5712fcb0dd6a42d3546384070347419.png`
2. `https://i0.hdslb.com/bfs/new_dyn/245df4ec904905681a229d7f5beafa683546384070347419.png`
3. `https://i0.hdslb.com/bfs/new_dyn/d0d59e3ef20bba74a9b98966b845a9d83546384070347419.png`

## 卡点的证据与未知边界

17:34:22，Studio Agent 实际点击发布入口一次，main gate 记录 allow-once 并完成派发。17:34:52 回执观察器超时，WebAffair 进入结果未知并中断写入权限。Agent 自述“被派发闸门拒绝”不准确：入口点击实际已派发，错误来自点击后的回执等待。

之后真实页面显示《哔哩哔哩动态使用规范（2019年6月）》原生弹窗，含 iframe `https://t.bilibili.com/h5/dynamic/specification`、按钮“确认并发送”“取消”。Codex 没有点击这两个按钮。正文、标题和三图仍在弹窗后方。

这证明漏接了首次确认分支，但不能仅凭回执超时或缺少日志，断言服务器从未收到请求。目前已有日志没有提供可用于解除未知发布保护的完整请求证据。

## 最重要的未解决问题

当前旧 main 不含首次确认修复。加载代码通常要重启 main；但原生 B站临时编辑器无持久草稿，重启会丢失现场。当前 unknown 任务也缺少回执URL，现有恢复在启动 Agent 前拒绝继续写入。

不要把“先重启、清掉 unknown、另建任务再发”当作恢复；不要靠改持久化 JSON 或放宽保护解除阻塞。也不要为保住现场临时注入主进程代码、另开通道代点发布。需要独立评估正式、安全的续接路径。若证据不足就明确报告，不承诺假闭环。

上一轮停在这里，尚未解决。换会话不会自动恢复这个能力。

## 已写入但未在当前真实 main 加载验收的修复

主要文件：
- `src/main/article-publishing/bilibili-publication.ts`
- `src/main/article-publishing/bilibili-publication.test.ts`
- `src/main/article-publishing/article-publishing-browser-policy.ts`
- `src/main/mcp/modules/browser/index.ts`
- `src/shared/article-publishing/article-publishing-plan.ts`
- `src/renderer/src/features/article-publishing/ArticlePublishingTab.tsx`

新增 finishBilibiliSubmission：在同一仍存活的发布 operation 内，竞速等待原生回执或首次规范弹窗；确认 iframe/标题/按钮和原稿，校验 Runtime、取消状态及尚无 native create 请求，才由 Studio 有界点击一次“确认并发送”；同一个观察器继续对应回执。无此分支根据真实直接回执跳过。存在任何 native 创建请求（包括不匹配请求）时不再确认。

观察器当前严格限定 `/x/dynamic/feed/create/dyn` 请求、冻结全文与逐图顺序，要求code=0及字符串dyn_id_str。新代码的真实端到端兼容仍待验收，不要将测试中的fixture当作本账号已经验证的请求事实。

MCP catch 调用 finish(false)，异常路径仅等原观察器，不派发确认；finish Promise复用，防止重复进入确认。平台已接受后即使点击报错或取消使计划写入失效，也返回回执供WebAffair持久绑定。请独立复核这些边界，别照搬设计结论。

细步骤：发布入口点击、首次规范识别、首次规范确认并发送、创建请求/回执核验、公开全文/逐图核验。新增动作和结果已分行，按实际顺序排列；UI HMR可见，不等于当前主进程已执行它们。UI中 B站标题/临时稿提示误写成微博也已修正。

这条新代码只处理同一存活 operation 内首次出现的弹窗，**没有解决已经结束的当前旧任务的续接**。

## 已加载并真实验证的更早修复

- `playwright-actions.ts` B站冻结纯文本fill，不再误入知乎富文本路径；实际正文成功。
- `bilibiliImageUrl` 仅允许原生限定CDN/路径，HTTP回执规范化HTTPS。
- 单图原生上传回执对应、预览与授权原文件逐字节匹配且可解码（非哈希），实际三图完成。
- 公开图片核验映射到 asset.*.published，B站公开正文错误映射publication.verify；代码已加载，真实公开结果尚未走到。

## 运行信息、只读诊断和证据

最后已知 dev 于17:17启动，PID90803；先核对进程，不要直接重启。

- dev log：`/tmp/cclink-studio-dev/cclink-studio-dev.log`
- owner store：`/Users/apple/Library/Application Support/CCLink Studio/web-affairs/web-affairs.json`
- Agent持久化：`/Users/apple/Desktop/研发日记/.cclink-studio/state/c2605ad74a74fa5f.json`
- `python3 /tmp/bili-status-current.py`：只读当前任务事实
- `python3 /tmp/read-bili-current.py`：只读最近文本/工具结果，不输出thinking

只读网络记录线索：PlaywrightBridge有内存networkLog，最多500条后裁剪，getPageDiagnostics仅暴露失败请求，MCP getNetworkLogs受账号安全边界限制。不要擅自解开限制；也不要将“未找到请求”冒充完整未派发证据。最后仅查了源码和已有dev日志，未取得此缓冲的历史请求事实。

真实证据目录：`artifacts/article-bilibili-agent-20260912/`
- `body-and-three-images-live.jpeg`：实际正文/标题/三图/公开设置，发布前
- `first-publication-agreement-blocker.jpeg`：实际首次规范弹窗
- `final-first-confirmation-state.json`：当前任务状态快照
- `new-image-plan-live.jpeg`：更早任务逐图细步骤真实执行变化，不能当作当前任务发布证据

两个更早B站任务 `3eb86c88-265c-46a2-b144-2ea228e7f186`、`ee57dda3-94a2-4107-b8e4-8d5a6d5705f1` 已正常终止，不能误恢复或覆盖它们的记录。

前述针对性测试：B站publication21项，policy70项，Browser MCP52项；最终node/web类型和受影响lint、diff检查通过。日志在 `/tmp/bili-agreement-final-tests.log`、`/tmp/bili-agreement-tests.log`、`/tmp/bili-agreement-node-final.log`、`/tmp/bili-agreement-web-final.log`、`/tmp/bili-agreement-lint.log`。测试是工程门禁，不是首次确认和发布真实验收。

## 工具和操作纪律

使用电脑界面前读取computer-use skill，通过其node_repl+@oai/sky操作。Studio app id `com.cclink.studio.dev`。不能通过私有IPC/CDP/evaluate绕过Studio发布状态；不能用Codex页面点击最终发送替代Studio能力。普通文件、源码、日志读取和测试允许。

Mac会锁屏；获取截图失败不等于Agent停止。不要更改系统锁屏或网络设置。主窗口和网页独立窗口可通过Window菜单切换；菜单有两个同名Studio窗口，先取真实AX。切回主窗口不要把网页“送回主窗口”导致任务页面不可见。

## 接手的完成标准

1. 先根据真实证据确定当前任务能否安全续接；不能凭Agent自述解除unknown。
2. 若能续接，由Studio完成必要首次确认和本篇唯一提交，并记录真实回执。
3. 只读核验公开URL、正确UID/作者、标题、完整正文、三图地址/顺序/加载。
4. WebAffair与用户可见细步骤一致，截图展示真实已执行、等待或失败，不混淆Agent run完成和发布完成。
5. 若仍不能完成，直接指出缺的证据或能力与替代路径。不要再以“修复已写好但无法加载”收尾却暗示马上可以继续。
6. 分别报告执行计划真实验收、平台发布闭环、临时编辑器恢复限制；未验收明示。最终用中文人话与真实界面证据汇报。
