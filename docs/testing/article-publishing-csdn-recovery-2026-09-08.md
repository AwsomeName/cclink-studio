# CSDN 最小恢复修复：真实验收记录（未完成）

用户功能进度（09-08 11:53 更新）：真实开发版已从管理页找回本任务原草稿，重启后保留已完成
步骤，并继续完成正文、摘要填写和保存复核。**save-draft 已真实通过；本轮另用本地测试任务通过了
实际 Agent/BrowserTask 绑定后的按钮终止、保留详情页以及超过一分钟的无后续动作观察。**
这不代表全部恢复故障注入场景或公开发布验收完成。原恢复任务没有重开，原稿和完成记录未改变；
应用保持运行但没有活动测试运行，登录未清除。下方保留各轮当时结论，最新结果见末节。

基于 HEAD `3ccda35f`（Studio 0.1.87）上的工作区修改，未提交、未发布。时间为本机
2026-09-07 23:38 至 2026-09-08 00:22 左右，Asia/Shanghai。

## 本轮只修实际闭环遇到的阻塞

- AgentPanel 无 Browser Tab 会话绑定时，不再强制选全局 `agent-default`。该会话不属于本地项目，
  原逻辑会与项目会话兜底效果互相切换。修改后多次启动、恢复未再出现面板循环更新。
- 新任务不能认领账号 Tab 上残留的数字草稿 URL。真实失败任务曾错误记录旧稿 `164148817`，
  立即终止，未产生平台保存请求。现只有本任务受保护的首次保存响应可以建立新草稿编号。
- 当前 CSDN AI 助手会遮挡保存按钮。适配器仅签发实际顶层
  `.edit-drawer-content > img.edit-title-close`，不进入 AI Chat iframe、不强制穿透点击。
  首次保存增加 trial 点击检查，发生在消费/派发授权之前。
- CSDN 的隐藏正文表单项对草稿保存也要求非空。首次建稿按冻结标题、标题前 10 字符的短占位、
  一次保存执行，每次写入前重新 inspect，仍使用原 WebAffair 副作用预写与同步派发闸门。
  占位使用真实正文 iframe，适配器要求 CKEditor 序列化正文少于 100 字符且无图片；这是当前站点
  自动保存阈值以下的建稿准备，**不算 fill-body 完成**。完整正文仍由后续原步骤替换。
- 主进程被动观察本 Page 主框架的实际首次保存请求和响应：仅 POST、status=2、空 article_id、
  冻结标题、短正文，且返回 code=200 和数字 article_id 时记录编号。超时、断连、非本次请求均不得猜编号或重建。
  取消后迟到响应仅可在同执行代次和已派发凭证下记回编号，不推进步骤、不导航；旧代次被拒绝。
- 保存响应取得编号后复用原草稿恢复协调器，从管理页按 ID 找回。真实测试曾在管理页重定向期间
  过早 evaluate，出现 execution context destroyed；协调器现在只对导航瞬态和页面尚未就绪进行
  有界只读重试，不重放保存。错误账号、错误标题、错误 ID、未保存状态仍拒绝。

继续使用 WebAffairService/current operation/transition/长 Agent Run/Runtime handshake。
没有新增 operation 账本、调度框架、迁移、内容哈希或 actionFingerprint。此前安全修复未撤销。

## 实际操作与证据

使用既有登录 Profile，账号目录 ID 为 `ff3592e8-517a-443d-a674-58105f7bc06b`，
页面真实账号为 `csdn:weixin_36388257`，全程没有要求重新登录。

第一次新任务通过界面和原生文件选择器创建。后续原生自动化反复选错文件，改用产品已有
`articlePublishing.inspectSource/createTask` preload 接口提交明确路径；不是修改数据库，所有任务
仍经过正式源文件/账号/持久化校验。**最终这份任务的创建不是全程鼠标界面验收**；启动、恢复、
继续均通过实际任务界面按钮操作，不能隐去这一验收边界。

本轮唯一真正形成平台草稿的测试任务：

```text
affairId       = 4c465867-25f6-478f-bd32-c857241dd6fb
attemptId      = 192f26f5-a8bb-4f5d-a0df-6d4047c45d00
title          = Studio 恢复验收 20260908-0011
platformDraftId= 164508531
platformAccount= csdn:weixin_36388257
source         = /Users/apple/Desktop/chat-cc/cclink-promotion/studio-recovery-acceptance-2026-09-07-2355.md
```

1. generation 1 的真实 Agent 收起 AI 助手、填写标题、通过 `browser_frame_execute` 写入 10 字占位。
   00:12:00 CSDN 实际保存响应为 `code=200, data.article_id=164508531, msg=保存成功。`。
   WebAffair 记录自己的编号；随后管理页读取撞上导航，保存动作记为未知，未再次保存或另建。
2. 修复只读就绪等待，重启开发版，点击原任务“核验未知网页动作”。generation 2 从管理页、草稿箱
   找回 `164508531`，核验真实账号、标题和服务器保存状态，签发当前 BrowserTask 的 permit。
   00:15:41 首次 inspect 完成。open-editor、verify-account 后续均为 completed；旧三项建稿副作用为 reconciled。
3. 在当前步骤 upload-assets、前两步 completed 时主动重启。重启后的真实持久化状态保留两步 completed，
   open-editor 的 attemptCount 仍为 2，verify-account 仍为 0，没有重建草稿或重放已完成步骤。
4. 点击同一任务“从中断处继续”，generation 3 再次从管理页找回同稿。导航诊断记录包含
   `/mp_blog/manage/article` 后到 `/mp_blog/creation/editor/164508531`，不是只用旧 URL 代替管理页查找。
   00:17:50 首次 inspect 完成，00:18:16 无图片的 upload-assets 完成；正文仍是占位，未假装正文完成。
5. 00:19:03 fill-body 进入 running。00:19:22.078 正式派发完整正文 iframe fill 的一次性授权，
   00:19:29.547 该副作用进入 result-unknown，fill-body 为 needs-reconcile。
   **只能证明正文动作已派发，不能证明完整正文已保存，也不能把该失败单纯归因于锁屏。**
6. 随后诊断 CDP 连续超时；改用 Computer Use 后工具明确返回 Mac 已锁定，需要用户解锁。
   停止开发版，防止无人看管继续推进。通过只读 jq 核对持久化结果，没有改写任何状态。

停止时：前三步 completed，fill-body needs-reconcile，其余 pending，publication not-started。
旧稿 `164148817` 未改动；保留所有失败测试任务，未删除、伪造 checkpoint 或认领别人的草稿。
中断前截图：`/tmp/cclink-recovery-164508531-before-restart.png`。

## 必须继续查的具体问题

- 正文动作后只读保存轮询目前上限为 24 次、间隔 250ms。此次约 7.5 秒后进入未知，
  与短轮询窗口相符；站点使用定时自动保存，因此等待窗口不匹配是高概率原因。
  但锁屏和测试诊断连接中断后，未能读回平台最终正文，不能排除正文事件同步或测试拦截的影响。
  **不要只改等待秒数便宣称修好。**下一次先读取服务器原稿与 CKEditor 当前值，核验正文写入事件
  和真实自动保存请求/响应时间，再作必要的有界等待修复。
- 有 draftId 的两次真实恢复及继续已验证；最初建稿后的管理页读取修复虽然在恢复路径实测通过，
  尚未在修复后的完整“全新任务 → 首次建稿 → 自动读回”路径重新端到端实跑。
- 此次重启确实重建了页面执行环境；但没有在真人运行中精确注入“恢复核验结束与 BrowserTask 创建之间
  Page binding 改代”的竞态。该排列仍只有跨服务自动测试，不可冒充实测完成。
- 没有真实图片上传、字段全覆盖或公开发布验收。发布未授权；测试侧设置请求拦截防误发，
  未以拦截代替产品保护或宣称发布成功。未知发布不重试、取消后不派发仍有自动化覆盖，真人矩阵未完成。

## 解锁后的接续步骤（不新建稿，不要求重新登录）

1. 用户解锁 Mac；启动当前工作区开发版，打开上述原任务与其已有登录账号页。
2. 先只读从草稿管理页找回 `164508531`，核对账号、标题、服务器正文与保存状态。
   本次正文若已自动保存，只对账现有结果；不要直接重发未知动作。
3. 修正实际正文保存确认问题后，点击原任务继续，要求 fill-body 真正完成，原前三步和 draftId 保持不变。
4. 在正文保存后的安全点终止，通过真实动作日志和页面检查确认 Studio 不再派发操作。
5. 补齐最终当前代码的创建—中断—继续真人验收。没有公开发布授权，不能做公开发布；
   发布未知分支暂只报告自动化覆盖，不能宣称整套文章发布闭环完成。

工程验证与产品验收分开：最终 10 个相关测试文件、170 项测试通过；web/node TypeScript 通过。
修改源码的 ESLint、Prettier 与 `git diff --check` 通过。测试不替代尚未完成的真人验收。
截至上述凌晨运行，正文保存与最终真人验收均未完成；上午接续的增量和剩余问题见下文。

## 2026-09-08 上午接续：真实原因与最小修正

以下是接续实测，不能用来覆盖上述失败记录。

- 10:03 既有登录仍有效。CSDN 自己的 getArticle 只读结果：164508531、原账号、原标题、status=2，
  服务器正文仍为 `<p>Studio 恢复验</p>`，不是完整正文。昨晚的保存确实没有落下。
- generation 4 通过原任务“核验未知网页动作”恢复。真实 frame fill 后 CKEditor.getData 已是完整正文，
  但 window.onbeforeunload 未设置，页面未进入 dirty，未观察到保存请求。查看当前站点已加载的
  HtmlEditor-CZUZSwee.js：change 监听更新正文；dirty 变化启动 60 秒定时器；正文至少 100 字符才自动保存。
- 诊断时对原稿正文执行一次真实 ArrowRight（只移动光标，不增删内容），页面立即 dirty。
  10:08:47.031 观察到站点自身 POST saveArticle（article_id=164508531、status=2、contentLength=275），
  10:08:47.222 返回 HTTP 200/code 200/同一 article_id。未点击保存或发布。
  **这一次键盘动作是诊断操作，不冒充修正版产品自动执行成功。**
- 最小代码修正：当前 CSDN 的受保护 iframe fill 取得并固定同一个正文 ElementHandle；填入后发送
  ArrowRight，让现有 CKEditor change/自动保存工作。获取元素后与键盘动作前均重新执行原同步取消/身份闸门；
  不重新解析到替换 iframe，不调用站点写 API。保存读回改为 75 秒截止、每秒只读一次，仍核对服务器原稿；
  取消、View/文档/Page binding 变化均废弃结果，不重发保存或发布。
- generation 5 又从管理页恢复原稿，并读到完整已保存正文。真实 Agent 调用 frameContent 却取到外层整页，
  随后申请任意 browser_evaluate；未批准。代码证实 frameContent 使用全局 activePage 且 frames.find
  首先命中同 URL 的 mainFrame。现改为任务传入 Page 的子 frame，多个匹配拒绝；listFrames 同步使用该 Page。
- generation 6 在草稿箱入口出现后中断，提示“草稿箱入口在使用前已变化”。真实 DOM 为草稿箱(2)，
  原实现把此前读取的动态数量带入精确名称匹配。现只匹配完整“草稿箱”标签及可选数字计数，仍要求唯一可见；
  不放宽真实账号、draftId、标题或保存核验。

额外诊断边界：测试侧 CDP 网络拦截期间出现连接/工作台读取超时；不能据此判定产品 Runtime 再次失效。
后续运行取消该诊断拦截，通过实际任务状态监控，在公开发布前用产品终止入口停止。没有公开发布授权。
所有接续仍使用同一 affair/attempt/平台草稿，未伪造数据库或 checkpoint，未新建替代草稿。

- generation 7 再次成功找回原稿，但 Agent 的 get/report_checkpoint 返回约 79KB 历史，SDK 另存的
  工具结果又被工作区边界正确拒绝。Agent 因读不到当前状态再次申请 browser_evaluate，未批准。
  真实界面点“终止”，随后停止开发进程；没有把终止点击直接写成整个事务 cancelled 的验收结果。
- 只在现有文章发布 MCP get/checkpoint/asset 返回中省略历史 events、旧代次 Runtime bindings、
  processedRuntimeEventIds 与 recentTransitions；当前 Attempt、operation、检查点、全部图片、全部副作用
  （包括未知与已对账）及 publication 完整保留。响应明确标记 historyOmitted；完整数据仍在唯一 owner
  WebAffairService 和诊断中，未删除数据或扩大文件读取权限。补测试证明源对象不变、未知风险不丢失。
  启动指令明确使用现有 frameContent + inspect 的 URL/body selector 只读正文，禁止任意 evaluate。

- generation 8 确认 MCP 当前状态可直接读取。原 iframe 读取参数仍不适用于该无独立 URL 的编辑器，
  Agent 报“未找到指定 iframe”，最后重新派发正文 fill。主进程 BrowserTask 动作约 61 秒成功、服务器原稿
  保存核验通过，但 HTTP MCP 调用端先在 60 秒超时。Agent 随后只读 inspect 确认 saved，并最终把 fill-body
  回报 completed、进入 fill-fields（在停止开发进程前已持久化），未重复建稿或发布。
- 进一步最小修正：现有 frameContent 增加 frameSelector 参数，不新增工具。文章任务必须匹配最新 inspect
  签发的正文 iframe/body selector，错误 AI frame 或过期文档拒绝；执行仍用传入的任务 Page。
  仅文章发布运行的内部 HTTP MCP server 设置 timeout=120000，覆盖主进程 75 秒保存核验期限；
  普通 Agent 与其他 MCP server 配置不变。当前 SDK 类型声明支持该字段；HTTP 默认每请求 60 秒的规则
  见 [Claude Code 官方说明](https://code.claude.com/docs/en/env-vars#environment-variables)。
- generation 9 改用真实界面点击“从中断处继续”，不附加第二条 CDP 诊断连接。管理页重新核验原稿成功，
  当前步骤为 fill-fields；open-editor/verify-account/upload-assets/fill-body 都保持 completed，
  attemptCount 分别为 2/0/1/5，正文没有倒退或重填。该代 launch=d5da263b-9481-46ad-b027-3f3f6f3f4c1b，
  BrowserTask=787b83d9-e3e5-4e1e-82ff-7b3e8d8c107d。
- generation 9 实际 Agent 读到摘要为空，按冻结摘要填写；BrowserTask 记录 fill 用时约 61 秒完成，
  MCP 正常返回成功（未再提前超时），Agent 继续调用 inspect。该次对完整等待链路使用的是修正版，
  没有人工补键盘、点击保存或伪造完成状态。

- 10:36:25 generation 9 的 fill-fields 实际完成，正文和摘要的 autosave 均为 verified；前五个步骤
  completed，当前 save-draft。10:36:58 Agent 再次 inspect 读到原稿标题、正文和服务器保存一致。
  10:37:14 报 save-draft verifying 后，10:37:28 又派发 manual-save:save-draft；30 秒后记录 result-unknown。
  真实界面随后因 Mac 锁屏不可读，不能确定这次点击失败是遮挡、按钮状态还是锁屏相关，也不能归咎登录。
- 代码可确定的额外阻塞：save-draft 完成门禁排除了全部 autosave 凭证，即使正文和摘要都已核验落盘，
  也要求另有一次手动保存。现保留 WebAffairService 为唯一状态 owner，仅补允许已 verified 的自动保存
  满足复核：必须有最新适配器证据，账号、原 draftId、冻结标题一致，saveState=saved，且本 Attempt
  没有任何尚未 verified/reconciled 的保存凭证。未知、未派发、错误原稿或失效页面均不能走此分支。
  不新增动作、不重试发布。**此最后修改仅自动测试通过，尚未在真实界面重跑。**
- 10:40 左右因锁屏停止开发进程，原草稿和全部进度保留，publication=not-started。
  解锁后下一步是启动开发版，在此同一任务点“核验未知网页动作/继续”，由现有恢复路径先对账
  manual-save 未知结果，再检查能否只读完成 save-draft；在发布之前用任务“终止任务”停止并核验不再操作。
  不需要用户重新登录；禁止通过直接改状态、新建替代稿或手动点发布完成验收。

剩余真实验收：最后 save-draft 修正、产品终止后的无后续动作、准备窗口精确 Page 改代注入，以及
当前 frameSelector 读正文的实际 MCP 路径。发布结果未知不重发已有自动化覆盖，但未进行真实公开发布试验，
没有此授权。当前仍不能给出“用户可稳定完整恢复”的结论。

10:44 最终工程验证：受影响的 12 个测试文件、236 项测试通过；web/node TypeScript、此次修改文件
ESLint 和 git diff --check 通过。保存复核新增 7 个针对场景：已验证自动保存可完成；错误 draftId、
错误账号、错误标题、未知保存状态、过期页面、尚待处理的保存凭证均拒绝。工程结果不替代上述未完成真人验收。

## 10:50–10:58 接续真实验收：保存复核通过，取消界面仍待验收

本次没有再改业务代码；使用上一轮修正版实际运行。仍为同一 affair/attempt/draftId，未重新登录、
没有新建替代稿、未修改数据库或 checkpoint，也没有公开发布文章。

### generation 10：完整走过保存复核

- 10:50:37 在真实任务详情点击“核验未知网页动作”。管理页按原账号找到 draftId 164508531；
  10:50:38.998 在 Agent 启动前只读对账，把 g9 manual-save:save-draft 从 result-unknown 变为 reconciled。
- 10:50:39.090 BrowserTask 创建后再次核验最终 Page，绑定新 Agent。launchOperationId=
  41be46c3-3d58-44e7-8927-74354e7eb725，BrowserTask=e1c2b937-54ed-4fe7-af55-ebca6865aaa9。
- 10:51:16.929 首次 inspect 通过；Agent 收起 CSDN AI 助手并重新 inspect，核对原稿标题、正文及保存。
  10:52:10.607 save-draft → verifying；**10:52:30.552 save-draft → completed**。
  此代没有任何新增保存、上传或发布副作用凭证；并未被迫再次点击保存按钮。
- 前五步 attemptCount 仍为 2/0/1/5/2；save-draft 为 2，保存完成状态在下一次重启后仍保留。
  这证明首次检查后继续完成了原来未完成的步骤，不只是 inspect 成功。
- 进入 publish 检查点后，为遵守“不公开发布”范围，尝试打开任务详情并终止。实际截图曾显示
  “正在读取发布事务…”，原生 AX 终止点击没有获得成功确认，随后出现 noWindowsAvailable。
  10:54 停止开发进程确保安全；publication=not-started、没有发布副作用。**不能将这次进程停止记为
  产品取消按钮通过。**

### generation 11：取消已落盘，但界面链路不作通过结论

- 重启后详情正常打开，前六步均 completed。只读调用现有 getSnapshot 返回约 4.7 ms。
  这不足以定位之前的加载阻塞；不能贸然把它归因于服务端队列、CSDN 登录或页面绑定。
- 为验收启动后的取消，通过真实产品“从中断处继续”按钮启动；管理页仍恢复原稿。
  launchOperationId=a9215371-f06c-4386-89b0-2286e418097b，BrowserTask=7adb386c-176a-4bd0-aa91-587751e0fbba。
  本轮未等到首次 inspect，便尝试终止；不能把此代算作另一次完整恢复验收。
- 通过开发版 renderer 的 Playwright DOM 可读到“终止任务”按钮，但后续定位/点击出现超时。
  最后调用的是产品既有 articlePublishing.terminateRuntime preload 接口，参数来自当前 getSnapshot，
  不是修改状态文件。该调用的测试侧返回也超时，随后停止开发进程。
- 持久事件证明：10:58:10.732 `USER_CANCELLED` 已发生；WebAffair、execution、Attempt 均为 cancelled，
  当前 Agent/BrowserTab/BrowserTask bindings 均为 terminal；开发进程停止日志在其后。
  generation 10 和 11 的新增网页副作用均为零，publication=not-started。
  但无法以此证明用户单击终止按钮已正常返回，也没有完成进程保持运行情况下取消后的观察窗口。
- 剩余可见状态问题：cancelled 事务的 publish checkpoint 仍为 running；这是进度展示与终态投影待核对项，
  不能称仍有发布动作在执行（当前 Runtime bindings 已终止，发布从未派发）。

同一取消界面阻塞重复两次后执行止损：不继续重启碰运气，不凭猜测改 AgentPanel 或通用 IPC。
下次应先隔离“详情加载/终止响应”的真实 renderer 与主进程事件，再进行正常按钮取消验收；
不能重新开启这个已取消任务来制造成功，也不能篡改已完成的保存证据。
准备窗口精确 Page 改代注入、frameSelector 正文读取的实际 MCP 路径，以及真实发布结果未知场景仍未补齐；
最后一项涉及公开发布，没有授权，本次不得执行。

本轮仅更新验收记录，未重复运行上一轮已通过的 236 项工程测试；git diff --check 通过。

## 11:36–11:53：终止响应与迟到切页的最小修复

### 事实、修复和未证实的部分

- 对原已取消任务仅作只读检查：三次详情切换分别约 324/285/268 ms；从 CSDN 网页返回详情约 750 ms，
  没有 renderer pageerror，getSnapshot 基线约 4 ms。**未复现原先的无限加载，不能把所有超时都归为同一根因。**
- 确定的等待耦合：ArticlePublishingService.terminateRuntime 原来先等待 AgentBridge.abort 回执，
  才持久化 WebAffair 的用户终止。测试令回执保持 pending，旧代码无法返回，修正后通过。
  现先同步 cancel BrowserTask 拦住写入；请求精确 Agent Run 取消但不等待其回执；仍等待 WebAffairService
  持久化终止后才向 UI 返回。Agent 真实退出仍由原 AgentBridge 自己确认，不伪造 Agent 终态。
  取消请求异常只记录运行身份，不泄露数据。没有新增取消协议、任务账本或第二状态 owner。
- 确定的可见竞态：已绑定测试任务 f7e021bf… 在 11:46:53.824 已 cancelled，但当前 Tab 随后变回 CSDN、
  详情 footer 不存在；再次点任务 Tab 就立即读到“已终止”。源码 executeTask 在多次 await 之后无条件
  activateTab(browserTabId)。去掉这一次迟到切页；main 启动时已经打开账号页，原打开网页按钮不受影响。
- 统一状态 reducer 在取消时把当前正在执行/等待/验证的 checkpoint 置为 needs-reconcile，不再残留 running。
  已完成步骤不动，发布已派发且未知时仍走原 result-unknown 分支。没有修改原任务的历史数据或执行迁移。

### 本轮测试任务（不是原恢复任务的替代品）

五条任务均通过现有 createTask preload 创建本地记录，使用原测试 Markdown 和已有账号；
启动和终止使用真实 renderer 产品按钮。没有改数据库、checkpoint 或伪造平台证据。
创建并非全程文件选择器操作，此边界不隐去。全部在网页写入前终止，平台 draftId 为空、sideEffects=[]、
publication=not-started；本地记录保留供复查，没有删除用户数据。

| 本地任务 ID | 验收作用与真实结论 |
| --- | --- |
| de702f4d-612d-4059-95f6-ced1e21914a7 | 启动阶段取消，11:44:01.573 持久化终止，界面显示已终止 |
| f920285a-b151-46bf-b365-812e749a49ca | 曾仅凭 execution=running 误判已绑定；最终没有 Agent 绑定，只算启动阶段取消，不计入运行中验收 |
| f7e021bf-0c22-4d15-9664-c01423f60a38 | 有真实 Agent/BrowserTask 绑定，取消成功，但迟到启动回调把用户切回网页；用于定位切页竞态 |
| e22bb5fc-c509-4e79-abcd-31a67c252f19 | 去掉迟到切页后取消显示并留页；最终记录无 Agent 绑定，仍只算启动阶段覆盖 |
| f3f92ed8-edcf-43d7-ae9b-7464cc70b94e | 最终合格的已绑定运行取消验收，详细身份见下 |

最终一轮不再依赖异步等待条件的布尔结果：先直接读取并输出当前真实身份，确认后才点击终止。

```text
affairId      = f3f92ed8-edcf-43d7-ae9b-7464cc70b94e
attemptId     = dd222854-01f2-4bdf-9207-a5331e763d48
generation    = 1
launch        = 001a779c-68a1-4c5a-a05d-92275d2da6d7
Agent Run     = run-001a779c-68a1-4c5a-a05d-92275d2da6d7
BrowserTask   = 74153b26-0827-4675-833b-eb1e12a37218
绑定时间      = 11:50:14.540
用户终止时间  = 11:50:41.838
```

- 点击前 execution=running、Attempt=running-ai，Agent Run/BrowserTask 非空，三项 bindings 均 active。
- 真实“终止任务”点击后约 **198 ms**，可见 footer 为“Attempt：dd222854 · 已终止”，仍选中此任务详情 Tab。
- 随后分别通过原 agent.getRunStatus / browser.getTask 读取，Agent 和 BrowserTask 均 cancelled；
  WebAffair 与 Attempt 均 cancelled，bindings terminal。未以退出开发进程代替取消。
- 到 11:53 前后，应用仍运行，已超过 60 秒：任务仍 cancelled、详情页没有切走、sideEffects=[]、
  draftId 为空、publication=not-started。原恢复任务 4c465867… 的最后事件仍为 10:58:10 取消，
  原 draftId 164508531 和 10:52:30.552 的 save-draft completed 记录未变。

### 工程验证和剩余边界

246 项测试（13 个文件）、web/node TypeScript、受影响文件 ESLint、git diff --check 通过。
新增/加强覆盖：取消回执 pending 不阻塞事务终止、取消后未派发动作被拒且步骤不残留 running、
启动回调不得重放网页焦点。最后一个是源码约束回归，异步界面行为另由上述真实 Electron 操作验证。

本轮已关闭所测试的取消响应/迟到切页问题，不再以此要求用户登录或处理网页。
仍未证明：原先所有加载超时的唯一根因；准备窗口精确 Page 改代的真人注入；最新 frameSelector 读取的
实际 MCP 路径；保存/发布已经派发瞬间取消的全部真实网络时序。真实公开发布及发布结果未知试验没有授权，
仍未执行。上述边界不得用自动测试通过替代。
