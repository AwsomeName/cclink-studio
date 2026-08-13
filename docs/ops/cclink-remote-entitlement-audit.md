# CCLink 远程服务授权审计

> 审计日期：2026-08-13。审计范围只读：`/Users/apple/Desktop/chat-cc/deploy`。

## 结论

当前云服务已对远程设备列表强制执行身份 token 验证，并对设备注册、配对和数量进行账号级限制；但它没有强制“付费后才能使用 CCLink 托管远程服务”。免费计划仍然有非零的 server、session 和 device 额度，`getPairedAgents` 也不检查付费 entitlement。

因此，客户端只能把 entitlement 用于提示，不能宣称已形成收费安全边界。本次不修改云服务。

## 证据

- `handlers/agent.js` 中 `_getStrictUserKey` 要求 `user_id` 和 `auth_token`，验证 token 签名、用户一致性和过期时间。
- `handlers/agent.js` 中 `getPairedAgents` 使用上述强身份检查，然后按用户查询已配对 Agent；该路径没有付费计划检查。
- `common/plan-limits.js` 中 free 计划的 server、session 和 device 限制都为 1，不是 0。
- 文件树和文件读取由登录后的 TIM 实时链路直接向已配对 Agent 请求；现有路径中没有可作为付费权威结论的服务端通行判定。

## 产品影响

- Studio 未登录时不请求远程身份，本地功能不受影响。
- 点击 CCLink 远程入口后才登录和连接。
- 在云端增加并验收付费门禁之前，不展示或记录“已授权付费远程服务”的正式结论。
- 网络错误、开发模式或客户端布尔值不能转换为授权成功。

## 关闭条件

要宣称收费闭环完成，云服务至少需在发放可用远程身份或远程访问服务端决策点强制有效 entitlement，并通过免费、付费、过期、撤销和网络失败用例验证 fail-closed 行为。
