# 第190天文章六平台实测

## 2026-09-16 小红书准备中的真实定位问题

原账号草稿箱为0，笔记管理5篇均非第190天。两个“上传图文”同名控件使普通选择器及可见伪类组合均非唯一。原生精确路径中，第一个通过保护却因屏幕外目标在点击前超时，第二个由Studio点击成功。随后Studio上传首图1/18、填写并回读原标题；真实界面为 artifacts/article-day190-six-platforms-20260915/xiaohongshu-first-image.jpeg。

普通文本无法定位闭合Shadow DOM中的“暂存离开”，已暂停无效重试，保留现场。Agent后续读到平台自动保存，并从发布入口回到草稿箱(1)，再次使用有界草稿识别读取到UUID `b8f83e48-8f3c-4332-8592-a4a07cc9aa3a`、UID `65361844000000000301e75a`、原标题及首图 `01-随行助手概念效果图.png` 1877×838，savedAt=1789490225692。此时未提交。

直接改动：有界控件读取新增inViewport布尔信息，保留屏幕外控件与文件输入，不更改动作权限或强制点击。点击工具说明指引使用精确控件地址和视口信息，并告知已有的小红书专用暂存选择器。58项相关测试、Node类型检查、受影响ESLint、格式检查通过。准备Agent结束并确认草稿落库后，通过官方restart.sh restart加载，开发启动PID4139；新诊断仍待Agent真实控件读取复验，不等于自动准备已稳定。

重启后Studio正式表单已读取本篇全文和3图，但平台下拉仍为CSDN，AX点击、空格、原生set_value均未改变选项，坐标点击返回noWindowsAvailable。停止无效输入，已请用户解锁并将Studio前置。尚未点击“保存并开始执行”，没有本篇小红书正式WebAffair或提交；CSDN、掘金本轮也尚未开始。下一步应继续配置小红书图文、原账号、上述真实UUID与UID，由Studio补齐图文并提交。

## 00:47—00:54 小红书正式任务启动与首图对账

解锁后，通过Studio创建本篇唯一小红书事务 `ece6c8ed-9455-44d2-9ac2-fb109a7377ec`。首次启动因第189天同账号waiting-human占用而拒绝。经源码确认旧终止入口保留未知发布事实后，通过Studio旧任务“终止任务”结束其等待运行；旧事务 `7fe17f76-e0fb-4f21-be3f-1323908065a4` 仍为result-unknown、旧作品URL不变、publish副作用仍verified，没有重发或改持久化文件。

本篇正式Attempt `0016f483-806f-42ff-8f99-e31e47182ead` 第1代恢复原稿成功。Agent识别一张未归属图片，未盲目重复上传，正常结束后execution=interrupted。Codex对照原素材、前次草稿文件名/尺寸与当前预览，并通过Studio“网页里有这张图”对账。第一次因计划遮住原稿而被可见性门禁拒绝；打开“网页独立窗口”后，同一按钮由main核验首图成功，asset=uploaded，上传尝试仍为0。证据 xiaohongshu-task-ready.jpeg、xiaohongshu-first-reconciled.jpeg。

通过同一任务“从中断处继续”进入第2代，launch `d30291ac-01ea-4f91-97ed-0c01c3ee3fe7`，BrowserTask `dc105226-8831-44bd-8d40-454045a10a1e`。Studio已向原稿派发第二张图，尚待后置核验。以上只验收准备、等待、对账与恢复，不能算本篇已发布。

## 00:59 小红书单次提交结果未知；01:06 开始CSDN

小红书第2代完成三图、463字符正文、标题与自动保存；发布前bodyMatchesFrozen=true。00:59:14主进程允许Studio单次点击专用发布控件，15秒观察期限内未获得匹配本次标题、正文及逐图fileId的提交回执，00:59:30 execution/publication=result-unknown，publish副作用=result-unknown，没有取得作品ID。真实页面仍为同一草稿编辑器，不能将点击返回当作发布成功。第3/4代只读恢复均提示“当前页面不是可识别的平台文章管理页”；Codex仅点击原生“笔记管理”作只读导航，真实管理页仍是全部5篇、没有第190天，Studio当前不能从该管理页完成自动核验。未重发。

界面证据：xiaohongshu-three-images.jpeg、xiaohongshu-after-submit.jpeg、xiaohongshu-manager-no-day190.jpeg、xiaohongshu-result-unknown-plan.jpeg。计划窗口曾保留启动时旧快照（图片2/3尚未观察、执行中），但主进程已完成三图并进入未知；切到其他任务再回到本任务后才显示正确状态。这是本轮真实暴露的计划同步缺口，尚未定位根因，不能宣称完整执行计划实时验收通过。

CSDN通过Studio正式表单读取同一原稿与三图，选择原账号ff3592e8-517a-443d-a674-58105f7bc06b，配置85字左右摘要及原文前五个标签（AI眼镜、智能眼镜、AI搭子、独立开发、开发日记），保留平台默认分类与封面。唯一事务 `6f0d6536-111d-4afc-9cf3-a4df72f4439f`，Attempt `9eb0a6ae-b048-4e58-85f4-25161bd06e81`，第1代launch `9763dc74-ab78-4440-91d4-59fbc66f6757`，BrowserTask `d3d4f829-ee73-4cf6-9a13-181a3083f738`。Agent已建稿并核验真实原稿165493415、账号csdn:weixin_36388257；仍待三图和全文。证据 csdn-task-ready.jpeg。

## 01:20 CSDN 实际提交成功，平台审核中

CSDN第1代从建稿到三图、486字符正文、摘要、五标签、保存核验与提交连续完成，没有恢复重试。01:20:31 Studio签发并点击唯一发布按钮，真实页面跳到 `/mp_blog/creation/success/165493415`，显示“发布成功！正在审核中”。即时截图 csdn-submit-immediate.jpeg；此前截图 csdn-three-images.jpeg、csdn-before-submit.jpeg。

Studio随后从原生链接打开 `https://blog.csdn.net/weixin_36388257/article/details/165493415`（页面附分享参数），账号、文章ID、标题和正文匹配，但状态栏明确“审核中”。Agent据实将verify-publication转waiting-human，error=PLATFORM_REVIEW_BLOCKED，publication=dispatched，不把作者可见当作正式公开。证据 csdn-pending-review.jpeg。本轮3个平台公开核验闭环、另1个平台已确认提交且等待审核；小红书仍结果未知。

针对真实计划窗口旧快照，renderer增加focus/visibilitychange时从现有WebAffair快照刷新，不推测状态、不改发布事实。Web类型检查、ESLint、10项发布表单相关测试、格式检查通过，已HMR加载；回前台真实同步仍待复验，持续事件漏更新根因尚未定位。掘金准备会话已启动，先检查本篇是否存在，只保存独立标题草稿，不操作旧稿或最终提交。

## 01:33 掘金独立草稿与正式执行

准备Agent在原账号深芯智造 / UID4382008413004393核验无本篇后，只保存原标题，平台生成草稿 `7685651354878738441`。从编辑器草稿箱真实链接重新打开后，标题回读一致、正文0字、无图片；原第189天草稿未修改。创作中心管理页与编辑器草稿箱均显示2份草稿。旧 `/admin/articles` 地址实际重定向首页，Agent经原生创作者菜单进入草稿箱；不能将旧路由继续写作有效入口。

通过Studio正式表单绑定原稿、三图、真实草稿URL `https://juejin.cn/editor/drafts/7685651354878738441`、原账号UID，摘要沿用本篇内容摘要，分类/标签均为“人工智能”。事务 `348e49b9-c706-47ea-9d84-cdda1caa121d`，Attempt `4df4cef4-39cf-4736-8436-8d644f4a85ca`，第1代launch `84d5592c-9521-4fd1-ba9e-5b6180579858`，BrowserTask `b871ce4e-2719-40d0-a36f-d2c37274e07c`。启动与原稿恢复成功，开始顺序执行；此时未提交。证据 juejin-task-ready.jpeg。新增inViewport已在真实准备工具返回中出现，能区分视口内外控件；这不等于全部点击稳定性验收。

## 01:37 掘金正文后置核验中断与直接修复

三张图各上传一次并全部核验，进入fill-body后browser_fill返回 `locator.scrollIntoViewIfNeeded: Element is not attached to the DOM`，main将同一Attempt中断、execution=result-unknown，但publication仍not-started，没有发布动作。Agent自述“textarea脱离、正文未写入”不可信：真实界面已完整显示本篇正文、三图预览和“保存成功”，字符数1645、行数12、正文字数403。证据 juejin-body-after-interruption.jpeg；以现场和后续main核验为准，不能根据工具异常推断动作没执行。

源码中该有界流程的scrollIntoViewIfNeeded位于JuejinPublishingAdapter的预览图片探测。新增仅对“Element is not attached”重新定位同索引图片一次；第二次失败或关闭页面等其他错误仍抛出，仍以新DOM快照的身份、数量、加载及正文匹配作为核验事实，不重放写入。9项适配器测试、Node类型检查、ESLint和Prettier通过。确认原Agent退出且页面显示保存成功后，通过官方开发入口重启加载；真实恢复与提交尚待继续，不能把单测通过当作闭环。

## 01:47 掘金公开全文与三图闭环

通过原任务“核验未知网页动作”续接同一Attempt第2代，launch `85594b1a-f62f-4428-891e-460186e4de66`、BrowserTask `60f58486-176e-4806-802b-e7cb787994b4`。已保存正文对账通过，三图未重复上传；Studio完成摘要、分类/标签“人工智能”、保存核验，单次点击“确定并发布”。真实成功页 `/published` 显示本篇标题和“发布成功！”，原生链接为 `/spost/7685648064543391790`。证据 juejin-before-submit.jpeg、juejin-submit-immediate.jpeg。

适配器依据原账号草稿服务端article_id打开 `/post/7685648064543391790`，最初404，稍后同一地址正常显示本篇。不能将最初404归因为错误路由或断言审核原因。Studio在同一第2代完成全文及三张公开图片匹配，WebAffair=completed、execution/publication=published，observedAt=2026-09-15T17:47:30.408Z，正式URL `https://juejin.cn/post/7685648064543391790`。证据 juejin-public-page.jpeg。本轮4/6公开闭环，CSDN已提交待审核，小红书仍未知。

执行计划分开验收：独立网页完成后，回到主窗口，侧栏已发布但当前计划仍停在第2代启动快照（正文结果未知、后三图位置等待、提交尚未观察、Attempt执行中）。截图 juejin-plan-stale-after-focus.jpeg 记录的是**刷新未解决的旧快照**。focus/visibilitychange补刷新未通过这次真实验收，不能声称实时执行计划已修复。切换其他任务再返回可以重新读取正确快照；根因仍待定位。

CSDN在开发重启时按保护规则由waiting-human转result-unknown，先前“发布成功！正在审核中”的页面证据仍有效。随后经原任务“核验发布结果”启动同一Attempt第2代，launch `f104d203-b739-45e2-9008-b9aa4570913d`。Studio重新导航本篇文章，账号、ID、标题、正文匹配，真实状态栏仍“审核中”，回到waiting-human；publication保留result-unknown，没有重发。证据 csdn-review-recheck.jpeg。该公开结果仍需平台审核完成；不将先前编辑页三图通过冒充本次公开三图核验。

## 本轮验收目标

用户授权 Studio 将 `/Users/apple/Desktop/研发日记/AIR/2026-09-11/小红书软文.md` 与其中三张图发布到既有的小红书、知乎、微博、头条、CSDN、掘金账号；本轮忽略 B站。题目为“做AI眼镜第190天，它跟我出门了”。所有平台填写、上传及最终提交由 Studio Agent / Studio 有界能力执行。Codex 操作 Studio 发布入口、诊断和修复，不代点网站最终发送。

真人验收动作：在 Studio 新建文章发布，读取本原稿，选择原账号和本篇独立草稿（适用平台），开始执行；观察准备、账号、原稿、逐图上传、正文、字段、保存、提交与结果核验的小步骤随真实事件变化。发布闭环单独记录实际回执或公开页面，只有点击提交但缺少结果证据的记为“已提交、待确认”。用户允许最后统一人工确认。旧第189天结果未知任务保持原状，新篇不能覆盖旧稿或用来重试旧提交。

## 21:27 已完成的入口修复

原生“选择要发布的 Markdown”窗口能预览新稿，但“打开”保持不可用；通过 AX 选择、打开动作及键盘确认未能完成，根因未定位。补充用户可见的“原稿完整路径 / 读取原稿”，与文件选择复用 `articlePublishing.inspectSource`。主进程继续检查 Markdown 扩展名、真实路径在当前工作空间内、图片真实路径和物料有效性；没有新 IPC 或文件权限扩张。路径编辑或重新读取会清掉旧预览，读取失败不能沿用旧预览创建任务。

真实 Studio 已通过该入口读取正确标题和三张原图（随行助手概念效果图、小眸表情设计板、小眸新图标）。尚未创建本轮任何平台发布事务，没有上传或提交。

工程验证：Web 类型检查、受影响 ESLint 通过；发布表单辅助及 ArticlePublishingService 测试合计 29 项通过。上述验证只覆盖入口与既有服务门禁，不证明六平台发布稳定。

后续平台选项的 AX 点击可聚焦，但键盘未改变值；鼠标坐标工具返回 `noWindowsAvailable`。已请求用户解锁并将 Studio 前置。这是当前执行环境阻塞，尚不能归因于平台发布逻辑。

| 平台 | 本轮执行计划 | 本轮发布闭环 |
| --- | --- | --- |
| 知乎 | 全部执行检查点完成，同一 Attempt 第3代只读复验通过 | 已发布；公开全文和三图核验通过 |
| 微博 | 同一任务第3代只读恢复与所有检查点完成 | 已发布，481字符正文与三图核验通过 |
| 头条 | 原 Attempt 第2代只读恢复，全部检查点完成 | 已发布，公开全文与三图核验通过 |
| 小红书 | 图文、字段、保存通过；单次提交结果未知，计划窗口同步缺口待修复 | 未取得匹配回执，管理页未见本篇；保留未知、不重发 |
| CSDN | 第1代连续完成建稿、图文、字段、保存与提交；公开核验等待平台审核 | 提交成功，文章165493415审核中；尚未公开闭环 |
| 掘金 | 第2代对账已保存正文后完成字段、保存、单次提交与公开核验 | 已发布，公开全文与三图核验通过 |

再次加载二级入口修复后，开启准备会话时工具明确返回 Mac 已锁定且自动解锁失败。已请求用户解锁并保持唤醒；没有开始新的上传或提交。当前仍只有知乎草稿箱原有两篇旧稿，本篇草稿尚未创建。恢复后先核对会话身份（开发重启会恢复到旧 CSDN 会话，不能直接往其中发续接指令），再由 Studio Agent 绑定原知乎账号、检查原生新建入口与本篇草稿存在性，继续创建并提交本篇新稿。不要把准备会话的“已完成”当作文章已发布。

## 21:58 知乎准备入口实测

解锁后已由 Studio Agent 核对账号深芯智造 / zhidfc1e，原草稿箱只有 08-25、08-26 两份旧稿，不含本篇。首次点击创作中心“发布内容”被通用敏感词护栏误认为最终发布。修复限定管理页侧栏入口后，Studio 实際点击成功展开菜单，真实二级“发布文章”链接为 `https://zhuanlan.zhihu.com/write`；该二级入口再次命中敏感词，尚未创建草稿。已补精确目标链接识别，仍限定管理页、唯一可见控件、无表单/编辑器/弹窗，不放开编辑页最终提交。新入口边界 17 项与 Browser MCP 53 项测试、Node 类型检查和 ESLint 通过。二级入口真实复验待继续。证据 `artifacts/article-day190-six-platforms-20260915/zhihu-creator-menu.jpeg`。

## 22:14 知乎正式 Runtime 已启动

解锁后 Studio Agent 实际打开了「发布文章」链接，二级敏感词误拦截修复通过。链接以新标签页打开，但 BrowserTask 仍绑定原草稿箱；`browser_get_tab_info.openedPageUrls` 的同 origin 过滤未暴露从 www.zhihu.com 打开的 zhuanlan.zhihu.com 编辑器。Agent 两次点击后，在原绑定页导航到刚从页面读取的真实 href，填写标题并核验自动保存，取得本篇真实草稿 `2083316981558670694`。正文仍空、无图片、未提交。多开的空白编辑标签页没有被填入文章。

Studio 表单已读取本原稿及三图，绑定既有知乎账号和本篇编辑地址、账号标识 zhidfc1e，点击「保存并开始执行」。WebAffair `64bcbb5d-9ff4-4ec1-968a-4a3752ba608a` / Attempt `4b291e4f-2064-45e2-95be-04e17a7696fc` 已完成管理页原稿恢复核验，Runtime running-ai。启动前界面证据：`artifacts/article-day190-six-platforms-20260915/zhihu-task-ready.jpeg`。实际上传与提交仍待运行结果，不将草稿准备回合已完成计为已发布。

## 22:28 知乎已提交，公开 CDN 匹配修复待真实复验

Studio 已完成三图上传、470 字符正文、标题字段与保存核验，于 22:22 点击最终提交并打开公开文章 `https://zhuanlan.zhihu.com/p/2083316981558670694`。真实界面显示发布于 2026-09-15 22:22，公开页三图 loaded=true。证据 `zhihu-three-images.jpeg`、`zhihu-published.jpeg`。

最终检查中图1/2进入 waiting：公开页使用 pica.zhimg.com WebP 变体，既有 verifyBody 仅接受 pic 数字 .zhimg.com，导致平台图片标识相同仍不匹配。已补 pica 的精确 host，继续核对平台 v2 标识、数量、顺序、前文位置与加载状态；附带拒绝 URL 凭据与非标准端口。适配器 17 项测试通过（含不同标识/位置/未加载/相似域名/凭据/端口拒绝）。

Agent 转人工时传了非契约 error 对象，日志证实存储 Zod 校验拒绝 code/message 缺失及额外字段。MCP 检查点 error 输入现已明确对象格式，并在进入事务写入前复用 shared schema 校验，错误不会伪装成存储故障。对应 MCP 7 项测试及 Node 类型检查、受影响 ESLint 通过。当前旧回合已完成退出，WebAffair 为 result-unknown / Attempt interrupted，随后通过官方开发重启加载修复；只读复验当前已发布文章，禁止重复提交。

本轮执行计划已实测显示各项核验事实，查看计划遮住原稿页时真实显示不可见等待；恢复原稿页后经「从中断处继续」在原 Attempt 第2代继续，未重复上传，最终完成3图与提交。`zhihu-plan-running.jpeg` 留存了恢复前的可见性等待界面。该事实只覆盖知乎，不能宣称六平台稳定。

22:30 真实复验：Studio 点击「核验发布结果」启动同一事务第3代，只读检查公开文章。三张 published 图片详情全部 completed，最终 WebAffair=completed、execution=published、publication=published，公开链接 https://zhuanlan.zhihu.com/p/2083316981558670694。未重复提交。闭环证据 zhihu-verified.jpeg。开始推进微博。

## 22:45 微博已发出；屏幕再次锁定

微博新事务 `4d50fee2-87ef-4f57-862b-cc898addc2c5`，Attempt `3e08ae83-cced-469b-9e48-bb73ec3d1d81`，UID `5961101548`。Studio 自动核验初始编辑框为空，逐图上传并核验3/3，填写冻结正文481字符，bodyMatchesFrozen=true，首行标题与公开范围通过。22:42:11 仅点击一次发布，30秒后有界回执观察器超时，主进程将事务置 result-unknown / Attempt interrupted。未重发。

真实 Studio 信息流已出现本篇，作者深芯智造，时间 2026-09-15 22:42，链接 `https://weibo.com/5961101548/RigKevSRB`。证据 `weibo-ready.jpeg` 与 `weibo-after-submit.jpeg`。首次点击「核验发布结果」因当前为信息流而停止，提示打开本篇公开详情；Codex 仅通过 Studio 可见地址栏打开已从真实信息流观察到的上述链接，网页 AX 已确认「微博正文 - 微博」与准确 URL。随后点击原事务准备再次核验，读取按钮时 Computer Use 明确返回 Mac 已锁定且自动解锁失败。尚未启动最终只读复验，无新提交。

下一步：用户解锁并保持屏幕唤醒后，查看同一微博事务的「核验发布结果」，如现在展示计划则直接点击；让 Studio 在已打开的原账号公开详情核验全文、3图与公开范围。成功后继续头条、小红书、CSDN、掘金。微博回执超时根因尚未取得请求匹配诊断，不能宣称该路径稳定。当前本轮1个完整闭环（知乎），1个已发出待自动核验（微博），4个未开始，B站按用户要求忽略。没有提交代码、推送或发版。

23:04 解锁后由 Studio「核验发布结果」完成微博原公开详情页的只读恢复（第3代）。账号、作品ID、481字符正文bodyMatchesFrozen与3/3图片通过，全部检查点完成、finish_attempt succeeded。公开地址 https://weibo.com/5961101548/RigKevSRB。未重发。证据 weibo-verified.jpeg。接下来准备头条本篇独立草稿。

## 23:23 头条本篇正式任务启动

Studio 准备会话 `daf5d679-abba-4b91-803e-eca25938d6d1` 已在原账号草稿箱确认没有本篇，创建标题微头条草稿并保存。新草稿 `1876411490609164`，编辑地址 `https://mp.toutiao.com/profile_v4/weitoutiao/publish?draft_id=1876411490609164`；UID `3777529577766638` 与真实主页链接一致，当前显示名「你好小眸」（以UID为准）。保存成功弹窗、草稿箱唯一记录、重新打开后的17字标题均由 Studio 读取。

准备阶段踩到实际布局问题：窄面板使头条创作侧栏折叠、右上按钮落在可见viewport外。Codex 通过 Studio 收起左右面板扩大浏览器，随后 Studio 点击右上“开始创作”进入错误的空白文章编辑器，创作助手又遮挡入口，通用护栏拒绝无文字关闭按钮。空白文章页未写入任何内容；Codex 仅用可见地址栏回到已经读取过的草稿箱，并在同一准备会话指出实际左侧“创作→微头条”入口。保持宽页面后，Studio 从侧栏读取真实href并完成建稿。保存成功弹窗的“前往”被泛化敏感控件拦截，Studio 通过已读取的草稿箱href回读，无重复创建/保存/提交。以上准备仍需操作者辅助布局及路径选择，不能称为完全稳定自动准备。

通过 Studio 正式表单读取原稿及3图，选择原头条账号、输入真实草稿URL与UID，点击“保存并开始执行”。事务 `aba211fd-8887-4604-b4cb-d1dbb49df5a5` / Attempt `32b73dd3-3009-4a73-98a0-527741b44fe9`，第1代Runtime已经通过原稿恢复与账号核验，推进到 upload-assets。此时 Computer Use 再次返回 Mac 锁定，已请求用户解锁；Studio 自身Runtime仍继续运行，因此持续只读观察其进度，未重启或改状态。

23:32 头条提交已派发：Studio在锁屏后仍自主完成3/3图片上传核验、冻结正文、标题/字段、保存、关闭配乐（checked=false），随后对签发的button.publish-content仅点击一次。工具返回“头条回执返回成功，但管理页尚未唯一对应本篇图文；只核验，不重发”，主进程记录publication=result-unknown、事务needs-attention、Attempt interrupted。还不能宣称公开全文和三图闭环。尚未取得管理页匹配诊断；下一步应通过原事务「核验发布结果」只读重查实际管理页，不应猜ID或重发。再次尝试Computer Use仍返回Mac锁定，已请求用户解锁。小红书/CSDN/掘金本轮未开始。

## 2026-09-16 00:20 头条原任务闭环

用户重启电脑后，确认开发服务未运行，通过官方 restart.sh start 恢复当前源码。原事务点击「核验发布结果」续接同一 Attempt 第2代，Studio 从管理页唯一匹配本篇并打开真实公开页 https://www.toutiao.com/w/1876411490609164/，完成全文及三张图片核验。WebAffair=completed、execution=published、publication=published，observedAt=2026-09-15T16:20:19.064Z。没有再次提交。真实界面证据：artifacts/article-day190-six-platforms-20260915/toutiao-public-result.jpeg、toutiao-verified.jpeg。本轮3/6闭环，继续小红书。
