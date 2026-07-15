# Historical: chatcc-agent Remote Requirements

> 当前状态：历史需求包，不再作为 `cclink-studio` 当前事实源。
>
> 当前真实位置是 `/Users/apple/Desktop/chat-cc/Agent`，当前命名应按 CCLink Agent runtime 处理。本文仍保留旧 `chatcc-agent` / `private-serv` / `DeepInk Remote` 表述，用于迁移审计；后续若继续推进远端 runtime 协议，应迁到 `/Users/apple/Desktop/chat-cc/Agent` 侧维护。

# chatcc-agent Remote Requirements

> 用途：复制到 chatcc-agent 项目
> 最后更新：2026-07-15

## 总结

DeepInk Remote 会把 chatcc-agent 作为唯一远端 runtime 使用。agent 不实现登录、订阅、订单或套餐判断，只验证 private-serv 签发的短期 remote session token，并按 token scope、本机 path 安全策略和 capability 决定是否执行请求。

CCLink 是首发 transport，Direct 未来也必须复用同一套 remote runtime 协议。不要为 Direct 另起第二套 agent。

## 必须提供的协议面

### 1. server meta / capability probe

agent 需要稳定上报：

- agentVersion
- protocolVersion
- hostname
- platform / os
- lastSeen
- workspace list
- file capability
- terminal capability
- Codex / Claude Code runtime probe
- session capability

### 2. 文件能力

需要实现：

- file tree，支持分页或 depth。
- file read，支持大文件限制、二进制识别、编码错误、line window。
- file write。
- file create。
- file rename。
- file delete。
- file search。
- path allow/deny 和 deny reason。

### 3. Terminal 能力

第一版至少支持：

- command execute。
- cwd。
- stdout/stderr。
- exitCode。
- timeout。
- cancel。

PTY 可以作为增量 capability，但协议里要能明确 `shell.pty=false`。

### 4. Codex / Claude Code Session

需要实现：

- runtime probe。
- create session。
- send message。
- subscribe event stream。
- approval request。
- approval result。
- cancel session。
- archive/resume session。

事件流至少覆盖：

- text
- thinking
- tool_use
- tool_result
- command_started
- command_completed
- file_change_started
- file_change_completed
- approval_request
- error

### 5. Trace 与错误

所有请求和日志必须带 traceId。

错误需要映射到：

- account
- transport
- remote-agent
- workspace
- file-provider
- execution-backend
- unknown

agent 日志不能打印：

- private-serv token 全文
- IM userSig
- API key
- 文件内容
- 用户消息正文

## 调试要求

agent dev/staging 需要支持：

- 本机启动并连接 DeepInk dev/staging。
- mock private-serv token 或读取 dev token。
- verbose protocol log。
- diagnostic command。
- 打印 capability。
- 打印 workspace root。
- 打印 path deny reason。
- 打印 runtime probe 结果。
- 打印 terminal 输出摘要。
- 打印 agent event stream 摘要。
- 按 traceId 搜索日志。

## 优先级

1. protocolVersion + capability probe。
2. file write/create/rename/delete。
3. terminal command。
4. Codex / Claude Code session stream。
5. approval / cancel。
6. Direct transport 复用同一 runtime 协议。

## 拷问

agent 不要知道套餐，也不要判断价格。

agent 的职责是“我能不能在这台机器、这个 workspace、这个 scope 下安全执行这个请求”。商业判断必须留给 private-serv 和 DeepInk entitlement gate。
