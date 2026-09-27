# 第194天六平台真实发布验收（2026-09-26）

授权原稿 `/Users/apple/Desktop/研发日记/AIR/2026-09-15/小红书软文.md`，标题《做AI眼镜第194天，专门留一天还体验债》，原有账号发布B站、微博、CSDN、知乎、掘金、头条，排除小红书。

验收动作：Studio选择原稿及三图、核验账号和原稿、上传/填写/保存/单次提交，核对公开全文及三图；逐平台等待owner终态再切换。分别记录执行计划可观测性与发布闭环，记录任何人工干预。已有授权不重复询问；未知结果只读恢复，不重发、不改持久状态。最终提交全部由Studio完成。

起点：原稿及三图存在，WebAffair没有第194天任务。开发版已退出；通过正式开发脚本启动。保留前轮发布修复及其他任务Agent授权/后端改动，不提交不发版。

## B站（已完成）
- WebAffair：ecbac63a-7099-413a-87ad-e022c8bc153b；Attempt：23eab87f-fed2-4b9b-9fa0-05e5e02f4b69；generation 1。
- 2026-09-26 02:33：execution/publication 均 published，attempt-finished succeeded，8 个检查点全部完成；单次提交，三图各上传一次。
- 公开地址：https://t.bilibili.com/1252080501214150662 。Studio 核验作者、全文、三图、public。
- 证据：artifacts/article-day194-20260926/bilibili-published.jpeg。
- 额外往返：Agent 首次回报遇证据过期、running→completed 顺序错误，自行重新 inspect 并正确经过 verifying；Codex 未代点网站发布。
- 实际开发版界面版本为 0.1.96；已安装 0.1.93 曾持有单实例锁，正常退出后开发版启动。

## 微博（未提交，恢复受阻）
- WebAffair：0cf66ceb-2fd5-4114-8aa0-d944a4736d3a；Attempt：bf4e1530-20fc-4b50-aadb-eb87dc246887。
- 02:35:42 第1图上传派发后，Agent process exited with code 143；随后开发日志显示完整新启动，说明应用发生重启。本任务未触发这次重启，未确定外部触发者。
- publication=not-started；第一图 reconciling，其余 pending。
- 原任务“从中断处继续”进入 generation 2，但 main 拒绝：当前临时编辑器没有可恢复草稿身份。未新建微博重复任务、未修改持久状态。
- 界面证据：artifacts/article-day194-20260926/weibo-recovery-blocked.jpeg。
- 缺口：缺少微博临时编辑器跨重启的可靠图集身份与有界对账恢复能力；不能单凭新页面为空推断旧附件完全丢失。

## CSDN（已提交，审核中）
- WebAffair caf71a37-20c5-481a-8372-14c6fbb36f6b，Attempt 7c08eb1d-86ef-4cf8-9be4-86b74546d03b。
- 单次提交成功页 /creation/success/166652934；结果页 https://blog.csdn.net/weixin_36388257/article/details/166652934 。
- 正文、账号、标题、三图位置/地址/替代文字/加载全部一致；平台审核中，verify-publication waiting-human，publication dispatched，未声称公开成功。
- Codex 只收起 Studio 两侧面板缓解窄页遮挡；Agent 自行通过签发按钮关闭 AI 助手及目录，完成字段和提交。三图各一次上传。多次自动保存相关操作约62–65秒。
- 界面 artifacts/article-day194-20260926/csdn-public.jpeg 是作者结果页证据，非公开通过证据。

## 知乎（已完成）
- Studio Agent 经发布列表/草稿箱去重后创建标题草稿，正式事务 434d6979-87fe-4bab-aada-2c7f72f060c4 / Attempt 803b2870-0185-47ad-9f28-a670dc030809，generation 1。
- 03:05:57 execution/publication published，attempt-finished succeeded。账号 zhidfc1e、标题、正文699字符和三图通过，三图各一次上传，仅一次发布，无人工弹窗。
- https://zhuanlan.zhihu.com/p/2087013170728661195
- 证据 artifacts/article-day194-20260926/zhihu-published.jpeg。

## 掘金（已完成）
- Agent 经去重创建标题草稿7689019584239124499，正式事务76dab584-f421-4a79-be93-3a6905d7c7d1 / Attempt e8857b81-dae9-4850-9c74-5ccbcc3bacb7，generation1。
- 03:20:08 execution/publication published，attempt-finished succeeded。正文、账号4382008413004393、标题/摘要/分类/标签、三图alt及加载均通过；各图一次上传，最终提交一次。
- https://juejin.cn/post/7689076563438583862
- 证据 artifacts/article-day194-20260926/juejin-published.jpeg。准备时通用导航extract有多次匹配失败，Agent自行转入草稿入口；正式任务无干预。

## 头条（已完成）
- WebAffair 5c908de2-5bc5-498b-a3bb-7c8bfed38d8d / Attempt f53eead6-7f3d-44d0-9df1-6a5809affa1f。03:33 单次提交后管理页审核中；03:41 已发布。
- 首次只读恢复因管理页两张图片以 http CDN URL 表示而无法匹配三图；修复 readToutiaoPublicationReview 的允许列表 CDN 图片身份规范化（不发起 HTTP 请求，返回地址仍为HTTPS）。没有按标题去重或放松三图核验。
- generation3 只读恢复成功，03:44:51 execution/publication published，attempt-finished succeeded。作者3777529577766638、冻结全文、三图地址/顺序/加载通过；未重发。
- https://www.toutiao.com/w/1877332981831692/
- 证据 artifacts/article-day194-20260926/toutiao-review.jpeg、toutiao-published.jpeg。

## CSDN 后续核验与修复
- 03:35 首次继续错误地查草稿箱：publication=dispatched 未进入只读结果恢复，原稿已离开草稿箱，启动失败。
- 修复：CSDN dispatched/verifying 与 result-unknown 一样进入既有 recoverExactPublication；保持原账号/标题核验、WebAffair 状态唯一所有者和无重复发布保护。
- 03:40 generation3 原任务只读恢复成功，但真实页面仍显示审核中，保持 waiting-human，不能声明公开成功。此真实续接进入的是 result-unknown 分支；dispatched/verifying 新增分支由回归测试覆盖，未伪造持久状态来做实机覆盖。

## 本轮结论与验收
用户功能：6个平台均已尝试；B站、知乎、掘金、头条共4个平台公开全文/三图核验成功；CSDN已单次提交、等待平台审核；微博没有提交，重启丢失临时编辑现场后安全续接受阻。小红书未操作。不能声明六平台稳定无人值守。
执行计划：真实界面观察到上传、正文、字段、保存、提交、核验，以及微博图片结果未知、CSDN审核等待；状态来自WebAffair。没有新增执行计划能力；未单独完成全平台所有小步骤及每种恢复分支的UI验收。
工程准备：本轮只修复以上两条有直接证据的结果恢复问题。CSDN服务/恢复测试34项、头条结果相关测试33项通过，Node类型检查与相应eslint通过。没有提交、推送或发版。保留原有及其他任务修改。
真人验收动作：打开本轮四个公开链接核对标题、全文及三图；在Studio文章发布侧栏打开第194天各平台任务，核对完成/审核/中断状态；CSDN审核结束后使用原任务核验，微博不要直接重跑。
证据快照：artifacts/article-day194-20260926/status.json。

执行计划真实界面补充：artifacts/article-day194-20260926/toutiao-plan-completed.jpeg，显示步骤34–45、单次提交动作完成、三图公开核验通过、Attempt已发布。

## 2026-09-27 微博续接调查（尚未修复）

- 用户人工检查确认第194天文章没有发布；该确认不是对第一张图片缺失的确认。
- 只读重查 WebAffair：原事务仍是 generation 2、interrupted / upload-assets，publication=not-started，唯一副作用为第一图 upload-asset / result-unknown，没有 publish 副作用。
- 通过原事务“打开网页”检查到微博账号深芯智造（5961101548），正文区为空、发送按钮禁用。图片入口打开文件选择框，已取消，未选文件、上传或发送。这些可见事实尚不足以证明平台内部附件完全不存在。
- 源码确认 launchRuntime 的临时编辑器恢复分支有即刻、B站专用对账，微博仍直接拒绝；不能把平台判定简单扩为允许，也不能把用户“没有帖子”的确认记作“没有图片”。
- 已向 Studio 新建的本地诊断会话交代仅只读检查原账号编辑器、原生附件和发送按钮，禁止上传、填写、清空、发送及新建发布事务。发送后观察到思考中，尚未取得诊断结果。
- 同时发现界面未经本任务操作切入“生产”并多次出现“选择工作空间中的宣发稿件”窗口；另一个 Codex 任务「【待验收】多模态生成」也处于 active。已暂停本任务的界面点击，向用户确认界面使用安排；不关闭其他任务窗口、不重启应用。
- 本次尚无恢复代码改动或新发布结果；下一步需要错开界面操作、取得原生附件证据后再实现有界对账，仍从原事务继续。

## 2026-09-27 微博缺图确认后恢复（工程已实现，正向实机待确认）

- 另一个界面任务已空闲后继续。读取上次 Studio 诊断的公开输出：正文空、发送按钮 disabled、无可见图片；任意 evaluate 多次超时，不能证明平台内部附件为空。源码同时确认登记账号明确禁止通用 evaluate；保留该保护，没有为诊断开放任意脚本权限。
- 最小恢复路径复用现有“网页里没有，重新上传”人工缺图确认。只有原账号、原工作空间、空白编辑器、upload-assets 阶段、publication=not-started、没有任何 publish 或正文写入副作用、每次已派发上传均已明确确认缺失并记为 rejected 时，允许原任务续接。空白 DOM 或用户确认“没有帖子”都不自动解除未知上传。
- 新增 weibo-composer-recovery.ts；ArticlePublishingService 接入恢复分支和缺图现场核验；WebAffairService 在串行写入点检查现场证据仍有效。保留全部上传尝试和原 Attempt，不直接编辑真实持久化状态。
- 工程验证：相关 189 项测试通过（恢复条件21、发布服务22、事务状态146）；Node 类型检查、受影响代码 eslint、git diff --check 通过。没有提交、推送或发布版本。
- 无运行中发布任务后重启开发版加载修复。实机从原事务继续进入 generation 3，明确停在“微博上传结果尚未核清”；publication 仍 not-started，唯一副作用仍为原第一图 upload-asset/result-unknown，没有新增上传或发送。**这只验收了保护分支，不代表发布闭环或正向恢复已完成。**
- 当前原账号5961101548的空白编辑器截图：artifacts/article-day194-20260927/weibo-empty-confirmation.jpeg。
- 已请用户明确确认编辑器缺少第一张图片（与确认帖子未发布区分）。在得到该确认前，不替用户点击缺图确认，不续传。确认后由 Studio 原任务完成补传、正文、单次提交及公开结果核验。

## 2026-09-27 微博原任务完成发布

- 用户提供当前微博空白编辑器截图并明确“看起来没有，继续”。Codex 通过 Studio 原事务的“网页里没有，重新上传”记录缺图确认，未修改持久化文件。Studio 随后成功从同一 Attempt 恢复到 generation 4。
- Studio Agent 完成三图上传和回读、冻结正文填写/回读、标题与现场核验、图文复核，并执行唯一一次 publish/final。第一图保留原中断尝试，本次补传后总尝试2次；另外两图各1次。
- 发送后网络回执超时，WebAffair 正确转 result-unknown，Agent 停止写入，没有再次发送。真实首页已出现同账号、同标题的新帖。Codex 只点击该帖“刚刚”的详情入口（只读导航），随后通过 Studio 原任务“核验发布结果”继续；没有代点网站最终发送。
- generation 5 的 Studio 主进程用原账号、冻结全文和全部三张图片身份核验唯一详情页，通过后绑定公开 URL；只读 Agent 完成 verify-publication 与 finish_attempt(succeeded)。22:07:09 execution/publication 均 published，8个检查点全部 completed。
- 公开地址：https://weibo.com/5961101548/Rk5CD72Wq 。Studio 核验 UID 5961101548、标题、冻结正文710字符、3图均加载且图片对象ID与上传结果一一对应；最终发送次数1。
- 真实界面：artifacts/article-day194-20260927/weibo-resumed-upload.jpeg、weibo-before-submit.jpeg、weibo-after-submit.jpeg、weibo-published.jpeg、weibo-plan-completed.jpeg。
- 执行计划验收：真实经历“上传结果未知→人工确认缺图→恢复上传/正文/复核→已派发但结果未知→公开核验通过”；截图显示30提交动作完成、31–33三图已核验、34公开结果已核验、Attempt已发布。公开页没有编辑器字段，计划中标题步骤的“本次复核”仍显示缺少字段读证据；不能称全部细步骤显示已无瑕疵。
- 发布闭环已完成；这次仍需要一次用户缺图确认，以及回执超时后的只读详情导航/继续。没有宣称微博跨中断、回执丢失全程无人值守；网络回执超时原因尚未确定，不通过猜测放宽回执匹配条件。

## 2026-09-27 六平台本轮收尾

- 微博完成后，仅对 CSDN 原任务做只读复查。generation 4 因账号 Tab 创建超时未启动；页面加载完成后 generation 5 成功进入原文章结果核验，没有再次提交。
- 22:10:57 CSDN execution/publication 已为 published，平台原“审核中”标记已解除；Studio 回读账号、标题、全文与三图后完成原 Attempt。URL：https://blog.csdn.net/weixin_36388257/article/details/166652934 。
- **本轮最终：B站、微博、CSDN、知乎、掘金、头条六个平台全部 published，每个平台恰有一次 publish 派发。** 小红书未操作。此结论是这篇文章的发布闭环结果，不是六个平台无需人工干预的稳定性声明。
- 汇总事实快照：artifacts/article-day194-20260927/status.json；六平台真实侧栏：six-platform-status.jpeg；CSDN 界面：csdn-published.jpeg（同目录）。
- 真人验收：在 Studio“文章发布”侧栏逐一打开第194天六个任务，均应显示已发布；微博原 Attempt 为 bf4e1530，步骤30、31–34分别显示提交完成、三图与公开结果已核验；打开上述微博、CSDN公开链接核对标题、全文及三图。
- 本次代码未提交、未推送、未发版，保留其他任务的已有修改。残余问题：微博回执超时需要详情导航后只读收尾；CSDN 首次创建账号 Tab 偶发超时；公开页的编辑器字段“本次复核”提示仍可造成执行计划阅读歧义。
