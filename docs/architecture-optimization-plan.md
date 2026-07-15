# Historical: 架构优化方案

> 当前状态：历史优化计划，不再作为 CCLink Studio 当前事实源。
>
> 本文写于商业模块迁出前，包含 auth、subscription、sync、CCLink runtime 等旧架构目标。当前事实源见 `docs/architecture.md`、`docs/development.md` 和 `docs/cclink-studio-boundary-and-migration.md`。

# DeepInk 架构优化方案

本文档描述 DeepInk 从“快速功能集成期”进入“平台内核整理期”的架构优化路线。

## 总体判断

DeepInk 当前的产品架构方向是正确的：Electron 工作台、内嵌浏览器、Android 自动化、Agent、MCP 工具、文档编辑、同步、订阅等能力构成了一个有平台潜力的桌面入口。

当前主要问题不是方向错误，而是能力增长太快后，以下边界尚未完全沉淀：

- 主进程入口承担过多职责。
- IPC contract 没有单一事实源。
- Agent、Playwright、MCP、Browser 之间耦合偏硬。
- 工作台状态恢复散落在 renderer localStorage。
- 完整 TypeScript 检查没有进入日常质量门禁。

优化目标不是重写，而是逐步把 DeepInk 整理成一个稳定的桌面工作台平台内核。

## 目标架构

```text
Main Process
├── AppRuntime / ServiceRegistry
├── Core Services
│   ├── SettingsService
│   ├── WorkspaceStateService
│   ├── AuthService
│   ├── SubscriptionService
│   └── PermissionService
├── Capability Services
│   ├── BrowserRuntime
│   ├── AndroidRuntime
│   ├── EditorRuntime
│   ├── MeshyRuntime
│   └── CCLinkRuntime
├── AgentRuntime
│   ├── BackendManager
│   ├── CapabilityRegistry
│   ├── ToolRuntime
│   └── ConversationManager
└── IPC Layer
    ├── shared contract
    ├── preload bridge
    └── feature ipc handlers
```

Renderer 保持轻量：

```text
Renderer
├── UI components
├── Zustand runtime cache
├── Commands / shortcuts
└── IPC client based on shared contract
```

核心原则：

- main process 持有长期状态和能力生命周期。
- renderer 只做 UI 和短期交互缓存。
- IPC contract 由 `src/shared` 提供单一事实源。
- Agent 能力按 capability 注册和降级，避免单点失败拖垮整条链路。

## Phase 0：止血

目标：不大改功能，先阻止架构继续漂移。

任务：

- 新增 `typecheck:web`、`typecheck:node`、`typecheck`、`verify` 脚本。
- 修复 Agent/权限 IPC 注册太晚的问题。
- 修复 `registerSettingsIpc` 与调用方签名不一致的问题。
- 让 Agent runtime 未就绪时 IPC 优雅返回，而不是出现未注册 handler 或空依赖崩溃。
- 记录并逐步清理当前 `tsc --noEmit` 错误。

完成标准：

- 启动日志不再出现 `No handler registered for 'agent:getPermissionMode'`。
- `pnpm build` 和 `pnpm test` 继续通过。
- `pnpm typecheck` 作为可见质量门禁存在，即使初期仍有待清零错误。

当前进展（2026-07-06）：

- 已新增 `typecheck:web`、`typecheck:node`、`typecheck`、`verify` 脚本。
- 已将 Agent/权限/MCP IPC 改为早注册 + runtime getter 模式。
- 已将 Settings IPC 改为通过 `getAgentBridge()` 延迟获取 AgentBridge，保留后续热重载能力。
- 已避免 Playwright/CDP 失败后强行创建空依赖 AgentBridge；当前会明确进入 Agent IPC 降级状态。
- 已验证 `pnpm build` 通过，`npx vitest run` 102 个测试通过。
- 已验证启动日志不再出现 `No handler registered for 'agent:getPermissionMode'`。
- 已清零 web/node 侧既有 TypeScript 错误，`pnpm typecheck` 已通过。
- 当前 Phase 0 基础质量门禁已闭环：`pnpm typecheck`、`npx vitest run`、`pnpm build` 均通过。
- 已将 `pnpm build` 改为先执行 `pnpm typecheck`，避免再次出现 build 通过但 TS 失败。
- 已处理启动日志中的 CDP/Playwright 连接超时：初始 BrowserView 会在 bounds 未上报前用 1x1 临时区域先加载默认页，避免空 URL CDP target 卡住 Playwright。
- 已验证 Playwright 连接、MCP server 启动、Agent 后端就绪。

## Phase 1：IPC Contract 单一事实源

目标：main、preload、renderer 不再各写一套类型。

建议目录：

```text
src/shared/ipc/
├── browser.ts
├── agent.ts
├── fs.ts
├── sync.ts
├── settings.ts
├── android.ts
├── cclink.ts
├── meshy.ts
└── index.ts
```

要求：

- renderer 禁止直接 import `src/preload/index.d.ts`。
- preload 只负责 contextBridge 暴露。
- IPC 返回值由 shared contract 定义。
- main/preload/renderer 都引用 shared contract。

优先清理：

- `fs.readFile` 返回值统一为 `{ content, encoding }`。
- sync/settings 类型迁移到 shared。
- browser snapshot/history 类型迁移到 shared。

当前进展（2026-07-06）：

- 已建立 `src/shared/ipc/` 骨架。
- 已添加 `src/shared/ipc/sync.ts`、`settings.ts`、`fs.ts`、`index.ts`。
- renderer 中 settings/sync 相关类型引用已切到 `@shared/ipc/*`。
- renderer 已不再直接 import `src/preload/index.d.ts`。
- `fs.readFile` 调用方已兼容 `{ content, encoding }` 对象返回，preload 类型声明中的历史 union 已移除。
- 已补齐 `FsApiContract`、`SyncApiContract`、`SettingsApiContract` 在 preload 侧的使用，删除 `src/preload/index.d.ts` 中 fs/sync/settings 的本地重复 API 声明。
- 已添加 `src/shared/ipc/cclink.ts`，定义 `CclinkApiState` 与 `CclinkApiContract`。
- preload 的 `window.deepink.cclink` 声明已切到 shared contract，主进程 `CclinkStoreState` 也复用同一个 `CclinkApiState`。
- 已添加 `src/shared/ipc/browser.ts`，定义 Browser view state、实例快照、浏览历史与 `BrowserApiContract`。
- preload 的 `window.deepink.browser` 声明已切到 shared contract，`BrowserManager`、`BrowserInstanceStore`、renderer browser store 与 Workbench 的浏览器相关类型已复用 shared 定义。
- 已添加 `src/shared/ipc/subscription.ts`，定义订阅套餐、订单、用户订阅状态与 `SubscriptionApiContract`。
- preload 的 `window.deepink.subscription` 声明已切到 shared contract；main/renderer 原有订阅类型文件已改为兼容 re-export，主进程订阅 service/ipc 直接引用 shared 类型。
- 已添加 `src/shared/ipc/auth.ts`，定义 `UserProfile`、`AuthResult`、`AuthSession`、`TokenRefreshResult` 与 `AuthApiContract`。
- preload 的 `window.deepink.auth` 声明已切到 shared contract；`TokenManager`、`AuthService`、`AuthIPC` 和 renderer 兼容类型出口均已复用 shared Auth 类型。
- 已添加 `src/shared/ipc/window.ts`、`dialog.ts`、`wechat.ts`、`update.ts`，覆盖窗口控制、系统对话框、微信公众号格式转换和自动更新 IPC。
- preload 的 `window.deepink.window/dialog/wechat/update` 声明已切到 shared contract；Dialog 与 Update 主进程侧类型也已复用 shared 定义。
- 已添加 `src/shared/ipc/editor.ts`，定义 Agent→编辑器内容更新、读取请求、保存请求与 `EditorApiContract`。
- preload 的 `window.deepink.editor` 声明已切到 shared contract；renderer `editor-store` 与 main `EditorToolModule` 已复用 shared 事件类型。
- 已添加 `src/shared/ipc/meshy.ts`，定义 Meshy 任务、生成参数、资产保存结果与 `MeshyApiContract`。
- preload 的 `window.deepink.meshy` 声明已切到 shared contract；main `src/main/meshy/types.ts` 保留为兼容 re-export，避免现有服务和 MCP 模块导入路径大面积变更。
- 已添加 `src/shared/ipc/android.ts`，定义模拟器状态、SDK 安装状态、物理设备、设备信息、应用商店安装结果、Scrcpy 视频帧与 `AndroidApiContract`。
- preload 的 `window.deepink.android` 声明已切到 shared contract；main Android 侧 `EmulatorState`、`DeviceInfo`、`PhysicalDevice`、`StoreInstallResult` 改为复用 shared 类型，renderer Android store 的跨进程数据类型也已切到 shared。
- 迁移时发现旧 preload 声明与真实返回值不完全一致：`listPackages` 实际返回 `{ packages }`，设备操作实际返回 `{ success }`；shared contract 已按真实运行结果建模。
- 已扩展 `src/shared/ipc/agent.ts`，覆盖 AgentScope、Claude/HTTP 后端流式事件、工具确认请求、Playwright 兼容操作、外部 MCP server 管理与完整 `AgentApiContract`。
- preload 的 `window.deepink.agent` 声明已切到 shared contract；main `scope.ts`、`permission.ts`、`client-manager.ts` 和 renderer `types/index.ts` 保留兼容 re-export，避免上层组件一次性大改。
- 迁移时发现旧 preload 声明与真实返回值不完全一致：`sendMessage` 实际返回 `{ success, error? }`，不是纯 `void`；shared contract 已按真实运行结果建模。

## Phase 2：拆分 Main Runtime

目标：`src/main/index.ts` 只负责启动 runtime，不再亲自装配所有模块。

建议目录：

```text
src/main/runtime/
├── app-runtime.ts
├── service-registry.ts
├── lifecycle.ts
├── ipc-registry.ts
└── bootstrap.ts
```

服务接口：

```ts
export interface RuntimeService {
  name: string
  start(runtime: AppRuntime): Promise<void> | void
  stop?(): Promise<void> | void
}
```

完成标准：

- `src/main/index.ts` 降到约 100 到 150 行。
- 服务依赖由 runtime registry 管理。
- graceful shutdown 改为 registry 逆序 stop。
- 单个服务失败时能明确 degraded，而不是留下半初始化全局变量。

当前进展（2026-07-06）：

- 已将 IPC handler 清理清单从 `src/main/index.ts` 抽到 `src/main/ipc/ipc-cleanup.ts`。
- 已补齐 IPC 清理遗漏的 `editor:readResponse`、`editor:saveResult`、`updater:check`、`updater:download`。
- 已补齐 IPC 清理遗漏的 `agent:resolveToolConfirmation`，并清理 `workbench:bounds` listener，避免窗口重建时重复监听。
- 已让 `src/main/index.ts` 不再直接依赖 `ipcMain`。
- 已新增 `src/main/runtime/shutdown.ts`，将退出流程的重复 try/catch 收敛为 `runShutdownStep()`。
- 已新增 `src/main/runtime/main-window.ts`，将 BrowserWindow 创建与 renderer 加载从 `src/main/index.ts` 抽离。
- 已新增 `src/main/runtime/app-lifecycle.ts`，收敛单实例锁、Chromium 命令行配置、全局异常日志注册。
- 已新增 `src/main/runtime/app-runtime.ts`，把主进程长期持有的服务引用集中成 `DeepInkRuntimeState`。
- 已新增 `src/main/runtime/window-runtime.ts`，把主窗口、BrowserManager、浏览器 IPC、CCLink、本地 Android runtime 的窗口期装配从入口移出。
- 已新增 `src/main/runtime/core-services.ts`，把 Settings、WorkspaceState、Auth、Subscription、FS、Meshy、微信转换、Sync、Permission、MCP client、基础 IPC 注册从入口移出。
- 已新增 `src/main/runtime/automation-runtime.ts`，把 CDP、Playwright、MCP tool host、Browser/Editor/Meshy/Android/agent-device 工具注册从入口移出，并保留失败降级语义。
- 已新增 `src/main/runtime/agent-runtime.ts` 与 `agent-capabilities.ts`，把 AgentBridge 创建和 capability 状态计算从入口移出。
- 已新增 `src/main/runtime/service-registry.ts` 与 `shutdown-runtime.ts`，退出清理改为通过轻量 registry 按注册逆序 stop，入口不再手写每个资源的清理步骤。
- 已新增 `src/main/runtime/bootstrap-runtime.ts`，启动阶段也改为 `ServiceRegistry.startAll()` 正序执行 `state-services`、`window-runtime`、`main-process-services`、`automation-runtime`、`agent-runtime`。
- 已新增 `src/main/runtime/service-registry.test.ts`，覆盖 start 正序、stop 逆序、单个 stop 失败不阻断后续清理。
- `src/main/index.ts` 已从约 445 行降到约 69 行，达到 Phase 2 的入口瘦身目标。
- 已修正退出清理标记：不再在 `before-quit` 提前标记为已清理，避免 `will-quit` 跳过真正的异步资源释放。
- 尚未完成：当前 registry 是按粗粒度 bootstrap module 编排，服务依赖仍由 `DeepInkRuntimeState` 手工串联；下一步可继续拆成更细粒度的声明式 `RuntimeService`。

## Phase 2.5：工作台状态恢复测试

目标：把“重启后恢复原工作状态”从实现意图变成可回归验证的行为。

当前进展（2026-07-07）：

- 已补充 renderer store 层恢复测试，覆盖 `layout`、`tabs`、`browserTabs`、`agentConversations` 四个 WorkspaceState section。
- `ui-store` 测试覆盖 Activity Panel、侧栏/Agent 面板可见性与宽度恢复，并验证非法面板回退到默认 `files`。
- `tab-store` 测试覆盖 Tab 顺序、活跃 Tab、文件 Tab、统一会话 Tab 与旧 CCLink Tab 兼容恢复，并验证无效 activeTabId 回退到首个 Tab。
- `browser-store` 测试覆盖多个浏览器实例、viewMode、zoomMode、zoomFactor、导航栈恢复，并验证 `ready` 不跨重启保存。
- `agent-store` 测试覆盖历史多会话恢复、活跃会话镜像、sessionId/scope 保留，以及 loading/streaming/input 这些运行中瞬态状态在重启后清空。
- `editor-store` 已接入 WorkspaceState 的 `editorDrafts` section，继续保留 localStorage 兼容；虚拟文档和 dirty 文件会镜像到主进程状态，启动时可从 `editorDrafts` 恢复。
- 已新增 `editor-store` 测试，覆盖虚拟文档初始化、编辑器草稿恢复、非法快照不覆盖现有状态，以及 Agent 更新队列按文件消费。
- 已新增 WorkspaceState renderer util 的当前工作区路径上下文：启动时按 `settings.lastWorkspacePath` 选择恢复快照，后续 store 默认写入当前工作区；显式传入 workspacePath 的 fileTree 仍可覆盖默认路径。
- 启动恢复增加兼容回退：如果存在 `lastWorkspacePath` 但该工作区快照为空，会回退读取 global snapshot，避免从早期全局状态迁移后用户看到空工作台。
- 已新增 `workspace-state` util 测试，覆盖默认工作区路径和显式覆盖路径。
- 已验证相关 store/util 测试通过：6 个测试文件，68 个测试通过。
- 已明确“空 Tab = Codex/Agent 中心模式”的产品语义：`tab-store` 允许关闭最后一个 Tab，`activeTabId=null` 时 UI system context 切到 `empty`，主工作区显示居中的 Agent 会话。
- Tab 右键菜单和 Tab 关闭按钮已允许关闭最后一个 Tab；WorkspaceState 的 `tabs: []` 快照也会恢复为空工作台，而不是被 normalize 忽略。

仍需继续：

- 目前测试覆盖 store/util/bootstrap-core 级恢复，尚未引入 jsdom/testing-library 做 React 组件集成测试。
- 工作区路径维度已完成第一步绑定，但尚未做跨工作区切换的端到端冒烟验证。

## Phase 3：Agent Capability 降级模型

目标：Agent 不再硬依赖 Playwright/MCP/Android 全部成功。

建议结构：

```text
AgentRuntime
├── ConversationManager
├── BackendManager
└── CapabilityRegistry
```

Capability 示例：

```ts
type CapabilityName = 'browser' | 'editor' | 'android' | 'agent-device' | 'meshy' | 'cclink'

interface Capability {
  name: CapabilityName
  available: boolean
  reason?: string
  tools?: ToolModule
}
```

完成标准：

- Playwright 失败时，Agent 面板仍可打开。
- 纯文本 HTTP API backend 仍可用。
- browser scope 不可选，或显示不可用原因。
- MCP tool host 可以只注册部分工具。
- Agent 面板能展示每个 capability 的状态。

当前进展（2026-07-07）：

- 已新增 `src/shared/ipc/agent.ts`，定义 Agent capability 状态 contract。
- 已新增 `agent:getCapabilities` IPC，main process 会基于当前 runtime 返回 Agent、Browser、Editor、Android、agent-device、Meshy、CCLink、MCP 的可用状态。
- 已在 preload 暴露 `window.deepink.agent.getCapabilities()` 并补齐类型声明。
- Agent 面板已展示 capability 状态条，可用能力显示绿色，降级能力显示黄色并在 tooltip 中展示原因。

## Phase 4：WorkspaceStateService

目标：工作台状态从 renderer localStorage 迁移到 main process 的 workspace-scoped state。

建议目录：

```text
src/main/workspace/
├── workspace-state-service.ts
├── workspace-id.ts
├── schema.ts
└── workspace-state-ipc.ts
```

状态结构：

```ts
interface WorkspaceStateV1 {
  version: 1
  workspaceId: string
  updatedAt: number
  layout: LayoutState
  tabs: TabSnapshot[]
  browserTabs: Record<string, BrowserTabSnapshot>
  editorDrafts: Record<string, EditorDraft>
  fileTree: FileTreeState
  search: SearchPanelState
  commandPalette: CommandPaletteState
}
```

完成标准：

- 不同 workspace 的 tab/layout/search 状态互不污染。
- 状态文件带 schema version。
- 支持 migration。
- renderer store 只做运行时缓存。

当前进展（2026-07-06）：

- 已新增 `src/shared/ipc/workspace-state.ts`，定义 WorkspaceState IPC contract。
- 已新增 `src/main/workspace/workspace-state-service.ts`，将状态持久化到 Electron `userData/workspace-state.json`。
- 已新增 `src/main/workspace/workspace-state-ipc.ts`，提供 `workspaceState:get`、`workspaceState:setSection`、`workspaceState:clear`。
- 已在 preload 暴露 `window.deepink.workspaceState` 并补齐类型声明。
- 已新增 renderer 侧 `persistWorkspaceSection()` 过渡工具。
- 已将 `tabs`、`browserTabs`、`layout`、`fileTree` 的现有 localStorage 持久化同步镜像到 main process。
- 已新增 MainLayout 启动 bootstrap：先从 main process 读取 WorkspaceState，再挂载 Workbench，减少启动后闪烁。
- 已将 `tabs`、`browserTabs`、`layout`、`fileTree` 从 WorkspaceStateService 启动恢复，localStorage 仍作为兼容 fallback。
- 已将 `agentConversations` 纳入 WorkspaceState 镜像与启动恢复，右侧 Agent 面板会话历史也成为工作台状态的一部分。
- 已新增 `src/main/workspace/workspace-state-service.test.ts`，覆盖空状态、持久化重载、workspace 隔离、清空指定 workspace、versioned state file。

## Phase 5：Renderer 瘦身

目标：React 组件少做业务装配，多做展示。

建议拆分：

```text
src/renderer/src/bootstrap/
├── use-register-commands.ts
├── commands/
│   ├── view-commands.ts
│   ├── tab-commands.ts
│   ├── file-commands.ts
│   ├── settings-commands.ts
│   ├── sync-commands.ts
│   ├── agent-commands.ts
│   ├── browser-commands.ts
│   ├── window-commands.ts
│   └── commands.test.ts
├── use-global-shortcuts.ts
├── use-workspace-bootstrap.ts
├── use-main-process-events.ts
├── use-agent-work-context.ts
└── use-app-session.ts
```

Workbench 拆分：

```text
components/workbench/
├── Workbench.tsx
├── TabBar.tsx
├── BrowserToolbar.tsx
├── BrowserHistoryMenu.tsx
├── WorkbenchContent.tsx
├── use-browser-view-lifecycle.ts
├── use-browser-events.ts
├── use-editor-content-updates.ts
└── use-workbench-bounds.ts
```

完成标准：

- `App.tsx` 只负责认证守卫和布局挂载。
- `Workbench.tsx` 不再同时管理 Tab、浏览器生命周期、历史菜单、内容渲染。
- hooks 承担副作用，components 承担 UI。

当前进展（2026-07-07）：

- 已新增 `src/renderer/src/bootstrap/use-workspace-bootstrap.ts`，把工作台启动恢复 hook 从 `App.tsx` 抽离。
- 已新增 `src/renderer/src/bootstrap/workspace-bootstrap-core.ts`，将“读取 settings → 选择 workspace/global snapshot → hydrate stores → initWorkspace”的核心流程拆成无 DOM 纯函数。
- 已新增 `src/renderer/src/bootstrap/use-workspace-bootstrap.test.ts`，覆盖按 `lastWorkspacePath` 恢复、workspace 快照为空时 fallback global、状态恢复失败仍继续 initWorkspace、initWorkspace 失败只告警不抛出。
- 已新增 `src/renderer/src/bootstrap/use-register-commands.ts`、`use-global-shortcuts.ts`、`use-main-process-events.ts`、`use-app-session.ts`、`use-agent-work-context.ts`。
- `App.tsx` 已从约 450 行降到 161 行，目前只负责认证守卫、主布局挂载、宽度 resize 和全局浮层挂载；命令注册、快捷键、主进程事件、session 初始化、工作上下文桥接均已移入 bootstrap hooks。
- 空工作区已定义为 `WorkContext = empty`，用于进入中央 Agent/Codex 会话模式，而不是自动补一个浏览器 Tab。
- `Workbench.tsx` 已从 551 行降到 111 行，目前作为工作区装配层；Tab 拖拽/新建入口、浏览器工具栏、历史菜单、内容渲染、浏览器视图生命周期、浏览器事件、编辑器 Agent 更新监听、Workbench bounds 上报已拆到独立组件或 hooks。
- 浏览器 Tab 关闭清理从“每次 render 生成新数组触发 effect”改为稳定 `browserTabKey`，降低生命周期误触发概率。
- 命令注册已按 `view/tab/file/settings/sync/agent/browser/window` 拆成 command modules，`use-register-commands.ts` 降到 38 行。
- 已新增 `src/renderer/src/bootstrap/commands/commands.test.ts`，覆盖命令 ID 不重复和核心命令保留。
- `BrowserApiContract.onUrlChanged/onViewStateChanged` 已改为返回 unsubscribe；preload 不再使用 `removeAllListeners` 粗暴清空频道，`useBrowserEvents()` 会在卸载时清理监听。
- `theme-store` 已增加 DOM/window/localStorage guard，避免测试或非 DOM 环境 import store 时产生副作用，并新增 `src/renderer/src/stores/theme-store.test.ts` 锁住该行为。
- 当前验证通过：`pnpm verify`，包含 18 个测试文件、140 个测试、TypeScript 检查和 Electron/Vite 构建。

剩余工作：

- 尚缺真正的 React 组件测试或 Playwright/Electron smoke test，当前主要靠 store/unit/typecheck/build 兜底。

## Phase 6：测试与质量门禁

建议测试类型：

- IPC contract tests。
- Main runtime degraded tests。
- Workspace state migration tests。
- Agent capability tests。
- Browser session restore tests。

推荐质量命令：

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm verify
```

## Phase 7：本地优先身份与未登录工作台

目标：DeepInk 不登录也能进入本地工作台，并按本地身份恢复工作现场。登录只作为云能力开关。

关联规格：`docs/features/local-first-identity.md`。

### 7.1 主进程本地身份服务

新增：

```text
src/main/identity/
├── local-identity-service.ts
└── local-identity-service.test.ts
```

职责：

- 启动时生成或读取 `userData/local-identity.json`。
- 生成稳定 `localId`、`deviceId`、`deviceName`。
- 损坏文件可恢复，不阻塞 App 启动。

IPC：

```text
identity:getLocalIdentity
```

preload：

```ts
window.deepink.identity.getLocalIdentity()
```

验收：

- 首次启动生成本地身份。
- 重启后 ID 不变。
- 删除/损坏文件后可重新生成。

### 7.2 认证 Store 语义重构

当前：

```text
loggedIn: boolean
user: UserProfile | null
```

目标：

```text
localIdentity: LocalIdentity | null
cloudUser: UserProfile | null
cloudLoggedIn: boolean
identityReady: boolean
```

兼容期可保留 `loggedIn`，但语义必须只代表 cloud session，不能再决定 App 是否挂载主工作台。

验收：

- 无 token 时 `identityReady = true`，`cloudLoggedIn = false`。
- 有 token 时本地身份和云用户同时存在。
- 登出只清云用户，不清本地身份。

### 7.3 App 登录守卫重构

当前：

```text
checking -> Loading
!loggedIn -> LoginPage
loggedIn -> MainLayout
```

目标：

```text
identityChecking -> Loading
identityReady -> MainLayout
LoginPage -> Settings/Account 或可选 modal
```

验收：

- 未配置 `DEEPINK_API_URL` 仍进入工作台。
- 无网络仍进入工作台。
- 登录入口仍可从设置页打开。

### 7.4 WorkspaceState ownerKey

目标：工作台状态归属本地身份。

新增/调整：

- `WorkspaceStateSnapshot.ownerKey?: string`。
- `WorkspaceStateService.getSnapshot(ownerKey, workspaceKey)` 或等价请求结构。
- 旧无 owner 数据迁移到当前 `local:${localId}`。

验收：

- 未登录重启恢复 tabs、browserTabs、editorDrafts、agentConversations。
- 登录/登出不清状态。
- 旧 `workspace-state.json` 升级不丢状态。

### 7.5 云能力门控

需要云身份的功能：

- CCLink identity / TIM 实时连接。
- 订阅与支付。
- 云同步和云存储。
- IM、好友协作、跨设备。

验收：

- 未登录点击云能力入口提示登录，不影响主工作台。
- 设置页能同时显示“本机身份”和“云账号”。

## 推荐执行顺序

1. Phase 0：启动顺序、typecheck 脚本、设置热重载、Agent IPC 优雅降级。
2. Phase 1：抽 shared IPC contract。
3. Phase 2：拆 main runtime。
4. Phase 3：Agent capability registry。
5. Phase 4：WorkspaceStateService。
6. Phase 5：Renderer 瘦身。
7. Phase 6：补体系化测试和 CI 门禁。
8. Phase 7：本地优先身份与未登录工作台。
