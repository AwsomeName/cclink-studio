# CSDN 当前编辑器适配与真实恢复验收记录

结论：**产品验收未通过，不能宣称用户已能从中断处继续。**

日期：2026-09-07，约 20:40–21:15（本机 Asia/Shanghai）。基于 HEAD
`3ccda35f` 上的当前工作区，开发版 Studio 0.1.87。没有提交或发布。

## 本轮源码修改

- 只增加当前 CSDN CKEditor 的 `iframe.cke_wysiwyg_frame` 正文支持，不操作 AI Chat iframe。
- 复用已有 `browser_frame_execute`，文章任务仅可向本次 inspect 签发的正文 Frame/selector 执行
  fill。仍经过 WebAffair 原有副作用预写、取消/代次同步闸门；其他登记账号任务的 iframe 禁令保留。
- Frame 动作使用精确传入的 Page，不再使用全局 active Page；正文 Frame 刷新/脱离使旧检查证据失效。
- CSDN 在窄窗隐藏头像，改为读取网站专用登录头像节点，不把正文里的个人主页链接当账号。
- 已有草稿通过当前页面已加载的 CSDN 模块中唯一 `getArticle` 只读客户端读取服务器记录。
  不复制 Cookie、签名头或密钥，不调用模块的保存/发布方法。核对数字 ID、草稿 status=2、标题、
  正文及可识别摘要；读回前后页面、编辑器实例、文档、标题、正文与账号节点必须不变。
  图片 src/srcset 不作为保存身份；图片存在/身份仍由原有图片对账处理，没有新增内容或图片哈希。
  保存中提示优先于保存成功；接口不可读、格式变化或内容不一致时返回 unknown，不能退回相信旧 toast。
- 首次启动且没有平台进度的任务使用实际 `/mp_blog/creation/editor` 入口，不再让 Agent 从账号首页
  猜入口。已有 draftId 的恢复分支不变，仍从管理页找回原稿。

这不是完整的字段/正文正确性改造。标签、分类等所有字段的保存同步、真实正文写入后的自动保存时序
尚未验收；不能把上述 saved 读回扩大解释为所有平台字段均已正确填写。

## 真实适配器只读验证（不是新任务的恢复验收）

在原登录 Profile 中，从管理页点击“草稿箱(1)”，再点击原稿链接；没有直接用旧 URL 充当恢复依据。
以当前源码编译的 `CsdnPublishingAdapter.probe` 在真实 Electron Page 执行，21:13:57 读回：

```text
platformAccountId = csdn:weixin_36388257
draftId = 164148817
title = 【无标题】
pageKind = editor
bodyFrameSelector = iframe.cke_wysiwyg_frame
bodySelector = body.cke_editable[contenteditable="true"]
imageEnumerationComplete = true
images.length = 1
saveState = saved
```

saved 来自网站只读接口对当前编辑器的核对，不来自“保存草稿”按钮。旧稿只被读取，没有填写、上传、
保存、发布或删除。它不是本轮测试任务的稿件，**不计入新任务恢复通过证据**。

## 正常产品流程实跑

1. 新建本地验收 Markdown：
   `/Users/apple/Desktop/chat-cc/cclink-promotion/studio-recovery-acceptance-2026-09-07.md`。
   不含图片或私人资料，标题为“Studio 恢复验收 20260907-2100”。
2. 点击 Studio“新建文章发布”，通过原生文件选择器选择该文件，选择已有 CSDN 账号，
   点击“仅保存草稿”（此按钮保存本地任务，不是 CSDN 草稿），再点击“开始执行”。
3. 产品创建 `affairId=69900ee1-d524-456d-ae74-30d9056f9d0c`，
   `attemptId=9f26092f-cccd-4c78-8af0-d9c4b7efdd85`。
4. 第一代真实 Agent 从账号首页开始，inspect 后自行导航到错误的 `/creation/editor/new`。
   现场确认该路径没有正文 iframe；网站实际创作链接是不带 `/new` 的入口。
   拒绝 Agent 的自由 `browser_evaluate` 请求，点击 BrowserTask“暂停”，没有批准越界脚本。
   随后 watchdog 将非运行 BrowserTask 判定为 owner lost 并收敛到 interrupted。
   **这次 owner lost 发生在主动暂停之后，不能写成另一次自发 Page 绑定故障。**
5. 修正入口后重启开发版，点击同一任务“从中断处继续”，进入 generation=2 和正确编辑器。
   AgentPanel 再次报 `Maximum update depth exceeded`，点击“重试”仍失败。
   两代启动均出现该 UI 错误，本轮没有扩大到 AgentPanel 重构。
6. 点击该任务的“终止任务”。从正常只读 `webAffairs.getSnapshot` IPC 核对，并在后续只读验证后再次核对：

```text
execution.status = cancelled
execution.currentGeneration = 2
attempt.status = cancelled
draft = undefined
sideEffects = []
publication.status = not-started
open-editor.attemptCount = 2
open-editor.status = running
其余 checkpoint = pending
```

最后的 checkpoint 仍显示 running 是当前残留状态不一致，不代表后台仍获准操作。没有篡改该状态。
该任务和测试文件均保留，未删除、未伪造数据库、checkpoint、草稿 ID 或成功证据。

## 未解决的最小闭环阻塞

1. **第一次创建平台草稿的边界还没接通。**当前 open-editor 只允许打开控件，不允许填写标题或
   保存；后续写入要求已有稳定 draftId，连无图片的 upload-assets 完成也要求同稿已保存证据。
   真实新建页起初没有 draftId。网站当前保存成功会更新它内部的 article_id，但不保证地址栏变成
   带 ID 的路径。因此不能只修 selector，也不能等 Agent 猜 ID 或要求用户去旧草稿里续写。
   这是当前代码推导的启动死锁；本轮真实任务尚未走到后续检查点来直接触发它。
2. **AgentPanel 启动后的循环更新**使第二代运行无法可靠目视追踪；不是 CSDN 登录问题。
   依仓库“同一阻塞两次止损”规则暂停继续扩张，没有修改 AgentPanel。
3. 真实正文填写、平台保存、形成该任务自己的 draftId，以及有稿后的中断恢复均未跑通。
   现有每次写入后的短时保存读回能否覆盖 CSDN 自动保存延迟，尚需在真实写入后验证。

下一步应只在现有 open-editor / WebAffair 副作用机制内补一次受保护的“创建初始草稿”：
先核对当前账号与新建页，预写一次性授权，真正动作前复查取消与 Page/文档；读取真实首次保存响应，
登记该任务自己的 ID，再从管理页核验同一稿的标题和保存状态。首次保存结果未知时只对账，不能再建。
不得新增 operation 账本，也不得放开所有无 ID 页面写入；仅靠改 Agent 提示词不能解决。
修补 UI 循环必须局限于可复现的触发点，不能借此全面改造 AgentPanel。

## 验证结果与禁止越界的结论

- 8 个相关测试文件、147 项自动测试通过；node TypeScript、修改代码 ESLint、格式与 diff 检查通过。
- 新增 iframe 精确目标/禁止 AI Chat 和其他字段、全局 Page 不得抢写、正文文档失效、保存按钮不是证据、
  授权落盘前后取消不得派发 iframe 动作的测试。原 Runtime 改代与未知发布不重试测试继续通过。
- 实际复用了已有登录，未让用户重新登录。实际没有上传、保存、发布文章，也没有替换旧稿。
- 实际执行了正常创建任务、启动、主动暂停、重启、点击原任务继续和终止；但没有先形成自己的平台草稿。
  因而未完成用户要求的有稿恢复验收，也未证明首次检查后能继续正文。
- 没有真实发布授权，未派发发布请求；“发布结果未知后只核验”本轮只有自动测试，没有平台实测。

只有正常产品任务形成自己的草稿，记录账号/ID/标题/保存证据，中断后点击继续从管理页找回同稿，
在改代后的最新页面首次检查并实际完成下一个未完成步骤，且取消/未知发布矩阵通过后，才可宣布完成。
