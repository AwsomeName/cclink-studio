# B站自动确认继续调试（2026-09-12）

用户现在仍不能用当前结果未知的旧任务自动续发；本轮修正了首次确认分支的观察器超时时序，并在隔离 Electron 中验证自动点击与请求回执衔接。真实账号公开发布尚未通过，不以 fixture 成功代替产品验收。

## 本轮改动

- `bilibili-publication.ts`：观察器显式记录 Promise 已结束状态。首次确认要求观察器已 arm、未释放、未结束且从未观察到创建请求。尤其是正文/图片复核耗时超过原回执期限时，不再允许确认发送。
- `article-publishing-browser-policy.ts`：首次确认前再次检查真实公开范围及即时发布入口，原有 UID、冻结正文、标题、逐图顺序与加载、Runtime 和取消检查继续保留。
- 新增观察器在复核期间超时/释放的行为测试；不能再只用“尚无请求”代表“仍可以发送”。
- `scripts/bilibili-confirmation-smoke.cjs` 直接载入本轮发布函数，在独立 userData 的 Electron WebContentsView 中测试真实 DOM、iframe、Playwright 点击和 request/response 对应。所有 HTTPS 请求均由测试路由本地完成或拒绝，不连接用户 Studio、不访问真实 B站服务、不使用账号 Cookie。不是完整 WebAffair 产品验收。

## 本轮验证

- publication 23 项、policy 70 项、Browser MCP 52 项，共 145 项通过。
- Node 类型检查、受影响 ESLint、diff whitespace 检查通过。
- Electron fixture 四场景通过：正常原生首次规范分支确认一次、对应回执取得；正文变化、取消、观察器释放均零发送。
- fixture 初次因空白 BrowserWindow 未加载而卡住，已结束该独立测试进程并补齐；第二次等待隐藏 iframe 的 heading 未设置 includeHidden 而失败，修正测试等待后四场景通过。没有因此重启当前 Studio。

证据：`artifacts/article-bilibili-agent-20260912/confirmation-electron-fixture.log`、`confirmation-typecheck.log`、`confirmation-lint.log`。

## 真实验收前提

原任务 G2 的 result-unknown 不变；缺少回执或可信未发送证明，不能重置为 not-started。当前 Studio 仍是旧 main，不能注入代码热补，也不能用 Codex 代点确认。

已向用户提出具体范围变更，尚待答复：允许重启加载修复、保留原未知任务；以艾瑞_B / UID 3546384070347419 发布一篇独立且明确标注为验证的图文测试稿及既有三图，而不是重发结果未知的原稿。只有获得该具体测试稿授权后才可创建验收任务。

拟议验收动作：Studio 建立单篇测试任务 → Agent 自动上传三图、写标题正文、main 回读 → 公开范围与即时发送核验 → 原生发布入口及必要首次确认 → WebAffair 保存创建回执 → 公开详情 UID、全文和三图逐项核验。最终分别报告计划变化与公开发布结果。

本轮未提交 Git、未发版、未修改旧任务持久化状态。

## 授权后的真实运行（18:24–18:46）

用户回复“全部允许”，授权上述重启与独立测试稿。测试原文保存为 `/Users/apple/Desktop/研发日记/2026-09-09/Studio图文发布验证.md`，原文章未改动。

首次新建被账号级未结束任务限制拦截，没有上传或发送。已补仅 B站的独立文稿准入：旧任务必须 publication/execution=result-unknown、Attempt 已中断且无活动 Attempt；原、新文件均保持其记录的大小和修改时间；不同文件、不同标题、不同非空正文。比较正文排除标题与图片标签，拒绝只改名或改图注。原未知任务不修改，也不能恢复为可重发。其他平台规则不变。10 项边界测试与100项状态测试通过；类型/lint通过。

加载后通过正常文件选择器和账号表单建立正式测试任务：

- Affair `1eec44d9-429c-4df4-99eb-9835eaf88287`
- Attempt `6643c51d-a5c7-476f-bb66-40421b370bc5`
- 账号仍为 `7c1ef8bb-7770-4c53-ad02-e4943f745fea` / UID `3546384070347419`
- G1 因网页不可见等待，无上传；独立网页可见后经正常“交还 Agent 并继续”进入 G2。
- G2：三图各上传一次并经 main 核验；测试正文、标题和 public 通过；当前图文复核通过，无平台持久草稿。
- 18:39:25 Studio Agent 点击原生发布入口；main 于约250毫秒后报“B站首次规范确认弹窗身份不完整”，没有执行确认分支，没有回执。任务转为 result-unknown；没有重复点击或修改保护状态。

真实页面与 DevTools Elements 只读证据确认 `.bili-dyn-specification-popup`、`.bili-popup__content`、`.bili-dyn-specification-popup__content iframe`（原生属性为协议相对的规范地址）、footer 中两个原生按钮；iframe 当前 contentDocument 可读。没有使用 Console 执行代码或通过私有接口操作网站。此前即时检查发生时具体缺项未记录，不能把加载竞态直接宣布为已证实唯一根因。

新增5秒有界等待该 iframe 的一级规范标题就绪，然后再次检查同一活跃观察器和原弹窗结构。Electron fixture 改为点击入口才加载 iframe，并加入800毫秒延迟：正常及延迟两场景各确认一次、取得本地模拟回执；正文变化/取消/观察器释放均零发送。publication23项、Node类型与受影响lint通过。这一最后改动尚未加载真实 Studio，也未在真实规范页面验收。

18:45 左右电脑控制明确返回 Mac 锁定，已要求用户手动解锁。原测试图文与规范弹窗保留；新旧两个任务的未知状态均保留。本次仍未完成公开发布验收，不能因三图上传和 fixture 通过宣称自动发布已调好。

证据目录 `artifacts/article-bilibili-agent-20260912/`：`test-running-plan.jpeg`、`test-running-plan-ax.txt`、`test-g2-upload.jpeg`、`test-g2-body.jpeg`、`test-submission-observed.jpeg`、`test-agreement-container-dom.txt`、`test-agreement-dom.txt`、`test-g2-final-state.json`、`delayed-frame-electron-fixture.log`。

执行计划验收：实际显示并运行了账号、空白现场等待/恢复、三图、正文、标题、范围和发布入口；首次确认、回执和公开结果未通过。发布闭环验收：未通过，无可用动态 URL。解锁只恢复电脑操作条件，不自动解除结果未知保护。

## 解锁后复核（19:00–19:04）

用户已解锁。原生 DevTools Elements/Properties 和可访问性树再次确认规范文档来自 `https://t.bilibili.com/h5/dynamic/specification`、文档可读，实际一级标题为“哔哩哔哩动态使用规范 （2019年6月）”。这一当前证据不证明18:39:25检查时文档已经加载。关闭的是 DevTools；没有关闭网页、取消规范弹窗或点击发送。

将弹窗校验的布尔返回值改为具体拒绝原因：iframe/按钮数量、规范文档读取、标题、独立容器、取消按钮。相同保护条件全部保留，只提高失败可诊断性。新增隔离 Electron 缺少取消按钮场景，验证零发送且错误准确指出缺项。23项publication测试、6个隔离Electron场景、Node类型和受影响lint通过。首次把CJS脚本纳入lint发现require风格规则冲突，已按该独立CommonJS harness的模块格式作文件级说明；复查通过。

真实测试任务仍为10:39:25.595Z的result-unknown；三个资源各上传一次。尚未重启加载iframe等待和此次诊断变化。证据：`test-unlocked-current-page.jpeg`、`test-unlocked-current-page-ax.txt`、`test-unlocked-specification-dom.txt`、`unlocked-tests.log`、`unlocked-fixture.log`、`unlocked-typecheck.log`、`unlocked-lint.log`。

止损判断：原稿和独立测试稿已连续两次停在首次确认，不能再以不断新建文章代替解决未知结果恢复问题。当前记录缺少可绑定本稿的创建回执，也缺少从入口点击到失败持续有效的完整未发送证据；当前弹窗和页面“0动态”不能补回历史证据。现有有界能力不能安全续发这两条任务。下一次真实发布验证必须先解决首次确认失败时观察器与未发送事实的保留/受控续接，再以真正独立的授权内容验证；不能把本次增加诊断视为这一能力已经完成。用户无需补充账号、解锁或发布权限。

## 同一次操作的有界续接修复（19:10–19:30）

用户同意继续后，当前补齐的是同一活跃操作内的恢复，不是跨进程或旧未知任务的重发：

- 确认文档首轮5秒未就绪时，WebAffair计划显示等待；保持原观察器，再有界读取15秒。原30秒回执期限不延长，重新读取不点击入口；同账号、正文、标题、公开范围和逐图复核通过后，确认最多尝试一次。已出现请求、Runtime失效或监听结束都不允许确认。
- 查到并修复确定的失败路径缺陷：`finish(true)`缓存了失败Promise，原MCP异常处理的`finish(false)`也直接返回同一个失败，提前释放了原观察器，不能等待迟到回执。现在确认分支只运行一次；异常分支独立只读等待原回执，回执持久化最多一次，不重试点击。
- 原发布sideEffect增加可选B站观察事实，仍由WebAffair串行持久化和投影：确认尝试的保守预写、是否观察到创建请求、监听是否结束。确认前持久化失败则不点击；取消发生于预写期间也不点击。记录不能反转已尝试/已观察/已结束，不能清除publication未知、生成新permit或授权旧稿重发。
- 观察器关闭/崩溃/释放立即终结等待并对称移除监听；超时或已启用后不能重新arm。没有历史字段的旧任务保持缺证，不进行迁移补写。

本轮验证：publication29项、policy71项、状态101项、Browser MCP52项，共253项通过；隔离Electron8场景通过，其中6.5秒延迟实际进入等待后确认一次，等待期间取消零发送；类型/lint/diff检查通过。新状态测试初版把Attempt设为运行中而execution设为未知，严格生命周期校验正确拒绝；修正测试场景为中断Attempt后通过，没有放宽生产不变量。

用户功能验收仍未完成：新计划行和等待/恢复状态未在真实Studio运行中验收；真实提交、公开全文和三图未验收。当前主进程未为此次修复重启，原测试任务仍是10:39:25.595Z的未知状态，规范弹窗和三图保留。没有直接操作最终发送，也未创建第三条WebAffair。

证据：`recovery-work-current-page.jpeg`与AX文本为本轮真实当前页面；`recovery-tests.log`、`recovery-fixture.log`、`recovery-types.log`、`recovery-lint.log`为工程验证。已准备待核对的新稿`/Users/apple/Desktop/研发日记/2026-09-09/Studio发布恢复验证.md`，仍用艾瑞_B与原三图。新稿尚未建立任务或发布；如用户确认此新增公开对象，加载修复后由Studio/Agent执行全部提交并分别核验计划与公开结果。不能把原测试稿改名后重发。

工作期间发现HEAD已由外部更新至75a29c1e；本任务没有执行Git提交、回退或发版，保留现有工作区修改。

## 再次授权后的真实运行及阶段误判修复（19:41–20:10）

用户明确回复“可以，再发一次没问题”，授权上一节已展示的独立测试稿。经正常 Studio 表单创建 Affair `248d5211-9d05-477c-a8db-50a4d75f0d84`，Attempt `a64c9daf-a43f-4a62-89e8-be68d7c9dd49`；本轮曾经授权重启加载此前修复。G1 在页面不可见处等待，经正常“网页独立窗口”与“交还 Agent 并继续”进入 G2。三图各上传一次，全文、独立标题、公开范围和即时发布均由 main 回读通过。

19:51:31.614 Studio Agent 经有界能力点击发布入口。19:51:31.922 main 成功识别原生规范弹窗，随后确认前复核失败。原观察器继续到19:52:01，没有确认发送，没有匹配创建请求或成功回执。WebAffair最终保存 `confirmationAttempted=false, requestObserved=false, observationEnded=true`；publication/execution仍为result-unknown，发布检查点needs-reconcile，公开核验pending。未观察到请求不等于平台未收到的证明。

本次确定根因：真实 DevTools Elements 显示原发布入口为 `div.bili-dyn-publishing__action.launcher.disabled`。原生规范弹窗打开后使该入口禁用；此前确认前复核又要求 `current.publishSelector`，而适配器仅为可点击入口返回该值。公开范围DOM仍保留“所有用户可见”的is-active，不能把此错误归于隐私设置未知。

修复仅分离阶段：适配器增加只读 `immediatePublishPresent`，表示当前唯一可见即时发布入口身份；首次入口仍要求完整可用publishSelector，规范确认阶段检查即时发布身份及账号/全文/标题/公开/逐图证据，另由原有规范校验两次检查唯一启用的“确认并发送”。不使禁用入口可点击，不接受定时发布，不清除未知状态，不产生旧任务重发许可。

验证：policy78项加adapter17项共95项通过；新增7种确认前复核场景涵盖原入口禁用成功以及私密、定时、正文/标题/账号/图片变化零发送。隔离Electron8场景通过，fixture现在运行生产composer读取器，真实DOM将原按钮禁用，核验publishSelector消失而即时入口身份保留。Node类型、受影响lint和diff检查通过。最新阶段判断修复尚未重启加载到真实Studio，不能将模拟回执当作公开验收。

执行计划验收：真实应用中可见等待/恢复、三图、正文、字段、发布入口及结果未知变化；首次规范识别通过。首次确认、创建回执、公开结果仍未通过，整体计划验收仅部分通过。BrowserTask/Agent会话的completed只表示运行结束，不代表WebAffair已发布。

发布闭环验收：未通过，无公开URL，无法进行公开全文和三图验收。本轮只关闭DevTools并保存真实页面；规范弹窗仍在，未点击确认或取消。随后切换到主窗口，真实侧栏显示本稿结果未知；尝试打开详细计划时电脑再次锁定，未取得新的详细计划截图。保留此前等待计划截图及本轮侧栏证据，不重启、不修改持久化状态、不再新建试发任务。

止损：连续真实试发仍未完成公开闭环，停止继续换稿试错。用户无需再次授权、解锁或手工点发送；缺失的是Studio针对已有未知任务的受控确认续接能力。当前已结束观察器不能重新arm，旧任务只允许核验结果；如继续开发，需要让原任务在明确的新授权下保留旧未知事实、重新核对同稿同账号现场，并由main发放仅确认一次的有界权限及新回执监听，不能重放原入口或改状态文件。该能力本轮未实现，不能宣称Studio已调好。

证据均位于 `artifacts/article-bilibili-agent-20260912/`：`recovery-new-final-sidebar.jpeg`及AX文本、`recovery-new-plan-waiting.jpeg`及AX文本、`recovery-new-final-page.jpeg`及AX文本、`recovery-new-publish-control-dom.txt`、`recovery-new-visibility-dom.txt`、`recovery-new-final-state.json`、`disabled-entry-{tests,fixture,types,lint}.log`。本轮没有Git提交或发版。

## 同一任务的显式一次重建（20:20起，验收中）

用户要求无须人工操作时持续开发到最终结果，沿用先前“再发一次没问题”的明确授权。补充实际可执行路径：普通继续仍只读；独立“接受可能重复，重建并提交本稿一次”入口绑定当前任务、Attempt、代次、唯一旧发布effect。仅B站、已授权同稿、无URL、旧观察已结束且未尝试确认/未观察请求、其他副作用已结算且图片尝试次数未满时可用；每条任务只签发一次。该证据不代表平台未收到，UI明确提示可能重复。

owner保留旧publication=result-unknown及全部旧sideEffects、旧上传尝试与地址证据；另记录绑定新generation的显式授权。当前检查点及图片映射转入新现场准备，原证据不得冒充新现场完成。主进程启动前重新比较原文件/图片快照；仅真实同账号空白发布器允许重建，已有图文时不覆盖。上传、正文、标题、公开与最终发送继续走现有Agent、current operation、Runtime和一次性副作用链路；本代发送一旦派发即失去重试权限，普通恢复不会继承授权到下一代。没有新增任务、通用MCP或第二状态所有者，也没有手改持久化JSON。

本能力是用户明确授权的新一轮同稿执行，不是证明旧提交失败、取消旧未知事实或实现临时弹窗跨重启保留。此前原稿及第一测试稿缺少新观察证据，仍不开放此入口。

本轮代码门禁：4个受影响文件235项通过；新增授权策略用例后policy79项通过；Node/Web类型和受影响lint通过。已经保存 `same-task-retry-before-restart.jpeg` 与AX文本。20:37开始加载修复，随后须由Studio实际启动同一任务并完成公开验收；本节不宣称已提交。

20:39真实启动：通过Studio按钮对原Affair `248d5211-9d05-477c-a8db-50a4d75f0d84` / 原Attempt `a64c9daf-a43f-4a62-89e8-be68d7c9dd49` 签发G3，launch=`cbd63ed5-a9fa-4681-a6e4-a2720687fdb6`，BrowserTask=`502b8386-6e54-4ccf-baa8-b3ab47fdf802`。原publication仍为11:52的result-unknown，旧副作用未变。三张旧上传成功记录仍各保留一次，新现场pending；main与Agent均读到原UID空白发布器。独立网页已显示，G3正在执行。重启后第一次“网页独立窗口”因旧source失效报错，经普通“打开网页”重新显示原Tab，再打开独立窗口成功；没有创建新发布任务或操作平台发送。

20:42 G3进入upload-assets但未派发：首次上传准入仍要求历史attemptCount=0，遗漏显式重建情形，`report_asset(uploading)`被EVIDENCE_REQUIRED拒绝，直接upload也被状态闸门拒绝，没有文件传输。新增rebuildUploadAllowed必须同时满足新授权当前代次、pending、无当前平台映射、当前代次未派发本图、最新页面完整枚举且无未归属图片。191项policy/state测试覆盖无授权/本代已派发拒绝及合法重建允许；Node类型/lint通过。

另补未消费授权跨Runtime恢复：只有所有图片仍pending、无平台映射、当前代次连reserved副作用都没有，才可把同一次授权绑定到新的Runtime代次；authorizedAt和旧effectKey不变。发生任一副作用即不允许这条继承。UI准确显示“继续已授权的原稿重建”，不把写入入口伪装为只读核验。G3确认为0条新sideEffect后重启加载，原未知记录保留。

## 20:45–21:20：G4 真实发送及多段正文缺陷

用户现在已能通过 Studio 自动上传三图、填入标题正文、核验公开范围，并自动点击首次规范的“确认并发送”；仍不能验收 B站公开发布成功。以下是测试稿《Studio 发布恢复验证》的事实，不是最初 AIR 第188天原稿的成功证据。

- 同一 Affair `248d5211-9d05-477c-a8db-50a4d75f0d84`、Attempt `a64c9daf-a43f-4a62-89e8-be68d7c9dd49`，G4 / launch `22fdf398-5f0d-4ec1-9fc7-00f734a91513`。G3 无外部写入，未用授权通过正常 owner 入口续至 G4。
- G4 三图各上传一次，累计每图 2 次上传。20:54:28.474 派发原生发布入口；20:54:29.884 首次确认步骤记录原生按钮已点击一次。20:54:58.604 主进程保存 `confirmationAttempted=true, requestObserved=true, observationEnded=true`。没有动态 ID 或 publication.url。
- G2 unknown 原样保留，G4 也为 unknown；没有新建发布事务，没有修改持久化 JSON 解除保护，没有 Codex 手工代点网站最终发送。G4 之后没有再次提交，也没有重启丢失旧编辑器。
- 发送后旧编辑器仍保留全文与三图。新打开的同 UID 动态页显示“好像没有东西诶”。该空列表不证明平台拒绝，更不构成再次发送许可。

### 执行计划验收（真实 UI）

准备、账号、逐图上传/核验、正文、字段、无持久草稿的说明、提交与首次确认均有实际运行状态；首次规范确认已核验，回执与平台公开结果显示结果未知，公开三图核验尚未执行。可展开每步查看执行者、进入/完成条件、证据与允许下一步。中断后状态未伪装为成功。历史“可见正文已核验”仅证明 DOM 显示全文，不能证明原生编辑器的提交模型包含全文。

### 发布闭环验收（未通过）

G4 已观察到创建请求，但旧观察器未记录请求不匹配原因、响应状态或平台错误码，丢失的信息不能靠修改源码追补。DevTools Network 在事后打开，未保留那次请求；公开动态列表未找到结果。因此无法认领回执、核验公开全文与三图。原 AIR 第188天事务仍未知，未改写成已发布。

### 有证据的直接修复

现场 DOM 显示 `fill()` 的多段文本形成裸文本和普通 div；原生 Console 出现 JSON.parse(undefined) 的 _backspace 错误。只读检查当前页面公开加载的 `index.27f5a8b3.js`：其输入处理会把元素节点的 data-data 当 JSON 解析，而 paste 处理通过内部文本模型插入。这确认了多段正文输入不兼容；由于 G4 请求明细未留下，不能断言它就是该请求未取得回执的唯一原因。

1. B站冻结正文改走原生 paste 事件，只提供 text/plain；只允许空白正文，聚焦与定位后重新检查派发许可，事件前再核对为空。不清除旧稿，不读取或操作站点私有状态。
2. 主进程核验正文结构；普通 div 等缺少原生数据的元素不能只凭可见全文取得发布 selector 或正文匹配结论。
3. 观察器保留有界匹配结论、HTTP 状态、平台数字错误码、网络失败事实；不持久化原始请求、响应或凭证。字段不可倒退，结果仍由原 WebAffair owner 持有；诊断不赋予重发许可。

工程验证：相关 169 项测试（动作、适配器、提交观察、发布策略）与 owner 109 项测试通过；隔离 Electron 12 个场景通过，包括旧 fill 多段文本解析失败复现、原生 paste 的完整多段模型、拒绝覆盖旧稿、取消不写入，以及原有 8 个首次确认场景。TypeScript 与受影响 ESLint 通过。后两项修复尚未在真实账号再次提交验收；运行中的旧现场没有为加载修复而重启。

证据目录 `artifacts/article-bilibili-agent-20260912/`：

- `same-task-g4-final-plan.jpeg`、`same-task-g4-final-plan-ax.txt`：真实执行计划和确认按钮已点击的 owner 证据。
- `same-task-g4-final-state.json`：G2/G4 副作用及检查点的只读快照。
- `same-task-g4-after-send.jpeg`：发送后仍保留的原稿/三图现场。
- `same-task-g4-account-dynamics.jpeg`：当时打开的账号动态页。
- `same-task-g4-body-dom.txt`、`empty-bilibili-body-dom.txt`、`same-task-g4-console-ax.txt`：原生结构与错误。

下一步约束：不能把 G4 伪装回未提交；原一次重建入口只覆盖“未尝试确认且未观察到请求”的旧任务，不能自动用于当前 G4。安全只读续接仍缺少本次对应回执/公开动态证据。

21:25 已准备最后一次另行授权入口，但没有点击：仅已消费过一次显式重建授权、恰有两条发布记录、原观察已结束、没有回执地址、各图仍未耗尽三次上传上限且没有其他未对账写入的同一任务可显示。必须携带当前 effectKey/generation 和新的 acceptPossibleDuplicate；普通恢复始终只读，不继承已消费许可。新代保留全部旧未知记录；第三条提交一旦发生不再开放入口。界面明确显示“上一次重发授权已经使用”“最后一次”“可能重复”。该次外部提交需用户另行决定；没有把此前“再发一次”当作无限授权。Owner 114 项测试覆盖明确授权、普通只读、过期代次、未结束观察及上传限额；受影响 169 项其余测试和 12 个隔离 Electron 场景通过。新 main 代码尚未加载，以保留 G4 原页面；界面通过 HMR 显示待确认方案。正式执行前需要正常加载已验证代码、重新核对冻结文件与空白同账号编辑器，再由 Studio Agent 执行。

### 22:22：用户允许重复测试，G5 已由 Studio 启动

用户最新明确表示“发布几次都可以，我可以再删除，目标就是功能稳定”，覆盖上述待授权状态；后续必要的重复测试无需再次逐次询问。不会代用户删除帖子。G4 现场已留存且 Run 已结束，通过正常开发重启加载原生正文粘贴和回执诊断修复；没有编辑持久化状态。

在同一事务、同一 Attempt 的 Studio 显式重建入口启动 G5：launch `3e7df58f-b867-4ff8-9906-798f20edd496`，BrowserTask `ebe9179c-0fd8-4d87-91e5-4a2d6ca81279`。原 UID 的空白编辑器在真实网页和 main inspect 均已确认。`same-task-g5-start.jpeg` 与对应 AX 留存开始现场。本段只记录启动，不代表发布成功。

真实计划还暴露旧代次动作被折入重建计划的问题：旧上传、正文及发布派发记录仍被标成当前代次结果。已修正 owner 的计划折叠，仅在显式 B站重建时排除早于重建代次的旧副作用；历史记录仍保留。114 项 owner 测试通过，新增断言证明旧发布与观察记录不再被折入新计划。该修复尚未重启加载，以免中断当前 G5。

### 22:30–22:38：G5 自动提交收到账号类错误，公开发布未完成

- G5 三图各上传一次并完成核验；正文通过原生粘贴写入并完成真实回读，标题与公开范围通过 main 核验。
- Studio Agent 于 `2026-09-12T14:30:52.867Z` 派发原生发布入口；本次直接发出创建请求，没有再次调用首次规范确认。
- 当前副作用真实记录：`requestMatch=matched`、`requestObserved=true`、`confirmationAttempted=false`、`responseStatus=200`、`platformCode=4126021`、`observationEnded=true`。冻结正文及三图顺序与实际请求匹配，未收到成功回执和动态 ID。G2/G4/G5 历史均保留，未假定旧请求失败，未重复点击网站发送。
- 当前网页所加载的官方公开静态脚本 `https://s1.hdslb.com/bfs/static/2233-monorepo/dyn-home/static/js/index.27f5a8b3.js` 明确定义 `DYNAMIC_FEED_ACCOUNT_ERROR:4126021`。不能据此把它扩大解释为某种封禁或风控，也不能保证某个账号处理动作必然解决问题。
- 只读进入同 UID 个人中心，真实界面显示“注册会员”、LV0、“转正成为正式会员”，手机已绑定、实名已认证。下一步需要账号所有者处理会员资格/账号限制，再继续真实发布验收；发布授权本身已充分，不需要重复索要授权。

**执行计划验收：部分通过，未完整通过。** 真实运行可观察上传、正文、字段和派发状态变化，新增账号类错误提示已通过 HMR 在 Studio 任务页展示并截图。另修复直接提交分支未更新首次确认/回执小步骤的问题：根据 owner 的观察事实跳过未调用的确认，对非零平台码显示回执核验失败。与旧代次折叠修复一起，owner 114 项测试通过；这两项 main 修复尚未加载到真实应用，保留当前 G5 图文现场，不能宣称其真实 UI 验收完成。

**发布闭环验收：未通过。** 自动输入和自动发送已经真实运行，平台账号类错误阻止取得成功回执；没有公开全文、三图核验结果，也没有成功公开 URL。原 AIR 第188天事务依旧未知。当前同任务上传限额已耗尽，账号问题解决后的再试需走保持历史的有界产品恢复路径，不能修改持久化计数或关闭保护。

真实证据：`same-task-g5-final-state.json`（owner 事实）、`same-task-g5-platform-response.jpeg` 与 AX（发送后编辑现场）、`same-task-g5-public-setting.jpeg`（公开范围）、`same-task-g5-account-level.jpeg`（账号主页）、`same-task-g5-registered-member.jpeg` 与 AX（注册会员/LV0/转正入口）、`same-task-g5-account-block-in-studio.jpeg` 与 AX（Studio 可见账号阻塞说明）。`same-task-g5-body-three-images.jpeg` 拍摄时页面滚动到信息流下方，不作为完整图文的视觉证据；其 AX 有输入内容，全文图文仍需最终公开页验收。
