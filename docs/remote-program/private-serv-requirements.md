# Deprecated: private-serv Remote Requirements

> 状态：废弃历史文档
> 新目标：`/Users/apple/Desktop/chat-cc/deploy`
> 最后更新：2026-07-15

## 总结

本文档记录的是旧 `private-serv` 方向下的 Remote 要求。该方向已废弃。

新的边界是：CCLink Studio 是桌面客户端；`/Users/apple/Desktop/chat-cc/deploy`
作为账号、订阅、entitlement、agent 绑定、pairing 授权和 remote token 的真相源；
`/Users/apple/Desktop/chat-cc/Agent` 承担远端文件、shell、Codex 或 Claude Code 的实际执行。

后续更新应迁到 deploy requirements，而不是继续扩展 private-serv 文档。

CCLink Agent 不判断套餐、不处理订单、不知道价格。Agent 只验证 deploy 签发的短期 remote session token。

## 必须提供的能力

### 1. Entitlement 查询

CCLink Studio 商业 overlay 需要能查询当前用户：

- remote_workspace
- remote_pairing
- remote_file_read
- remote_file_write
- remote_terminal
- remote_agent_session
- remote_audit

要求：

- 支持 dev/staging 测试用户快速开通/取消。
- 支持不依赖真实支付的测试套餐/测试订单。
- 返回稳定 code，不返回只适合 UI 展示的套餐文案。

### 2. Agent 绑定与 Pairing

需要支持：

- 创建 pairing。
- 查询 pairing 状态。
- agent 绑定到用户。
- agent 绑定到设备。
- 记录 endpointId。
- 记录 workspace 列表或最近上报摘要。
- 解绑。

### 3. Remote Session Token

需要签发短期 remote token。

Token scope 至少包含：

- userId
- agentId / endpointId
- workspace scope
- capability scope
- expiresAt
- traceId

规则：

- token 有效期要短。
- agent 只验证 token 和 scope，不判断套餐。
- CCLink Studio 不把长期敏感凭证交给 agent。

### 4. TIM / Relay Token

CCLink 首发需要：

- Tencent TIM userSig 或 relay token 下发。
- token 过期刷新。
- 错误码可诊断。

Direct 后续需要决策：

- 是否仍由 deploy 签发 remote token。
- 是否需要 gateway。
- 如何授权设备和 workspace scope。

### 5. 后台诊断

需要能按 traceId 查询：

- entitlement 命中。
- token 签发。
- pairing 状态。
- agent 绑定状态。
- userId / agentId / endpointId。
- 失败原因码。

日志不能展示：

- token 全文。
- IM userSig。
- 短信验证码。
- API key。

## 调试要求

dev/staging 环境需要：

- CCLink Studio 官方构建可指向 dev/staging API。
- 测试用户快速开通 Remote entitlement。
- 测试用户快速撤销 Remote entitlement。
- 可查看 agent binding。
- 可查看 pairing。
- 可查看 token 签发日志。
- 可查看 entitlement 命中日志。
- 可按 traceId 查询一次 Remote 调用链。

## 优先级

1. entitlement 查询和 mock/test 套餐。
2. agent binding / pairing 状态查询。
3. remote session token。
4. TIM/relay token 规范化。
5. 后台 traceId 诊断。
6. Direct 授权模型决策。

## 拷问

deploy 不要实现远端执行，也不要让套餐逻辑散到 Studio 和 Agent。

它的核心价值是控制面：谁有权、哪个 agent 属于谁、这个 token 能干什么、失败时后台能不能查到原因。
