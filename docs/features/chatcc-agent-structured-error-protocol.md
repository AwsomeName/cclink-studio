# Historical: chatcc-agent 结构化错误协议改造说明

> 当前状态：历史 Remote 协议材料，不属于 CCLink Studio OSS 当前事实源。
>
> 对应的 Studio 侧 RemoteError/shared remote contracts 已从 OSS 默认路径移出。若继续推进 CCLink Agent 结构化错误，应在 `/Users/apple/Desktop/chat-cc/Agent` 和官方 commercial overlay 中重新定义。

# chatcc-agent 结构化错误协议改造说明

> 状态：DeepInk 侧已兼容接收；待 chatcc-agent 侧实现发送  
> 最后更新：2026-07-12  
> 关联文档：`docs/features/remote-error-model.md`、`docs/features/cclink-integration.md`

## 结论

DeepInk 已经支持新版 `cc_type: "error"` 结构化错误字段。下一步需要 `chatcc-agent` 在发生远程错误时主动返回 `layer/code/retryable/context`，否则 DeepInk 只能把旧版 `error_type` 兼容为通用执行后端错误，无法稳定判断是工作空间、文件 provider、权限还是执行后端问题。

本改造不要求立刻升级协议版本，也不要求移除旧 `error_type`。短期采用“可选字段增强”：

```text
旧客户端：继续读 message/error_type
新客户端：优先读 layer/code/retryable/context，fallback 到 error_type
```

## 给 chat-cc 会话的可粘贴文本

```text
请在 chatcc-agent 的 cc_type: "error" 协议里增加结构化错误字段，并保持旧 error_type 兼容。

背景：
DeepInk 桌面端已支持接收新版字段：
- layer?: "account" | "transport" | "remote-agent" | "workspace" | "file-provider" | "execution-backend" | "unknown"
- code?: string
- retryable?: boolean
- context?: Record<string, string | number | boolean | null>

要求：
1. 不删除旧字段 error_type；旧客户端仍可继续使用。
2. 新错误优先填写 layer/code/retryable/context。
3. message 保持人可读，但程序判断不能依赖 message 字符串。
4. context 至少补充能定位问题的现场字段，例如 session_id、workspace_path/workspaceId、path、operation、tool_use_id、exit_code。
5. 如果无法准确归因，layer 可先用 unknown，但必须保留原始错误 code/message/context，方便后续补映射。

建议映射：
- 工作空间不存在、workspace_path 无效：layer = "workspace"，code = "REMOTE_WORKSPACE_NOT_FOUND"，retryable = true
- 文件树/读文件/搜索文件失败：layer = "file-provider"，code = "REMOTE_PROVIDER_ERROR" 或更具体业务码，retryable 视情况
- Claude/Codex/Agent 执行失败：layer = "execution-backend"，code = "REMOTE_AGENT_ERROR"，retryable = true
- 会话不存在：layer = "execution-backend"，code = "REMOTE_SESSION_NOT_FOUND"，retryable = true
- 协议版本不兼容：layer = "remote-agent"，code = "REMOTE_PROTOCOL_INCOMPATIBLE"，retryable = false

新版示例：
{
  "cc_type": "error",
  "v": 1,
  "min_v": 1,
  "request_id": "req_123",
  "session_id": "sess_123",
  "message": "远程工作空间不存在",
  "error_type": "REMOTE_WORKSPACE_NOT_FOUND",
  "layer": "workspace",
  "code": "REMOTE_WORKSPACE_NOT_FOUND",
  "retryable": true,
  "context": {
    "workspaceId": "agent_1:/data/research",
    "workspace_path": "/data/research",
    "operation": "session_create"
  }
}

验收：
- DeepInk 收到 workspace 层错误时，不应再显示成通用 execution-backend 错误。
- DeepInk 收到 file-provider 层错误时，能在文件树/文件 Tab 里显示具体来源和 path/operation。
- 旧客户端仍能看到 message/error_type，不因新增字段崩溃。
```

## DeepInk 已完成的接收规则

DeepInk 当前处理规则：

- 如果远端返回 `layer/code/retryable/context`，DeepInk 原样保留。
- 如果远端只返回旧 `error_type`，DeepInk 映射为：
  - `layer = execution-backend`
  - `code = error_type || REMOTE_AGENT_ERROR`
  - `retryable = true`
- DeepInk 会额外合并本地接收现场：
  - `serverId`
  - `sessionId`
  - `requestId`

对应代码位置：

- `src/shared/chatcc/protocol.ts`：`ChatccErrorMessage`
- `src/main/cclink/cclink-protocol-router.ts`：`remoteErrorFromProtocolError`
- `src/main/cclink/cclink-protocol-router.test.ts`：新版结构化错误回归测试

## 推荐错误分层

| 场景 | layer | code | retryable | context 必备字段 |
|---|---|---|---:|---|
| 远端协议版本不兼容 | `remote-agent` | `REMOTE_PROTOCOL_INCOMPATIBLE` | 否 | `operation`, `remoteVersion`, `minVersion` |
| 工作空间不存在 | `workspace` | `REMOTE_WORKSPACE_NOT_FOUND` | 是 | `workspaceId` 或 `workspace_path`, `operation` |
| 文件树失败 | `file-provider` | `REMOTE_PROVIDER_ERROR` | 是 | `path`, `operation = file_tree` |
| 文件读取失败 | `file-provider` | `REMOTE_PROVIDER_ERROR` | 是 | `path`, `operation = file_read` |
| 会话不存在 | `execution-backend` | `REMOTE_SESSION_NOT_FOUND` | 是 | `session_id`, `operation` |
| Agent 执行失败 | `execution-backend` | `REMOTE_AGENT_ERROR` | 是 | `session_id`, `msg_id`, `operation` |
| 工具执行失败 | `execution-backend` | `REMOTE_AGENT_ERROR` | 视情况 | `tool_use_id`, `tool`, `exit_code` |
| 权限拒绝 | `execution-backend` | `REMOTE_PERMISSION_DENIED` | 否 | `tool_use_id`, `tool`, `policy` |

说明：

- `REMOTE_PERMISSION_DENIED` 目前 DeepInk 通用码表尚未正式加入；chatcc-agent 可以先作为业务码返回，DeepInk 会保留该 `code`。
- `REMOTE_PROVIDER_ERROR` 是兜底码；如果 chatcc-agent 能区分 `FILE_NOT_FOUND`、`PERMISSION_DENIED` 等更细业务码，可以先返回更具体 code，但不要把 transport 名称塞进 code。

## 不要做什么

- 不要新增 `CCLINK_*` 错误码表达通用语义；CCLink 是 transport，应该写进 `context.transport`。
- 不要让 DeepInk 继续按中文/英文 message 正则判断错误来源。
- 不要把所有远端错误都归到 `execution-backend`。
- 不要为了新增字段强制断开旧客户端兼容。

## 拷问

- 如果用户只给 DeepInk 一张错误截图，我们能否从 `layer/code/context` 判断卡在哪一层？
- 如果 Direct Remote 未来也发生同类错误，是否能复用同一个 `code`？
- 如果 chatcc-agent 返回 `unknown`，是它真的不知道，还是缺少映射？
- 如果权限拒绝、命令失败、文件不存在都叫 `REMOTE_AGENT_ERROR`，后续还能不能排障？
