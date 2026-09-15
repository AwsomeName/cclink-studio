# 第189天头条微头条验收（进行中）

用户授权继续下一平台，沿用 `/Users/apple/Desktop/研发日记/AIR/2026-09-10/小红书软文.md` 与其三张素材。目标账号 `1345b278-f2bf-4d40-ac5f-437d8a0b3c14`，以真实页面重新核验 UID `3777529577766638`，不继承历史昵称或完成声明。

用户验收动作：在 Studio 选择本篇、头条账号和真实原草稿；由 Studio Agent 完成逐张上传、全文、平台字段与保存核验、单次提交，最终打开真实公开详情核验全文及三图。执行计划各小步骤随真实动作、等待及结果变化；执行计划与实际发布分别验收。

当前源码头条正式入口仍要求已有草稿地址，因此先由 Studio 账号会话查重，若无同篇草稿/作品则只在空白编辑器填写标题并保存，取得实际 draft_id。该准备不等于正式事务从零建稿已交付，禁止把上次第188天已有图认领发布当成新稿上传验收。

边界：WebAffair 唯一拥有正式发布状态；保留现有修改和全部旧记录。Codex 不代点网站最终发送，不手改持久化状态。已授权文章/account 范围内推进，验证码/声明等特殊卡点据实等待。无新代码改动、未提交或发版。

初始现场：Studio 新建表单已打开；Computer Use 可读取窗口、触发部分 AX 按钮和写入文本，但原生坐标点击返回 noWindowsAvailable，平台选择菜单不能展开。已请求用户恢复前台可操作状态。同时通过 Studio 自有文本入口启动头条账号草稿准备会话，等待真实页面结果。

## 本轮实际进展与阻塞

Studio 账号 Agent 已打开真实头条后台，确认昵称“你好小眸”，个人主页链接 UID 与目标相同。全部作品关键词查询没有第189天同标题作品（仅命中第188天正文提到明天第189天）；草稿箱显示共0条、暂无草稿。

后台开始创作入口因网页宽度导致两次 outside viewport；收起 Studio 左侧栏后入口可点击，但默认进入 graphic/publish 文章编辑器。没有填写文章内容或发送。Agent 持续查找微头条导航，本轮终止该浏览器任务，准备改用适配器已登记的精确 editorUrl `https://mp.toutiao.com/profile_v4/weitoutiao/publish`；该补充指令尚在 Studio 输入框，未确认发送。

电脑控制先返回 noWindowsAvailable，最后返回 Sky Computer Use native pipe closed before response。已请求用户保持电脑解锁并将 Studio 置前，尚未收到回应。不再继续 UI 重试。没有第189天头条正式 WebAffair、draft_id、图片上传或提交成功证据；不能宣称新稿创建或发布闭环。准备会话后续终态未能再次读取，须恢复连接后先核查现有页面与会话，避免重复创建。


## 09:55 续接与新稿适配

电脑恢复后，主 renderer 曾丢失而原浏览器仍有标题；只读诊断确认主日志 Render frame was disposed，未找到能证明根因的崩溃记录。原生 Reload 未恢复，保留现场后按官方脚本恢复开发进程。账号准备会话随后通过唯一存草稿按钮的 Enter 保存标题，草稿箱回读唯一记录，原稿 ID `1876269094198340`；账号 UID `3777529577766638`，昵称你好小眸。标题草稿截图 `artifacts/article-toutiao-day189-20260914/title-draft.png`。

正式事务 `cfa02275-a4e6-4edb-bb68-62adf15bb0f7`，attempt `cf9f375b-5dd8-4e78-a50a-a9f3ca6f7a59`。G1 首次检查被空图判断挡住：服务端 ID、全文都一致，但页面0/原稿0仍判逐图失败。正式任务没有任何 sideEffect，未上传或发布。

源代码确认旧头条适配只验证已有完整草稿，未提供 imageOpen/fileInput/body/save 写入控件。真实页面图片按钮先打开上传抽屉，本地上传 input 位于 `.byte-drawer button.upload-btn`，accept=image/*。只读 Agent 的多层祖先探测反复失败，已停止该调查并保留有效控件回读；Codex 只打开图片面板检查，未选择文件。正式发布仍须通过 Studio Agent。

本轮修复：只有唯一可见 main 包含已识别编辑器、图片工具栏存在、正文区域确实无图且两次观察不变时才认定空图；仍要求服务端原稿明确 images=[]，不将隐藏或缺失图集当作零图。增加头条原生单图上传及正文写入，并在同一受控操作内调用存草稿；后续原有服务端全文和逐图保存核验不变，不新增状态所有者、不放宽未知重试保护。未提交、推送或发版。

工程门禁：相关 adapter/native input/service 共45测试通过；node 类型检查和受影响 ESLint 通过。这里只证明工程门禁，实际新稿上传、保存与发布尚待同一事务续接验证。受控重载前已存 `affair-before-fix.json`（sideEffects=[]）及 `upload-drawer-before-fix.png`。


G2 新代码实测仍停在零图检查；G3 加入只读细分诊断后确认 `main=1 composer=true toolbar=1 item=0 img=1 file=0 counter=false`。结合此前 Studio main 控件回读（唯一可见图片是首发说明装饰图，编辑区0图），根因是 main 内另一张隐藏非正文图片。空图判断改为保留 main 的全部 span.item、文件控件和计数核验，并检查所有正文图片及其他可见图片；隐藏非正文装饰图不算图集。27项 adapter/native 回归通过，包含隐藏装饰图与隐藏图集分别处理。G1-G3均未派发任何正式副作用。


G4 页面空图完整枚举已通过，保存比较仍失败；进一步诊断 G5 的服务端 `images` 为非数组 object。增加仅对严格空稿的 null/缺省字段兼容，非数组非空对象仍拒绝；G6 待核验。此前把空字段预先视为 `[]` 的假设不成立，已在诊断中输出实际字段类型。上述 G1-G5 都只有只读恢复，副作用数为0；不是五次发布。


G6 真实恢复通过：`6e7bce7c-ae63-4e1c-ad62-2cd029bb7a19`，浏览器任务 `966a765a-fe8a-4423-a2fe-26c97c6182fc`。首次页面回读 21字符、0图、saved，原账号/原稿/标题一致；原事务已推进到 upload-assets。这确认当前纯文字草稿的 images 实际为空值 null，而非有效图片对象。`g6-runtime-resumed.png` 为真实恢复界面。此刻三图仍 pending、sideEffects=0，不能报告上传或发布完成。


G6 上传入口实测：第一张 asset 进入 uploading（尝试记录1），但 imageOpen 的 `:text-is` 未匹配到按钮；文字实际在嵌套 span 中。点击被唯一可见控件门禁挡住，没有文件上传 sideEffect（记录数0）。关闭发文助手后仍失败，确认不是遮挡问题。改用按钮 `:has-text("图片"):visible`，保留唯一性检查。新增头条恢复分支复用既有“从未派发”证明，仅无平台地址、历史无任何 dispatchedAt 且页面完整缺图时允许第一次真实上传；5项否定/肯定测试通过，未知上传、已有地址、图集不完整、未关联图片均不放行。G6 重载前证据 `g6-image-button-blocked.png`、`g6-before-selector-fix.json`。不把上传状态中的1次准备尝试当作已上传。


G7 Runtime 握手被 reconciling 图片挡住，虽然历史 sideEffects=[]。将证据驱动的未派发恢复接入 WebAffair 现有握手：仅头条原账号、原 draftId、标题、saved 和完整图集都一致、该图没有平台地址、没有任何历史 upload reservation（比仅检查 dispatchedAt 更严格）、图集没有未归属图片时，把未派发的准备尝试记为 retryable-failed 并附握手证据。上传尝试历史和计数保留，不改磁盘 JSON 解除保护。任何已 reservation/可能派发的图不适用。状态127+恢复15=142测试通过，类型与受影响lint通过。G8真实续接待验。

## 10:42 首图上传与原稿保存

G8 关闭助手后遇到主页面小型 data:image 发文助手图标，空图检查保守拒绝；无上传派发。仅排除编辑器外可见且不超过64×64的内嵌图标，正文图、隐藏图集和其他可见图片仍阻断空图。adapter20测试通过。

G9 实际只派发一次首图上传，上传抽屉显示1张1086×1448图片；原生插入“确定”未被旧有界上传实现处理，30秒等待到期后 result-unknown。保留保护、未重传。证据 `g9-first-image-awaiting-insert.png`、`g9-pending-insertion.json`。Studio 账号准备 Agent 点击原抽屉唯一确定，插入既有上传，页面显示共1张。10:34 同一原稿通过 button.save-draft 的 Enter 保存一次；没有公开发布。

10:38 G10 原事务只读恢复完成原稿/账号/标题/保存核验（draft.recovery.verifiedAt=2026-09-14T02:38:48.652Z），旧未知上传未映射，安全阻断Runtime绑定并转interrupted。Codex 对照原封面与真实网页缩略图，画面一致；截图 `g9-first-image-native-saved.png` 本身只证明页面图像，保存事实来自G10平台回读。现有“确认第1张”入口仍返回无法唯一对应，两次后停止重试，补充具体失败证据诊断。

新增有界上传确认：仅同一冻结单图派发、同稿同账号、唯一可见上传抽屉明确已上传1张且唯一图已加载、唯一启用确定按钮时点击一次；其后等待正文唯一新增图并调用存草稿，保存完成仍交平台回读。native9测试、node类型与受影响lint通过。10:42 在平台保存已核验后受控重载加载修复。

用户功能进度：只证明首图上传、插入及原稿保存；后两图、全文和真实提交未完成。执行计划展示open-editor/verify-account完成和首图结果未知，但整条细步骤闭环未验收。实际发布次数0。没有提交、推送或发版。

## 10:51 旧任务图片核对入口修复，待解锁实测

G11/G12 只读恢复仍成功，随后因旧未知图片没有对应关系而拒绝完整 Agent Runtime 绑定。真实 UI “网页独立窗口”反馈“当前任务尚未绑定可见网页”。源码确认恢复开始清空 attempt.tabId；但 WebAffair 当前 operation `runtime.prepare-first-inspect` 已拥有已核验原稿的完整 Runtime snapshot。原图片核对入口没有使用该现有证据，导致独立窗口无法打开或读取旧页面。此前按截图推测窗口切换成功不可靠，实际按钮反馈才是事实源。

修复复用当前 operation Runtime：仅头条、interrupted、upload-assets、未开始发布、确有未知图、同代 verified 草稿恢复且 operation 的 attempt/generation/launch 全匹配时，允许 Studio 打开这一个已核验页面进行图片核对。主进程核对前及提交结果前重查原生 View 和 Playwright binding 代次，保留可见性、Profile、账号、项目、原稿、标题、保存及唯一未关联已加载图片门禁。没有创建第二状态、Agent 绑定或写许可，没有直接解除未知保护。诊断现在分别显示绑定缺口与原稿/图集缺口。

验证：新恢复身份选择11测试及既有任务Tab10测试通过；完整 web/node 类型检查及受影响 ESLint 通过。原 native 插入确认9测试此前通过。开发进程 PID2515 已加载修复；接下来须先从原事务恢复当前页面身份，再开独立窗口视觉核验并确认首图，随后同一事务继续。不可直接使用重启前的 Runtime snapshot，也不可重传首图。

10:51 Computer Use 明确返回 Mac locked、automatic unlock failed，要求用户手动解锁。本轮到此没有实测新的图片核对入口，不能宣称修复真实闭环；后两图、全文及公开提交仍未开始。没有提交/推送/发版。

## 10:55 解锁后真实续接

G13 在同一事务恢复原稿后，新入口成功打开 current operation 记录的真实页面，截图可见同一 draft_id 和首图。对照已核验原封面后调用 Studio “确认第1张对应此原图”，主进程核验保存和唯一图片成功，首图变为 uploaded。这里的视觉确认由 Codex 执行，UI 通用“你已确认”文案不代表用户本人逐图检查。

G14 `20c18c0f-4444-4a4c-ba16-ef565a5c4a4a` 已在原 Attempt 成功启动，browserTask `fbd40363-fe96-432a-b0d4-53b524725894`，当前 upload-assets；首图 uploaded、后两图 pending。旧任务安全续接已得到真实验证，尚不能据此宣称最终发布成功。

G14 第二张实际单次上传，新增的原生确定分支自动插入成功，真实页面共2张（`g14-two-images-inserted.png`）。随后持久图片识别仍超时，安全保留第二张reconciling；没有重复上传。账号准备Agent在独立窗口下绑定失败两次，送回主窗口后绑定成功，对原稿存草稿Enter一次，明确捕获平台“保存成功”Toast。11:04 G15 重新打开原稿后，服务端两图与页面完整核验通过；本轮未取得上传瞬间URL诊断，不能断言具体CDN或blob根因。第二张经原图/截图对照和Studio唯一映射核验成为uploaded。

调整原生流程：唯一已加载上传结果点击确定后，立即原生存草稿一次，再等待完整图集及持久身份；不会按保存点击或图集计数宣称完成。此举消除“先要求持久识别才能保存”的顺序依赖。超时追加去除查询参数及图片ID的图集计数/加载/来源主机诊断。9项native测试、20项adapter测试、node类型与lint通过。两图已保存并关联后受控重载，待第三张实测。此时仍无实际发布。

G16 第三张原生上传、确定插入、存草稿均自动完成。超时诊断明确：counter=3 nodes=3 loaded=2 stable=true，第三张来源 `image-tt-private.toutiao.com/tos-cn-i-ezhpy3drpa` 未获旧域名白名单识别；平台原稿已是3图，正文一致。由此确认根因是新上传域名缺失，而非只靠调整保存时机即可修好。仅新增这个精确已观察主机，继续要求HTTPS、无用户名/端口、原有URI路径及32位图片ID、图像加载、服务端逐图一致，拒绝相似恶意域名。执行真实DOM读取回调的域名正反例与native合计30测试、node类型及lint通过。`g16-three-images-saved.png` 保存真实三图与正式任务失败现场。加载域名修复后仍须原任务核验第三张，不能新建或重传。

## 全文保存及提交前恢复

G17 三图原稿恢复核验通过，第三张经Studio原图对应入口变uploaded；G18 `1e09084e-0f9a-4b7a-8bb4-5455b5f95815` / browserTask `0c80f585-85b6-406a-a20e-72bf13c9dfd2` 继续原任务，upload-assets、fill-body检查点均完成。Studio browser_fill 写入冻结全文（首行标题、完整正文、八个话题），原生保存后服务端全文及三图一致，bodyMatchesFrozen=true。

运行期间电脑锁屏且连接发生恢复；11:39 watchdog记录NO_VERIFIABLE_PROGRESS并安全中断，不能断言锁屏是唯一根因。currentStep=fill-fields；发布未开始。G19/G20恢复草稿箱报原账号不一致。真实编辑页刷新后显示UID3777529577766638、全文及三图；草稿箱唯一记录也有完整正文与三图，但不再显示可核验的账号链接。扩大窗口、刷新、80%后恢复100%均未使链接出现，因此“只是窄布局”的早期推断不成立。

G21加入等待账号链接后仍超时。最终修改只读发现流程：管理页显式错误或多账号立即拒绝；管理页缺失账号栏时，仅打开唯一同标题行的原生编辑子页，精确draftId匹配后，在编辑页核验原UID、标题与saved，再返回原稿地址；后续既有主进程恢复握手再次完整校验，未发出Agent/写许可前不执行任何内容写入。管理页前后出现错误账号同样拒绝。9项恢复（含缺失账号栏正反例）+21项实际DOM读取测试通过，node类型/lint通过。原等待管理页账号栏的方案已移除。

开发工作台最近两次重载初始白屏，原生工作台刷新可恢复；没有足够证据定位该独立问题，未扩张修复。当前改动未提交、未推送、未发版，最终公开发布仍待原任务续接。

G22 原生草稿编辑子页返回正确draftId，但该后台子页的可见编辑器等待超时，未获得账号核验成功。最终实现复用已有 coordinator 的原可见Tab导航和 `verifyExactDraftPage`：草稿箱仅只读定位候选URL；account步骤先running，只有原可见Tab的账号/ID/标题/保存全部核验成功后才completed。不会在隐藏子页上声称可见核验。错误或歧义的管理页账号仍立即拒绝；缺少管理页账号不授予任何写许可。9项头条恢复含coordinator端到端正反例与12项现有恢复测试通过，node类型/lint通过。此前尝试在子页验证账号的实现已移除。

## G23 恢复成功，G24 平台网络错误阻塞

G23 已通过原可见 Tab 的恢复握手。正式 Agent 回读同一账号、原 draftId、冻结全文及三图，首次 saveState=saved，继续 fill-fields。真实界面见 `artifacts/article-toutiao-day189-20260914/g23-full-article-restored.png`。随后 12:07:35、12:08:10 两次原稿接口回读失败，saveState=unknown；完成回报被门禁拒绝，Agent 回报 waiting-human。没有派发发布。

草稿回读异常现在只记录白名单错误名称（TimeoutError、AbortError、TypeError、SyntaxError 或 UnknownError），不输出响应、签名和敏感参数。相关 adapter 21 测试、node 类型和受影响 lint 通过；尚未从真实失败取得具体错误分类，不据此认定网络根因。

G24 恢复导航至精确原稿 URL 后，平台没有提供编辑器和账号证据，恢复被拒绝。用户解锁后再次检查，头条原生页面明确显示“网络错误，加载页面失败”；点击页面“重试加载”后重新读取仍显示同一错误。截图 `artifacts/article-toutiao-day189-20260914/g24-network-error.png`。只能确认平台当前加载失败，尚未定位网络、服务端或客户端的具体根因。没有再次重启、重复上传、新建发布任务或修改持久化保护状态。

用户验收：打开原事务可看到上传及正文步骤完成、字段阶段中断；恢复及失败状态已真实变化，但执行计划全链路尚未验收。公开发布次数仍为 0，全文与三图的公开结果核验未完成。继续条件是同一原稿页面恢复加载并重新通过账号、全文、逐图和已保存回读，再由 Studio 从原事务继续字段、保存、关闭配乐、提交及公开核验。代码未提交、推送或发版。

用户要求再次尝试后，实际点击原页面“重试加载”，仍返回网络错误；再用 Studio 浏览器刷新同一原稿，分两次间隔观察后仍只有页面外壳，无编辑器或账号内容。证据 `artifacts/article-toutiao-day189-20260914/g24-network-retry.png`。本机已有日志包含头条帮助中心子框架 `ERR_NETWORK_CHANGED`，支持曾发生网络变化，但不足以证明原稿失败的具体根因。未恢复任务、未派发内容写入或发布，当前仍需页面加载恢复。

## 13:51 G25 实际提交，平台审核中

用户截图显示原稿恢复正文和三图。Codex 使用原事务“从中断处继续”，G25 launch `ecd5e3ee-4151-465f-9c79-16cb34ee4888`；Studio Agent 重新核验同账号、draftId、标题、冻结全文、服务端保存及 matchedAssets 3/3，完成 fill-fields、save-draft，无重填或重传。随后关闭助手遮挡、点击 disableMusic 一次，inspect 确认 checked=false，13:51:33 通过主进程派发 publish/final 一次。最终发送由 Studio Agent 完成。真实步骤截图 `artifacts/article-toutiao-day189-20260914/g25-publish-step.png`。

头条回执返回成功，但管理页初始加载不完整，主进程记录 result-unknown。Codex 使用 Studio 只读“核验发布结果”，未重复发送。刷新提交后的管理页后，真实页面出现同账号你好小眸 UID3777529577766638 下唯一第189天文章，正文与八话题可见，状态“09-14 13:51 审核中”。截图 `artifacts/article-toutiao-day189-20260914/g25-platform-reviewing.png`。这证明本次真实提交被平台接收，不能据此宣称公开全文和三图已核验。

执行计划验收已实际观察字段、保存、配乐关闭及核验、单次提交、结果未知与只读核验状态变化；公开核验步骤尚未通过，WebAffair 仍保守显示结果未知。残余缺口是平台审核完成后的公开唯一 URL、全文和三图核验，以及审核中状态在任务中的准确呈现。未提交、推送或发版。

## 15:07 G29 发布闭环完成

继续核验时，管理页已显示第189天文章“已发布”。G28 打开实际公开页，但原入口等待只要求 HTTPS，未可靠取得最终单篇地址，主进程仍拒绝收敛；更早 G27 的诊断还明确显示第三图使用 `p9-sign.toutiaoimg.com`，旧结果读取白名单只接受 p3/p11。保留失败证据，不把页面已打开等同于原实现已成功核验。

只读结果修复：管理页/公开图读取增加精确 p9 主机，继续核验原 URI、图片 ID、顺序、数量、加载和账号；拒绝相似域名、凭证和异常端口。原生标题入口等待精确单篇 `/w/{id}/`，同一 ID 的 www/非 www 地址规范化去重，不把管理页或 HTTPS 中转页当结果；多个不同 ID、取消均拒绝。公开读取、管理页实际 DOM 回调、入口导航及提交回归合计30测试通过，node类型与受影响 ESLint 通过。

保留已发布现场证据后加载修复（PID17794），通过原任务“核验发布结果”启动 G29 `0baa9f10-a167-484c-a18b-670f8c170f84`。Studio 主进程管理页账号/标题/三图匹配成功，锁定公开地址；Studio Agent inspect 确认 published-article、bodyMatchesFrozen=true、三图 loaded 且平台地址逐张匹配。Agent 完成 verify-publication 并调用 finish_attempt，WebAffair 于15:07:38成为 completed，execution/publication均published，八个检查点全部completed。全程只发生G25一次最终发送，G26-G29均为结果核验。

公开地址：https://www.toutiao.com/w/1876269094198340/

真人可执行验收：打开上述链接，核对完整第189天正文及八话题，向下滚动依次看封面、陪伴效果图、暂停观察截图；在 Studio 文章发布侧栏打开原头条任务，看到“已发布”、公开三图和平台结果步骤“已核验”。本轮已实际完成这些动作。证据：`g29-public-verified.png`、`g29-public-images.png`、`g29-public-images-2-3.png`、`g29-plan-completed.png`。管理页已发布证据 `g28-management-published.png`。

分别验收结论：本篇原任务的执行计划与真实发布闭环均通过；不代表全新稿从零无人介入的稳定性已充分验收，此前上传需恢复、网络/加载失败及审核中状态呈现仍是残余风险。未提交、推送、发版，未扩张其他平台。
