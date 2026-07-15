# Historical: Remote Debug Playbook

> 当前状态：历史联调手册，不再作为 `cclink-studio` 当前事实源。
>
> 本文描述的是旧 Remote / entitlement / private-serv / chatcc-agent 三方联调路径。Studio OSS 当前不内置远程工作区、商业账号、TIM、entitlement 或远程诊断入口。后续官方联调手册应放在 `/Users/apple/Desktop/cclink-dev` 或 `/Users/apple/Desktop/chat-cc` 对应目录。

# Remote Debug Playbook

> 状态：联调排查手册
> 最后更新：2026-07-15

## 目标

任何 Remote 失败，都按同一条路径排查：

```text
登录/订阅
  -> entitlement
  -> pairing / agent binding
  -> transport
  -> agent online
  -> protocol version
  -> capability
  -> workspace scope / path policy
  -> runtime backend
```

## DeepInk 本机侧

### 1. 打开诊断报告

路径：

```text
Settings -> 远程连接 -> 远程设备 -> workspace -> 诊断
```

确认：

- `traceId`
- 远程工作空间授权
- 远端连接
- 文件读取
- 文件写入授权
- 文件写入协议
- 远程 Terminal 授权
- 远程 Terminal 能力
- 远程 Agent 会话授权
- 远程 Agent 会话能力
- 最近错误

### 2. 复制诊断报告

诊断报告允许包含：

- traceId
- endpointId / workspaceId
- transport
- operation
- error code
- error layer
- capability 摘要
- agentVersion / protocolVersion

诊断报告不能包含：

- token
- IM userSig
- 短信验证码
- API key
- 文件内容
- 用户消息正文
- 命令敏感参数

## 错误层级判断

| layer | 先查哪里 |
|---|---|
| account | DeepInk 登录态、subscription store、private-serv entitlement |
| transport | CCLink/TIM 连接状态、Direct 连接状态 |
| remote-agent | agent 是否在线、agent 日志、agent 版本 |
| workspace | workspaceId 是否存在、path scope、path deny |
| file-provider | 文件协议、编码、大文件、权限、path policy |
| execution-backend | Terminal、Codex、Claude Code、runtime probe |
| unknown | traceId 串三边日志，补错误归类 |

## 常见失败

### 有权限，但按钮不可用

判断：

- Entitlement 通过。
- Capability 失败。

处理：

- 查 chatcc-agent capability probe。
- 查 protocolVersion 是否过旧。
- 查 agent 是否在线。

### 远端在线，但文件写入不可用

当前预期：

- DeepInk 已有写入 IPC。
- CCLink provider 仍返回 `REMOTE_CAPABILITY_UNAVAILABLE`。
- chatcc-agent 尚未实现写入协议。

处理：

- 不要在 UI 假装可保存。
- 先推进 `file_write` 协议。

### Terminal 有 entitlement，但不能执行

判断：

- `remote_terminal` entitlement 只是商业授权。
- `capabilities.shell.command` 才是远端真实能力。

处理：

- 查 agent terminal command capability。
- 查 workspace cwd。
- 查命令协议是否支持 timeout/cancel/output。

### Agent Session 发送失败

判断：

- DeepInk 当前只有 `sendAgentMessage` 边界。
- 完整 create/stream/approval/cancel 未闭环。

处理：

- 先查 `remote_agent_session` entitlement。
- 再查 agent runtime probe。
- 再查会话是否存在。

## 三项目联调最小材料

每次联调至少记录：

```text
traceId:
DeepInk commit:
private-serv commit:
chatcc-agent commit:
DeepInk env: dev/staging/prod
transport: cclink/direct
endpointId:
workspaceId:
operation:
expected:
actual:
remoteError.layer:
remoteError.code:
```

## 拷问

没有 traceId 的失败，不要靠聊天记录排查。

Remote 是跨项目系统，靠“我本地复现不了”会浪费大量时间。必须让每次失败都能被三边日志串起来。
