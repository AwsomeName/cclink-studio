# AI 工作浏览器路线

> 状态：📋 方案设计中
> 优先级：P0，浏览器支柱的下一阶段
> 目标：让 CCLink Studio 同时成为可靠的 AI 任务浏览器，以及具备基础日常浏览能力的工作浏览器。

## 一句话结论

CCLink Studio 浏览器不是单纯的内嵌 Chrome，也不应一开始追求完整替代 Chrome。它的定位是：

```text
AI 任务浏览器优先，逐步具备日常主力浏览器能力。
```

第一阶段同时推进两条线：

| 方向             | 定义                                                   | 优先级 |
| ---------------- | ------------------------------------------------------ | ------ |
| A：AI 任务浏览器 | Agent 可控、可观测、可恢复，优先任务成功率             | P0     |
| B1：工作浏览器   | 书签、历史、下载、登录态、标签页恢复，优先日常工作闭环 | P1     |

B2 能力（密码管理、扩展生态、完整 DevTools、跨端同步、企业级隐私策略）暂缓，不进入第一阶段承诺。

## /grilling 结论

先做 A，再以 B1 托住用户日常浏览，是当前最稳的路线。

需要警惕的不是功能做不出来，而是产品模式混乱：用户在浏览时 Agent 突然接管，Agent 执行时用户手动改状态，下载和登录态无法解释来源。这会直接伤害信任。

因此浏览器必须明确区分两种模式：

| 模式     | 触发                              | 核心目标               | 用户感知              |
| -------- | --------------------------------- | ---------------------- | --------------------- |
| 浏览模式 | 用户手动打开网页、日常浏览        | 顺手、连续、可信       | 像一个工作浏览器      |
| 任务模式 | Agent 接管当前 tab 或创建任务 tab | 成功率、可观测、可恢复 | AI 正在可见地操作网页 |

任务模式不是隐藏自动化。用户必须能看到、暂停、终止、接管，并能追溯 Agent 做过什么。

## 产品边界

### 当前要做

- Agent 操作浏览器时有任务记录、动作日志、失败原因和恢复策略。
- 用户日常浏览有基础书签、历史、下载中心和跨会话恢复。
- 登录态以站点级持久化为目标，优先支持常见工作网站。
- 下载由统一下载中心管理，人工下载和 Agent 下载使用同一套记录。
- 浏览历史、下载、书签可以成为 Agent 上下文。

### 当前不做

- 不承诺完整替代 Chrome / Edge。
- 不接入 Chrome Web Store。
- 不做完整密码管理器。
- 不做完整 DevTools 替代品。
- 不做跨端浏览器同步。
- 不把高风控网站的绕过能力作为第一阶段验收标准。

## 核心对象

```ts
type BrowserMode = 'browse' | 'task'

interface BrowserProfile {
  id: string
  name: string
  kind: 'default' | 'work' | 'personal'
  createdAt: number
  updatedAt: number
}

interface BrowserTabState {
  tabId: string
  profileId: string
  workspaceKey: string | null
  mode: BrowserMode
  url: string
  title: string | null
  pinned: boolean
  lastActiveAt: number
}

interface BrowserTaskRun {
  id: string
  workspaceKey: string | null
  tabId: string
  profileId: string
  goal: string
  status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
  startedAt: number
  endedAt?: number
  failureReason?: BrowserTaskFailureReason
  downloadIds: string[]
}

type BrowserTaskFailureReason =
  | 'timeout'
  | 'navigation_blocked'
  | 'selector_missing'
  | 'element_obscured'
  | 'auth_required'
  | 'captcha_or_bot_check'
  | 'download_failed'
  | 'user_interrupted'
  | 'unknown'

interface BrowserActionLog {
  id: string
  taskRunId: string
  tabId: string
  action: string
  paramsSummary: string
  status: 'started' | 'succeeded' | 'failed' | 'skipped'
  startedAt: number
  endedAt?: number
  screenshotId?: string
  domSnapshotId?: string
  errorMessage?: string
}

interface DownloadRecord {
  id: string
  profileId: string
  workspaceKey: string | null
  taskRunId?: string
  sourceUrl: string
  suggestedFilename: string
  savedPath?: string
  status: 'pending' | 'downloading' | 'completed' | 'failed' | 'cancelled'
  createdAt: number
  completedAt?: number
}

interface BookmarkRecord {
  id: string
  profileId: string
  workspaceKey: string | null
  title: string
  url: string
  folderId?: string
  createdAt: number
  updatedAt: number
}

interface HistoryRecord {
  id: string
  profileId: string
  workspaceKey: string | null
  tabId?: string
  taskRunId?: string
  url: string
  title: string | null
  visitedAt: number
}

interface SitePermission {
  profileId: string
  origin: string
  allowAgentClick: boolean
  allowAgentFill: boolean
  allowAgentUpload: boolean
  allowAgentDownload: boolean
  allowPersistentSession: boolean
  updatedAt: number
}
```

## A：AI 任务浏览器

### 必备能力

| 能力              | 要求                                                          |
| ----------------- | ------------------------------------------------------------- |
| tab/page 生命周期 | 每个 Agent 动作必须绑定到正确 `tabId`，tab 关闭后动作立即失效 |
| 动作日志          | 记录动作、参数摘要、耗时、状态、错误、截图和必要 DOM snapshot |
| 暂停/终止/接管    | 用户可以在任何任务模式下暂停、终止或手动接管                  |
| 失败分类          | 所有失败必须归类，避免只返回通用 error                        |
| 下载追踪          | Agent 触发的下载必须进入下载中心，并关联 `taskRunId`          |
| 权限提示          | 上传、下载、表单提交、跨站导航等动作按站点权限确认            |

### 任务模式状态

```text
idle
  -> running
  -> paused
  -> completed
  -> failed
  -> cancelled
```

状态约束：

- `running` 时工具栏显示 Agent 正在操作、当前动作、暂停和终止按钮。
- `paused` 时页面保持当前状态，不自动继续动作。
- `failed` 时展示失败原因、最后截图、可恢复建议。
- `cancelled` 由用户触发，后续动作全部丢弃。

### 可靠性指标

| 指标               | 第一阶段目标 |
| ------------------ | ------------ |
| 标杆任务首次成功率 | >= 80%       |
| 重试后成功率       | >= 90%       |
| 用户终止响应时间   | <= 1s        |
| 错误可归类比例     | >= 95%       |
| 下载可追踪比例     | 100%         |
| 动作日志完整率     | 100%         |

标杆任务应覆盖登录后表单、搜索提取、多页跳转、popup、iframe、下载、上传和失败恢复。

## B1：工作浏览器

### 书签

第一阶段只做工作闭环：

- 当前页收藏。
- 书签搜索。
- 文件夹管理。
- 工作空间内书签。
- Agent 可读取用户授权的书签作为上下文。

### 历史

历史分两类：

| 类型         | 来源           | 用途                 |
| ------------ | -------------- | -------------------- |
| 普通浏览历史 | 用户手动浏览   | 快速回访、地址栏建议 |
| 任务访问历史 | Agent 任务过程 | 任务追溯、上下文恢复 |

历史必须支持按 `profileId`、`workspaceKey`、`taskRunId` 过滤。

### 下载中心

下载中心是 A/B 共用基础设施，不是浏览模式附属功能。

必须展示：

- 文件名、状态、来源 URL。
- 保存路径。
- 触发来源：用户 / Agent 任务。
- 失败原因和重试入口。
- 打开文件、在文件夹中显示、复制来源 URL。

#### 下载路径与生命周期

下载必须区分“用户手动下载”和“Agent 任务下载”。这不是实现细节，而是信任边界：

| 下载类型                 | 默认位置                                                            | 说明                             |
| ------------------------ | ------------------------------------------------------------------- | -------------------------------- |
| 用户手动下载             | 系统下载目录，例如 macOS `~/Downloads`                              | 符合日常浏览器习惯               |
| Agent 任务下载           | CCLink Studio 临时下载区：`userData/agent-downloads/{taskRunId}/`   | 不污染用户工作空间，保留任务归属 |
| Agent 明确生成的成果文件 | 当前工作空间 `.cclink-studio/downloads/{taskRunId}/` 或用户指定路径 | 需要用户确认或任务权限授权       |

用户操作：

- `保留到工作空间`：从临时下载区移动到当前工作空间 `.cclink-studio/downloads/{taskRunId}/`。
- `另存为`：弹系统保存对话框，让用户选择路径。
- `打开`：打开已下载文件。
- `在文件夹中显示`：定位到文件所在目录。
- `丢弃`：标记为 discarded，并可删除临时文件。

任务完成后，任务卡展示本次下载文件，并给出保留、打开、移动、丢弃等操作。

权限边界：

- Agent 可以自动下载到临时下载区。
- Agent 不能静默把文件永久写进用户工作空间。
- 保存到工作空间需要用户确认，除非用户已提前授权该任务“保存产物到当前工作空间”。
- 手动浏览下载默认仍走系统下载目录，不被 Agent 临时区规则劫持。

下载记录至少保存：

```ts
interface BrowserDownloadRecord {
  id: string
  trigger: 'user' | 'agent'
  retention: 'temporary' | 'kept' | 'discarded'
  taskRunId?: string
  tabId: string
  workspaceKey: string | null
  sourceUrl: string
  suggestedFilename: string
  tempPath?: string
  savedPath?: string
  status: 'pending' | 'downloading' | 'completed' | 'failed' | 'cancelled'
  createdAt: number
  completedAt?: number
  errorMessage?: string
}
```

### 会话和站点数据

第一阶段目标是“站点级登录态可用”，不是完整浏览器同步。

要求：

- Cookie、localStorage、sessionStorage 按 profile 隔离。
- 用户可以清理单站点数据。
- 任务模式使用当前 profile 的登录态，但敏感动作仍需权限确认。
- 未来支持工作 profile / 个人 profile 时，默认不共享站点数据。

## UI 约定

### 标签页

浏览器 tab 需要显示当前模式：

```text
[网页标题]             浏览模式
[Agent: 投递简历]      任务模式
```

任务模式 tab 关闭时，如果任务仍在运行，需要二次确认。

### 工具栏

浏览模式：

```text
← → 刷新 地址栏 收藏 下载 菜单
```

任务模式：

```text
Agent 正在操作 当前动作 暂停 终止 接管
```

### 右侧 Agent 面板

任务模式下，右侧面板应显示：

- 当前目标。
- 最近动作。
- 等待用户确认的操作。
- 失败原因。
- 产物：下载文件、截图、提取结果。

## 权限模型

站点权限按 origin 存储，按动作类型区分。

| 动作         | 默认策略                   |
| ------------ | -------------------------- |
| 读取页面内容 | 允许，但展示上下文来源     |
| 点击普通按钮 | 按权限模式决定             |
| 填写表单     | 需要站点授权或单次确认     |
| 提交表单     | 需要确认                   |
| 上传文件     | 必须确认                   |
| 下载文件     | 可自动，但必须进入下载中心 |
| 清理站点数据 | 必须确认                   |
| 执行 JS      | 高风险，默认严格确认       |

权限确认卡片必须说明：站点、动作、目标元素或文件、潜在影响。

## 里程碑

### v0.1：任务浏览器可靠化（核心链路已落地）

- 修正 tab/page 绑定生命周期。
- 增加 `BrowserTaskRun` 和 `BrowserActionLog`。
- 增加暂停、终止、接管状态。
- 增加失败分类。
- Agent 下载进入下载中心。

开发工单见：[AI 工作浏览器 v0.1 开发工单](ai-work-browser-v0.1-tasks.md)。

### v0.2：工作浏览器基础

- 增加基础历史。
- 增加基础书签。
- 增加下载中心 UI。
- 恢复上次打开的浏览器 tabs。
- 站点级登录态持久化。

### v0.3：A/B 融合

- Agent 可引用浏览历史、书签和下载记录。
- 下载文件可作为后续任务上下文。
- 任务完成后生成可读摘要和产物列表。
- 工作空间维度聚合浏览器任务。

### v0.4：Profile 和站点权限

- 增加默认 profile。
- 预留工作 profile / 个人 profile。
- 增加站点数据清理。
- 增加站点权限面板。

## 验收清单

| 场景           | 验收标准                                             |
| -------------- | ---------------------------------------------------- |
| 用户日常浏览   | 可以打开、后退、前进、刷新、收藏、查看历史、下载文件 |
| Agent 自动任务 | 可以观察动作、暂停、终止、查看失败原因               |
| 登录态恢复     | 重启后常见网站保持登录，或给出明确失效原因           |
| 下载追踪       | 所有下载都有来源、状态、保存路径和触发者             |
| 任务追溯       | 任务结束后能看到动作日志、截图、下载产物             |
| 权限安全       | 上传、提交、执行 JS 等高风险动作必须确认             |

## 残余风险

- 高风控网站仍可能识别 CDP、Electron 或自动化痕迹，第一阶段只做减噪，不承诺绕过。
- Electron 内嵌视图与主流浏览器在扩展、密码、证书、媒体和系统集成上仍存在天然差距。
- 如果 B1 做得过宽，会拖慢 A 的可靠性建设；第一阶段必须坚持 A 优先。
- 如果 A 的任务日志不可读，用户会看到“AI 做完了”，但无法信任“AI 做对了”。
