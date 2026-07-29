# AI 工作浏览器 v0.1 开发工单

> 状态：🔧 实施中（核心链路已落地）
> 范围：只做 A 线可靠化，不做 B1 书签/历史/下载中心完整 UI
> 目标：把现有浏览器自动化从“可执行工具集合”升级为“可追踪、可暂停、可失败归因的任务系统”。
> 最后更新：2026-07-28

## /grilling 结论

v0.1 的关键不是继续增加 Playwright 工具，而是补一层任务运行时。

当前已有基础：

- `BrowserManager` 已维护可见浏览器 tab 和 `WebContentsView`。
- `PlaywrightBridge` 已维护 `tabId -> Page` 注册表。
- `executePlaywrightAction` 已封装 46 个动作。
- `BrowserInstanceStore` 已有快照和基础历史。
- MCP `PermissionManager` 已有工具确认链路。

原始缺口：

- 每次 Agent 浏览任务没有独立 `taskRunId`。
- 每个动作没有结构化日志。
- 暂停、终止、接管没有统一状态机。
- 下载只存在于 `PlaywrightBridge.downloads` 内存 Map，缺少持久化记录和任务归属。
- 失败通常只是异常消息，不能稳定归类。

当前实现状态：

| 工作空间             | 状态        | 说明                                                                                      |
| -------------------- | ----------- | ----------------------------------------------------------------------------------------- |
| `BrowserTaskRuntime` | ✅ 已完成   | 主进程状态机、IPC、tab 销毁取消、Agent browser scope 自动创建/收束                        |
| 动作执行闸门         | ✅ 已完成   | MCP `browser_*` 和旧 `agent:executeAction` 都会检查任务暂停/取消/失败                     |
| `BrowserActionLog`   | ✅ 已完成   | 记录 started/succeeded/failed、耗时、失败原因、脱敏参数                                   |
| Agent 面板任务卡     | ✅ 已完成   | 展示任务状态、最近动作、暂停/继续/终止、下载产物                                          |
| 下载记录闭环         | ✅ 已完成   | Agent 临时区、用户下载目录、保留到工作空间、另存为、丢弃、打开、定位、持久化              |
| 失败分类器           | 🟡 部分完成 | 已覆盖 timeout、selector、download、tab closed、user interrupted；验证码/登录态弱判断未做 |
| 文件缺失处理         | ✅ 已完成   | 外部删除文件后显示“已丢失”，禁用打开/定位/保留/另存为                                     |
| 最小回归测试         | ✅ 已完成   | 覆盖任务状态机、动作日志脱敏、下载路径、持久化、打开定位、文件缺失                        |

所以 v0.1 不要先做书签，不要先做完整下载中心，也不要先做 profile。先把 A 线可靠性钉住。

## 验收目标

| 指标       | v0.1 验收                                                        | 当前状态                               |
| ---------- | ---------------------------------------------------------------- | -------------------------------------- |
| 任务可追踪 | 每次 Agent 浏览任务都有 `taskRunId`、目标、状态和关联 tab        | ✅                                     |
| 动作可追踪 | 每个浏览器 MCP 动作都有开始、结束、耗时、状态和错误信息          | ✅                                     |
| 失败可归因 | 常见失败归类为 timeout、selector_missing、auth_required 等枚举   | 🟡 `auth_required` 未做弱判断          |
| 用户可中断 | 任务运行中可暂停、终止、接管，终止后不再执行后续动作             | 🟡 暂停/终止已完成，手动接管语义待细化 |
| 下载可关联 | Agent 触发的下载记录 `taskRunId`、来源 URL、建议文件名和保存路径 | ✅                                     |
| UI 可见    | 右侧 Agent 面板或浏览器工具栏能看到当前任务状态和最近动作        | ✅ Agent 面板已完成，浏览器工具栏未接  |

## 工单 1：新增浏览器任务运行时 ✅

### 目标

新增主进程任务运行时，管理 Agent 浏览任务生命周期。

### 建议文件

- `src/main/browser/browser-task-runtime.ts`
- `src/main/browser/browser-task-types.ts`
- `src/main/runtime/app-runtime.ts`
- `src/main/runtime/automation-runtime.ts`

### 数据模型

```ts
type BrowserTaskStatus = 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'

interface BrowserTaskRun {
  id: string
  tabId: string
  goal: string
  status: BrowserTaskStatus
  startedAt: number
  endedAt?: number
  failureReason?: BrowserTaskFailureReason
  downloadIds: string[]
}
```

### 交付内容

- `startTask({ tabId, goal })` 创建任务。
- `pauseTask(taskRunId)` 将任务置为 `paused`。
- `resumeTask(taskRunId)` 将任务置为 `running`。
- `cancelTask(taskRunId)` 将任务置为 `cancelled`。
- `finishTask(taskRunId)` 将任务置为 `completed`。
- `failTask(taskRunId, reason, error)` 将任务置为 `failed`。
- 当前 active tab 最多一个运行中的任务。

### 验收

- 同一 tab 重复启动任务时，旧任务必须完成、失败或取消。
- tab 关闭时，该 tab 上运行中的任务必须取消。
- 所有状态迁移必须发 IPC 事件给渲染进程。

### /grilling 风险

- 如果不限制“一 tab 一个运行任务”，后面动作日志会互相污染。
- 如果任务运行时放进 `PlaywrightBridge`，会让桥接层承担过多产品语义；建议独立服务。

### 实现状态

- 已新增 `src/main/browser/browser-task-runtime.ts`。
- 已新增任务 IPC 和 preload 合约。
- 已接入 `runtime.browserTaskRuntime`。
- 已在 `BrowserManager.onViewDestroyed` 中支持多监听器，tab 关闭会取消对应任务。
- 已在 Agent browser scope 下自动创建、完成、失败或取消 `BrowserTaskRun`。

## 工单 2：为 MCP 浏览器动作增加任务上下文 ✅

### 目标

让每个 `browser_*` 工具调用知道自己属于哪个 tab、哪个任务，并在执行前检查任务状态。

### 建议文件

- `src/main/mcp/modules/browser/index.ts`
- `src/main/playwright/playwright-actions.ts`
- `src/main/agent/agent-bridge.ts`
- `src/main/agent/backend/claude-code-backend.ts`

### 交付内容

- 浏览器工具执行前获取 `activeTabId`。
- 如果 active tab 有 `paused` 或 `cancelled` 任务，阻止继续执行。
- 对浏览器工具调用补充 `taskRunId`、`tabId`、`toolName`。
- 保持现有 MCP schema 向后兼容，不要求模型显式传 `taskRunId`。

### 验收

- Agent 不传 `taskRunId` 时，系统仍能绑定到当前运行任务。
- 任务暂停后，新的浏览器动作返回明确错误：`Browser task is paused`。
- 任务取消后，新的浏览器动作返回明确错误：`Browser task is cancelled`。

### /grilling 风险

- 不要把 `taskRunId` 暴露为必须由模型传入的参数；模型会漏传，系统应自动绑定。
- 不能只在 UI 上暂停，主进程执行层也必须拦截。

### 实现状态

- `BrowserToolModule` 执行前会读取 `activeTabId` 并调用 `assertCanRunAction`。
- 旧兼容路径 `agent:executeAction` 也已接入同一任务闸门。
- `paused`、`cancelled`、`failed` 状态会阻止后续动作。
- `completed` 状态会释放 active task，允许后续普通浏览器动作。

## 工单 3：新增动作日志 ✅

### 目标

每个浏览器动作都有结构化日志，任务结束后可追溯。

### 建议文件

- `src/main/browser/browser-task-runtime.ts`
- `src/main/mcp/modules/browser/index.ts`
- `src/main/ipc/agent-ipc.ts`
- `src/shared/ipc/browser.ts`

### 数据模型

```ts
interface BrowserActionLog {
  id: string
  taskRunId: string
  tabId: string
  action: string
  paramsSummary: string
  status: 'started' | 'succeeded' | 'failed' | 'skipped'
  startedAt: number
  endedAt?: number
  errorMessage?: string
  failureReason?: BrowserTaskFailureReason
}
```

### 交付内容

- 动作执行前写入 `started`。
- 动作成功后写入 `succeeded` 和耗时。
- 动作失败后写入 `failed`、错误信息、失败分类。
- `paramsSummary` 要脱敏，不能原样记录用户输入的完整密码、token、cookie。
- 日志先落本地 JSON 即可，后续再考虑 SQLite。

### 验收

- 任务完成后可以按 `taskRunId` 列出动作日志。
- 敏感字段不进入日志。
- `browser_fill` 对 password/input token 场景只记录 selector 和长度，不记录原文。

### /grilling 风险

- 动作日志如果记录过多 DOM 或输入原文，会引入隐私风险。
- 只记录失败动作不够；成功路径同样需要记录，否则无法解释“AI 做对了什么”。

### 实现状态

- 动作日志暂时内聚在 `BrowserTaskRuntime`，未单独拆 `browser-action-log-store.ts`。
- MCP `browser_*` 和旧 `agent:executeAction` 都会记录动作日志。
- `fill.value`、`setCookie.value`、token/password/secret/apiKey、`evaluate.expression` 已脱敏。
- 日志当前为内存态；任务级持久化未做。

## 工单 4：失败分类器 🟡

### 目标

把 Playwright/Electron 异常归类成稳定枚举，避免 UI 和 Agent 只看到原始 error。

### 建议文件

- `src/main/browser/browser-task-errors.ts`
- `src/main/playwright/playwright-actions.ts`

### 失败枚举

```ts
type BrowserTaskFailureReason =
  | 'timeout'
  | 'navigation_blocked'
  | 'selector_missing'
  | 'element_obscured'
  | 'auth_required'
  | 'captcha_or_bot_check'
  | 'download_failed'
  | 'user_interrupted'
  | 'tab_closed'
  | 'unknown'
```

### 交付内容

- `classifyBrowserError(error, context)`。
- Playwright timeout 归类为 `timeout`。
- selector 等待失败归类为 `selector_missing`。
- target/page closed 归类为 `tab_closed`。
- download save/wait 失败归类为 `download_failed`。
- 用户取消/终止归类为 `user_interrupted`。

### 验收

- 所有浏览器动作失败都带 `failureReason`。
- 未识别错误才落到 `unknown`。
- UI 可以直接用枚举展示中文解释。

### /grilling 风险

- 不要过早追求完美识别验证码和登录页；v0.1 可先基于 URL、标题、常见文本做弱判断。
- 错误分类必须保留原始 `errorMessage`，方便调试。

### 实现状态

- 已新增 `src/main/browser/browser-task-errors.ts`。
- 已覆盖 timeout、selector/locator、download、tab closed、user interrupted 等基础分类。
- 动作日志失败会记录 `failureReason` 和 `errorMessage`。
- 未完成：`auth_required`、`captcha_or_bot_check`、`element_obscured` 的页面语义弱判断。

## 工单 5：任务控制 IPC 与 UI 状态 ✅

### 目标

用户可以看到并控制当前任务。

### 当前实现文件

- `src/main/browser/browser-task-runtime.ts`
- `src/main/ipc/browser-ipc.ts`
- `src/preload/index.ts`
- `src/preload/index.d.ts`
- `src/renderer/src/stores/browser-task-store.ts`
- `src/renderer/src/components/workbench/BrowserToolbar.tsx`
- `src/renderer/src/components/agent-panel/AgentPanel.tsx`

### 交付内容

- IPC：`browserTask:list`、`browserTask:getActive`、`browserTask:pause`、`browserTask:resume`、`browserTask:cancel`。
- 渲染进程 store 订阅任务状态事件。
- 浏览器工具栏展示：运行中、暂停、失败、完成。
- Agent 面板展示最近 3-5 条动作日志。

### 验收

- 点击暂停后，后续浏览器工具调用被主进程拒绝。
- 点击终止后，任务状态为 `cancelled`。
- 用户手动接管时，任务进入 `paused`，页面不被遮挡。

### /grilling 风险

- UI 的“暂停”如果只是按钮变色，没有主进程拦截，就是假暂停。
- 不要把动作日志塞成聊天消息；它是任务状态视图，应该更像操作时间线。

### 实现状态

- 已新增 `src/renderer/src/stores/browser-task-store.ts`。
- Agent 面板已显示任务目标、状态、最近动作、失败信息和任务按钮。
- 已支持暂停、继续、终止。
- 未做浏览器工具栏任务状态；当前只在 Agent 面板显示。

## 工单 6：下载记录最小闭环 ✅

### 目标

Agent 触发的下载不再只存在内存里，至少能追踪来源和归属。

### 建议文件

- `src/main/browser/browser-download-store.ts`
- `src/main/playwright/playwright-bridge.ts`
- `src/main/playwright/playwright-actions.ts`
- `src/shared/ipc/browser.ts`

### 数据模型

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
  fileMissing?: boolean
  status: 'pending' | 'downloading' | 'completed' | 'failed' | 'cancelled'
  createdAt: number
  completedAt?: number
  errorMessage?: string
}
```

### 交付内容

- `page.on('download')` 创建 `BrowserDownloadRecord`。
- `waitForDownload` 创建或复用同一下载记录。
- Agent 任务下载默认保存到 `userData/agent-downloads/{taskRunId}/`。
- 用户手动下载默认走系统下载目录，例如 macOS `~/Downloads`。
- Agent 明确生成的成果文件保存到当前工作空间 `.cclink-studio/downloads/{taskRunId}/` 或用户指定路径。
- `saveDownload` 成功后写入 `savedPath`、`retention` 和 `completed`。
- 下载失败写入 `failed` 和错误信息。
- 任务详情能列出 `downloadIds`。
- 预留 `keepDownloadToWorkspace` / `discardDownload` / `saveDownloadAs` IPC，不要求 v0.1 做完整下载中心 UI。

### 验收

- Agent 触发下载后，即使尚未保存，也能看到 pending 记录。
- 保存后能看到保存路径。
- 任务日志能关联下载 ID。
- Agent 下载不会静默写入工作空间。
- 用户可将临时下载保留到工作空间，或通过另存为选择路径。

### /grilling 风险

- 当前 `page.on('download')` 和 `waitForDownload` 都会生成 ID，必须避免同一下载双记录。
- v0.1 不要求完整下载中心 UI，但数据模型必须为 v0.2 下载中心铺好。
- 不区分 `trigger=user/agent` 会导致用户手动下载和 AI 产物混在一起，后续下载中心无法解释来源。
- Agent 默认写入工作空间会污染工作空间目录，也会绕过用户对持久化产物的确认。

### 实现状态

- 已新增 `src/main/browser/browser-download-store.ts`。
- Agent 下载默认保存到 `userData/agent-downloads/{taskRunId}/`。
- 用户手动下载默认保存到系统下载目录。
- “保留”会复制到工作空间 `.cclink-studio/downloads/{taskRunId}/`。
- 已支持另存为、丢弃、打开、定位。
- 下载记录已持久化到 `userData/browser-downloads.json`。
- 文件被外部删除时，UI 会显示“已丢失”，并禁用打开/定位/保留/另存为。

## 工单 7：任务关闭与 tab 生命周期联动 ✅

### 目标

解决 tab 关闭、切换、claim 失败时任务仍继续的问题。

### 建议文件

- `src/main/browser/browser-manager.ts`
- `src/main/playwright/playwright-bridge.ts`
- `src/main/browser/browser-task-runtime.ts`

### 交付内容

- tab 关闭时通知 `BrowserTaskRuntime`。
- `unregisterPage(tabId)` 时取消运行任务。
- `claimPageForView` 失败时记录任务失败或给出可恢复错误。
- `switchToPage` 只切 active page，不自动迁移任务归属。

### 验收

- 关闭任务 tab 后，任务状态变为 `cancelled` 或 `failed(tab_closed)`。
- Agent 不会继续操作已经关闭的 tab。
- 切换到另一个 tab 后，原任务仍归属于原 tab。

### /grilling 风险

- 不能把 active tab 等同于任务 tab；任务开始后要固定 `tabId`。
- `activeTabId` 是 UI 当前焦点，`task.tabId` 是任务归属，两者必须分开。

### 实现状态

- `BrowserManager.onViewDestroyed` 已支持多监听器。
- tab 关闭会通知 `BrowserTaskRuntime.cancelTasksForTab`。
- `PlaywrightBridge.unregisterPage` 仍释放 Page 注册表 key。
- 已保留 `task.tabId` 和 `activeTabId` 的语义区分。

## 工单 8：最小回归场景 ✅

### 目标

用少量高价值场景确认 v0.1 不是纸面完成。

### 建议文件

- `src/main/playwright/playwright-actions.test.ts`
- `src/main/mcp/modules/browser/index.test.ts`
- 新增 `src/main/browser/*.test.ts`

### 场景

| 场景          | 验收                                       |
| ------------- | ------------------------------------------ |
| 简单导航任务  | 创建任务、执行 navigate、记录成功动作      |
| selector 失败 | 失败分类为 `selector_missing` 或 `timeout` |
| 用户暂停      | 暂停后新动作被拒绝                         |
| 用户取消      | 取消后新动作被拒绝，任务状态为 `cancelled` |
| 下载任务      | 下载记录关联 `taskRunId`                   |
| tab 关闭      | 任务变为 `cancelled` 或 `tab_closed`       |

### /grilling 风险

- 不需要一开始跑真实网站；先用本地测试页覆盖状态机。
- 只测 action type 映射不够，v0.1 的风险在任务生命周期。

### 实现状态

- 已新增 `src/main/browser/browser-task-runtime.test.ts`。
- 已新增 `src/main/browser/browser-download-store.test.ts`。
- 覆盖任务状态机、暂停/取消拦截、动作日志失败原因、敏感参数脱敏。
- 覆盖 Agent 临时下载目录、用户系统下载目录、保留到工作空间、持久化恢复、打开定位、文件缺失。
- 当前还未做真实网页端到端回归；仍需后续补 Playwright/Electron 集成场景。

## 推荐实施顺序

1. 工单 1：任务运行时。
2. 工单 4：失败分类器。
3. 工单 3：动作日志。
4. 工单 2：MCP 动作接入任务上下文。
5. 工单 7：tab 生命周期联动。
6. 工单 6：下载记录最小闭环。
7. 工单 5：IPC 与 UI 状态。
8. 工单 8：最小回归场景。

原因：先主进程骨架，再接执行层，最后做 UI。否则 UI 会先长出来，但下面没有真的控制力。

## 当前剩余项

| 工作空间                 | 优先级 | 说明                                                                                                |
| ------------------------ | ------ | --------------------------------------------------------------------------------------------------- |
| 真实网页端到端回归       | P0     | 测试手册见 `docs/testing/ai-work-browser-v0.1.md`；需要覆盖本地测试页下载、表单、弹窗、tab 关闭中断 |
| 浏览器工具栏任务状态     | P1     | 当前任务状态只在 Agent 面板展示                                                                     |
| 截图 / DOM snapshot 归档 | P1     | 动作日志已有结构，但还没保存截图和 DOM snapshot                                                     |
| 登录 / 验证码弱分类      | P1     | `auth_required`、`captcha_or_bot_check` 目前仍会落到 unknown                                        |
| 任务日志持久化           | P2     | 下载记录已持久化，动作日志和任务历史仍是内存态                                                      |
| 完整下载中心 UI          | v0.2   | v0.1 只在任务卡展示任务产物                                                                         |

## v0.1 不做项

- 不做完整书签。
- 不做完整历史管理。
- 不做多 profile。
- 不做完整下载中心 UI。
- 不做 Chrome 扩展。
- 不承诺绕过高风控网站。

这些进入 v0.2 或之后，否则 v0.1 会失焦。
