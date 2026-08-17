# 本地与远程 Agent Panel 统一方案

> 状态：方案已纠偏；不再以独立 IME 补丁或共享键盘函数作为产品阶段。首个工作包直接原子统一 Agent Panel/Composer 并删除远程重复 UI；远程事务强化仍须通过本文契约门禁。最后更新：2026-08-17。

## 结论

Studio 应只保留一个面向用户的 `AgentPanel`。本地与 CCLink 远程会话共用同一套会话壳、
消息区、Composer、键盘与输入法策略、发送/停止状态和通用操作；本地与远程继续分别拥有
运行时、会话事实和传输协议，通过受限 adapter 向统一 Panel 提供数据与动作。

这不是合并 `agent-store` 与 `cclink-store`，也不是让远程消息经过本地
`agent:sendMessage`。统一的是产品 surface 和交互规则，分离的是运行时事实、安全边界和
失败生命周期。

本地 Panel 已有正确的 IME composing 保护。远程 Enter 误发送不需要再设计一套键盘
策略；当远程直接渲染由本地现有实现提取出的同一个 `AgentComposer` 时，它必须自然继承
这一行为。另外抽取纯键盘决策函数可以是组件内部重构手段，但不是用户闭环、不是里程碑，
也不得允许本地/远程两个 Composer 继续并存。

独立审核确认总体方向符合架构宪法，但原始 adapter 示例没有绑定不可变执行目标，也不能
表达提交证据、明确拒绝、目标过期、能力不支持和结果未知。该示例已废弃，不得作为实现
依据。首个统一工作包只能用薄 controller 继续委托现有唯一 owner，不得顺手发明宽泛
adapter 或改变远程协议语义。UAP-2 远程事务强化在本文“统一命令与远程事务契约”的
UAP-2 门禁全部关闭前
不得开始；该门禁不得被用作保留两套 Panel UI 的理由。

## 用户可执行验收

实现完成后，真人必须能够执行以下动作：

1. 打开本地工作空间，在 Agent Panel 使用中文输入法输入内容；按 Enter 确认候选时不发送，
   再按 Enter 才发送，`Shift+Enter` 始终换行。
2. 打开已登录、已配对的远程工作空间，执行相同操作，键盘行为与本地一致，消息只发送到
   按下发送时选定的远程会话；之后切换可见工作空间或会话不能改投目标。
3. 在本地与远程工作空间之间切换，Panel 的布局和通用操作保持一致，消息、会话、草稿和
   运行状态不串用。
4. 让远程设备离线或返回协议不兼容；Panel 保留可查看的远程历史并明确禁用不可用动作，
   切回本地工作空间后本地 Agent 仍可正常使用。
5. 对远程运行时不适用的图片、资源、Skill、Runtime 选择或其他能力，Panel 可以隐藏对应
   动作，原因进入诊断；对用户合理期待但暂时不可用的动作，Panel 必须禁用并显示原因。运行中
   Agent 的停止属于用户合理期待的通用动作，远程协议不支持时必须显示 disabled 状态及原因，
   不能隐藏。所有动作都不得伪装成功，也不得回退到本地 Agent 执行。

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

权威运行事实与 renderer 投影是上下游关系，不是两个并列 owner：

| 领域                                     | 权威事实 owner                                 | renderer 投影/UI owner                               | 不得承担                                          |
| ---------------------------------------- | ---------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------- |
| 本地 run、runtime session 和执行结果     | main Agent runtime / conversation run contract | `agent-store` 的可重建投影                           | 远程连接和远程 session 事实                       |
| 本地 per-conversation 草稿和挂载内容     | 无主进程权威副本                               | `agent-store` 中目标 conversation                    | 跨 conversation 草稿或 adapter 副本               |
| 远程 session、message、capability 和状态 | CCLink remote service                          | `cclink-store` 的可丢弃、可重建投影                  | renderer 反向成为远程权威事实                     |
| 远程 operation 关联和远端运行 phase      | remote service 有界内存 operation registry     | `cclink-store` 的 per-operation 投影                 | 只凭 session ID 归因或持久化消息正文              |
| 远程草稿、loading/error 和提交 attempt   | 无远端权威副本                                 | `cclink-store` 中按精确 remote target/operation 建模 | 无 target 的全局状态或 adapter 缓存               |
| 当前工作空间身份、正式 generation 与切换 | Studio workspace 基础层                        | workspace store 的唯一投影                           | 根据路径猜身份或复用领域私有计数器                |
| 输入法组合态、候选菜单和纯视觉展开状态   | 无持久化权威事实                               | 统一 Agent Composer 组件实例                         | session/message/status 副本或跨会话草稿           |
| 用户命令路由                             | Command Registry、既有领域 controller/命令     | adapter facade 只委托唯一入口                        | adapter 私建第二套命令入口                        |
| Panel view                               | 无                                             | adapter 纯派生 selector                              | 写入事实、缓存、事件订阅或 sessions/messages 副本 |

本地与远程 store 不合并。统一 Panel 不保存第二份 sessions/messages；adapter 必须是无持久化、
无订阅所有权、无内部 session/message/status 副本的纯 selector 与 command facade。远程
capability/status 在 UAP-2 前必须收口到 `cclink-store` 或远程 service，不能藏在 adapter 缓存或
Panel 组件状态中。

`cclink-store` 中所有可能跨工作空间漂移的 renderer 状态，包括 loading、error、status、draft 和
operation，都必须按精确 remote target 建模；不得只隔离 draft 而保留全局 loading/error/status。

本方案不新增草稿正文持久化。`cclink-store` 的 draft、提交 attempt 和 UI operation 只保证在
同一 renderer 生命周期内跨组件卸载、StrictMode 重挂载和工作空间切换保留；BrowserWindow、
renderer 进程或整个 App 销毁后不保证恢复。remote service 的 operation registry 只在 main
进程内存中保存 client attempt ID、operation ID、trace ID、endpoint、workspace、session、phase
和时间戳，不保存消息正文，不作为跨 App 重启的持久化 ledger。

当前 workspace store 尚未暴露可供用户命令绑定的正式 generation；`cclink-store` 只有用于丢弃
过期 session 列表响应的领域私有 generation。UAP-1 在绑定统一 Panel 回调前，必须先由
workspace 基础层定义正式 generation 的创建、读取和失效语义，并让命令执行时重新
校验。UAP-1/UAP-2 都不得借用 `cclink-store` 该私有计数器。

UAP-1 不合并或复制草稿 owner：本地继续使用 `agent-store` 的 per-conversation input，
远程继续由当前领域 owner 提供受控 value/onChange。两者都渲染同一个 `AgentComposer`，不再
保留远程 textarea 或键盘处理。UAP-2 前再把远程草稿收口为由 `cclink-store` 按精确
workspace/session target 唯一拥有；迁移不得出现双写期。

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

## 统一命令与远程事务契约

以下类型是需要先冻结并用契约测试证明的边界草案，不是授权直接实现的最终接口。
其中，不可变 target、正式 workspace generation、exhaustive/fail-closed 路由和 action availability
是 UAP-1 统一回调的安全前提；`clientAttemptId`、`operationId`、verified event 关联、
unknown/untracked 收敛和 registry 生命周期是 UAP-2 实现门禁。UAP-1 不得因此伪造后一组
事务状态，UAP-2 也不得重新引入第二 Panel UI。

### 不可变执行目标

```ts
type AgentPanelTarget =
  | {
      readonly runtime: 'local'
      readonly workspaceKey: string | null
      readonly conversationId: string
      readonly generation: number
    }
  | {
      readonly runtime: 'remote'
      readonly ref: Readonly<RemoteWorkspaceRef>
      readonly sessionId: string | null
      readonly generation: number
    }
```

每个动作捕获点击/提交时的 target，并在执行前重新校验当前 workspace generation、实体归属
和 capability。路由使用 exhaustive switch 并 fail closed；禁止 `default` 分支、truthy fallback
或任何“无法识别即本地执行”的行为。

远程无 session 时的“创建会话并发送”必须是 owner 提供的单一命令。Panel 不得先调用
`createSession` 再读取当前 workspace/session 后调用 `send`。该命令固定采用以下阶段语义：

1. 创建 session 前重验原 target、workspace generation 和 capability；失效则不创建，返回
   `stale-target`。
2. 创建成功后、发送前再次重验原 target 和 generation；失效则不发送，保留原 target 草稿，
   保留已创建的空闲 session，返回 `stale-target`。
3. transport 调用一旦开始，不因随后切换 workspace 而改投、取消或重试；结果只写回原 target
   的 operation/session/message 投影。
4. transport 已提交时，即使用户已经切走，也由原 owner 清理原 target 草稿并更新原 target
   operation；不得改变当前可见 workspace 的 selection。
5. transport 明确拒绝或结果未知时保留原 target 草稿；任何阶段都不得读取新的“当前
   adapter”继续事务。

### 可判定动作结果

```ts
interface AgentSubmissionAttempt {
  clientAttemptId: string
  target: AgentPanelTarget
  draftRevision: number
}

interface AgentSubmissionAttemptState {
  attempt: AgentSubmissionAttempt
  operationId?: string
  phase: 'submitting' | 'submitted' | 'running' | 'completed' | 'failed' | 'unknown' | 'untracked'
  untrackedReason?: 'expired' | 'archived' | 'endpoint-removed' | 'service-reset'
  supersededByClientAttemptId?: string
}

type AgentActionResult =
  | {
      status: 'submitted'
      attempt: AgentSubmissionAttempt
      submittedTarget: AgentPanelTarget
      resolvedTarget: AgentPanelTarget
      operationId: string
      evidence: 'local-runtime-accepted' | 'remote-transport-accepted'
      runId?: string
      requestId?: string
    }
  | { status: 'rejected'; attempt: AgentSubmissionAttempt; code: string; message: string }
  | { status: 'stale-target'; attempt: AgentSubmissionAttempt }
  | { status: 'unsupported'; attempt: AgentSubmissionAttempt; reason: string }
  | {
      status: 'untracked'
      attempt: AgentSubmissionAttempt
      operationId?: string
      reason: 'expired' | 'archived' | 'endpoint-removed' | 'service-reset'
    }
  | {
      status: 'unknown'
      attempt: AgentSubmissionAttempt
      operationId?: string
      message: string
      retry: 'manual-only'
    }
```

renderer 在调用任何提交命令前生成 UUID `clientAttemptId`，并捕获当前 target 及该 target
单调递增的 `draftRevision`。该 attempt 在 renderer 生命周期内不可变；每次用户修改草稿都增加
revision，人工重试必须生成新的 `clientAttemptId`，不得复用旧 attempt。正式 send IPC 输入和
schema 必须包含 `clientAttemptId`；main 的 receipt 与 verified `CclinkRealtimeEvent` 必须原样
返回它。

不得用 `Promise<void>`、裸 boolean 或异常作为全部事务语义。只有命令 owner 可以清理草稿：
它在得到 `submitted`、attempt target 与 `submittedTarget` 完全匹配，且当前 draft revision 仍等于
attempt 捕获值时，原子更新 operation 并清理对应草稿，再返回结果；Composer/Panel 不直接
清理。远程从
`sessionId: null` 创建后发送时，owner 在同一事务中返回带真实 session ID 的
`resolvedTarget` 并迁移原 target 的 session 映射与草稿状态；只有当前可见 target 仍是该
submitted target 且 generation 仍匹配时，owner 才可把当前 selection 切到 resolved session。
用户已切换 workspace/session 时绝不得改变当前 selection；Panel 不自行拼接该迁移。`rejected`、
`stale-target`、
`unsupported`、`untracked` 和 `unknown` 均保留草稿；`unknown`/`untracked` 禁止自动重试，
避免远程重复发送。

`remote-transport-accepted` 的证据只表示腾讯 IM transport 的 `sendMessage()` 已成功返回，
不表示远程 Agent 已确认接收、已经创建 run 或已经开始执行。远程 UI 可以清理原 target 草稿
并显示“已提交”，但在收到后续远程协议事件前不能显示“远程 Agent 已接收/正在执行”。若产品
要求后一种保证，必须新增带 request/session/workspace 关联的远端 ACK；这属于远程协议和
shared contract 变更，触发本文止损与重新评审，不能在 adapter 中推断。

当前 remote service 在 transport 返回后立即把 session 标为 `active` 并发出 `phase: 'started'`；
这是现有实现事实，不是远端执行证据。UAP-2 契约门禁必须先把 renderer 投影拆成“transport
已提交/等待远端响应”和“已收到关联远程运行事件”两个状态，现有 `started` 不得继续直接显示
为“远程 Agent 正在工作”。增加 renderer 内部的 `submitted` 投影不能伪造 ACK；若要增加
真正的远端 ACK，仍按上一段重新评审。

### 远程 operation 关联契约

远程提交使用两级身份：renderer 在调用前生成 `clientAttemptId`，main 校验其 UUID 格式、
target 归属，并确保该 ID 未被另一原始 target identity 占用后生成 `operationId`。已由相同
identity 占用的 ID 是合法幂等重放，必须加入或返回现有 operation，不得再生成 ID。main 把
`operationId` 写入 outbound
`user_text.trace_id`。当前实现可继续让 `request_id` 与它取相同值以兼容既有消息，但长期运行
归因只以经验证的 `trace_id` 为准；`request_id` 继续承担单次请求/响应关联，`session_id` 只标识
会话，三者都不能替代 `clientAttemptId + operationId` 映射。

同一个 `clientAttemptId` 对同一个原始 submitted target identity 重复到达 main 时，不得再次
创建 session 或再次发送：首次调用仍在执行时，重放调用加入同一个 in-flight Promise；已有可
判定结果时返回同一 operation snapshot/result。同一个 ID 携带不同原始 identity 时 fail closed。
renderer 的未知 attempt 只能使用 `clientAttemptId` 与迟到 receipt/event 对账，禁止按 session、
最近 attempt 或消息正文猜测。

原始 identity 与创建后的解析结果必须分别保存：

```ts
interface RemoteSubmittedTargetIdentity {
  endpointId: string
  workspaceId: string
  requestedSessionId: string | null
  generation: number
}
```

幂等比较只使用原 IPC 携带的 `submittedTargetIdentity`；`resolvedSessionId` 记录现有 session 或
创建成功后的真实 session。main 在创建 session 前先预留 operation record 和 in-flight attempt，
因此首个调用仍在创建时，同 attempt 的并发/重放调用也只能等待或读取该 record，不能穿透到
第二次创建。

in-flight attempt 由 remote service 以 `clientAttemptId` 唯一索引，并遵守以下事务规则：

- 预留 operation record 与登记共享 in-flight Promise 必须在任何 session create/transport 调用前
  同步完成；
- 同 identity 的并发调用加入同一 Promise，不创建第二个异步任务；异 identity 立即拒绝；
- owner 层使用 2 分钟 deadline；到期时所有等待者收到同一个 `unknown` result，in-flight map
  删除该 Promise，但 operation record 保留为 `unknown`；
- 底层不可取消调用可以在 deadline 后迟到完成，只能按现有 client/operation ID 更新尚存在的
  record 并走迟到收敛，不能重新执行后续阶段或新建 record；
- 正常 settle 后在 `finally` 中只删除匹配同一 Promise 实例的 map entry，防止旧任务清掉后续
  状态；
- session 归档、endpoint 移除/登出或 service reset 时，先让仍存活的等待者收敛为对应
  `untracked`/结构化结果，再清理 in-flight map；底层迟到结果不得复活已删除 record；
- in-flight map 受 operation registry 的 endpoint/service 容量共同约束，不另开无界集合。

main remote service 在 transport 提交前建立有界内存 operation record：

```ts
interface RemoteAgentOperationRecord {
  clientAttemptId: string
  operationId: string
  traceId: string
  submittedTargetIdentity: RemoteSubmittedTargetIdentity
  resolvedSessionId: string | null
  phase:
    | 'creating-session'
    | 'submitting'
    | 'submitted'
    | 'running'
    | 'completed'
    | 'failed'
    | 'unknown'
  createdAt: number
  updatedAt: number
}
```

若原 target 已有 session，`resolvedSessionId` 在预留 record 时就是该 session；若原 target 为
`sessionId: null`，则先保持 null，创建成功后只更新 `resolvedSessionId`，绝不改写
`submittedTargetIdentity.requestedSessionId`。receipt/event 返回原始 submitted identity 和解析后
identity。由此，“创建成功 + transport 提交成功 + IPC receipt 丢失 + 原 IPC 重放”只返回同一
operation/session snapshot，不创建第二个 session，也不重复发送。

关联和投影固定遵守以下规则：

1. `stream_start` 或 `agent_status` 只有携带与 active operation record 匹配的 `trace_id`，且 main
   能通过 canonical session 记录同时验证 endpoint、workspace、session 和 operation，才能把
   当前 operation 从 `submitted` 或 `unknown` 升级为 `running`。
2. 验证成功后，main 把 `operationId` 绑定到 `endpointId + msg_id` 的 stream buffer；后续不带
   `trace_id` 的 `stream_chunk`/`stream_end` 只能通过该已验证 buffer 继承 operation 关联。
3. 缺少 trace、trace 未知、endpoint/workspace/session 不匹配、chunk 先于已验证 start 到达，
   或重连后收到无法归属的旧流时，只能更新 session 级消息/活动，不能升级、完成或失败当前
   operation。
4. main 向 renderer 发出的 `CclinkRealtimeEvent` 必须携带显式判别：

```ts
type RemoteOperationCorrelation =
  | {
      state: 'verified'
      clientAttemptId: string
      operationId: string
      traceId: string
      operationPhase: 'running' | 'completed' | 'failed'
    }
  | { state: 'session-only' }
```

renderer 只能根据 `state: 'verified'` 更新 per-operation phase；`session-only` 事件不得用“当前
operation”或“最近 operation”猜测归属。renderer 若已因窗口重建失去对应 `clientAttemptId`，
该 verified event 仍可用于 session 事实和诊断，但不得重建旧 draft/attempt 或清理当前草稿。

现有消息类型只把 `request_id`/`trace_id` 定义为可选 envelope 字段，当前服务也没有执行上述
验证或通过 `CclinkRealtimeEvent` 暴露结果。UAP-2 解冻前必须用真实远程 Agent 证明
`stream_start`/运行状态稳定回传 outbound `trace_id`。若真实 Agent 不保证回传，必须扩展远程
协议并按止损规则重新评审；不得降级为 session-only 推断。

### Verified 事件转换表

原始协议事件只由 main remote service 归一化一次；renderer 不得根据 `cc_type`、status 字符串、
`stream_end` 字段或消息内容再次推导 operation phase。

| 经验证事件                                       | 条件                                                                 | 归一化 operation phase |
| ------------------------------------------------ | -------------------------------------------------------------------- | ---------------------- |
| `stream_start`                                   | trace 和 endpoint/workspace/session/operation 全部匹配               | `running`              |
| `agent_status`                                   | status 为明确的 running/working/streaming                            | `running`              |
| `agent_status`                                   | status 为明确的 completed/succeeded                                  | `completed`            |
| `agent_status`                                   | status 为 failed/error/cancelled                                     | `failed`               |
| `stream_end`                                     | error/code、非零 exit code，或 final state 为 failed/error/cancelled | `failed`               |
| `stream_end`                                     | 不含失败证据，或 final state 为 completed/succeeded                  | `completed`            |
| 通用 `error`                                     | 自身 trace 可直接验证，即使尚未建立 stream buffer                    | `failed`               |
| `stream_chunk` / `agent_text`                    | 通过已验证的 `endpointId + msg_id` buffer 继承关联                   | `running`              |
| `agent_tool` / `user_question`                   | 自身 trace 已验证，或通过已验证 buffer 继承                          | `running`              |
| `user_text` echo、session/server/permission 事件 | 无论是否同 session                                                   | 不改变 operation phase |
| 任意事件                                         | 无 verified correlation                                              | 只更新 session 事实    |

明确的 terminal event 不要求 stream buffer：携带可验证 trace 的 completed/failed
`agent_status`、通用 `error` 或 `stream_end` 可以直接终结 operation。`stream_end` 没有 trace 且
没有已验证 buffer 时只能是 session-only。

转换满足单调和失败优先：

- `running`/start/chunk 永远不能把 terminal operation 回退；
- 相同 terminal 重复到达幂等；
- `failed` 永不被之后的 completed 覆盖；
- completed 后若迟到同 operation 的 verified failed/error，升级为 `failed` 并记录无正文的
  terminal-conflict 诊断；
- completed 后迟到 running/start/chunk 保持 completed；
- `stream_end` 与 `agent_status` 任意乱序都应用上述同一规则，handler 不得拥有自己的优先级。

### Unknown 收敛状态机

远程提交 attempt 至少遵守以下状态转换：

```text
submitting -> submitted | rejected | stale-target | unsupported | unknown
submitted  -> running | completed | failed | unknown
unknown    -> submitted | running | completed | failed
running    -> completed | failed | unknown
submitting -> untracked
submitted  -> untracked
running    -> untracked
unknown    -> untracked
```

`unknown` 只有在迟到 command receipt 或携带同一 `clientAttemptId + operationId` 的 verified event
到达时才能收敛；允许直接收敛为 `running`、`completed` 或 `failed`，不要求补造中间状态。收敛
规则如下：

- 未人工重试、target 仍匹配且当前 `draftRevision` 等于 attempt 捕获值：迟到证据证明已经提交
  后，由 owner 清理该 revision 的草稿，并把“结果未知/可能重复”替换为已确认的真实 phase。
- 用户已经编辑草稿导致 revision 改变：保留当前文本，只更新旧 attempt 的 operation phase。
- 用户已经人工重试：新 attempt 生成新 `clientAttemptId`，旧 attempt 记录
  `supersededByClientAttemptId`。旧事件只能更新旧 operation，不得清理草稿、改变新 attempt 或
  当前 selection；提示改为“原提交已确认，人工重试可能造成重复”。
- 同一 operation 的重复或乱序 verified event 必须幂等；terminal phase 不被较早 phase 回退。
- 只有 verified evidence 可以解除未知状态；session-only 活动不能解除“可能重复”提示。

### Renderer `untracked` 收敛

main 删除非 terminal operation record 前必须发送有界的 tracking lifecycle event：

```ts
interface RemoteOperationUntrackedEvent {
  clientAttemptId: string
  operationId: string
  reason: 'expired' | 'archived' | 'endpoint-removed' | 'service-reset'
}
```

remote service 同时提供只读、无正文的 active operation snapshot；`cclink-store` 在初始化、
realtime 重连和 workspace 切换时对账。实时淘汰通知丢失或 renderer 晚订阅时，本地存在但 main
snapshot 不再存在的非 terminal operation 必须转为 `untracked`，无法得到更具体原因时使用
`service-reset`。

`untracked` 是 renderer-only tracking 终态，不代表远程 completed/failed：

- 原 phase 为 `unknown` 时继续显示“提交结果未知，可能重复”；
- 原 phase 为 `submitting/submitted/running` 时显示“已停止跟踪远程运行结果”；
- 不清理或恢复草稿，不改变当前 selection，不自动重试，也不接受 session-only 事件重新关联；
- main record 已淘汰后的迟到事件保持 session-only，不能让 `untracked` 回到 running/terminal；
- terminal record 正常 UI 退场不需要伪造 `untracked`，但 terminal-conflict 仍在 main record TTL
  内按转换表处理。

session 归档、endpoint 移除/登出、TTL 清扫和 service reset 都必须先投影对应 reason；如果
renderer 已销毁则遵守本文不可恢复边界。Registry 满时新 attempt 返回
`OPERATION_REGISTRY_FULL` 并收敛为 rejected，不得在 renderer 留下孤立 submitting operation；
容量释放后的新 attempt 使用新 `clientAttemptId`。

结果分类固定如下，adapter 不得自行发明映射：

- `rejected`：发送调用开始前即可证明未提交的校验失败，包括空内容、目标不存在/已归档、
  workspace/session 不匹配、generation 已失效、能力明确不支持或 transport 尚未建立；其中
  generation 失效对外使用更精确的 `stale-target`，能力缺失使用 `unsupported`。
- `submitted`：本地 runtime 明确接受命令，或远程 transport 的 `sendMessage()` 成功返回。
- `unknown`：transport 调用已经开始，但超时、连接在途断开、renderer 仍存活时 IPC 返回丢失，
  或返回错误
  无法证明消息一定未提交。该状态必须保留原 target 草稿、记录 operation ID、显示可能重复
  的风险并只允许人工决定是否重试。
- `untracked`：main 已按 TTL、归档、endpoint 移除或 service reset 停止跟踪该 operation；它不
  证明成功或失败，保留草稿/风险提示并禁止自动重试。
- transport/runtime 返回能够证明未提交的结构化错误才可归为 `rejected`；无法证明时默认
  `unknown`，不能为了简化 UI 降级成普通失败。分类由唯一 command owner/request router 根据
  冻结的错误码表完成，adapter 只转发结果，不能自行判断。

`sending` 只是由带 target 的活动 operation 投影出的 UI 状态，不是独立全局事实。停止动作
必须绑定明确的 `runId` 或远程 operation/request ID；不能停止“当前正在运行的某个任务”。

### 封闭能力与动作契约

```ts
type ActionAvailability =
  | { state: 'enabled' }
  | { state: 'disabled'; reason: string }
  | { state: 'hidden'; diagnosticReason: string }
```

发送文本、图片、资源、Skill、角色、Runtime、历史、压缩、停止、权限和诊断分别定义自己的
availability、payload 与 result。禁止同时用 `capabilities.cancel` 和可选 `cancel?()` 表达同一
事实，也禁止 adapter 静默丢弃不支持的 payload 字段。

`hidden` 只用于该 runtime 根本不适用、用户不应期待的动作，原因只进入诊断；用户可能合理
期待但当前不可用的动作必须使用 `disabled`，并在 UI 中展示 `reason`。

停止是统一 Agent Panel 的通用预期：只要当前 operation 处于
submitted/running/unknown/untracked，停止控件都不能 hidden。远程协议尚无停止能力时使用
`{ state: 'disabled', reason: '当前远程 Agent 不支持停止' }`；只有正式 capability 和 target-bound
停止命令均存在时才可 enabled；`untracked` 固定 disabled，并说明“已停止跟踪，无法安全定位要
停止的远程运行”。

### Operation registry 生命周期

main remote service 的内存 registry 固定使用以下边界，实施不得留作“合理默认值”：

- 每个 session 最多 32 条、每个 endpoint 最多 256 条、整个 service 最多 1024 条 record；
- `resolvedSessionId: null` 的 pending record 计入 endpoint 和 service 上限；解析出 session 后才
  同时计入对应 session 上限；
- `creating-session` 或 `submitting` 超过 2 分钟未得到明确结果时转为 `unknown`；
- `submitted`、`running`、`unknown` 自最后一次状态更新起最多保留 6 小时；
- `completed`、`failed` 的正常 TTL 为 15 分钟，便于迟到/乱序事件幂等对账；容量压力下允许
  提前删除最旧 terminal record，但不得提前删除未过期的非 terminal record；
- 每 60 秒清扫一次，并在创建 record 和处理 inbound event 前执行惰性清扫；timer 由 service
  生命周期拥有并在 shutdown 释放；
- 容量不足时先删除过期 record，再删除最旧 terminal record；若仍达到任一上限，拒绝新提交并
  返回结构化 `OPERATION_REGISTRY_FULL`，不得驱逐未过期的非 terminal record；
- transport disconnect 时，所有非 terminal record 转为 `unknown`，保留至对应 TTL，禁止自动
  重试；重连后的事件仍须完整验证；
- session 归档、endpoint 移除/登出时先向非 terminal record 发出对应 untracked reason，随后
  删除该作用域全部 terminal/non-terminal record、stream buffer 和 in-flight entry；底层
  不可取消任务的迟到结果只能更新仍合法的 session 事实，不能重建 operation；
- service shutdown/reset 使用 `service-reset` 通知仍存活的 renderer 和 in-flight 等待者，然后
  清空 registry、in-flight map、stream correlation buffer 和 timer；
- record 被 TTL、归档或 shutdown 淘汰后，迟到事件只能标为 `session-only`，记录无正文的诊断
  原因，不得重新创建 operation 或关联到最近 attempt。

registry record 和诊断只保存 ID、目标身份、phase、时间戳、淘汰原因，不保存草稿、消息正文、
token 或 UserSig。

已有稳定命令必须继续复用，尤其是 `agent.newConversation`。该命令当前在执行时读取 active
workspace；UAP-2 前必须保留 command ID 但扩展正式 target 输入，捕获调用时 workspace 与
generation，并在执行时重验，不能继续依赖可变化的“当前工作空间”。没有稳定 command ID 的
动作继续走现有唯一 owner（例如本地 conversation run controller）；如需成为跨 runtime
通用命令，必须先在 Command Registry 和正式 target contract 中定义，再由 adapter 路由，
不能先在 adapter 中新增同名旁路。

### Owner 关闭条件

UAP-2 开始前必须形成可审查的 owner matrix 和测试，至少证明：

- 本地草稿只存在于目标 conversation；远程草稿只存在于精确 remote target；
- workspace 基础层提供正式 generation，命令不复用 `cclink-store` 的请求私有计数器；
- remote service 唯一拥有远程权威 status/capability，`cclink-store` 只保存可重建投影；
- 远程 loading/error/status/draft/operation 均按 target 建模，没有跨 workspace 全局值；
- transport submitted 与关联远程运行事件是两个状态，现有本地 `started` 投影不冒充 ACK；
- main 使用 trace ID 和 endpoint/workspace/session 验证 operation，renderer 只消费显式关联；
- client attempt ID 在 IPC 前生成，main/renderer 和 verified event 共同携带且禁止按 session 猜测；
- pending target 的 submitted identity 与 resolved session 分开保存，IPC 重放不重复创建/发送；
- unknown 的迟到收敛按 draft revision 和 superseded attempt 隔离，不清理用户新内容；
- verified 原始事件只由 main 转换一次，terminal 乱序遵守单调且失败优先；
- operation registry 的容量、TTL、disconnect/archive/shutdown 清理和 timer 释放均有契约测试；
- in-flight Promise 在预留、join、deadline、settle、归档和 shutdown 时生命周期对称且同样有界；
- main 淘汰/重置通过 lifecycle event 与 snapshot 把 renderer 非 terminal 投影收敛为 untracked；
- activity operation 带 target 和 operation ID，Panel 只读取投影；
- adapter 没有缓存、事件订阅生命周期或 sessions/messages 的内部副本；
- 所有命令路由都能对 local/remote exhaustive switch，未知 target fail closed。

## 实施顺序

### UAP-1：原子统一 Agent Panel

这是首个也是唯一的 UI 迁移工作包，不再拆成“先共享键盘函数”、“再共享
Composer”、“最后删旧 Panel”三个可独立停留的阶段。以下改动必须在同一工作包中完成：

- 从已正确处理 IME 的本地实现提取唯一 `AgentComposer`；local-center、local-side 和
  remote 都渲染该组件，候选确认、Enter、Shift+Enter、历史导航和粘贴均没有第二实现；
- 提取唯一 `AgentPanel` view，统一 `ConversationShell`、消息列表、工具结果、错误/空状态、
  Composer 和通用操作位置；
- 本地与远程各保留一个薄 controller/hook，它们只把既有 owner 的受控投影和 target-bound
  回调传入同一 view，不缓存 sessions/messages/status，不建立第二命令入口；
- UAP-1 的 controller 在构造回调时必须捕获当次不可变 target（包括正式 workspace
  generation），调用时重验，失效就 fail closed；通用 Panel 不读取“当前 adapter”二次选路，
  远程失败不得调用本地 owner；
- UAP-1 不新建宽泛的跨 runtime command facade，不伪造 `submitted/running` 等远程证据；
  attempt/operation result 和 verified event 契约在 UAP-2 由唯一 owner 实现；
- 远程特有连接状态和权限 surface 只能通过有界 slot 注入，不在通用 JSX 中复制一套
  remote 分支；未支持的能力按 availability 隐藏或禁用，不静默丢弃 payload；
- `App.tsx` 只渲染 `AgentPanel`，并在同一工作包删除完整 `RemoteAgentPanel`、其独立 textarea/
  键盘处理以及只为它存在的重复 CSS；
- 禁止通过 feature flag、隐藏组件、旧 controller 渲染新 JSX 或双写保留两套 Panel 路径。

UAP-1 的产品闭环是“本地和远程已经在真实应用中使用同一 Panel/Composer”。只提取
键盘函数、只修远程 Enter handler、只新建共享组件但仍保留 `RemoteAgentPanel` 生产路径，都不算
UAP-1 完成。

### UAP-2：远程事务与 operation 强化

- 前置条件：target、action result、owner matrix、action availability、命令路由、operation
  correlation 和 registry 生命周期契约均已冻结并通过契约测试；否则 UAP-2 不开始。
- 按本文契约实现不可变 target、`clientAttemptId`、`operationId`、verified event 关联、
  unknown 收敛、untracked 对账和有界 registry。
- 将远程 loading/error/status/draft/operation 收口为按精确 target 建模，不改变已完成的
  单 Panel/Composer UI 结构。
- 检查所有发送、新建、选择、停止、诊断和权限入口，确认最终进入唯一 Command Registry 或
  既有领域 controller；adapter command facade 只能委托该入口，不得形成并行事务。

UAP-2 是事务正确性和可观测性强化，不是第二次 UI 统一。UAP-1 后若仍存在完整
`RemoteAgentPanel` 或远程 Composer，应判定 UAP-1 失败，不得把删除工作推迟到 UAP-2。

## 失败降级与生命周期

- 未登录、远程离线、协议不兼容或能力缺失：远程 adapter 返回可诊断状态，Panel 保留历史，
  禁用新建/发送等不可用动作；不得调用本地 adapter 兜底。
- 切换工作空间：只激活与精确 `WorkspaceRef` 和 generation 匹配的投影；过期远程异步结果
  丢弃，不能覆盖新工作空间。
- 切换会话：本地按 conversation ID 保留草稿；远程按 endpoint/workspace/session target 保留
  草稿。新远程会话尚无 session ID 时使用带 workspace identity 的 pending target，创建成功后
  由同一个 owner 原子迁移到返回的 session ID。
- 发送结果：只有 target 匹配的 `submitted` 才清理原 target 草稿。结果未知时保留草稿、显示
  可能重复的风险并禁止自动重试；不得把 transport 已提交伪装成远程 Agent 已接收或已执行。
- Panel 卸载、StrictMode 重挂载或窗口重建：不得重复注册远程事件或本地 stream listener。
- BrowserWindow/renderer/App 销毁是本方案明确的草稿与 UI operation 不可恢复边界。新 renderer
  只从 remote service 重建已持久化 session/message 投影，不恢复旧草稿、不自动重试，也不把
  session 级活动猜成原 operation 结果。若未来要求恢复，必须另行定义 userData 存储位置、正文
  保留期限、成功/归档/退出清理、文件权限和诊断脱敏后重新评审。

## 权限与人工确认

- 本地修改性工具继续复用现有 permission manager 和 conversation run controller。
- 远程权限请求继续由 CCLink 远程事实源拥有。当前 realtime permission 只有 server ID、
  request ID、path 和 operation，没有可验证的 workspace/session 绑定；UAP-2 不把它合并为
  宣称展示目标工作空间的通用确认卡，只保留有界的远程权限 surface。
- 若要统一远程权限卡，必须先扩展远程协议与 shared contract，加入可验证的 workspace/session
  绑定，并按本文止损条件重新评审。
- 统一 UI 不得统一或扩大权限；本地批准不能复用于远程，远程批准也不能写成本地默认设置。
- 只有协议提供可验证身份时，确认卡才能展示具体目标工作空间；否则必须明确标为未验证，
  不能根据当前 Panel、路径或 endpoint 猜测。

## 诊断与验证

自动化至少覆盖：

- 同一 `AgentComposer` 分别绑定本地与远程 controller 时的 composition、Enter、Shift+Enter、
  `keyCode === 229`、候选菜单、历史导航、图片粘贴、流式编辑和重复提交测试；
- 本地与远程 adapter 的 session/message/status/action 映射测试；
- 同一 Panel view 分别绑定 local/remote adapter 的组件测试；
- 创建会话期间切换、发送期间切换、超时/结果未知、远程 session 已归档、同 endpoint 多
  workspace、组件卸载与 StrictMode 重挂载测试；
- 创建前失效不创建；创建后/发送前失效保留空闲 session 且不发送；transport 开始后切换只
  更新原 target、不改变当前 selection；
- 远程 transport 成功只投影为 `submitted`，收到关联远程事件后才投影执行状态；
- trace 验证覆盖匹配、缺失、错误 workspace/session、未知 trace、chunk 早到、重连旧流和
  stream buffer 继承；无验证关联时当前 operation phase 不变化；
- IPC 返回丢失后通过 client attempt ID 对账；unknown 迟到收敛覆盖未编辑、已编辑、已人工
  重试、乱序和重复事件，旧 operation 不清理新 revision 或更新新 attempt；
- `sessionId: null` 创建并提交后 receipt 丢失，再重放原 IPC 时返回同一 resolved session 和
  operation，不创建第二个 session、不重复发送；
- verified start/status/end/error/tool/chunk 事件转换覆盖无 buffer terminal、失败优先和 terminal
  后不回退；renderer 不解释原始 status；
- registry 覆盖 session/endpoint/global 上限、各 phase TTL、容量拒绝、disconnect、归档、登出、
  shutdown、timer 释放及淘汰后迟到事件降级为 session-only；
- in-flight attempt 覆盖并发 join、异 identity 拒绝、2 分钟 deadline、finally 实例保护、归档/
  reset 清理和 deadline 后迟到 settle 不复活 record；
- TTL/归档/endpoint 移除/service reset 使 renderer 非 terminal operation 收敛为对应 untracked；
  registry-full 拒绝不遗留 submitting 投影，snapshot 重同步可修复漏失通知；
- 运行中远程 Agent 不支持停止时，停止按钮 disabled 且展示原因，不能 hidden；
- BrowserWindow 销毁不承诺恢复 draft/UI operation；重建后不自动重试，只从权威消息事实恢复；
- 上述所有失败路径以及远程离线/协议不兼容时，本地 `agent.sendMessage` 调用次数严格为零；
- 工作空间快速切换、远程过期响应、target/generation 重验和草稿隔离测试；
- 生产代码只存在一个 `AgentPanel` view 和一个 `AgentComposer`，不再导入或渲染完整
  `RemoteAgentPanel`、独立远程 textarea 或第二键盘 handler 的架构回归检查；
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
6. UAP-1 是否直接交付了单一 Panel/Composer，还是用 IME 补丁或共享键盘函数掩盖双 UI 仍在？
7. 所有动作是否绑定提交时的不可变 target，并在执行时重新校验 generation？
8. 草稿是否只在匹配 target 的 `submitted` 后清理，结果未知时是否禁止自动重试？
9. 通用动作是否复用 Command Registry/既有 controller，而不是 adapter 自建第二套命令？
10. 远程 transport 提交是否被错误描述成远程 Agent 已接收或已开始执行？
11. 运行事件是否通过 trace + endpoint/workspace/session 验证，而不是只凭 session ID 归因？
12. 是否误称纯内存 renderer store 能在 BrowserWindow/App 销毁后恢复草稿或 operation？
13. IPC 前是否已有双方可对账的 client attempt ID，迟到事件是否同时返回 attempt/operation ID？
14. unknown 迟到收敛是否按 draft revision 和 retry 代际隔离，避免清理用户新内容？
15. registry 是否真正有界且生命周期对称，淘汰后的事件是否严格降为 session-only？
16. pending target 与 resolved session 是否分开保存，IPC 重放是否真正幂等？
17. 所有 verified 事件是否经过唯一转换表，terminal 乱序是否单调且失败优先？
18. main 淘汰 record 后，renderer 是否确定收敛为 untracked 而不是永久显示 running/unknown？

若实现需要修改远程协议、扩大 preload 权限、合并 store、改变远程身份规则，或无法以单一
owner 表达 status/draft/operation，应停止当前工作包并重新评审；需要违反架构宪法时必须先
提交 ADR。
