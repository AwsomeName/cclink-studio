# 文章发布逐步可观测执行协议

状态：已确认需求，尚未实现
日期：2026-09-07

## 一句话结论

文章发布不能再让 Studio 只显示一个粗状态、同时让 Agent 在内部完成一整段流程。Studio 必须把
每次发布拆成可独立开始、可独立验证、可明确归责的小步骤；Agent 每次只执行当前被授权的小步骤。

用户在任何时刻都必须能直接看懂：现在执行哪一步、开始前应该是什么状态、Agent 被要求做什么、
完成后应该是什么状态、实际卡在哪里，以及问题属于 Studio、Agent、网页还是确实需要人工处理。

## 用户可执行验收

在真实 Studio 和真实 CSDN 登录账号中，用户只登录一次并启动一条文章发布任务。随后用户可以：

1. 在文章发布页看到当前精确步骤，而不是只看到“运行中”或“待核验”。
2. 展开当前步骤，看到起点状态、目标状态、执行者、允许动作、开始时间和最后活动时间。
3. 在 Agent Panel 中看到 Agent 收到的当前小步骤及其结构化结果，不能只有自由文本计划。
4. 当页面 Runtime 改代时，看到 Studio 正在执行“重新绑定并复核原草稿”，而不是被要求重新登录。
5. 当步骤失败时，看到一个明确失败归属和具体不匹配字段；无需从多份日志猜根因。
6. 关闭 Studio 后重新打开，看到同一 Affair、Attempt、草稿锚点和最后可信步骤，并从该步骤对账。
7. 对已经派发但结果未知的上传、保存或发布，只进入核验步骤，不直接重复动作。

以上七项全部通过前，不得把文章发布称为“可观测闭环”或“恢复闭环完成”。

## 当前问题：两个黑盒

### Studio 黑盒

当前生产定义只有 8 个粗检查点：打开编辑器、核验账号、上传图片、填写正文、填写字段、保存、发布、
核验发布。一个检查点内部可能包含 Tab 创建、导航、CDP 连接、Page 绑定、草稿核验、BrowserTask 创建、
Agent 绑定和多次工具调用。

检查点只记录状态、次数、证据和错误；没有记录本次小步骤的起点快照、精确命令、期望终点、实际结果、
Runtime 快照和失败归属。因此 `open-editor`、`running`、`checking-runtime` 不能回答“具体卡在哪个交接点”。

### Agent 黑盒

当前 Agent 在一次 Run 中得到从当前检查点继续完成整段发布的 Prompt，并自行选择多个 MCP 工具推进。
Studio 可以限制工具和校验部分结果，但不能从持久状态中还原 Agent 此刻正在执行的具体动作、预期结果和
下一步选择依据。

结果是：Studio 看见粗状态，Agent 内部执行细节只存在于消息和工具流中。两个黑盒之间缺少共同的、
持久的逐步执行协议。

## 三层概念

必须明确区分三层，不能再把它们都叫“步骤”：

| 层级                   | 用途                                 | 示例                                            | 所有者                             |
| ---------------------- | ------------------------------------ | ----------------------------------------------- | ---------------------------------- |
| 阶段 `checkpoint`      | 给用户概括业务进度                   | 恢复草稿、上传图片、保存草稿                    | `WebAffair.articlePublishing`      |
| 执行步骤 `operation`   | 一次可开始、可验证、可归责的工作单元 | 创建 BrowserTask、核验 Page 身份、上传第 2 张图 | `WebAffair.articlePublishing`      |
| 工具动作 `tool action` | 当前执行步骤内的一次实际调用         | inspect、click、fill、upload                    | Agent/Browser 只保留运行事实和日志 |

阶段是执行步骤的汇总投影。工具动作不能直接推进业务阶段；只有 Studio 验证执行步骤结果并完成一次
WebAffair 原子提交后，阶段才允许变化。

## 每个执行步骤必须包含什么

当前执行步骤生成随机 `operationRunId`。它只是本次执行的关联 ID，不是内容哈希、证据哈希、
`actionFingerprint` 或幂等指纹。持久状态只保存一个 current operation 和有界 transition 历史；已经完成
的业务结果折叠回 checkpoint、asset、sideEffect、draft 或 publication，不再保存完整 operationRuns 账本。

一条持久执行记录至少包含：

- 定位：`operationRunId`、`operationId`、定义版本、所属 checkpoint；
- 外层身份：`affairId`、`attemptId`、`executionGeneration`、`launchOperationId`；
- 运行资源：适用时记录 `agentRunId`、`browserTaskRunId`、`tabId`、
  `browserViewRuntimeGeneration`、`webContentsId`、`playwrightConnectionGeneration`、
  `playwrightPageBindingGeneration`；
- 起点：步骤开始前必须满足的业务状态、页面状态和 Runtime 状态；
- 命令：执行者、唯一目标、允许的工具动作和禁止动作；
- 终点：成功必须满足的状态和由谁核验；
- 结果：`ready/running/verifying/interrupted/result-unknown/waiting-human/failed`；完成后 current 指向下一步，
  完成事实折叠到现有唯一业务字段；
- 证据：主进程适配器读取的结构化网页事实，或明确的人工选择；
- 诊断：开始、最后活动、结束时间，失败分类、错误码和字段级 expected/actual；
- 恢复：能否安全重试、必须先核验什么、是否存在不可重复副作用。

transition 数量必须有上限。历史 transition 只用于诊断和恢复，不能形成第二套发布进度。

## 完整逐步流程

下表是产品要求，不是建议性日志清单。没有持久执行记录和终点校验的行，视为尚未实现。

### 1. 本地任务建立

| ID                  | 执行者 | 起点                     | 本步只做什么                                     | 成功终点                         |
| ------------------- | ------ | ------------------------ | ------------------------------------------------ | -------------------------------- |
| `source.inspect`    | Studio | 用户选择本地 Markdown    | 读取路径、大小、修改时间和引用图片               | 返回可保存预览或明确本地文件错误 |
| `account.resolve`   | Studio | 用户选择已保存 CSDN 账号 | 解析真实 account/Profile/website 引用            | 账号存在、未归档、Profile 唯一   |
| `affair.create`     | Studio | 来源和账号校验通过       | 原子创建 WebAffair 和冻结配置                    | 新 Affair 可从持久存储读回       |
| `execution.prepare` | Studio | 用户点击开始或继续       | 原子确定 Attempt、generation 和 launch operation | 唯一当前执行代次进入 preparing   |

### 2. 新任务建立草稿锚点

| ID                       | 执行者           | 起点             | 本步只做什么                                                               | 成功终点                                  |
| ------------------------ | ---------------- | ---------------- | -------------------------------------------------------------------------- | ----------------------------------------- |
| `account.lease.acquire`  | Studio           | execution 已准备 | 取得该账号发布租约                                                         | 没有其他任务拥有账号写入权                |
| `tab.acquire`            | Studio           | Profile 已解析   | 创建或复用唯一可见 Browser Tab                                             | workspace/account/profile/tab 精确一致    |
| `editor.open-create`     | Studio           | Tab 可用         | 打开 CSDN 新建文章入口                                                     | 可见页属于目标账号和支持页面              |
| `draft.anchor.establish` | Studio + adapter | 新稿尚无数字 ID  | 取得平台生成的数字 draftId；若需触发一次空草稿创建，必须作为受控副作用记账 | 数字 draftId、账号、标题和当前 URL 可核验 |

取得数字 draftId 前，不允许进入正文、图片或发布写入。不能用普通编辑器 URL 代替草稿身份。

### 3. 中断恢复原草稿

| ID                         | 执行者           | 起点                                | 本步只做什么                        | 成功终点                                |
| -------------------------- | ---------------- | ----------------------------------- | ----------------------------------- | --------------------------------------- |
| `recovery.lease.acquire`   | Studio           | 旧任务有 draftId，开始新 generation | 取得账号 recovery lease             | 其他 BrowserTask 不能取得该账号写入权   |
| `recovery.management.open` | Studio           | recovery lease 有效                 | 打开文章管理/草稿管理页             | 当前页面是支持的管理页                  |
| `recovery.account.verify`  | adapter          | 管理页可读                          | 读取并核验真实 CSDN 账号            | 与持久 platformAccountId 精确一致       |
| `recovery.draft.locate`    | adapter          | 账号正确                            | 按数字 draftId 搜索和定位           | 唯一候选 draftId 相同；标题只做二次核验 |
| `recovery.draft.open`      | Studio + adapter | 唯一候选已确定                      | 打开该候选                          | 当前编辑器 URL 含同一数字 draftId       |
| `recovery.draft.verify`    | adapter          | 原草稿已打开                        | 核验账号、draftId、标题和已保存状态 | 四项全部一致；写入仍未开放              |

有 draftId 时只能走本段流程，不能依赖旧编辑器 URL 恢复。找不到原草稿时停止，不新建文章。

### 4. Runtime 建立与第一次 Agent 检查

| ID                               | 执行者           | 起点                                | 本步只做什么                                                                                     | 成功终点                                                                                  |
| -------------------------------- | ---------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `recovery.restore-exact-draft`   | Studio + adapter | 新 generation 和 recovery lease 有效 | 从管理页找回并核验原账号、draftId、标题和 saved                                                  | 原草稿已核验，仍无写入许可                                                                |
| `runtime.prepare-first-inspect`  | Studio           | 原草稿已核验                        | 创建 BrowserTask、比较资源挂载前后 Page、必要时重核验、转交 lease、提交 binding/permit 并等待早到事件收敛 | WebAffair、BrowserTask、当前 Page 和 permit 身份完全一致，Agent 工具门才开放               |
| `page.first-inspect`             | Agent + adapter  | Runtime 准备完成                     | 只调用一次文章页面 inspect，不写网页                                                                  | main 在当前精确 Page 上返回结构化事实                                                      |

Page 身份前后采样、lease 转交、binding commit 和缓存事件重放是
`runtime.prepare-first-inspect` 内的结构化 transition/diagnostic，不是彼此独立的业务 operation。只有会独立
决定能否继续、是否可重试或是否必须对账的工作单元才提升为 operation。

`page.first-inspect` 失败时，必须先判断是否为可安全修复的同页 Runtime 改代。可以重新绑定并复核原草稿
时由 Studio 自动处理；内部绑定错误不能转成登录、验证码或其他人工问题。

### 5. 正文和图片

每张图片分别执行，不能用一个 `upload-assets` 隐藏多张图片的不同状态：

| ID                                | 执行者          | 起点                   | 本步只做什么                   | 成功终点                                  |
| --------------------------------- | --------------- | ---------------------- | ------------------------------ | ----------------------------------------- |
| `asset.inspect:{assetId}`         | Agent + adapter | 当前草稿和 permit 有效 | 检查该资产是否已确认或结果未知 | 决定 skip、verify 或 upload；不猜图片 URL |
| `asset.upload.reserve:{assetId}`  | Studio          | 确认需要上传           | 预留一次上传副作用             | write-ahead 记录已持久化                  |
| `asset.upload.dispatch:{assetId}` | Agent           | reserve 有效           | 只上传这一张本地图片           | 派发事实先落盘；结果未验证                |
| `asset.upload.verify:{assetId}`   | adapter         | 上传已派发             | 读取平台页面中的对应图片状态   | 确认 uploaded，或进入 result-unknown      |
| `body.inspect`                    | Agent + adapter | 所有本地图片已处理     | 读取正文编辑器当前状态         | 明确是否需要填写或对账                    |
| `body.fill`                       | Agent           | 当前步骤授权 fill      | 只填写正文                     | 动作返回，不代表完成                      |
| `body.verify`                     | adapter         | 正文已填写             | 从页面回读支持的正文完成事实   | 主进程确认正文步骤完成                    |

图片 URL 改变但图片仍存在时不得失败。结果未知时，用户只能选择“网页里有”或“网页里没有，重新上传”，
不能被要求填写 URL。

### 6. 平台字段与保存

| ID                      | 执行者          | 起点                 | 本步只做什么                                        | 成功终点                         |
| ----------------------- | --------------- | -------------------- | --------------------------------------------------- | -------------------------------- |
| `field.inspect:{field}` | Agent + adapter | 正文已核验           | 读取一个字段                                        | 得到当前值或 unsupported         |
| `field.fill:{field}`    | Agent           | 当前字段需要修改     | 只填写 title/summary/tags/category/cover 中一个字段 | 工具动作返回                     |
| `field.verify:{field}`  | adapter         | 字段已填写           | 回读同一字段                                        | 与任务值一致                     |
| `draft.save.reserve`    | Studio          | 所有字段已核验       | 预留一次保存副作用                                  | write-ahead 记录已持久化         |
| `draft.save.dispatch`   | Agent           | reserve 有效         | 只触发一次显式保存                                  | 保存已派发，尚未宣称成功         |
| `draft.save.verify`     | adapter         | 保存已派发或结果未知 | 核验账号、draftId、标题和保存状态                   | 同一草稿明确 saved；否则保持未知 |

### 7. 发布和结果核验

| ID                   | 执行者           | 起点                     | 本步只做什么                                                   | 成功终点                        |
| -------------------- | ---------------- | ------------------------ | -------------------------------------------------------------- | ------------------------------- |
| `publish.preflight`  | Studio + adapter | 草稿保存已核验           | 复核账号、draftId、字段、资产及人工专属卡点                    | 目标和授权仍与用户启动快照一致  |
| `publish.reserve`    | Studio           | preflight 通过           | 预留唯一发布副作用                                             | write-ahead 记录已持久化        |
| `publish.dispatch`   | Agent            | 当前发布 capability 有效 | 只点击一次确定的发布控件                                       | dispatched 已落盘；禁止自动重放 |
| `publish.observe`    | adapter          | 发布已派发               | 观察页面导航或平台回执                                         | 得到明确结果或 result-unknown   |
| `publication.verify` | Studio + adapter | 有公开候选或结果未知     | 在文章管理页按原账号和精确标题查找并核验公开页                 | 唯一公开 URL、账号、标题一致    |
| `execution.complete` | Studio           | 平台结果已核验           | 原子结束 operation、Attempt、checkpoint、publication 和 Affair | 所有终态一致且只写一次          |

发布请求已派发但结果未知时，只允许执行 `publication.verify`，不能再次进入 `publish.dispatch`。

## Agent 执行协议

一个 execution generation 使用一个可见 conversation 和一个长 Agent Run，避免每个小步骤重复创建
BrowserTask 和交接账号租约。不可变的 ToolExecutionContext 只固定 workspace、Affair、Attempt、generation
和 launch；每次工具调用由 main 动态读取 WebAffair 当前 operation，模型传入的 operationRunId 最多只作
CAS 期望值，不能成为权限来源。

Agent 不能一次获得“自行完成后续全部流程”的开放式权限。它必须按以下协议运行：

1. Studio 确定当前唯一 operation；P0 的首次 inspect 由 main 自动建立，不新增 claim/report MCP。
2. Studio 先把 `operationRunId`、起点摘要和 `running` 状态写入 WebAffair。
3. Studio 只开放该 operation 所需工具和动作；其他动作在 Browser 调用前拒绝。
4. Agent 返回结构化结果，不用自由文本“我完成了”推进状态。
5. Studio 使用当前网页事实和当前 Runtime 身份验证结果。
6. Studio 原子折叠 completed/failed/result-unknown 后，才允许进入下一 operation。

Agent 没有权限修改 checkpoint、Attempt、publication 或 Affair 终态。Agent 完成文本、Run complete 和
BrowserTask complete 都不是发布成功证据。

## Runtime 改代协议

Tab 未变不代表 Page 未变。SPA 导航、iframe、popup、WebContents 重建、CDP 重连、Page 重新 claim 和
BrowserTask 资源挂载都可能改变 Runtime 身份。

发现任一 Runtime 字段变化时：

1. 立即关闭当前 operation 的网页写入权限。
2. 持久记录具体变化字段及 old/new 值。
3. 在同一可见 Tab 上取得最新 Page binding。
4. 重新核验账号、draftId、标题和保存状态。
5. 核验成功后，原子替换 WebAffair Runtime binding 和 write permit。
6. BrowserTask correlation 与新 binding 对齐后，再恢复原 operation。
7. 旧 binding、旧 permit、旧 operationRunId 的迟到调用全部 no-op。

只有真实页面出现登录失效、验证码、法律声明或账号冲突时才能进入人工处理。Studio 内部 Runtime、
状态机或绑定错误必须显示为“Studio 运行错误”，并提供自动重新绑定或终止操作。

## 用户必须看到的最小诊断

文章发布页必须直接展示：

```text
当前步骤：runtime.prepare-first-inspect
执行者：Studio
起点：草稿已核验，BrowserTask 已创建
目标：确认资源挂载后的 Page 身份
当前 transition：page_identity_changed
实际：playwrightPageBindingGeneration 31 → 32
处理：正在同页重新绑定并复核草稿 164148817
责任：Studio Runtime；不需要重新登录
```

复制诊断时必须同时包含：

- 事务期望值；
- 当前 WebAffair Runtime binding；
- 当前 BrowserTask correlation；
- 当前 BrowserManager View/WebContents 身份；
- 当前 Playwright connection/Page binding；
- 当前 operation 的起点、目标、实际结果和字段级 mismatch。

统一错误文案可以存在，但不能丢失字段级原因。一次真实故障后应能直接确定断点，不依赖重新复现和猜测。

## 失败分类

| 分类                  | 示例                                 | 默认处理                         | 是否让用户登录 |
| --------------------- | ------------------------------------ | -------------------------------- | -------------- |
| `studio-state`        | execution 与 Attempt 状态矛盾        | 停止写入，内部收敛或报工程错误   | 否             |
| `studio-runtime`      | Page/Task/permit 代次不一致          | 同页重绑并重新核验               | 否             |
| `agent-runtime`       | Agent 退出、未领取步骤、工具协议违规 | 安全步骤可重启；副作用步骤先对账 | 否             |
| `platform-page`       | CSDN DOM 不受支持、草稿找不到        | 停止自动化并说明网页事实         | 通常否         |
| `human-required`      | 验证码、扫码、法律声明、账号冲突     | 可见页面人工处理后重新核验       | 仅真实需要时   |
| `side-effect-unknown` | 上传/保存/发布派发后失联             | 进入专用核验步骤，禁止重放       | 否             |

## 不可违反的边界

- `WebAffairService` 仍是唯一发布进度状态所有者；operation 记录必须位于
  `WebAffair.articlePublishing`，不能建立独立数据库或 renderer Store 真相。
- 不重新引入内容哈希、正文哈希、图片哈希、证据哈希或 `actionFingerprint`。
- 不迁移旧文章发布数据；新 schema 启用时直接删除旧版本文章发布事务，保留非文章 WebAffair。
- 不依赖旧网页 URL 恢复；有 draftId 必须从草稿管理页找回原草稿。
- 草稿恢复必须核验真实账号、准确 draftId、标题和保存状态。
- 不得为了继续运行而降低串稿、错账号和重复发布保护。
- renderer、Agent 文本和 Agent 终态都不能成为发布成功事实源。

## 当前完成度判断

当前 HEAD 已有 execution generation、launch operation、Runtime binding、recovery permit、Page 改代重绑、
副作用账本和字段级主进程日志等基础能力，也已有一条“恢复后 Page binding 改代再进行第一次检查”的
针对性测试。

但上述 current operation、持久 transition、Agent 单步授权、用户可见阻塞点和统一结构化诊断尚未实现。
因此现状只能称为“具备部分安全围栏”，不能称为“双黑盒已经拆开”。
