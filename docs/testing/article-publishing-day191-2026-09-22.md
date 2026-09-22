# 第191天六平台续验（2026-09-22，进行中）

原稿：`/Users/apple/Desktop/研发日记/AIR/2026-09-12/小红书软文.md`。用户已授权六平台投稿，小红书禁止自动化投稿。所有网站提交由 Studio Agent / 有界发布能力完成。

## 用户功能事实

- B站：WebAffair `eb2c0a69-c200-486f-bcb1-21b6ce516a06` 已完成，公开地址 https://t.bilibili.com/1249973308685811731 。本轮没有重发。
- 微博：原事务 `e4422236-6532-439b-94b7-c915d047237b` 的9月20日提交实际已成功，旧记录因回执超时保持结果未知。9月22日在原账号个人主页找到同稿，打开 https://weibo.com/5961101548/RiX22ovwL?pagetype=profilefeed ，真实页面显示公开、完整正文和三张图片。Codex 只导航查看，没有发送。
- 通过 Studio 原任务“核验发布结果”启动 G4，只读核验。Agent 导航到不带查询参数的作品地址后，主进程完成账号、作品、全文、逐图验证，10:06:48 WebAffair publication=published，随后结束 Attempt。公开地址 https://weibo.com/5961101548/RiX22ovwL 。未重传、未重发、未编辑持久化状态。
- CSDN：原任务 `3ce3ee38-c230-4c3a-8c00-1ef18510dc34` 从打开编辑器中断位置恢复。G3 已实际完成冻结标题、建稿占位和首次保存，取得草稿 `166343596`，账号 `csdn:weixin_36388257`，G3 完成三图上传与全文，分类复合控件未被支持而安全暂停。修复后 G4 在同一草稿中通过原生 fill + Tab 补齐分类，核验全部字段和保存；10:43:07 由 Studio 单次派发发布，跳转成功页。文章地址 https://blog.csdn.net/weixin_36388257/article/details/166343596 ，真实页面可见全文和三图，但标注“审核中”。10:44:53 verify-publication=waiting-human / PLATFORM_REVIEW_BLOCKED，publication=dispatched，不能算公开闭环。
- 知乎：11:43:13原Attempt完成，WebAffair publication=published，公开地址 https://zhuanlan.zhihu.com/p/2085684921817896224 。正文514字符及三图位置/加载、账号、作品ID均由Studio核验。掘金：13:00:07已完成公开核验，地址 https://juejin.cn/post/7687897973762359306 。头条：待执行。

## 执行计划验收

微博真实计划从“结果未知”恢复到公开结果核验，三项公开图片分别有主进程证据，最终显示已发布。CSDN 本轮观察到建稿、账号、上传、正文、字段、保存、提交、核验阶段变化，分类等待后同 Attempt 恢复成功；最终计划如实停在平台审核。

## 工程修复与边界

微博公开页探针以前只返回去掉查询参数/末尾斜杠的规范作品 URL。主进程对页面完整 URL 做严格相等检查，造成带 `pagetype=profilefeed` 的真实详情页被误判为文档变化。新增同次 DOM 观察的 `documentUrl` 供探针身份校验，作品引用继续使用规范地址；没有放宽 Runtime、账号、正文、图片或导航失效保护。

验证：微博回执、适配器及发布策略共100项测试通过；Node 类型、受影响 ESLint、diff 检查通过。修复已于10:38在草稿保存且 Agent 停止后通过正式开发启动脚本加载，同一 userData 与原 Attempt 恢复；带参数微博页面修复尚未做真实复验。

另外观察到两站恢复首次均因旧 Tab 不存在而“账号浏览器 Tab 创建超时”，新账号 Tab 实际已创建，第二次正常恢复可用。源码线索是 main 固定等待旧 preferredTabId，renderer 在旧 Tab 不存在时创建新 ID；尚未修复，不能通过放宽原 Tab 保护仓促解决。

证据：`artifacts/article-day191-20260922/weibo-public.png`、`status.json`（采集时刻快照）。用户可在 Studio 文章发布列表选择第191天微博任务查看细步骤，并打开上述作品核对全文三图。本记录会随着本轮继续更新。

## CSDN 分类直接阻塞修复

真实页面使用 `.column-name-selection span.tag__name[contenteditable="true"]` 暂存分类，Tab 失焦后组件才把值提交到其 `input[name="categories"]`。适配器只在唯一组件/控件时签发选择器；冻结分类之外的输入、Enter、陈旧 pendingValue 均拒绝。输入缓冲不能冒充已保存字段；Tab 进入现有 save-draft 副作用链，主进程只认回读隐藏表单值。没有改写持久化发布状态。

CSDN 适配器、发布策略、服务共114项测试通过，Node 类型、受影响 ESLint 和 diff 检查通过。G4 真实执行已证明分类写入、平台保存和发布成功页；平台审核未通过，因此仍不声明公开闭环。真实界面证据 `artifacts/article-day191-20260922/csdn-submitted.jpeg`。

10:48 后由 Studio 准备知乎本篇独立标题草稿，先检查同名草稿存在性，再进入正式 WebAffair。

## 知乎准备选择器错误（10:50）

首个准备 Agent 调用了 `button:has-text("发布内容")`，但真实页面控件是 div，匹配0个。现有精确创作入口识别正确拒绝了错误目标；通用敏感护栏却将匹配0/多目标归为“无法识别的提交控件”并暂停整个任务，阻止 Agent 重新观察。改为在派发前抛出可恢复的选择器错误（不点击、不转人工），真实敏感目标及无法检查的目标保持原保护。Browser MCP + 知乎入口70项测试通过，Node类型、受影响ESLint、格式检查通过。10:50所有Agent停止后重启加载。

另一个残余问题：重启恢复的会话投影仍是旧工作区快照，刚创建的准备会话在UI检索不到；WebAffair事实独立保留。原知乎准备阶段没有任何写入，已通过新准备会话重新绑定账号、重新查重继续，不是重复发布任务。CSDN重启后owner将已派发待审核任务置为result-unknown，后续只能只读核验，不得重发。

## 知乎跨子域子页与正式启动（11:03）

真实 Studio 界面已出现同账号 `https://zhuanlan.zhihu.com/write` 空白子页，但 `getTabInfo.openedPageUrls` 只接受与 `www.zhihu.com` 同 origin，返回空列表，Agent 因而反复点击菜单打开多个空白页。已通过 Studio 停止准备回合，无文章内容写入。修复仅允许 BrowserManager 已校验同账号、同Profile、同工作空间、同源Tab代次的 adopted 子页中，来源 `https://www.zhihu.com` 的精确 `https://zhuanlan.zhihu.com/write`；其他跨origin和带secret URL仍不返回，未切换任务绑定。Browser MCP54 + popup45 + 入口17 =116项测试通过，Node类型、ESLint、diff通过。此修复尚未重启加载，不算真实复验。

为保留现场，给原准备会话提供真实UI观察到的新建编辑器URL，由 Studio 重新绑定原账号，在原任务Tab导航此地址。Studio只填写本篇标题，自动生成草稿 `2085684921817896224`，刷新后标题保持、正文0字。11:03通过正式发布表单绑定该草稿、原稿三图及账号zhidfc1e，启动 WebAffair `181c0f55-beb1-4e45-b86d-0e476fefa870` / Attempt `e8872f42-03bd-41ad-b636-cdfeeed03b99`。Runtime已成功恢复原稿并启动，发布尚待结果。

## 知乎第二张图片上传后的保存核验与恢复（11:18）

G1 实际上传了前两张图，但第二张上传后保存核验超时。只读诊断发现原稿、账号、标题、正文和图片数全部一致，差异仅为官方 CDN 的同一图片：页面使用 picx.zhimg.com/80/v2-…_1440w.png，草稿返回 pic1.zhimg.com/v2-….png。适配器保存比对增加官方图片 ID 规范化，同时保留精确 host、HTTPS、无凭证、路径形态检查；不同 ID、伪装域名仍拒绝。保存不一致诊断仅记录无查询参数图片地址及匹配摘要，不输出鉴权参数。

知乎适配器23项及发布策略87项共110项测试通过，Node类型、受影响ESLint和diff检查通过。11:13 Agent停止后重启加载，G5真实恢复已通过原稿保存状态核验；仍因旧图片上传结果未知而拒绝绑定Runtime，保护没有关闭。

通过真实独立浏览器窗口观察原稿中的第二张导航效果图后，11:18在原任务使用Studio“网页里有这张图”有界对账入口，第二图变为uploaded。同一Attempt G6恢复成功，Studio Agent继续第三图；未改写持久化状态、未新建发布任务、未重传前两图。此入口记录为人工确认来源，是Codex依据页面观察操作Studio，不应称为无需介入的自动恢复。全文与最终发布尚待核验。

11:10已加载跨子域子页发现修复；尚未重新做真实新建入口回归，不能将单测算作该入口已闭环。

11:19同仓库另一项Tab测试的清理脚本意外终止默认开发实例，第三图上传期间Agent以143退出。协调后其他任务已承诺只管理独立测试进程。默认实例重新启动后真实原稿只有前两图；11:22通过Studio“网页里没有，重新上传”对账第三图，原Attempt G7恢复。前两图保持uploaded；第三图允许第二次尝试，非重复任务或持久化状态解锁。11:23第三图上传动作返回，后续核验继续。

## 知乎正文组装的同图地址轮换（11:29）

G7第三图于11:24:33完成主进程核验，11:25进入fill-body。第二图在刷新后由picx切换pic1，虽然保存比对通过，通用matchedAssets与prepareBodyWrite仍按地址完全相等，阻止正文派发。补齐知乎专用的唯一官方图片ID查找：只接受已有已核验ID对应的单张加载图，返回当前签名URL用于原生正文写入；不同ID、非官方域名、HTTP、带用户信息或重复同图均拒绝。其他平台不改变。

新增7项图片查找测试；知乎30项+发布策略87项=117项通过，Node类型和受影响ESLint通过。11:29停止反复失败的Agent；owner将未派发的正文授权置为rejected，无未知正文写入。三张原图均uploaded，等待加载修复并通过原Attempt实测。此时仍无知乎提交证据。

## 已保存正文的凭证选择修复（11:36）

G8于11:31:41由Studio真实派发正文，11:31:44主进程核验514字符与三图顺序/位置/加载、同账号草稿保存均通过。完成检查点却被旧G7未派发的rejected保存授权遮挡：eligibleEffects按数组先取旧拒绝记录，没有选到G8已派发的真实凭证。修复仅排除status=rejected且没有dispatchedAt的记录；已派发或结果未知仍需对账。新增“旧拒绝后成功写入”和“只有拒绝没有真实写入”的状态回归，134项通过，未修改用户持久化数据。知乎Prompt补充同原因失败两次结束，避免刷新或换工具重复回报。

11:35已停止Agent；已保存全文三图的G8副作用保留，下一代应只读核验恢复，不重填正文。图片现场证据zhihu-body-saved.jpeg，尚无知乎提交证据。

11:37加载凭证修复后G9从原Attempt恢复；11:38:53 fill-body只读完成，没有再写正文；随后标题、保存均完成。11:41:19 Studio Agent单次派发publish/final，真实页面跳转 https://zhuanlan.zhihu.com/p/2085684921817896224 并显示“发布成功”，公开页面正文514字符及三图可见。真实证据zhihu-published.jpeg。最终WebAffair公开结果检查仍在继续。

## 掘金准备及正式启动（11:49）

Studio准备会话在UID4382008413004393账号中检查作品与草稿，创建仅标题草稿7688013345149157376，真实编辑页显示保存成功。通过Studio正式表单冻结本篇原稿、3图、摘要、人工智能分类及单标签，绑定原草稿 https://juejin.cn/editor/drafts/7688013345149157376 。WebAffair 40e14925-cb41-4389-ae43-1be71e5a347c / Attempt 4bebeb4c-a3bb-4e4b-bff0-187e775ed71a 于11:49:58成功核验草稿并启动G1。尚无掘金发布结果。

掘金G1完成三图各一次上传、全文与位置保存核验，进入fill-fields并写摘要；03:55Z页面绑定暂时失效但主进程随后确认健康。Agent于04:00Z返回API Error: Response stalled mid-stream，owner没有立即结束，04:16Z进展租约到期、04:25Z安全中断。尚无发布动作。12:47原任务字段步骤恢复并绑定G2，不重传正文或图片；模型终态与进展租约收敛延迟是残余稳定性问题，未把它报告为网页发布成功。

## 掘金已对账摘要的只读完成分支（12:54）

G2恢复后标题、摘要、分类、单标签与冻结配置一致，正文三图也匹配且saved。但旧摘要dispatch详情保留G1已完成，而effect已reconciled；只读字段完成分支仅接受本代skipped，因而要求不存在的新写入凭证。修复允许历史completed字段dispatch参与只读完成，仅当同Attempt/同历史代次/同字段存在dispatchedAt且status=reconciled的保存凭证、当前页面证据新鲜且全文匹配、该字段本代verify=completed，原账号、草稿、标题及保存条件仍必须通过。不同字段、未派发、陈旧页面、正文不符均拒绝。

新增5项恢复字段回归，总139项状态测试通过，Node类型与受影响ESLint通过。G2已按两次失败规则停止，加载后继续原Attempt，不重新写摘要。仍无掘金提交证据。

掘金G3恢复字段后完成保存；12:57:43 Studio单次派发最终提交，跳转/published取得作品7687897973762359306。首次公开页短暂找不到，稍后同地址生效。13:00:07 WebAffair publication=published、Attempt succeeded；全文和三图位置/加载通过。截图juejin-result-pending.jpeg记录短暂未生效，juejin-public.jpeg和juejin-public-title.jpeg记录公开结果。未再次提交。

## 头条准备续接

准备 Agent 已查内容管理无第191天、草稿箱为空，并核对你好小眸 UID3777529577766638。开始创作默认进入文章编辑器，体裁菜单“发布文章”被通用敏感动作保护误判，未点击、未建稿。后续提供此前真实页面已观察的微头条入口 `/profile_v4/weitoutiao/publish`，Studio通过正常账号绑定新建浏览器运行（非发布WebAffair），直接进入微头条编辑器，仅写标题。保存草稿首次被发文助手抽屉遮挡，Agent正在按真实DOM寻找收起入口。未放宽最终发布保护，未直接改持久状态。

头条准备完成后取得draft1877007769193536，13:17通过正式UI创建唯一WebAffair b75c91ce-e36f-4420-9443-7eb8e2b366bc / Attempt96eba9e5-f246-49e1-a54a-8ead6f490519。G1自动核验原账号原稿、关闭助手、三图各上传一次、冻结全文514归一化字符核验、保存及关闭配乐。13:25:18 Studio Agent单次派发publish/final，返回微头条管理页，第一条作品同标题全文三图、时间13:25，状态审核中。13:27转等待核验，未重复提交。截图toutiao-body-saved.jpeg、toutiao-submitted.jpeg。本轮六站实际提交已齐，头条与CSDN尚不能声明公开闭环。

13:29从原CSDN任务点击“核验发布结果”，同Attempt G5只读恢复。13:30:03 owner publication=published、Attempt succeeded：公开作品166343596，账号csdn:weixin_36388257、标题、bodyMatchesFrozen=true且无publicationBlocker。未再次填写/上传/保存/发布。公开链接 https://blog.csdn.net/weixin_36388257/article/details/166343596 。此时桌面工具返回空AX且无截图，未能补采公开截图，不以旧审核中截图冒充已公开证据；owner快照status-1330.json保存实际核验结果。

当前验收分列：执行计划在真实Studio展示准备、账号原稿核验、逐图上传核验、正文、保存、提交和结果等待，事件驱动状态可见。发布闭环：六站均已实际提交，B站/微博/知乎/掘金/CSDN已被owner核验为published；头条最后观察为审核中，当前waiting-human/verify-publication，尚无公开全文三图结果。整体尚不能声称完全无人介入稳定运行；本轮发生代码修复、恢复对账及准备入口人工指导。当前请求保持解锁与前台，以继续头条只读核验。
