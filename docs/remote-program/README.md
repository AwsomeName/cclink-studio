# Historical: DeepInk Remote Program

> 当前状态：历史项目空间，不再作为 CCLink Studio OSS 架构事实源。
>
> 这份文档记录的是旧 DeepInk Remote / private-serv / chatcc-agent 三项目协作假设。当前决策已经调整为：CCLink Studio 是开源桌面壳；商业 overlay 在 `/Users/apple/Desktop/cclink-dev`；CCLink 云函数在 `/Users/apple/Desktop/chat-cc/deploy`；CCLink Agent runtime 在 `/Users/apple/Desktop/chat-cc/Agent`；`private-serv` 废弃。
>
> 不存在独立的 `cclink-cloud` 或 `cclink-agent` 项目。本文下方内容仅供迁移审计和历史追溯，不能作为新实现依据。

# DeepInk Remote Program

> 状态：总控项目空间
> Owner：DeepInk 主项目
> 最后更新：2026-07-15

## 结论

DeepInk Remote 是一个跨项目产品能力，不是单仓库功能。

三个项目的组织方式固定为：

```text
DeepInk Desktop
  = Remote 产品主项目、工作台、协议 owner、验收 owner

private-serv
  = 账号、订阅、entitlement、pairing、token、审计控制面

chatcc-agent
  = 唯一远端 runtime，负责远端文件、Terminal、Agent Session、runtime probe
```

CCLink 是首发 transport。Direct 是后续 transport。两者不能分裂成两套远端 runtime 协议。

## 为什么需要这个目录

Remote 不是一个普通功能点。它跨客户端、服务端、远端 agent、TIM/transport、付费权限、诊断日志和真实用户服务器。

如果只在各项目里散点开发，会出现几个问题：

- DeepInk 已经有按钮，但 agent 协议没闭环。
- agent 已经有能力，但 private-serv 没有 entitlement/token。
- private-serv 已经能授权，但 DeepInk UI 不知道 capability。
- 出错时三边都说“我这里正常”，但没有 traceId 和协议版本能对上。

所以 DeepInk 仓库需要保留一份总控项目空间，作为 Remote 的产品真相、协议真相和验收真相。

## 文档索引

| 文档 | 用途 |
|---|---|
| [contracts.md](./contracts.md) | 三项目边界、协议契约、版本规则 |
| [milestones.md](./milestones.md) | 跨项目里程碑和验收顺序 |
| [integration-matrix.md](./integration-matrix.md) | 每项能力在 DeepInk / private-serv / chatcc-agent 的状态 |
| [debug-playbook.md](./debug-playbook.md) | 联调、诊断、失败排查流程 |
| [agent-requirements.md](./agent-requirements.md) | 复制给 chatcc-agent 项目的需求 |
| [private-serv-requirements.md](./private-serv-requirements.md) | 复制给 private-serv 项目的需求 |

## 项目规则

1. DeepInk 是 Remote Program owner。
2. 所有 Remote 能力先进入 `RemoteProvider` / `RemoteProtocol`，再接 UI。
3. chatcc-agent 是唯一 runtime，不为 Direct 另起第二套 agent。
4. private-serv 是商业和授权真相源，agent 不判断套餐。
5. Capability 必须来自远端真实探测，不能由 UI 猜。
6. Entitlement 控制入口和付费边界，Capability 控制远端真实可用性。
7. 任一失败必须能归因到 account、transport、remote-agent、workspace、file-provider、execution-backend 或 unknown。
8. 所有跨项目联调必须带 traceId。

## 当前阶段

DeepInk 侧已完成：

- Remote 付费 entitlement 模型。
- `RemoteProvider` / `RemoteStatus` / `RemoteCapabilitySet` / `RemoteDiagnosticReport` 协议骨架。
- CCLink 首发 provider。
- Remote IPC 和 preload。
- 远程文件树和文件查看入口。
- Settings > 远程连接 workspace 诊断入口。
- 诊断报告复制、traceId、本机最近错误记录。

仍未完成：

- chatcc-agent 新 capability probe。
- 远程文件写入协议。
- 远程 PTY。
- 远程 Codex / Claude Code session stream。
- approval / cancel / file change event。
- private-serv 真实 entitlement、pairing、remote token、后台诊断。
- traceId 跨 DeepInk、private-serv、chatcc-agent 贯穿。

## 拷问

现在最危险的不是“还没做 Direct”，而是 CCLink Remote 还没完全闭环。

Direct 必须等 CCLink 跑通同一套 runtime 协议后再做。否则会产生两套 agent、两套错误模型、两套诊断链路，后面很难收拾。
