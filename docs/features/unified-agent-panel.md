# 本地与远程 Agent Panel 统一方案

> 状态：待独立审核，尚未实施。最后更新：2026-08-17。

## 结论

Studio 应只保留一个面向用户的 `AgentPanel`。本地与 CCLink 远程会话共用同一套会话壳、
消息区、Composer、键盘与输入法策略、发送/停止状态和通用操作；本地与远程继续分别拥有
运行时、会话事实和传输协议，通过受限 adapter 向统一 Panel 提供数据与动作。

这不是合并 `agent-store` 与 `cclink-store`，也不是让远程消息经过本地
`agent:sendMessage`。统一的是产品 surface 和交互规则，分离的是运行时事实、安全边界和
失败生命周期。

## 用户可执行验收

实现完成后，真人必须能够执行以下动作：

1. 打开本地工作空间，在 Agent Panel 使用中文输入法输入内容；按 Enter 确认候选时不发送，
   再按 Enter 才发送，`Shift+Enter` 始终换行。
2. 打开已登录、已配对的远程工作空间，执行相同操作，键盘行为与本地一致，消息只发送到
   当前远程会话。
3. 在本地与远程工作空间之间切换，Panel 的布局和通用操作保持一致，消息、会话、草稿和
   运行状态不串用。
4. 让远程设备离线或返回协议不兼容；Panel 保留可查看的远程历史并明确禁用不可用动作，
   切回本地工作空间后本地 Agent 仍可正常使用。
5. 对远程运行时尚不支持的图片、资源、Skill、停止或其他能力，Panel 必须隐藏或禁用对应
   动作并显示原因，不得伪装成功，也不得回退到本地 Agent 执行。

只有上述真实应用验收和受影响自动化门禁均通过，才能声明统一 Agent Panel 完成。

## 当前情况与问题

当前 App 外壳已经统一，但 Agent Panel 仍按 `WorkspaceRef.kind` 二选一渲染：本地使用
`AgentPanel`，远程使用 `RemoteAgentPanel`。两者分别维护输入框、草稿、发送状态、会话选择、
消息加载和样式。消息气泡与部分顶部会话投影已经开始复用，但 Composer 和核心交互仍然分叉。

已确认的直接缺陷是：本地 `AgentPanel` 的键盘处理会检查 IME composing 状态，远程
`RemoteAgentPanel` 的 Enter 处理没有同等保护。用户使用输入法按 Enter 确认候选时，远程
Panel 会把该按键当作发送。这不是单独的文案或 CSS 问题，而是两套交互实现产生的行为漂移。

远程 Panel 最初作为 CCLink 远程会话最小纵向闭环直接接入，确保远程消息不会误走本地
`agent:sendMessage`。协议隔离是正确约束，但实现把运行时隔离扩大成了完整 UI 隔离；后续只
局部统一消息展示和会话入口，没有收口 Composer、交互策略和 Panel 生命周期。

## 能力边界与状态所有权

| 领域                                                    | 唯一所有者                                       | 不得承担                                     |
| ------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------- |
| 本地会话、run、session、消息投影                        | `agent-store` 与本地 conversation run controller | 远程连接和远程 session 事实                  |
| CCLink 登录、连接、远程 session、远程消息、远程权限请求 | `cclink-store` 与 CCLink remote service          | 本地 run、Workspace/Tab 或通用 Panel UI 状态 |
| 当前工作空间身份与切换                                  | Studio workspace 基础层                          | 根据路径猜测远程身份                         |
| Composer 瞬时交互、菜单、输入法组合状态                 | 统一 Agent Panel / Composer                      | 持久化第二份本地或远程会话事实               |
| 消息发送、停止、诊断、权限动作                          | 当前 runtime adapter                             | 跨 adapter 自动回退或隐式改换执行位置        |

本地与远程 store 不合并。统一 Panel 不保存第二份 sessions/messages；adapter 只投影当前
surface 所需的 view model，并把用户动作路由回原 owner。

## 目标结构

```text
App
└─ AgentPanel                         唯一产品入口
   ├─ ConversationShell              通用标题、状态、错误和布局
   ├─ AgentMessageList               通用消息与工具结果展示
   ├─ AgentComposer                  通用输入、IME、快捷键和发送/停止
   └─ AgentPanelRuntimeAdapter
      ├─ LocalAgentPanelAdapter      agent-store / local run controller
      └─ RemoteAgentPanelAdapter     cclink-store / remote protocol
```

`App.tsx` 不再渲染两个完整 Panel。允许保留两个薄 controller/hook 绑定各自 store，但它们
必须产出同一个 view model 并渲染同一个 Panel view，不能复制 Composer、消息列表或键盘逻辑。

建议的 adapter 能力至少包括：

```ts
interface AgentPanelRuntimeAdapter {
  kind: 'local' | 'remote'
  sessions: AgentSessionViewModel[]
  activeSessionId: string | null
  messages: AgentMessageViewModel[]
  status: AgentPanelStatus
  capabilities: AgentPanelCapabilities
  createSession(): Promise<void>
  selectSession(sessionId: string): void
  send(payload: AgentComposerPayload): Promise<void>
  cancel?(): Promise<void>
  respondPermission?(requestId: string, approved: boolean): Promise<void>
  copyDiagnostics(): Promise<void>
}
```

具体接口应以现有本地 run controller、远程协议和 shared contract 为约束继续收窄，不得为了
让类型表面一致而丢失 run ID、远程 endpoint/workspace identity、权限或错误语义。

## 实施顺序

### UAP-1：共享 Composer，先关闭 IME 缺陷

- 提取单一 `AgentComposer` 和可单测的键盘决策函数。
- 统一处理 `compositionstart`、`compositionend`、`KeyboardEvent.isComposing`，并覆盖
  Chromium/macOS 输入法可能出现的 `keyCode === 229` 兼容路径。
- 本地与远程立即改用同一个 Composer；发送回调仍分别进入原有 owner。
- 覆盖“确认候选不发送、下一次 Enter 发送、Shift+Enter 换行、发送中不重复提交”。

UAP-1 是最小用户闭环，不能等整个 Panel 重构完成后才修复。

### UAP-2：统一 Panel view 与消息投影

- 复用现有 `ConversationShell`、通用消息渲染器和工具结果展示。
- 建立 local/remote adapter，将各自 session、message、status 和 action 投影为同一 view model。
- 统一错误、空状态、发送状态、诊断入口和通用按钮位置。
- 远程特有连接状态和权限请求通过明确的 status/confirmation slot 表达，不在通用 JSX 中散落
  `if (remote)`。

### UAP-3：收口入口与删除重复实现

- `App.tsx` 只渲染 `AgentPanel`。
- 删除完整 `RemoteAgentPanel` 及只为其存在的重复 composer/message CSS。
- 顶部最近会话切换器和左侧会话入口继续读取各自 owner，不持久化统一副本。
- 检查所有发送、新建、选择、停止、诊断和权限入口，确认没有绕过 adapter 的第二条 UI 事务。

## 失败降级与生命周期

- 未登录、远程离线、协议不兼容或能力缺失：远程 adapter 返回可诊断状态，Panel 保留历史，
  禁用新建/发送等不可用动作；不得调用本地 adapter 兜底。
- 切换工作空间：只激活与精确 `WorkspaceRef` 匹配的 adapter 投影；过期远程异步结果沿用
  generation/identity 校验丢弃，不能覆盖新工作空间。
- 切换会话：草稿必须按明确的 workspace/session key 隔离；具体是否保留草稿应统一定义，
  不能由本地和远程各自偶然决定。
- 发送失败：保留可重试文本和附件；发送成功后才清理。远程响应未知时不得伪造成功。
- Panel 卸载或窗口重建：不得重复注册远程事件或本地 stream listener。

## 权限与人工确认

- 本地修改性工具继续复用现有 permission manager 和 conversation run controller。
- 远程权限请求继续由 CCLink 远程事实源拥有，通过统一确认卡展示和回传。
- 统一 UI 不得统一或扩大权限；本地批准不能复用于远程，远程批准也不能写成本地默认设置。
- 所有确认必须展示执行位置、目标工作空间和操作摘要，避免用户把远程操作误认为本地操作。

## 诊断与验证

自动化至少覆盖：

- Composer 键盘决策的 IME、Enter、Shift+Enter 和重复提交单元测试；
- 本地与远程 adapter 的 session/message/status/action 映射测试；
- 同一 Panel view 分别绑定 local/remote adapter 的组件测试；
- 工作空间快速切换、远程过期响应和草稿隔离测试；
- 远程离线/协议不兼容时不调用本地发送的负向测试；
- 生产代码不再渲染完整 `RemoteAgentPanel` 的架构回归检查；
- 受影响测试、typecheck、lint 和 `pnpm verify`。

真人验收必须使用至少一种会产生 composition 事件的中文输入法分别验证本地和真实远程
会话。只有合成事件测试通过不能替代真实输入法验收。

## 审查重点与止损条件

独立审核必须重点拷问：

1. 是否真的只有一套 Composer 和键盘策略，还是把相同代码复制到了两个 controller？
2. adapter 是否只做投影与路由，还是变成第二个会话状态 owner？
3. 统一 Panel 是否充斥 `if (remote)`，导致运行时差异反向污染通用 UI？
4. 远程失败时是否可能误走本地发送、串 workspace/session，或清空无法确认已发送的草稿？
5. 不支持的能力是否诚实禁用，而不是为了视觉统一伪装成已支持？
6. UAP-1 是否先交付真实可验收的 IME 修复，避免大重构期间继续影响用户？

若实现需要修改远程协议、扩大 preload 权限、合并 store 或改变远程身份规则，应停止当前
工作包并重新评审；需要违反架构宪法时必须先提交 ADR。
