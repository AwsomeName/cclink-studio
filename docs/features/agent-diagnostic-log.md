# Agent 诊断日志与一键复制调试包

> 状态：D0-D3 已落地；浏览器绑定与登录态诊断已增强；D4 错误现场附件待做
> 最后更新：2026-07-16
> 关联文档：`docs/features/agent-system.md`、`docs/features/ai-work-browser-v0.1-tasks.md`、`docs/features/project-operations-assistant.md`、`docs/features/browser-automation.md`

## 结论

Agent 诊断日志不是锦上添花，而是 CCLink Studio 进入真实网页运营前必须补上的基础设施。

如果用户说“我想登录知乎”，Agent 在浏览器里反复尝试但没有结果，当前排查成本太高：

- 用户很难准确描述 Agent 到底卡在哪里。
- 开发者很难判断是浏览器没打开、页面没加载、登录态失效、选择器找不到、验证码/风控、权限确认卡住，还是模型自己绕远了。
- 现有右侧 Agent 面板能看到部分 tool use，但它不是可复制、可脱敏、可定位的调试材料。

第一版要做的不是完整日志平台，而是一个可复制的“当前任务诊断包”：

```text
用户点击右侧 Agent 面板顶部的“复制诊断日志”
  -> CCLink Studio 汇总当前会话、浏览器、任务、工具调用、错误、URL、console/network 摘要
  -> 默认脱敏 password/token/cookie/验证码/API key
  -> 复制 Markdown 到剪贴板
  -> 用户可以直接粘贴给开发者或 Agent 排查
```

当前实现状态：

| 项目 | 状态 | 说明 |
|------|------|------|
| Markdown 诊断包格式 | ✅ 已完成 | `buildAgentDiagnosticMarkdown` 输出固定结构 |
| 脱敏规则 | ✅ 已完成 | 覆盖 cookie/token/password/验证码/API key/手机号/邮箱等常见模式 |
| Agent 面板复制按钮 | ✅ 已完成 | 右侧资源栏旁剪贴板按钮复制当前会话诊断日志 |
| 浏览器任务日志合并 | ✅ 已完成 | 汇总 `BrowserTaskRun`、`BrowserActionLog`、下载记录 |
| 复制反馈 | ✅ 已完成 | 成功/失败 toast |
| console/network/page summary | ✅ 已完成 | 只读 `browser:getDiagnostics` 汇总 console、network、疑似登录/验证码/风控 |
| 可视页与自动化页绑定诊断 | ✅ 已完成 | 并列输出 WebContentsView 与 Playwright 的 tabId、URL、标题和绑定状态 |
| 登录态安全摘要 | ✅ 已完成 | 输出实际 partition、Cookie 数量、持久性、过期数和疑似认证 Cookie 元数据，不输出 Cookie 值 |
| 最近导航与 claim 结果 | ✅ 已完成 | 输出最近 URL 链和最近一次 Page claim 成败 |
| Console/Network 按 Page 隔离 | ✅ 已完成 | 页面日志带 Page 归属，避免其他 Tab 错误串入 |
| 截图/DOM 摘要 | 📋 待做 | D4：用户显式选择后再保存 |

## /grilling 结论

先做“当前任务黑匣子”，不要先做泛化 observability 平台。

这个判断的关键拷问：

- 只复制聊天记录够不够？不够。缺 tabId、URL、工具耗时、失败原因和页面错误，仍然无法排查。
- 只记录浏览器动作够不够？不够。Agent 可能根本没有切到浏览器 scope，或者模型事件流异常。
- 要不要保存所有截图和 DOM？第一版不要。截图和 DOM 有隐私风险，先只复制最后状态和错误摘要；截图改为用户显式附加。
- 要不要一开始做完整持久化日志系统？不要。当前痛点是“我怎么把失败现场准确发给你”，先复制最近任务。
- 最大风险是什么？日志泄露账号、手机号、验证码、cookie、token。脱敏必须作为 P0，不是后补。

一句话验收：

```text
用户在知乎登录失败后，点击一次复制按钮，把日志粘贴给开发者；
开发者不用再追问“你当时在哪个页面、点了什么、报什么错”，就能判断下一步排查方向。
```

## 用户故事

### 故事 1：知乎登录排障

用户说：

```text
我想登录自己的知乎。
```

Agent 打开浏览器后卡住。用户点击“复制诊断日志”，粘贴给开发者。

诊断包应回答：

- 当前浏览器是否真的打开知乎。
- 当前 URL 是知乎、百度，还是空页。
- 使用的是哪个 `browserProfile`。
- Agent 调用了哪些工具。
- 最近一次失败是 selector、timeout、navigation、auth、captcha，还是未知。
- 页面 console 是否有关键错误。
- 是否存在验证码、二维码、登录弹窗等弱判断信号。

### 故事 2：微信公众号投稿排障

Agent 读取 Markdown 后准备填公众号编辑器，但内容没有进入编辑器。

诊断包应回答：

- 文案文件路径。
- 浏览器 profile。
- 是否进入 `mp.weixin.qq.com`。
- 是否检测到 iframe 或 contenteditable。
- 最近的 `browser_click`、`browser_fill`、`browser_upload_file` 是否成功。
- 是否有上传失败、网络失败、权限确认未处理。

### 故事 3：用户发给 Agent 自查

用户不一定只发给开发者，也可以把诊断包重新贴给 CCLink Studio Agent：

```text
这是刚才失败的诊断日志，分析为什么登录知乎失败，下一步怎么做？
```

所以诊断包必须是人和模型都能读懂的 Markdown，而不是内部 JSON dump。

## 产品入口

### 第一版入口

位置：右侧 Agent 面板顶部，当前资源 chips 行右侧。

按钮：

```text
[复制诊断日志]
```

建议使用剪贴板图标，hover tooltip 显示“复制当前会话诊断日志”。

点击行为：

1. 收集当前 active conversation。
2. 收集当前挂载资源，优先浏览器 tab。
3. 收集 active browser task、action logs、downloads。
4. 收集当前浏览器 URL、title、profile、view mode。
5. 收集最近 console error 和 network failure 摘要。
6. 脱敏。
7. 复制 Markdown 到剪贴板。
8. toast 提示“诊断日志已复制”。

### 后续入口

- Agent 任务卡右上角：复制该任务诊断包。
- 错误卡片：复制失败诊断。
- 设置页：导出最近完整诊断日志文件。
- 运营助手平台会话：复制平台操作诊断包。

## 诊断包内容

第一版输出 Markdown，示例：

```md
# CCLink Studio 诊断日志

## 元信息
- 生成时间：2026-07-15 10:54:23
- CCLink Studio 版本：0.1.0
- 平台：macOS
- 工作区：/Users/apple/Desktop/...
- 会话 ID：...

## 用户目标
我想登录自己的知乎

## 当前浏览器
- tabId：...
- URL：https://www.zhihu.com/signin
- Title：知乎 - 登录
- Profile：zhihu
- View Mode：desktop

## Agent 状态
- 后端：cclink-studio-agent
- 权限模式：categorized
- 任务状态：running
- failureReason：-

## 时间线
[10:54:02.120] user_message: 我想登录自己的知乎
[10:54:04.031] tool_start browser_title {}
[10:54:04.166] tool_success browser_title 135ms title="百度一下，你就知道"
[10:54:06.440] tool_start browser_navigate {"url":"https://www.zhihu.com"}
[10:54:08.921] tool_success browser_navigate 2481ms url="https://www.zhihu.com/signin"
[10:54:10.102] browser_url_changed https://www.zhihu.com/signin
[10:54:13.772] tool_fail browser_click 5000ms reason="selector_missing"

## 最近浏览器错误
- console.error: -
- network failed: -

## 下载/上传
- 无

## 脱敏说明
password/token/cookie/api key/验证码等字段已脱敏。
```

## 数据来源

| 来源 | 当前状态 | 用途 |
|------|----------|------|
| Agent conversation messages | 已存在 | 用户目标、assistant 文本、tool use/tool result |
| `BrowserTaskRuntime` | 已存在 | taskRunId、状态、失败原因、动作日志 |
| `BrowserActionLog` | 已存在 | 工具名、参数摘要、开始结束、错误 |
| `BrowserManager` | 已存在 | active tab、URL、title、profile、view mode |
| `PlaywrightBridge` console/network buffers | 已存在 | console error、network 摘要 |
| `BrowserDownloadStore` | 已存在 | 下载记录、触发来源、文件状态 |
| 权限确认 pending 状态 | 部分存在 | 判断是否卡在用户确认 |
| 截图/DOM snapshot | 未形成诊断接口 | 第一版只预留，不默认复制 |

## 脱敏规则

必须默认脱敏：

- Cookie。
- Authorization header。
- token、secret、api key、session。
- password、passwd、pwd。
- 手机号中间 4 位。
- 邮箱用户名中间部分。
- 短信验证码、邮箱验证码、二步验证码。
- 用户输入框内容，默认只记录长度；明确属于普通搜索词时可记录。

建议脱敏格式：

```text
[redacted]
[redacted:11 chars]
138****1234
a***e@example.com
```

不得记录：

- 完整 cookie。
- 完整 localStorage/sessionStorage。
- 完整身份证、银行卡、恢复码。
- 未经用户确认的页面全量 HTML。

## 日志事件模型

第一版可以先在渲染进程汇总已有状态，但事件模型要提前定好，避免后续返工。

```ts
type DiagnosticEventKind =
  | 'user_message'
  | 'assistant_text'
  | 'assistant_thinking'
  | 'tool_start'
  | 'tool_success'
  | 'tool_fail'
  | 'browser_url_changed'
  | 'browser_task_changed'
  | 'browser_action_log'
  | 'browser_console_error'
  | 'browser_network_failed'
  | 'permission_requested'
  | 'permission_resolved'
  | 'download_changed'
  | 'system_error'

interface DiagnosticEvent {
  id: string
  timestamp: number
  conversationId?: string
  taskRunId?: string
  tabId?: string
  kind: DiagnosticEventKind
  summary: string
  data?: Record<string, unknown>
  redacted: boolean
}
```

## 里程碑计划

### D0：诊断包格式和脱敏规则

状态：✅ 已完成第一版。

目标：先固定复制出来的内容长什么样。

做什么：

- 新增本文档。
- 定义 `DiagnosticReport`、`DiagnosticEvent`、`DiagnosticRedactionRule` 的共享类型草案。
- 明确第一版复制 Markdown，不导出 JSON 文件。
- 明确敏感字段默认脱敏。

怎么做：

- 在 `src/shared/ipc` 或 `src/shared/diagnostics` 增加类型。
- 先写纯函数：`redactDiagnosticValue`、`formatDiagnosticMarkdown`。
- 单元测试覆盖 cookie、token、password、手机号、邮箱、验证码。

验收标准：

- 给定一组模拟事件，可以生成稳定 Markdown。
- 测试确认敏感字段不会原样出现在输出里。
- 诊断包包含时间、会话、浏览器、任务、时间线、错误、脱敏说明六个固定段落。

拷问：

- 如果格式今天不定，后面 UI 和主进程各写一套，复制出来会变成混乱文本。
- 如果先不测脱敏，后面真实登录场景一定会把敏感信息带出来。

### D1：当前会话一键复制

状态：✅ 已完成第一版。

目标：在右侧 Agent 面板复制当前会话诊断包。

做什么：

- 在 Agent 面板顶部增加“复制诊断日志”按钮。
- 从 renderer store 收集当前 conversation 的消息和运行状态。
- 调用浏览器 IPC 获取当前 active tab 的 URL、title、view state。
- 调用 task/download IPC 获取当前任务日志和产物。
- 复制 Markdown 到剪贴板。

怎么做：

- 新增 `src/renderer/src/features/diagnostics/`。
- 实现 `buildCurrentConversationDiagnosticReport(...)`。
- AgentPanel 顶部接入按钮和 toast。
- 使用 `navigator.clipboard.writeText`，失败时 fallback 到临时 textarea。

验收标准：

- 用户在任意 Agent 会话点击按钮后，剪贴板得到 Markdown 诊断包。
- 没有浏览器 tab 时，诊断包说明“当前未挂载浏览器”，而不是报错。
- 有浏览器 tab 时，诊断包包含 URL、title、browserProfile。
- 最近 tool use/tool result 至少能按时间线呈现。

拷问：

- 只从 UI 消息里拼日志不够，但 D1 可以先汇总现有 store 和 IPC，先解决“能复制出来”。
- 按钮不能影响 Agent 输入区操作，必须是轻量入口。

### D2：浏览器任务级诊断增强

状态：✅ 已完成第一版。

目标：让复制日志能定位浏览器任务到底卡在哪里。

做什么：

- 诊断包加入 `BrowserTaskRun`。
- 加入 `BrowserActionLog` 的耗时、状态、failureReason。
- 加入 tab 关闭、暂停、取消、任务完成事件。
- 加入下载记录。

怎么做：

- 复用 `browserTask:listActionLogs`、`browserTask:getActiveForTab`、`browserDownload:list`。
- 对 `paramsSummary` 二次脱敏，不信任任何上游日志已经脱敏。
- 时间线合并 conversation events 和 browser action logs，按 timestamp 排序。

验收标准：

- Agent 浏览器任务运行中复制日志，能看到当前 task id、goal、status。
- `browser_fill` 不显示完整填写内容，只显示长度。
- `browser_upload_file` 只显示文件名，不显示不必要的完整敏感路径；必要时路径只保留工作区相对路径。
- 任务失败时，诊断包包含 failureReason 和最后失败工具。

拷问：

- 如果只显示“Agent 正在想”，无法区分模型绕远和工具层失败。
- 如果没有耗时，无法判断是页面慢、网络慢，还是选择器立即失败。

### D3：页面运行态摘要

状态：✅ 已完成第一版。

目标：补齐“浏览器打不开还是网页报错”的判断材料。

做什么：

- 加入最近 console error。
- 加入最近 network failed / 4xx / 5xx 摘要。
- 加入最近 URL 变化。
- 加入当前页面弱诊断：是否疑似登录页、验证码页、二维码页、风控页。
- 并列记录真实可视 WebContentsView 与 Playwright Page，明确标记 URL/Tab 绑定不一致。
- 记录实际浏览器 partition 和不含值的 Cookie 元数据，用于判断认证态是否建立或被撤销。
- Console/Network 必须按具体 Page 隔离。

怎么做：

- 扩展 `PlaywrightBridge` 现有 console/network buffer 的 IPC 读取能力。
- 新增只读诊断 IPC：`browserDiagnostics:getPageSummary(tabId)`。
- 弱诊断只做启发式：标题、URL、页面文本关键词、常见 input 类型，不做绕过。

验收标准：

- 如果页面停在百度而不是知乎，诊断包直接显示当前 URL。
- 如果页面包含“验证码/安全验证/扫码登录/二维码”等关键词，诊断包标记 `suspectedCaptchaOrLoginChallenge`。
- 如果最近网络存在 403/429/5xx，诊断包列出 URL host、status、resourceType，不暴露敏感 query。

拷问：

- 不能把验证码识别做成“绕过验证码”。目标是定位和提示人工接管。
- network URL 必须清理 query 参数，很多 token 会藏在 query 里。

### D4：错误现场附件

目标：在用户明确需要时，提供更强的现场材料。

做什么：

- 复制诊断日志按钮旁增加菜单：
  - 复制诊断日志。
  - 复制诊断日志并保存截图。
  - 导出完整诊断文件。
- 失败任务自动记录最后一张截图路径，但不默认复制图片内容。
- 可选保存轻量 DOM 摘要，不保存完整 HTML。

怎么做：

- 截图保存到 `userData/diagnostics/{conversationId}/{timestamp}.png`。
- Markdown 中引用本地截图路径。
- DOM 摘要只包含 title、URL、可见表单控件摘要、按钮文本摘要、iframe 列表。

验收标准：

- 用户选择“保存截图”后，诊断包包含截图路径。
- 截图文件存在，且不会自动上传。
- DOM 摘要不包含 input value。

拷问：

- 诊断截图可能包含账号头像、手机号、私信等敏感内容，因此必须由用户显式选择。
- 完整 HTML 可能包含 token 或用户内容，第一阶段不要做。

### D5：持久化诊断日志与设置页

目标：从“当前复制”升级为“最近问题可回溯”。

做什么：

- 将最近 N 条诊断事件持久化。
- 设置页增加“诊断与日志”区域。
- 支持导出最近 15 分钟、当前工作区、当前会话、当前任务。
- 支持一键清理诊断日志。

怎么做：

- 主进程新增 `DiagnosticLogService`。
- 落盘到 `userData/diagnostics/events.jsonl`，默认滚动保留 7 天或 50MB。
- 所有写入前统一脱敏。
- 设置页展示存储大小、保留策略、清理按钮。

验收标准：

- App 重启后仍可导出最近诊断日志。
- 超过保留上限会滚动清理。
- 用户可以一键清空。
- 未开启“保存诊断日志”时，只保留内存最近事件。

拷问：

- 持久化是隐私风险放大器，默认策略必须保守。
- 不要把诊断日志变成云同步内容；第一阶段只留本机。

### D6：真实运营链路验收

目标：用诊断系统反过来支撑知乎和微信公众号测试。

做什么：

- 跑知乎登录链路。
- 跑微信公众号登录和草稿填写链路。
- 每次失败必须复制诊断日志，形成问题样本。
- 根据样本补分类器、页面摘要和提示词。

怎么做：

- 新增测试记录文档：`docs/testing/project-ops-browser-diagnostics.md`。
- 每个场景记录：目标、平台、profile、步骤、结果、诊断日志摘要、修复项。
- 至少保留 3 类失败样本：登录态失效、选择器失败、验证码/风控。

验收标准：

- 知乎登录失败时，诊断包能判断是否停在登录/验证码/错误 URL。
- 微信公众号编辑器失败时，诊断包能判断是否 iframe/contenteditable/上传失败。
- 开发者能基于诊断包直接创建 issue 或修复任务，无需反复追问用户现场。

拷问：

- 如果诊断系统不能服务真实知乎/公众号排障，就是形式主义。
- 如果每次失败仍要用户口述页面状态，说明 D1-D3 没有达标。

## 第一版开发顺序

建议实际排期：

```text
第 1 步：D0 类型、格式、脱敏测试
第 2 步：D1 Agent 面板复制按钮
第 3 步：D2 浏览器任务和动作日志合并
第 4 步：D3 console/network/page summary
第 5 步：用知乎登录做第一轮真实验收
第 6 步：再做 D4/D5
```

不要先做：

- 云端日志。
- 完整日志搜索 UI。
- 全量 DOM 保存。
- 自动上传诊断。
- 复杂 trace viewer。

## 残余风险

- Agent thinking 内容可能包含用户敏感意图，复制前需要清楚标注会包含会话摘要。
- 浏览器页面标题和 URL 本身也可能包含敏感 query，需要清理。
- 诊断包过长会影响粘贴和阅读，第一版默认限制最近 5 分钟或最近 100 个事件。
- 如果只在 renderer 汇总，主进程崩溃前的错误可能拿不到；D5 再补主进程持久化。
- 如果用户处于 `auto` 权限模式，日志会显示高风险工具已自动执行，这对排查有帮助，但也会暴露产品安全边界，需要在后续权限模型里继续收紧。
