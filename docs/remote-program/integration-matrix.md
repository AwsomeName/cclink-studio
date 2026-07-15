# Historical: Remote Integration Matrix

> 当前状态：历史能力矩阵，不再作为 `cclink-studio` 当前事实源。
>
> 本文列出的 Remote contracts、provider、IPC、UI 和 entitlement adapter 已迁出 Studio OSS 默认路径。保留本文只为审计“哪些商业/远程能力曾经存在”，不要据此把已删除文件加回开源壳。

# Remote Integration Matrix

> 状态：跨项目能力矩阵
> 最后更新：2026-07-15

## 状态说明

| 状态 | 含义 |
|---|---|
| Done | 已实现并有基础验证 |
| Partial | 有骨架或半闭环 |
| Missing | 未实现 |
| External | 依赖其它项目 |
| Blocked | 被明确依赖阻塞 |

## 能力矩阵

| 能力 | DeepInk Desktop | private-serv | chatcc-agent | 当前判断 |
|---|---|---|---|---|
| Remote 产品边界 | Done：文档已固定 DeepInk owner | Partial：需同步为控制面 | Partial：需同步为 runtime | Partial |
| entitlement 模型 | Done：类型、gate、mock、Pro 兼容 | External：需真实下发 | 不判断套餐 | Partial |
| remote_workspace | Done：入口 gate、status gate | External：需 entitlement | 需 agent binding/online | Partial |
| remote_pairing | 文档规划 | External：需 pairing flow | External：需 agent 绑定上报 | Missing |
| remote_file_read | Done：IPC/UI/CCLink provider | 不关心 | Partial：已有 CCLink 文件服务 | Partial |
| remote_file_write | Done：IPC/gate/不可用错误 | External：需 entitlement | Missing：write/create/rename/delete | Blocked |
| remote_terminal | Partial：entitlement adapter、capability masking | External：需 entitlement/token scope | Missing：稳定 remote command/PTY | Blocked |
| remote_agent_session | Partial：send message boundary | External：需 entitlement/token scope | Missing：create/stream/approval/cancel | Blocked |
| capability probe | Done：优先实时 `capability_probe_response`，回退 `server_meta.capabilities` 和旧推导 | 可记录 agent meta | Done：已支持 capability_probe | Partial |
| protocol compatibility | Done：模型、判断、诊断检查、Settings 展示，协议版本对齐 `2` | 可记录 agent protocol | Done：server_meta 已上报 protocol_version | Partial |
| diagnostic report | Done：checks、traceId、recent errors、copy | Missing：后台日志/trace 查询 | Missing：verbose log/trace 查询 | Partial |
| traceId | Partial：DeepInk 本机侧闭环 | Missing：token/pairing/entitlement trace | Missing：protocol log trace | Partial |
| RemoteError | Done：共享错误层级 | Missing：后端失败码对齐 | Missing：agent 错误码对齐 | Partial |
| workspace scope | Done：RemoteWorkspaceRef | Missing：token scope | Missing：path policy/scope enforce | Partial |
| path deny reason | UI/协议可展示 | 不关心 | Missing | Blocked |
| agent version display | Partial：字段存在 | Missing：绑定记录 | Missing：标准上报 | Partial |
| Direct transport | 预留 | 待决策 | 必须复用 runtime | Missing |

## 当前 DeepInk 已落地文件

| 文件 | 作用 |
|---|---|
| `src/shared/remote-protocol.ts` | Remote Provider、Status、Capability、Diagnostics 协议 |
| `src/shared/remote-compatibility.ts` | Remote protocol version 兼容判断 |
| `src/shared/ipc/remote.ts` | renderer/main Remote API 契约 |
| `src/main/ipc/remote-ipc.ts` | Remote IPC、entitlement gate、traceId、diagnostic log |
| `src/main/remote/cclink-remote-provider.ts` | CCLink 首发 RemoteProvider |
| `src/main/remote/remote-provider-registry.ts` | provider registry |
| `src/main/remote/remote-diagnostics.ts` | 诊断报告生成 |
| `src/main/remote/remote-diagnostic-log.ts` | 本机最近错误日志 |
| `src/main/terminal/terminal-entitled-execution-adapter.ts` | Remote Terminal entitlement 包装 |
| `src/renderer/src/components/sidebar/RemoteFileTree.tsx` | 远程文件树 UI |
| `src/renderer/src/components/workbench/RemoteFileViewer.tsx` | 远程文件查看 |
| `src/renderer/src/components/cclink/CclinkPanel.tsx` | Settings 诊断入口 |

## 下一批推荐取一行打穿

优先级：

1. `capability probe`
2. `remote_file_write`
3. `remote_terminal`
4. `remote_agent_session`

不要同时开三行。每次推进一行，更新三个项目状态和验收。

## 拷问

如果某一行在 DeepInk 显示 Done，但 chatcc-agent 还是 Missing，那它不能对用户承诺。

矩阵的价值就是防止“客户端已经做了”被误读成“产品能力已经完成”。
