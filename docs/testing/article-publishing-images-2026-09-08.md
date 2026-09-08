# CSDN 三张配图与执行计划：真实验收

验收文章为用户指定的 `03-linux.do/2026-08-27-App写完之后-初稿.md`，标题《App 写完可以 close，上线和宣发却要一直做》。本记录区分执行计划与最终发布结果，未通过的项目不计为完成。

## 真实任务

- 工作空间：`/Users/apple/Desktop/chat-cc/cclink-promotion`。
- 账号：`csdn:weixin_36388257`，复用已有登录及 Profile。
- Affair：`dfd81e44-aa13-43b5-b79c-e702c4939868`。
- Attempt：`38a22a0c-915a-41ff-a005-57637cdf1f42`，中断后始终恢复同一个 Attempt。
- 原草稿：`164615143`，14:19:41 首次保存取得，随后均由管理页找回并核验。
- 三张正文 PNG：`00-封面-App写完之后.png`、`01-从技术语言到用户动作.png`、`02-上线后的真实链路.png`。第一张是正文首图，本次未配置独立平台封面。
- 当前工作区基于 HEAD `3ccda35f733ab4efb86baabc48189f9098f3a332`，保留原有修改；未提交、发版或修改云端项目。

## 执行计划验收

真实恢复分支展示 53 个小步骤，保留 8 个 checkpoint 作为现有业务门禁。每个小步骤可以展开执行者、进入条件、完成条件、实际证据、证据时间/代次、卡点和允许下一步。

图片按文件分别拆成检查、打开上传面板、上传派发、上传结果核验、正文位置核验、公开页图片核验。正文写入、保存动作和结果核验分别显示。未配置的分类和封面明确无需执行。

真实入口：ArticlePublishingService 解析账号/Tab；CsdnDraftRecoveryCoordinator 管理页找回原稿；Runtime handshake 绑定当前 Page；既有 Browser MCP 派发动作；CsdnPublishingAdapter 读取编辑器/服务端同稿与公开页；WebAffair 接收可信事实并持久化细项。UI 只展示，不从 Agent 文案或计时生成成功状态。

### 已跑过的变化

1. 14:21–14:25，逐张通过 CSDN 正文图片面板上传。main 在实际单文件派发前后核验唯一新增且加载完成的图片，并绑定对应平台 URL。上传按钮返回不算上传核验完成。
2. 第三张图片上传后中断。第三张当时结果待对账，前两张已完成；真实服务端草稿已有三张图片。
3. 重启从管理页恢复原稿；当前保存状态、账号、标题、ID 及第三张已观察 URL 的加载结果全部通过，才原子绑定 Runtime 并对账。恢复后三张各只有 **1 次上传尝试、共 3 次上传派发**，没有重新上传。
4. 14:37，真实 Agent 填写全文。Studio 读取冻结源，将原 Markdown 图片引用替换为已核验平台 URL 后生成格式化正文。CKEditor 重建 iframe 导致旧元素按键失败，写入结果进入 unknown；没有重复写入。
5. 新页面重新核验全文、超链接和三张图，确认正文已保存。图片出现顺序、地址、替代文字、前文位置、加载状态全部一致；对应前文规范化字符位置为 23、701、1114。
6. 第 6 代恢复以新鲜完整正文证据核验原写入，并在 14:56 推进到平台字段，正文写入仍只有一次。随后摘要和“软件工程”标签通过真实控件填写、回读。
7. 15:00 保存点击被尚未关闭的标签下拉层拦截，结果进入 unknown，未发布。修复字段核验只收尾最后一个副作用的问题，补受适配器唯一 selector 限制的标签关闭入口；第 7 代恢复从保存检查继续，正文和图片均不重放。

### 直接阻塞与修复

- 原正文上传 selector 混入封面/反馈输入框：只接受已打开的正文图片面板中唯一文件控件。
- 原资产 ID 按冒号截断：保留完整 `local:...` ID，只剥离既有尝试后缀；每个 URL 必须来自该资产派发后 main 观察的新增图片。
- 原 Runtime 闸门无法收敛已观察到的未知图片：最终握手原子核验同稿保存及该 URL 的实际加载；缺失、未加载和不同 URL 仍拒绝。
- 草稿恢复读到了 CKEditor 初始化中间态：有界只读等待真实 saved 与图片加载，不用延时猜成功。
- CKEditor setData 重建 DOM：格式化写入不再向旧 body handle 发按键；后续 change 事件前仍重新检查取消/代次闸门。
- 完成门禁排除了已对账正文凭证：只在当前主进程完整正文比较为 true，且同账号/ID/标题/saved 时核验旧的已派发写入；不要求再写一次来制造凭证。
- CSDN 图片组件包含“编辑”按钮、拖拽图标和零宽空格；公开链接可能由平台加网站标题。只在比较用的 DOM 副本中排除已识别的编辑器控件；链接目标仍逐一相等，自动标题仅接受同 href 且与 data-link-title 一致的已观察形式。真实页面和源文件未修改。
- 保存点击曾因 Chromium native visual zoom 下限 0.3 导致布局宽 2110、可见宽 633 而错位。真实 DOM/CDP 指标定位后把 native visual 下限设为 1，Electron 手动 page zoom 仍支持 30%。未修改自动适宽阈值、缓存与主进程所有权。改后布局与可见窗口一致，实际首次保存点击成功。

## 证据

证据目录：[article-images-20260908](../../artifacts/article-images-20260908/)。

- `04-first-image-editor.png`、`05-first-image-plan.png`：第一张真实图片及执行状态。
- `06-interrupted-with-three-images.json`、`07-interrupted-plan.png`：上传后中断现场与具体卡点。
- `08-three-images-server-draft.json`：服务端原草稿中的三张图。
- `09-recovered-no-reupload.json`：恢复后三张已核验，无重复派发。
- `10-body-and-three-positions-verified.json`、`11-formatted-body.png`：全文及三处图片的真实核验。
- `12-real-electron-readback-negative-checks.json`：同一真实页面只读比较；故意改期望正文、图片 URL、链接目标均被拒绝，未改网页。
- `13-recovered-body-no-rewrite.json`：正文恢复完成并推进字段。
- `14-real-image-placement-plan.png`：真实界面中第二张图的前文位置、数量与加载证据。
- `15-save-blocked-by-tag-popup.png`、`15-save-blocked-state.json`：标签面板遮挡保存按钮的具体失败现场。
- `16-recovered-final-plan.png`：修复并恢复后，已完成正文及图片步骤没有残留错误等待。

## 发布闭环

**实际自动提交已完成，公开发布验收失败：CSDN 审核未通过。**

- 15:07:46，平台记录发布时间；本 Attempt 只有一个 publish/final 派发，没有重发。
- 文章地址：https://blog.csdn.net/weixin_36388257/article/details/164615143 。登录作者可见全文与三张图片，标题、正文、超链接目标和逐图位置/顺序/替代文字/加载均通过真实回读。
- 未登录访问文章返回 **404**；三张 CDN 图片均返回 200/image/png，字节数与原文件相同。不能据此把文章写成已公开。
- 作者文章状态栏 `.article-info-box .article-bar-top .bar-content.active` 明确显示 **审核未通过**。未读取到具体拒绝理由，不能猜测为营销、版权或其它原因。
- 适配器补充公开正文 `#content_views`，忽略平台插入的无 href 目录锚点；公开页原网址链接的自动标题通过已观察的 title 元数据归一化，href 仍逐一精确匹配。真实期望变体测试证明错正文、错图片地址、错链接目标全部拒绝。
- 发布成功凭证现在同时要求全文图片匹配且没有平台审核阻塞。作者可见但审核未通过/审核中/仅自己可见均不能成功；实际状态栏原因进入最后小步骤。
- 最终 verify-publication checkpoint 为 waiting-human，错误码 PLATFORM_REVIEW_BLOCKED；原 publish 副作用仍保留结果未知保护，不能重发。没有擅自改稿、重发或申诉。下一步需要用户在 CSDN 查看具体拒绝理由，再决定修改内容或申诉。

最终证据：

- [CSDN 原文及“审核未通过”](../../artifacts/article-images-20260908/24-final-platform-result.png)。
- [Studio 逐图核验与最终卡点](../../artifacts/article-images-20260908/25-final-plan-review-blocked.png)。
- [最终任务事实](../../artifacts/article-images-20260908/26-final-affair.json)：1 次发布派发、3 次图片上传派发、1 次全文写入。
- [公开页正反向回读](../../artifacts/article-images-20260908/19-public-body-images-readback.json)、[匿名 404 与图片 200](../../artifacts/article-images-20260908/20-anonymous-public-check.json)、[适配器读取审核拒绝](../../artifacts/article-images-20260908/23-real-review-probe.json)。

真人复核：Studio 打开 cclink-promotion → 文章发布 → 选择最上方《App 写完可以 close，上线和宣发却要一直做》→ 展开最后“核验平台公开结果”，应看到 CSDN 审核未通过和禁止自动重发；其前三个公开页图片核验均通过。点击“网页独立窗口”可查看作者页状态栏。未登录浏览器访问该链接仍不能据此期待可见。本次公开发布验收不通过。

## 工程与残余边界

13 个受影响测试文件 281 个测试通过，随后补公开页缺图拒绝用例（policy 57 个测试通过，共 282 个受影响用例）；新增正文恢复用例覆盖完整匹配、正文不匹配、过期页面、错误草稿、错误账号和未知保存。针对细项状态的后续修复再跑 WebAffair 54 个测试。node/web 类型检查与受影响 lint 通过。未运行全量 verify。

缩放回归：真实主窗口根视口/visualViewport 均 633、visual scale 1；手动 page zoom 30% 后根视口为 2110，复位后恢复 633/scale 1；页内导航、迁移至更宽辅助窗口和重启复验见 `22-real-zoom-regression.json`。没有修改自动适宽测量和拒绝下限。

本次不覆盖所有分类/封面控件、远程图片、验证码或平台风控；单篇闭环不能代表所有 CSDN 页面版本均支持。
