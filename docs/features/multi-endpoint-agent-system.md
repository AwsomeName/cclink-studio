# Historical: 多端 Agent 系统设计

> 当前状态：历史设计草案，不属于 CCLink Studio OSS 当前事实源。
>
> 本文中的多 endpoint、ChatCC、远程 Agent、IM 和云端协作内容属于旧方向或商业/CCLink 项目侧能力。Studio 开源壳当前只保留本地工作台、本地 Agent/MCP 和可扩展边界。

# DeepInk 多端 Agent 系统设计

> 状态：设计中
> 参考对象：OpenAI Codex、ChatCC
> 目标：把 DeepInk 从“本机 AI 工作台”扩展为“本机 + 远程 + 设备 + IM 的统一 Agent 工作入口”。

## 背景

DeepInk 当前已经具备本机 Agent 能力：浏览器、编辑器、Android 模拟器和本地工作区都可以被 Agent 操作。ChatCC 提供了另一种能力：通过腾讯 IM 连接远程 `chatcc-agent`，让移动端或桌面端用聊天方式控制远程机器上的 Claude Code。

这两个方向不能简单叠加成两个 App。DeepInk 需要抽象出一个更高层的系统：**任何可执行任务的地方，都可以成为 Agent 的工作目标**。

## Codex 参照模型

Codex 的核心结构可以概括为：

```text
Project
  -> Thread
  -> Mode(Local / Worktree / Cloud)
  -> Environment(files, shell, browser, permissions, plugins, MCP)
```

Codex 的 Remote Connections 也遵循同一逻辑：远程设备控制一台 Codex host，真正的文件、凭证、插件、浏览器、权限和工具都来自被连接的 host。

这套模型值得 DeepInk 借鉴的地方：

- **Thread 是工作单元**：一次任务、一次对话、一次代码修改都归属于一个线程。
- **Environment 是执行边界**：文件、命令、浏览器、MCP、权限都来自当前环境。
- **权限先于执行**：用户必须能看到并批准高风险动作。
- **工作结果可检查**：diff、日志、终端输出、文件、截图都应该成为可查看 artifact。
- **规则跟随工作区**：类似 `AGENTS.md`、skills、MCP 这类能力要按环境加载。

## DeepInk 的差异

Codex 的世界观是：

```text
围绕一个代码项目工作；远程只是控制这个项目所在的 host。
```

DeepInk 的世界观应该是：

```text
围绕一个人的任务工作；任务可能发生在本机、远程电脑、浏览器、Android、云手机、好友 Agent、团队 Agent 或文档里。
```

因此 DeepInk 不能只建模 `Project -> Thread`，而应该建模：

```text
Task Thread
  -> WorkTarget
  -> AgentEndpoint
  -> Capability
  -> PermissionProfile
  -> Artifact
```

## 核心概念

### TaskThread

一次可持续的 Agent 工作线程。它可以是本地 Agent 对话、远程 Agent 会话、Android 自动化任务、浏览器任务，或好友 Agent 协作任务。

```ts
interface TaskThread {
  id: string
  title: string
  endpointId: string
  targetIds: string[]
  status: 'idle' | 'running' | 'waiting_approval' | 'failed' | 'completed'
  createdAt: number
  updatedAt: number
}
```

### WorkTarget

用户希望 Agent 操作的具体对象。

```ts
type WorkTarget =
  | { kind: 'local_workspace'; path: string }
  | { kind: 'browser'; instanceId: string }
  | { kind: 'editor'; documentId: string }
  | { kind: 'android'; deviceId: string }
  | { kind: 'remote_agent'; serverId: string; workspacePath?: string }
  | { kind: 'ssh_host'; hostId: string; path?: string }
  | { kind: 'cloud_phone'; deviceId: string }
  | { kind: 'friend_agent'; userId: string; agentId: string }
```

### AgentEndpoint

执行能力来源。Endpoint 可以是本机，也可以是远程。

```ts
interface AgentEndpoint {
  id: string
  name: string
  kind:
    | 'local'
    | 'remote-chatcc'
    | 'ssh'
    | 'android'
    | 'browser'
    | 'cloud-phone'
    | 'friend-agent'
  status: 'online' | 'offline' | 'connecting'
  transport: 'ipc' | 'tim' | 'ssh' | 'http' | 'websocket'
  capabilities: AgentCapability[]
}

type AgentCapability =
  | 'chat'
  | 'files'
  | 'shell'
  | 'browser'
  | 'android'
  | 'editor'
  | 'diff'
  | 'mcp'
  | 'notifications'
  | 'approvals'
```

### PermissionProfile

DeepInk 的权限模型应参考 Codex 的 approvals + sandbox，但扩展到更多目标。

```text
Endpoint Permission Profile
  - 文件权限：read / write / deny
  - 命令权限：deny / confirm / auto
  - 浏览器权限：readonly / form_fill_confirm / submit_confirm
  - Android 权限：screenshot_only / tap_confirm / install_confirm
  - IM 权限：confirm_before_send / allow_contacts
  - Agent 协作权限：receive_only / approval_required / auto_collab
```

## ChatCC 作为第一个远程 Endpoint

ChatCC 不应该作为独立 Swift App 迁移进来，而应该成为 DeepInk 的第一个远程 endpoint：

```text
remote-chatcc endpoint
  transport: TIM
  protocol: cc_type
  capabilities:
    chat
    files
    shell
    diff
    approvals
    sessions
    notifications
```

远程 Agent runtime 只维护 `chatcc-agent` 这一套。DeepInk 不新增第二个远程 daemon，只作为 `chatcc-agent` 的桌面客户端、控制台和工作台。

对应模块建议：

```text
src/shared/agent-endpoint/
  endpoint-types.ts
  capabilities.ts
  permissions.ts

src/main/remote/
  endpoint-manager.ts
  endpoint-store.ts
  transport-registry.ts

src/main/remote/transports/chatcc/
  chatcc-tim-transport.ts
  chatcc-protocol.ts
  chatcc-session-service.ts
  chatcc-file-service.ts
```

ChatCC 的 Swift 代码仅作为交互样本参考。真正需要迁入的是：

- `cc_type` IM 消息协议
- 远程服务器 / 工作区 / 会话模型
- 远程文件树、文件读取、搜索协议
- `agent_tool` 工具卡片语义
- Setup Code 配对流程
- 云函数 API 中与认证、配对、配额相关的能力
- `chatcc-agent` 的远程 daemon 运行时约定

## UI 信息架构

DeepInk 需要同时支持“工作现场”和“对话线程”。推荐不要把对话位置写死，而是把对话做成可停靠面板。

### 默认布局：侧边对话

适合用户一边看浏览器、Android、文档、diff，一边和 Agent 对话。

```text
Activity Bar | Sidebar | Workbench(browser/editor/android/files/diff) | Conversation Panel
```

优点：

- 保持 VSCode 风格。
- 主工作区留给执行现场。
- 适合浏览器自动化、Android 自动化、文档编辑、远程文件查看。
- 当前 DeepInk 已经采用此结构，迁移成本最低。

缺点：

- 长对话、复杂工具卡片、代码 diff 在窄面板里会拥挤。
- 远程 Agent 会话如果以聊天为主，侧边可能不够沉浸。

### 中间对话：Thread View

适合 ChatCC/Codex 类任务：用户主要在看一条远程 Agent 线程，工具卡片、终端输出、文件引用都围绕对话展开。

```text
Activity Bar | Sidebar | Conversation Thread | Artifact Inspector
```

优点：

- 长对话可读性更好。
- 工具卡片、审批、流式输出、终端输出更舒服。
- 适合远程 Agent、好友 Agent、团队 Agent、任务复盘。

缺点：

- 浏览器/Android 这类“现场优先”的任务会被挤到附属位置。
- 如果所有 Agent 都默认中间，会削弱 DeepInk 的工作台感。

### 推荐方案：可停靠 / 可对换

DeepInk 应该支持同一个 conversation 在三个位置之间切换：

```text
side       右侧停靠，默认模式
center     主工作区 Thread Tab，沉浸聊天/远程任务
popout     独立浮窗，适合边看现场边对话
```

数据上不是复制三套 UI，而是同一个 `TaskThread` 的不同 presentation：

```ts
type ConversationPlacement = 'side' | 'center' | 'popout'

interface ThreadPresentation {
  threadId: string
  placement: ConversationPlacement
  pinnedArtifactId?: string
}
```

交互建议：

- 浏览器、Android、编辑器任务默认 `side`。
- 远程 Agent / ChatCC 会话默认 `center`。
- 用户可以点击“移到主工作区”或“停靠到右侧”随时切换。
- 当对话在中间时，右侧面板变成 `Artifact Inspector`，展示文件、diff、截图、终端输出、审批。
- 当对话在侧边时，主工作区展示当前 target 的现场。

## 对话停靠交互规格

这一节是实现 UI 时的准则。目标是让用户能直觉地理解“对话”和“现场”可以对换，而不是靠文字说明。

### 位置和命名

DeepInk 中与对话相关的区域统一叫 `Conversation`，不要在架构层写死为 `AgentPanel`。

```text
Conversation Side Dock     右侧停靠面板
Conversation Thread Tab    主工作区里的对话 Tab
Conversation Popout        独立浮窗
Artifact Inspector         对话居中时的右侧结果检查面板
```

默认规则：

```text
browser/android/editor/local-workspace -> side
remote-chatcc/ssh/friend-agent/team-agent -> center
```

用户手动移动过的位置要按 thread 持久化，下次打开同一 thread 时恢复用户选择。

### 拖动入口

侧边对话和中间对话都必须有一个可拖动区域：

```text
Conversation Header
  - 左侧：endpoint / target 名称
  - 中间：thread 标题，可作为拖拽手柄
  - 右侧：停靠按钮、弹出按钮、关闭按钮
```

拖动规则：

- 从 header 按住拖动 120ms 后进入 dragging 状态。
- 拖动时显示半透明预览框，而不是移动真实面板。
- 拖动过程中不选中文字。
- 按 `Esc` 取消拖动，回到原位置。
- 拖动结束时，如果没有命中 drop zone，回到原位置。

### Drop Zone

拖动对话时，界面显示三个吸附区域：

```text
┌────────────────────────────────────────────┐
│              center drop zone              │
│                                            │
│                                            │
│                                            │
│                             side drop zone │
└────────────────────────────────────────────┘

浮窗 drop zone 不需要占屏幕区域，由 header 菜单或快捷按钮触发。
```

命中规则：

- 拖到工作区中间 60% 区域：变成 `center`，打开或激活 `Conversation Thread Tab`。
- 拖到右侧 22% 区域：变成 `side`，停靠到右侧面板。
- 拖到窗口外或没有命中：保持原位置。

视觉反馈：

- 命中 `center` 时，Workbench 出现整块半透明蓝色轮廓。
- 命中 `side` 时，右侧边缘出现 350px 宽的半透明轮廓。
- 当前命中的 drop zone 显示短标签：`移到主工作区` / `停靠到右侧`。
- 不在 drop zone 时，只显示拖动预览，不显示标签。

### 按钮入口

拖拽不是唯一入口。header 右侧必须提供明确按钮：

```text
side 状态：
  [移到主工作区] [弹出] [关闭]

center 状态：
  [停靠到右侧] [弹出] [关闭 Tab]

popout 状态：
  [停靠到右侧] [移到主工作区] [关闭浮窗]
```

按钮只显示图标，hover tooltip 写完整动作。命令面板也提供同样命令：

```text
Conversation: Move to Side
Conversation: Move to Center
Conversation: Pop Out
Conversation: Reset Layout
```

### 宽度和折叠

当前 DeepInk 已有 `sidebarWidth`、`agentPanelWidth` 和 `ResizeHandle`。后续不要重写拖拽宽度逻辑，而是在此基础上扩展。

推荐约束：

```text
Conversation Side Dock
  min: 280px
  default: 380px
  max: min(720px, viewport * 0.45)

Artifact Inspector
  min: 280px
  default: 420px
  max: min(760px, viewport * 0.48)

Sidebar
  保持现有 160px - 500px
```

交互：

- 拖右侧面板左边缘调整宽度。
- 拖到小于 `min - 40px` 时显示折叠预览，松手后折叠。
- 双击 resize handle 恢复默认宽度。
- 折叠后 Activity Bar / Status Bar 仍保留状态入口。
- 宽度变化立即生效，拖拽结束后持久化。

### 中间 Thread Tab

当 conversation 移到中间时，它成为普通 Workbench Tab：

```text
Tab type: conversation
Title: thread title
Icon: endpoint kind icon
Close: 关闭 Tab，但不删除 thread
```

如果该 thread 已经有中间 Tab：

- 从 side 移到 center 时，激活已有 Tab。
- 不重复创建 Tab。

如果用户关闭中间 Tab：

- thread 不删除。
- presentation 回到 `side` 或 `hidden`，取决于用户设置。
- 默认回到 `side`，避免用户误以为会话消失。

### Artifact Inspector

当 conversation 在中间时，右侧区域不再显示同一个聊天面板，而是显示当前 thread 的 artifact：

```text
Artifact Inspector
  - 当前工具调用
  - 文件预览
  - Diff
  - 终端输出
  - 截图
  - Android / Browser 小预览
  - 审批卡片
```

点击消息里的文件、diff、截图、命令输出时：

- 如果 conversation 在 `center`，右侧 inspector 打开 artifact。
- 如果 conversation 在 `side`，主工作区打开 artifact Tab。
- 如果 conversation 在 `popout`，优先打开到主窗口 Workbench。

### 小屏和窄窗口

窗口宽度小于 1100px 时：

- 不同时显示 Sidebar + Workbench + Conversation Side Dock。
- `side` 对话以覆盖层形式从右侧滑出。
- 点击遮罩或按 `Esc` 收起。
- `center` 模式仍然作为 Workbench Tab。

窗口宽度小于 760px 时：

- 强制单列。
- Activity Bar 保留。
- Sidebar、Workbench、Conversation 互斥显示。

### 状态持久化

需要持久化两类状态：

```ts
interface ConversationLayoutState {
  threadId: string
  placement: 'side' | 'center' | 'popout' | 'hidden'
  sideWidth?: number
  inspectorWidth?: number
  updatedAt: number
}
```

全局默认布局存 `ui-store`，单 thread 布局存 thread presentation store。

### 首期实现取舍

第一版可以先不做真正的自由拖拽，先做“按钮移动 + 可调整宽度 + 中间 Tab”。原因是当前布局已经有稳定的 resize 基础，按钮移动能最快验证产品形态。

第一版必须做：

- `side <-> center` 按钮切换。
- Conversation Thread Tab。
- 右侧面板宽度持久化。
- 中间模式下右侧显示 Artifact Inspector 占位。

第二版再做：

- header 拖拽。
- drop zone。
- popout 独立浮窗。
- 小屏覆盖层。

## 当前代码落点

DeepInk 当前布局已经具备实现基础：

```text
src/renderer/src/App.tsx
  - MainLayout 管理 ActivityBar / Sidebar / Workbench / AgentPanel
  - 已有左右 ResizeHandle
  - 已有 sidebarWidth / agentPanelWidth 持久化

src/renderer/src/stores/ui-store.ts
  - 管理 sidebarVisible / agentPanelVisible
  - 管理 sidebarWidth / agentPanelWidth

src/renderer/src/stores/tab-store.ts
  - 管理 Workbench Tab
  - 已支持 tab 拖拽排序、持久化、激活、关闭

src/renderer/src/stores/agent-store.ts
  - 已经是多 Agent conversation 结构
  - 每个 conversation 有 id/title/messages/input/loading/scope

src/renderer/src/components/agent-panel/AgentPanel.tsx
  - 当前侧边对话 UI
  - 可以拆成 ConversationView 供 side 和 center 复用

src/renderer/src/components/workbench/Workbench.tsx
  - 当前根据 Tab type 渲染 browser/editor/settings/android/model
  - 可新增 conversation tab type
```

## 第一阶段动工方案

第一阶段目标不是一次性完成拖拽，而是把信息架构打通：

```text
AgentPanel(side)
  点击“移到主工作区”
    -> openTab({ type: 'conversation', conversationId })
    -> presentation.placement = 'center'
    -> 右侧 AgentPanel 折叠或显示 Artifact Inspector 占位

Conversation Thread Tab(center)
  点击“停靠到右侧”
    -> presentation.placement = 'side'
    -> 激活右侧 AgentPanel 对应 conversation
    -> 关闭或保留 center tab（默认关闭）
```

### 建议代码步骤

1. 扩展类型：

```ts
type TabType = ... | 'conversation'

interface Tab {
  conversationId?: string
}
```

2. 新增 presentation 状态：

```ts
interface ConversationPresentation {
  conversationId: string
  placement: 'side' | 'center' | 'popout' | 'hidden'
  sideWidth?: number
  inspectorWidth?: number
}
```

第一版可以先放在 `agent-store.ts`，后续远程 endpoint 增多后再拆成 `thread-presentation-store.ts`。

3. 拆组件：

```text
AgentPanel.tsx
  -> AgentPanelShell          侧边壳：header/session tabs/placement buttons
  -> ConversationView         纯消息列表 + 输入框 + 工具卡片
  -> ScopeSelector            保留

Workbench.tsx
  -> ConversationWorkbenchTab 根据 conversationId 渲染 ConversationView
```

4. 接命令：

```text
Conversation: Move to Center
Conversation: Dock to Side
Conversation: Reset Layout
```

5. 接 UI：

```text
侧边 header 右侧新增按钮：移到主工作区
中间 thread header 右侧新增按钮：停靠到右侧
```

6. 再做拖拽：

第一版按钮路径跑通后，再把 header drag + drop zone 接到同一组 `moveConversation(...)` action 上。

### 不建议第一阶段做的事

- 不要先做 popout。Electron 多窗口会牵涉 IPC 生命周期和焦点管理，放第二阶段。
- 不要先重写整体布局。当前 `App.tsx + ResizeHandle + ui-store` 足够。
- 不要把远程 ChatCC 同时塞进第一阶段。先让本地 Agent conversation 可对换，再接 remote endpoint。
- 不要复制一份独立的中间 Agent UI。必须复用 `ConversationView`，否则后面 side/center 会长期分叉。

## 视觉结构建议

```text
侧边对话模式：

┌ Activity ┬ Sidebar ┬ Workbench(Target) ┬ Conversation ┐

中间 Thread 模式：

┌ Activity ┬ Sidebar ┬ Conversation Thread ┬ Artifact Inspector ┐

浮窗模式：

┌ Activity ┬ Sidebar ┬ Workbench(Target) ┬ Inspector ┐
                         └ Floating Conversation ┘
```

这个设计把“对话到底放哪”变成用户可控的工作方式，而不是一次性产品选择。

## 阶段计划

### Phase 1：抽象层

- 新建 `AgentEndpoint` / `WorkTarget` / `TaskThread` 类型。
- 建立 endpoint registry。
- 把当前本地 Agent 注册为 `local` endpoint。
- 把现有 Agent scope selector 升级为 target selector。

### Phase 2：ChatCC Remote Endpoint

- TypeScript 化 ChatCC `cc_type` 协议。
- 新增 TIM transport。
- 支持 Setup Code 配对。
- 支持服务器列表、在线状态、工作区列表、会话同步。

### Phase 3：远程会话

- 支持 `session_create`、`user_text`、`stream_start/chunk/end`。
- 远程会话以 `center` Thread View 打开。
- 消息本地持久化，离线可浏览。

### Phase 4：工具卡片和审批

- 支持 `agent_tool`。
- 支持 Read/Edit/Write/Bash 卡片。
- 支持 `tool_approval_response`、`user_question`、`question_answer`。
- Diff Viewer 接入主工作区。

### Phase 5：远程文件系统

- 支持 `file_tree_request`、`file_read_request`、`file_search_request`。
- 主工作区新增远程文件浏览器。
- 文件引用点击打开远程文件 viewer。

### Phase 6：更多远程形态

- SSH endpoint。
- Cloud phone endpoint。
- Friend/team agent endpoint。
- Agent 协作消息流。

## 风险和边界

- 不迁移 Swift UI：Swift 代码只作为行为参考。
- 不把 TIM SDK 暴露给 renderer：主进程持有凭证，renderer 只走 IPC。
- 不把 ChatCC 设计写死为唯一远程协议：它只是第一个 transport。
- 不在第一阶段做完整多账号、多组织治理；先保证个人多远程场景跑通。
- 远程 shell 和文件写入必须默认确认，不能继承本地 Agent 的宽权限。

## 一句话原则

Codex 是“项目里的 Agent”。DeepInk 应该是“所有工作现场里的 Agent”。
