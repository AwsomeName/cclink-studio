# 第192天六平台真实发布验收（2026-09-22）

用户授权原稿 `/Users/apple/Desktop/研发日记/AIR/2026-09-13/小红书软文.md` 及三图，使用原有账号发布 B站、微博、知乎、掘金、CSDN、头条。禁止小红书。最终提交均由Studio Agent与有界发布能力完成，Codex只操作Studio配置/恢复入口、读取证据和修复直接阻塞。

验收动作：在Studio逐个平台选择原稿、原账号并启动；观察账号与原稿核验、逐图上传、正文与字段、保存、单次提交、公开结果核验。平台待审核单独列出，不记为公开闭环。遇到结果未知仅对账，不重复提交，不改持久状态解除保护。

起点：源码448b9a8e、v0.1.94，工作区干净，上一轮修复仍在源码。本轮不提交、不打包。

## B站

15:52创建唯一WebAffair `2119bb5e-549b-47cb-afbd-eb1698c00add` / Attempt `7db61973-4c47-431a-aa39-b5c29a4f311a`，账号7c1ef8bb-7770-4c53-ad02-e4943f745fea、UID3546384070347419，勾选Studio单次提交授权。当前开始核验空白发布器和账号，尚未提交。

B站G1完成三图各一次、正文485归一化字符、标题与public可见范围、一次最终发布。平台返回作品1250805269620850689；16:04:56公开结果检查点completed，全文与三图通过。但Codex在Attempt尚未finish时切到微博新建表单，导致原B站View不可见，后续fresh inspect/finish被拒。16:06:25 owner归为result-unknown，作品地址保留 https://t.bilibili.com/1250805269620850689 。这是操作过早切换页面导致的收尾中断，不能称为全自动稳定完成。仅允许稍后从原任务只读核验归档，不重发。

## 微博

16:06通过Studio表单绑定同一原稿、账号9823a570-a412-4fba-bbc1-09df836991c6、UID5961101548，授权单次提交。WebAffair14eb29b2-671e-43e9-91ca-e60d11499e20 / Attempta101e08d-fa61-478c-8071-79e6e6c314cf，G1运行中。本次等待Attempt终态后才切换平台。

微博G1于16:16:33派发唯一publish/final，30秒回执超时进入result-unknown，未重发。G2只读恢复要求先打开本篇公开页；真实原账号首页已出现16:16作品链接，Codex仅点击该阅读链接，进入 `/5961101548/RjidbpQLs?pagetype=homefeed`，再由原任务G3核验。16:24:04 owner published/Attempt succeeded，正文506字符、标题、三图地址与加载一致。作品 https://weibo.com/5961101548/RjidbpQLs 。此轮实测带query微博URL修复通过；回执超时仍是需要对账的稳定性缺口，不重复提交。

## B站已完成核验后的恢复收尾缺陷

G2公开页证据有效，但resume保留历史verify-publication=completed；report completed直接幂等返回，不将publication从result-unknown更新为verifying，finish持续EVIDENCE_REQUIRED。按连续失败止损停止Agent。修复只读恢复时将verify-publication（含历史completed）置needs-reconcile并沿用当前代次重查流程，保留已派发副作用和历史证据，不开放publish。扩展既有B站回归覆盖历史verifying/completed，验证只读步骤重开且单次发布回执完整保留。140项状态测试、Node类型与受影响ESLint通过。16:31无活动Agent后使用正式开发脚本重启加载；待原Attempt实测。

16:34:12修复后B站G3真实只读恢复成功：publication=published、Attempt succeeded；正文/标题/三图及作者均确认。截图bilibili-completed.jpeg。此轮无额外B站提交。

## CSDN

通过Studio表单选择原账号c s d n（ff3592e8-517a-443d-a674-58105f7bc06b），同篇原稿三图，标签人工智能/语音识别/智能眼镜，分类人工智能，摘要保留自动读取标题，启动正式发布。

CSDN G1三图各一次、正文及位置保存通过，摘要与三标签通过。分类openSelector连续被`.catlog-guide-box`拦截；Studio只读controls取到唯一`button.btn-hide-catlog.el_mcm-tooltip__trigger`，截图证实为正文目录侧栏（不是分类引导），与右侧AI助手共同挤占窄页面。补充适配器仅在已识别正文、唯一可见`.catlog-guide-box button.btn-hide-catlog`时签发dismissOutline；策略沿现有新鲜页面与selector校验允许关闭，不创建发布副作用，错误selector/陈旧证据拒绝；Prompt要求先收起再inspect。115项适配器/策略/服务测试、Node类型、ESLint通过。16:56通过Studio停止Agent，已保存正文三图/标签保留，尚未最终提交，准备加载并原Attempt恢复。

CSDN G2真实关闭AI助手及目录侧栏成功；分类输入后Tab提交并回读人工智能，旧全文三图/摘要标签只读保持。17:01:57一次最终提交；17:03:58 owner published / Attempt succeeded，文章166367569，全文511归一化字符、三图、字段、账号与公开结果均通过。公开地址 https://blog.csdn.net/weixin_36388257/article/details/166367569 。截图csdn-public.jpeg。当前3/6公开闭环完成。

## 知乎

Studio准备会话核对zhidfc1e/深芯智造、已发表无本篇、2条旧草稿无本篇后，仅标题创建草稿2085777800296916861。草稿箱2→3，标题一致。正式表单绑定 https://zhuanlan.zhihu.com/p/2085777800296916861/edit 与原稿三图；WebAffair08a0d26c-2c99-49b2-bc8e-34b84eec296d / Attemptadf6dc74-b63b-400d-91a4-f05f82f3e2d1，G1开始真实执行。

知乎G1三图各一次上传、全文及图片位置、标题与保存均通过；17:20单次最终发布，真实页面出现“发布成功”。17:21:07在verify-publication阶段GLM服务返回429/1308：5小时使用额度耗尽，提示2026-09-22 19:38:34重置。owner及时转result-unknown，未重发；这次模型终态收敛正常，没有上一轮长时间滞留running。截图zhihu-submitted-quota.jpeg。公开作品链接对应2085777800296916861，最终主进程公开核验尚未完成。

Studio设置确认当前提供商智谱GLM、模型glm-5.2、Anthropic兼容后端；没有改动模型或凭证。已请求用户选择等额度恢复或自行切换可用模型。当前本轮4站已实际提交，其中B站/微博/CSDN为published，知乎结果待只读核验；掘金/头条尚未执行。不得将模型额度问题说成网站网络故障，亦不能由Codex代替Studio最终发送。

## 2026-09-23 续接

10:27发现开发版昨晚已正常退出，先由正式restart脚本启动，未修改持久状态。知乎原Attempt G2只读恢复，10:30:02 WebAffair published / attempt-finished succeeded；公开URL https://zhuanlan.zhihu.com/p/2085777800296916861 ，账号zhidfc1e、原稿ID、标题、正文495字符及三图加载/地址/位置均通过，无重复提交。截图zhihu-completed.jpeg。当前4/6公开闭环，掘金与头条待执行。

## 掘金（2026-09-23）

Studio准备会话核对原账号4382008413004393/深芯智造，已发表无本篇，草稿仅旧第189天；创建并保存仅标题新草稿7688298824981037071。一次等待保存selector超时，随后草稿箱实际读回本篇，草稿总数2，无重复新建。

正式事务17ef8ba7-cb45-4fe2-ab96-b4468350dc0d / Attempt0a1ce323-c946-43b9-84c3-ec41184fcfbb，G1全流程。三图每张一次上传，全文与位置、摘要、人工智能分类/标签、保存均通过。单次最终提交后进入published成功页，公开新文章7688232642778529832；初始导航meta标题短暂为找不到页面，Agent随后extract已读到正文，禁止的network logs调用被拦截后改用正式适配器inspect。10:47:08 owner published / attempt-finished succeeded，原账号/标题/全文/三图均核验通过，无恢复无重复提交。公开URL https://juejin.cn/post/7688232642778529832 ，截图juejin-completed.jpeg。当前5/6公开闭环，剩头条。

## 头条（2026-09-23）

准备会话曾重复请求browser_evaluate而等待权限；未批准，停止旧浏览器任务和Agent后正常释放账号锁。纠正为extract/links/controls常规工具。窄窗口使草稿箱和存草稿受遮挡，Codex仅调整Studio侧栏/Agent面板宽度，网站动作均由Studio完成。查重无本篇，仅标题保存原稿1877089851948036。

正式事务3136738a-41bf-4e89-9a54-2654c6fccc84 / Attempt1c1476ad-bca7-4fff-8177-108f0a5a617f，G1三图每张一次、全文/字段/保存/关闭配乐通过，11:09单次最终提交。管理页本篇由审核中变为已发布，但普通inspect不识别微头条内容列表，G1在verify-publication waiting-human。

G2只读恢复已匹配原账号/标题/三图并打开真实公开页面 https://www.toutiao.com/w/1877089851948036/?enter_from=mp_group_management ，却报告没有唯一公开URL。真实日志显示弹窗由BrowserManager接管；旧代码仅等Playwright popup/原页导航，且公开URL严格解析拒绝平台实际来源参数。修复结果入口：复用现有getAccountChildPageUrls（来源Tab/Runtime/文档代次、账号、Profile、工作区与adopted均需一致），只接纳本次点击后新增子页；仅剥离已观察到的精确enter_from=mp_group_management，返回标准公开URL；其余参数、跨站、历史子页、多个不同作品、取消均拒绝。全部保留发布副作用和全文三图完成门禁。

相关100项测试通过（99项完整运行后新增未知query负例，入口11项重跑通过），Node类型、受影响ESLint及diff check通过。尚待重启后G3真实只读恢复；此时6站均已提交，5站owner已完成，头条管理页已发布但owner仍result-unknown。

11:19无活动Agent后正式开发脚本重启加载。头条G3管理页唯一匹配原账号/标题/三图，新增BrowserManager接管子页实际URL识别通过，定位并导航标准公开地址。11:21:21 owner published / Attempt succeeded；全文、标题、原作品ID与三张图片加载/地址一致，未重发。截图toutiao-completed.jpeg、toutiao-plan-result.jpeg；六平台权威最终快照status-completed-20260923.json，全部8个检查点completed，每站三图。

## 最终验收与边界

用户可执行验收：打开Studio文章发布侧栏，选择本篇各平台任务，六项均已发布；打开网页可读本篇；头条计划最后三张公开图片和公开结果均已核验。也可直接打开本文件各平台公开链接，核对标题、全文和三图。

发布闭环：6/6全部已提交、公开全文与三图核验通过；小红书未操作。最终发送全部由Studio完成，Codex只使用配置/恢复与布局入口。

执行计划可观测性：真实页面已观察运行、等待、结果未知、只读恢复及已核验变化；截图保留逐图/提交/结果状态。残余显示问题：头条成功只读恢复后，旧编辑器字段行（如标题）仍显示“已核验·本次等待处理”与公开页不可读提示，但最终公开结果与Attempt已完成；不能将此称作所有计划细节均完美通过。准备阶段仍需纠正evaluate请求与布局遮挡，发布后仍需手动触发只读恢复；因此本轮闭环完成，不等于六平台全程无人干预稳定。

工程准备度：本轮既有B站恢复140项、CSDN115项测试及本日头条相关100项测试、类型/lint门禁通过；真实头条G3修复回归通过。保留全部源码修改，未提交、未推送、未打包发版。
