# Historical: 远程错误模型

> 当前状态：历史 Remote 错误模型，不属于 CCLink Studio OSS 当前事实源。
>
> 对应的 `src/shared/remote-error.ts`、`RemoteErrorNotice`、remote IPC/provider 等默认路径已迁出或删除。Studio 开源壳当前使用中性的 terminal execution error 模型；官方 Remote 错误模型后续应在 commercial/CCLink runtime 侧重新落地。

# DeepInk 远程错误模型

> 状态：M5 远程能力闭环约束稿  
> 最后更新：2026-07-12  
> 关联文档：`docs/features/product-milestones.md`、`docs/features/product-experience-pages.md`、`docs/features/cclink-integration.md`

## 结论

DeepInk 的远程错误不能按 CCLink、Direct Remote、Terminal 各写一套。错误模型必须拆成两层：

```text
错误语义：layer + code + message + retryable
发生现场：context.transport + endpointId + workspaceId + sessionId + path + operation
```

也就是说：

- `code` 描述“失败语义”，例如 transport 不可用、请求超时、协议不兼容。
- `context` 描述“发生在哪里”，例如 `transport = cclink`、`serverId`、`workspaceId`、`path`。
- UI 根据 `layer/code` 展示可理解的错误，根据 `context` 给出可排查的现场信息。
- CCLink 只是 transport，不应该出现在通用错误码里。

## 数据结构

共享类型位于 `src/shared/remote-error.ts`。

```ts
interface RemoteError {
  layer: RemoteErrorLayer
  code: string
  message: string
  retryable: boolean
  context?: Record<string, string | number | boolean | null>
}
```

字段约束：

| 字段 | 含义 | 规则 |
|---|---|---|
| `layer` | 错误归因层 | 必须使用固定枚举，不允许写自由文本 |
| `code` | 错误语义码 | 使用 `REMOTE_*` 通用语义码，除非是远端 provider 明确返回的业务码 |
| `message` | 人可读说明 | 可以本地化，但不能作为程序判断依据 |
| `retryable` | 是否建议用户重试 | 协议不兼容、权限拒绝通常不可直接重试 |
| `context` | 现场信息 | 用于诊断，不用于替代 `layer/code` |

## 协议兼容格式

远端 Agent 通过 `cc_type: "error"` 上报错误时，DeepInk 支持两种格式。

旧格式仍兼容：

```json
{
  "cc_type": "error",
  "message": "远端 Agent 不可用",
  "error_type": "REMOTE_AGENT_UNAVAILABLE",
  "session_id": "sess_1"
}
```

旧格式会被本地映射为：

- `layer = execution-backend`
- `code = error_type || REMOTE_AGENT_ERROR`
- `retryable = true`
- `context.serverId/sessionId/requestId` 由本地补齐

新格式优先：

```json
{
  "cc_type": "error",
  "message": "远程工作空间不存在",
  "layer": "workspace",
  "code": "REMOTE_WORKSPACE_NOT_FOUND",
  "retryable": false,
  "context": {
    "workspaceId": "agent_1:/data/research",
    "operation": "open_workspace"
  },
  "session_id": "sess_1"
}
```

新格式中，远端给出的 `layer/code/retryable/context` 会被 DeepInk 保留；本地只合并 `serverId/sessionId/requestId` 等接收现场。

拷问：如果 chatcc-agent 仍只发 `error_type`，UI 只能知道“执行后端错误”，无法稳定判断是工作空间、文件 provider 还是权限问题；这不是 UI 问题，而是协议缺字段。

## Layer 定义

| Layer | 归因边界 | 典型问题 | UI 指引 |
|---|---|---|---|
| `account` | 账号、身份、token、手机号、订阅状态 | 未登录、身份不一致、token 过期 | 去设置页检查账号与远程连接 |
| `transport` | 连接通道、消息发送、请求超时 | TIM 未连接、直连不可达、请求超时 | 检查链路在线后重试 |
| `remote-agent` | 远端 Agent 进程、协议版本、响应类型 | 远端离线、协议旧、返回错类型 | 检查远端 Agent 状态和版本 |
| `workspace` | 远程工作空间归属与路径 | 工作空间不存在、workspaceId 缺失 | 重新同步或重新打开工作空间 |
| `file-provider` | 文件树、文件读取、文件搜索、diff provider | 文件不存在、provider 不支持、响应异常 | 检查远端文件 provider 能力 |
| `execution-backend` | Agent/Codex/Claude Code/Terminal 执行后端 | 会话不存在、流式执行失败、shell 失败 | 检查执行后端与任务状态 |
| `unknown` | 无法归因 | 旧错误、未分类异常 | 进入诊断日志 |

拷问：如果一个错误被归到 `unknown`，必须问：是协议缺字段，还是本地没有做映射？不能把 `unknown` 当垃圾桶。

## 通用错误码

`REMOTE_ERROR_CODE` 是 DeepInk 本地定义的通用语义码，适用于 CCLink、Direct Remote 和未来远程 Terminal。

| Code | Layer | Retry | 说明 |
|---|---|---:|---|
| `REMOTE_TRANSPORT_UNAVAILABLE` | `transport` | 是 | transport 未连接或未初始化 |
| `REMOTE_TRANSPORT_SEND_FAILED` | `transport` | 是 | transport 发送消息失败 |
| `REMOTE_REQUEST_TIMEOUT` | `transport` | 是 | 请求已发出但等待响应超时 |
| `REMOTE_PROTOCOL_INCOMPATIBLE` | `remote-agent` | 否 | 本地与远端协议版本不兼容 |
| `REMOTE_UNEXPECTED_RESPONSE` | `remote-agent` | 是 | 收到非预期响应类型 |
| `REMOTE_PROVIDER_ERROR` | 由 provider 决定 | 视情况 | provider 未细分的远端业务错误 |
| `REMOTE_STREAM_ERROR` | `execution-backend` | 是 | 远端流式任务结束时带错误 |
| `REMOTE_AGENT_ERROR` | `execution-backend` | 是 | 远端通用 Agent 错误 |
| `REMOTE_SESSION_NOT_FOUND` | `execution-backend` | 是 | 远程会话不存在或尚未同步 |
| `REMOTE_EXECUTION_BACKEND_UNAVAILABLE` | `execution-backend` | 否 | Terminal / Agent 执行 backend 尚未接入或不可用 |

命名规则：

- 通用错误码使用 `REMOTE_*`。
- 不能新增 `CCLINK_*`、`DIRECT_*` 这类 transport 绑定错误码。
- 如果确实需要保留远端原始错误码，放入 `code` 前必须确认它表达的是业务语义，而不是 transport 名称。
- transport 名称进入 `context.transport`，例如 `cclink`、`direct`、`local`。

## Context 约定

常用字段：

| 字段 | 示例 | 说明 |
|---|---|---|
| `transport` | `cclink` / `direct` | 连接通道 |
| `endpointId` | `agent_xxx` | 远端端点 ID |
| `serverId` | `agent_xxx` | CCLink 兼容字段，后续可归一到 endpointId |
| `workspaceId` | `agent_xxx:/data/research` | 工作空间 ID |
| `sessionId` | `sess_xxx` | 会话 ID |
| `path` | `/data/research/README.md` | 文件路径 |
| `operation` | `file_read` / `file_tree` / `send_message` | 操作类型 |
| `requestId` | `uuid` | 协议请求 ID |
| `msgId` | `msg_xxx` | 流式消息 ID |
| `status` | `offline` | 远端状态 |

规则：

- `context` 只能补充现场，不能决定错误层级。
- UI 可以显示关键 context，但不要把 context 原样倾倒给普通用户。
- 日志和诊断工具必须保留完整 context。

## Provider 责任边界

### Transport Provider

负责：

- 判断是否已连接。
- 发送消息。
- 处理超时。
- 把链路失败映射为 `transport` 层错误。

不负责：

- 猜测远端文件是否存在。
- 猜测执行后端是否失败。

### Remote Agent / Protocol Router

负责：

- 校验协议版本。
- 校验响应类型。
- 把远端 `cc_type: error` 转换为结构化错误。
- 给流式错误补 `msgId/sessionId/requestId` 等 context。

不负责：

- 把所有远端错误都归到 `execution-backend`；如果远端明确返回 layer，应透传。

### Workspace Provider

负责：

- 校验远端工作空间是否存在。
- 校验工作空间归属与 endpoint 是否匹配。
- 把 workspace 缺失或失效归到 `workspace`。

### File Provider

负责：

- 文件树、文件读取、文件搜索、diff 等文件能力。
- 把远端文件能力错误归到 `file-provider`。
- 合并 `serverId/workspaceId/path/operation` context。

### Execution Backend Provider

负责：

- Agent / Codex / Claude Code / Terminal 的执行状态。
- 把会话缺失、流式执行失败、命令失败归到 `execution-backend`。
- 未来 Terminal 必须补审计和权限 context。

## UI 展示规则

日常 UI 不展示“CCLink 调试面板式错误”，而展示：

```text
错误标题：实时链路异常 / 远端 Agent 异常 / 文件 Provider 异常
错误说明：message
错误码：REMOTE_REQUEST_TIMEOUT
下一步：检查实时链路在线后重试
```

规则：

- `RemoteErrorNotice` 优先消费结构化 `remoteError`。
- 没有 `remoteError` 时才允许 fallback 到字符串分类。
- 远程会话消息里的错误必须能沉淀到历史消息，而不只存在顶部 toast。
- 设置页/诊断页可以显示完整 context。

## 当前落地状态

已落地：

- `src/shared/remote-error.ts` 定义 `RemoteError` 和 `REMOTE_ERROR_CODE`。
- DeepInk 本地 `cc_type: "error"` 协议类型已支持 `layer/code/retryable/context`，并兼容旧 `error_type`。
- CCLink 文件服务返回结构化 `remoteError`。
- request router 的 transport 未连接、发送失败、超时、协议不兼容、非预期响应已结构化。
- 远程会话缺失、流式错误、远端 `cc_type: error` 已可沉淀到消息。
- `RemoteErrorNotice` 可展示结构化错误。

未完成：

- chatcc-agent 远端实现尚未承诺稳定发出 `layer/code/retryable/context`；DeepInk 只能先兼容接收。
- Direct Remote provider 尚未接入。
- Terminal 执行错误、权限拒绝、审计信息尚未建模。
- 错误日志与诊断页还没有统一索引。

## 拷问

- 如果用户只给一张截图，我们能否判断失败层级？
- 如果同一个错误发生在 CCLink 和 Direct Remote，是否共用同一个 `code`？
- 如果远端 Agent 返回旧版字符串错误，本地 fallback 是否会误导用户？
- 如果错误发生在远程 Terminal，context 是否足够解释副作用？
- 如果错误可重试，重试动作是 UI 发起、provider 发起，还是用户手动发起？
