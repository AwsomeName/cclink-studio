# ADR 0018：实验性 cclink-agent HTTP/SSE 后端

- 状态：accepted（实验性、默认关闭）
- 实施状态：Studio 适配器工程门禁已通过；现有 chatcc SSE 缺少 Session ID，真实最小闭环 blocked
- 日期：2026-08-24
- 负责人：CCLink Studio Maintainers
- 复审：ADR 0006 的 2026-08-22 本地运行面补充

## 用户验收目标

未登录 CCLink 的用户用显式实验开关启动 Studio 后，在一个新本地 Thread 中发送第一条消息，
看到增量回复；Studio 保存服务返回的 `runtime_session_id`。用户在同一 Thread 发送第二条消息，
服务收到首轮 ID 并返回有上下文的第二轮增量回复。关闭 Studio 后，由 Studio 启动的服务进程也
必须退出。普通启动仍使用 Claude Code 默认后端。

这只是文本聊天和 Session 续聊的最小闭环。工具、权限确认、精确取消、上下文压缩、外部服务
run 状态恢复和任意远程 URL 均不属于本次完成声明。

## 问题

现有 `chatcc cclink-studio` 提供只监听 loopback 的 HTTP/SSE debug/integration surface：

- `GET /healthz`；
- `POST /cclink-studio/v1/runtime/session`，以 `request_id` 关联请求并流式返回事件；
- 请求接受 `runtime_session_id`，事件可返回同一字段供下一轮恢复。

ADR 0006 曾否决新增并行本地 Runtime 服务，因为第二服务可能复制 Thread、run、Session、取消和
终态所有权。当前需求不是恢复第二套产品状态，也不是开放任意 Agent URL，而是在现有
`IAgentBackend` factory 中加入一个默认关闭的进程/传输适配器。因此需要写明最小例外和止损条件。

## 决策

1. 只有 `CCLINK_STUDIO_EXPERIMENTAL_AGENT_BACKEND=cclink-agent` 才启用适配器。普通启动、历史
   Thread 默认解释和 UI 均不变，Claude Code 仍是正式默认后端。
2. Studio 主进程启动 `chatcc cclink-studio --host 127.0.0.1`，固定 loopback，不接受 renderer
   提交 URL、命令、token 或端口。可执行路径、端口和 Runtime ID 只允许通过启动环境显式配置。
3. Studio 生成仅驻留内存的 mock debug token，权限只含 Runtime 请求，token 不进入 renderer、
   Thread、WorkspaceState、普通设置、日志、诊断或磁盘。此 token 只适用于 loopback 实验服务，
   不是 CCLink 登录 Session 或生产授权。
4. Studio Agent Runtime 继续唯一拥有 conversation、run ledger、终态、Session 绑定、兼容指纹和
   renderer 事件。服务只执行当前 HTTP 请求；`runtime_session_id` 是绑定当前 Studio Thread 的
   Runtime 恢复引用，不是第二个 Thread ID。
5. backend 只把文本增量、Session 初始化、完成和错误投影进现有 Agent 事件链，不增加或修改
   renderer、preload、IPC、Thread、Workspace、Studio 工具或 PermissionManager 契约。
6. 每次请求固定 `workspace_restricted=true`、`confirm_every`。首版不解析或批准外部服务工具请求；
   因而只声明文本闭环，不能声明 Studio 工具/权限闭环。
7. 首轮 SSE 没有 `runtime_session_id`，或流结束没有 `done/error` 时 fail-closed；不得把无续聊 ID 的
   响应标为成功闭环。
8. 外部协议缺少精确取消时，backend 显式声明不支持。Studio 在写 `cancelling` 前拒绝取消命令，
   不通过断开 SSE、杀客户端 socket 或超时来伪造 `cancelled`。
9. App 正常退出时停止 Studio 启动的子进程。实验服务启动失败只使 Agent backend 失败，不阻断
   浏览器、编辑器、Terminal、数据源、Android 或其他本地工作台能力。

## 状态所有者与生命周期

| 事实                                | 唯一 owner                                                | 持久化                              |
| ----------------------------------- | --------------------------------------------------------- | ----------------------------------- |
| Studio Thread、消息、Workspace 归属 | 现有 Studio renderer/WorkspaceState 领域                  | 现有格式                            |
| run 接收、运行/终态与查询           | `AgentRuntimeStateStore`                                  | `userData/agent-runtime/state.json` |
| Thread 与 Runtime Session 绑定/指纹 | `AgentBridge` + `AgentRuntimeStateStore`                  | 同上                                |
| HTTP 请求与 SSE socket              | `CclinkAgentBackend`                                      | 不持久化                            |
| chatcc 子进程启停                   | `CclinkAgentService`，由 `AgentBridge.destroy()` 对称释放 | 不持久化                            |

## 缺失的最小 Agent 接口

现有服务没有以下接口，因此本次不能宣称两轮续聊、取消和服务侧 run 状态闭环：

1. `POST /cclink-studio/v1/runtime/session` 的 SSE 成功终态必须返回实际
   `runtime_session_id`
   - 可在首个已知 Session 的事件中发送，也可放入唯一 `done`；
   - 必须取 `runRuntimeSession()` 最终返回值，不能回显请求体中首轮为空的字段；
   - 必须同时保留 `request_id` 和 Studio 提交的 `session_id` 关联；
   - 如果 Runtime 没有产生 Session ID，必须返回结构化错误，不能发送成功 `done`。
2. `POST /cclink-studio/v1/runtime/requests/{request_id}/cancel`
   - 请求至少包含 `session_id`、`runtime_session_id` 和新的取消 `trace_id`；
   - 必须按目标 `request_id` 幂等，只能取消该 run；
   - 响应区分 `accepted`、`already_terminal`、`not_found`、`identity_mismatch`；
   - `accepted` 之后仍需通过 SSE 或状态查询给出唯一 `cancelled` 终态，不能只表示收到命令。
3. `GET /cclink-studio/v1/runtime/requests/{request_id}`
   - 返回 `queued|running|cancelling|succeeded|failed|cancelled`、开始/结束时间、脱敏错误、
     `session_id`、`runtime_session_id`；
   - App/HTTP 断线后仍能查询，未知请求明确 `404`；
   - 状态转换必须单调且终态不可改写。
4. capability probe 增加 `runtime_session_id_in_stream`、`runtime_request_cancel`、
   `runtime_request_status`，Studio 只能按服务声明启用相应行为，不能按版本号或路由猜测。

工具请求若要进入下一阶段，还需独立设计按 `request_id + tool_use_id` 关联的审批提交接口，并证明
它不会绕过现有 `PermissionManager`。这不是当前文本闭环的最小接口。

## 失败降级与诊断

- `chatcc` 不存在、端口占用、`/healthz` 超时：Agent capability 失败，其他本地能力继续启动；
- HTTP 非 2xx、非 SSE、SSE JSON 损坏、无终态、无 Session ID：当前 Studio run 失败并保留错误码；
- 工作空间切换到服务启动 root 外：服务按路径边界拒绝；首版要求重启实验 Studio 绑定新 root；
- 服务进程退出：活动请求失败；Studio run ledger 仍可查询；
- 登录与 CCLink 云网络：完全不参与启动、token 或请求。

## 回收或复审条件

- 默认启动或本地其他能力开始依赖 chatcc 服务；
- 服务成为 Thread/run/终态第二状态 owner，或 Session ID 绕过 Studio 兼容指纹；
- 需要产品 UI 选择、任意 URL、远程服务、自动安装、工具/权限或多工作区常驻服务；
- 无法稳定取得 `runtime_session_id`，或两轮真实续聊失败；
- 未提供精确取消/状态接口却开始显示已取消或可恢复。

## 验证

- 单元/集成测试覆盖子进程启动/停止、loopback 限制、分片 SSE、错误终态、首轮 Session 捕获、
  第二轮 ID 回传和取消能力拒绝；
- 默认启动测试证明未启用开关时仍解析 Claude Runtime，不启动 chatcc；
- 未登录真实 App 按功能文档完成两轮新 Thread 验收；
- `pnpm verify` 通过后只能声明工程门禁完成，真人两轮验收通过后才能声明产品最小闭环完成。

2026-08-24 真实 Electron smoke 使用本机 `chatcc-agent 0.8.42` 失败于第一轮成功流的终点：文本
增量已到达，但 SSE `done` 没有 `runtime_session_id`，Studio 返回
`cclink_agent_session_id_missing`。同时检查只读源码工作区的 `0.8.48`，其
`runRuntimeSession()` 虽返回 ID，SSE route 仍丢弃该返回值并以请求体生成 `done`。因此这不是
Studio 可安全推断或降级的问题；Agent 补齐第 1 项后才能重跑两轮真人验收。
