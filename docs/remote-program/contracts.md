# Historical: Remote Program Contracts

> 当前状态：历史契约草案，不再作为 `cclink-studio` 当前事实源。
>
> 本文引用的 Remote shared contracts、IPC、provider、entitlement gate 和 `private-serv` 边界已经从 Studio OSS 默认路径移出。当前边界见 `../architecture.md` 与 `../cclink-studio-boundary-and-migration.md`。

# Remote Program Contracts

> 状态：跨项目契约草案
> 最后更新：2026-07-15

## 总边界

Remote 的项目边界固定如下：

| 项目 | 负责 | 不负责 |
|---|---|---|
| DeepInk Desktop | Remote 工作台、UI、IPC、RemoteProvider、诊断、权限确认、审计展示、协议 owner、验收 owner | 订单真相、套餐真相、远端真实文件/shell 执行 |
| private-serv | 登录、订阅、entitlement、pairing、agent 绑定、短期 remote token、后台诊断索引 | 远端文件、Terminal、Codex/Claude Code runtime |
| chatcc-agent | capability probe、文件读写、Terminal、Codex/Claude Code bridge、event stream、本机安全策略、远端日志 | 登录、套餐、订单、价格、订阅 UI |
| transport | CCLink / Tencent TIM、未来 Direct / SSH / Gateway | 产品能力定义、runtime 协议定义、商业判断 |

## 核心对象

### RemoteWorkspaceRef

DeepInk 所有远端能力都必须基于工作空间引用：

```ts
interface RemoteWorkspaceRef {
  kind: 'remote'
  transport: 'cclink' | 'direct'
  endpointId: string
  workspaceId: string
  path: string
  label?: string
  endpointName?: string
}
```

规则：

- `endpointId + workspaceId` 是稳定标识。
- `path` 是显示和执行路径，不是唯一 key。
- UI 不允许把远端文件伪装成本地 `filePath`。
- Direct 未来也必须复用这个引用模型。

### Entitlement

Entitlement 是商业边界，由 private-serv 下发，DeepInk 执行 gate。

```ts
type RemoteEntitlement =
  | 'remote_workspace'
  | 'remote_pairing'
  | 'remote_file_read'
  | 'remote_file_write'
  | 'remote_terminal'
  | 'remote_agent_session'
  | 'remote_audit'
```

规则：

- 套餐名不进入 Remote 业务代码。
- agent 不判断套餐。
- DeepInk dev 可以 mock entitlement，但打包/staging 必须来自 private-serv。

### Capability

Capability 是远端真实能力，由 chatcc-agent 上报，DeepInk 只消费。

```ts
interface RemoteCapabilitySet {
  file: {
    tree: boolean
    read: boolean
    write: boolean
    create: boolean
    rename: boolean
    delete: boolean
    search: boolean
    watch: boolean
  }
  shell: {
    command: boolean
    pty: boolean
    cwd: boolean
  }
  agent: {
    codex: boolean
    claudeCode: boolean
    deepinkAgent: boolean
    custom: boolean
  }
  session: {
    list: boolean
    resume: boolean
    stream: boolean
    archive: boolean
  }
}
```

规则：

- Entitlement 允许，不代表 capability 可用。
- Capability 可用，不代表用户有 entitlement。
- UI 必须同时解释这两层失败。

## 协议版本

chatcc-agent 必须上报：

```ts
interface RemoteAgentMeta {
  agentVersion: string
  protocolVersion: string
  platform: string
  hostname: string
  lastSeen: number
}
```

DeepInk 必须维护：

```ts
interface RemoteProtocolCompatibility {
  minSupported: string
  currentExpected: string
  agentReported?: string
  status: 'compatible' | 'upgrade-required' | 'unknown'
  message: string
}
```

规则：

- 协议过旧时，DeepInk 必须阻止危险写操作和 Terminal/Agent session。
- 只读能力可以按兼容范围降级，但必须显示降级原因。
- 升级提示必须明确到 agent 版本或 protocol version。

## TraceId

所有跨项目请求必须带 traceId。

```text
DeepInk IPC traceId
  -> private-serv token / entitlement / pairing log
  -> chatcc-agent protocol log
  -> DeepInk diagnostic report
```

规则：

- traceId 可以出现在诊断报告里。
- token、IM userSig、短信验证码、API key、文件内容、消息正文不能出现在诊断报告里。
- agent 和 private-serv 日志中必须能按 traceId 搜索。

## Error Layer

Remote 错误必须落入这些层：

| layer | 含义 |
|---|---|
| account | 登录、订阅、entitlement、token |
| transport | CCLink / Direct / 网络传输 |
| remote-agent | agent 离线、版本不兼容、runtime 崩溃 |
| workspace | workspace 不存在、path 不允许、scope 不匹配 |
| file-provider | 文件树、读取、写入、删除等 |
| execution-backend | Terminal、Codex、Claude Code、Agent session |
| unknown | 未归类错误 |

## 拷问

如果某项能力不能同时回答下面三个问题，就不能算闭环：

1. 用户有没有权调用？
2. 远端当前能不能执行？
3. 失败时去哪一层查？
