# Historical: 远程 Codex 工作空间方案计划

> 当前状态：历史商业/远程能力方案，不属于 CCLink Studio OSS 当前事实源。
>
> 本文仍保留 DeepInk Remote、private-serv、chatcc-agent、付费 Remote、entitlement gate 等旧表述。当前开源 Studio 默认不包含远程工作区、CCLink/TIM transport、商业 feature gate 或远程 provider。后续若恢复官方远程能力，应在 `/Users/apple/Desktop/cclink-dev`、`/Users/apple/Desktop/chat-cc/deploy` 和 `/Users/apple/Desktop/chat-cc/Agent` 分别维护。

# 远程 Codex 工作空间方案计划

> 状态：方案设计
> 最后更新：2026-07-14
> 关联文档：`docs/remote-program/README.md`、`docs/features/project-system.md`、`docs/features/cclink-integration.md`、`docs/features/terminal-tab-model.md`、`docs/features/multi-endpoint-agent-system.md`、`docs/features/remote-error-model.md`

## 结论

DeepInk 的远程工作空间应按“远程 Codex / 远程 Claude Code 工作空间”来设计。

本文件是 Remote 产品详细方案；跨项目总控、协议契约、能力矩阵和联调手册见 `docs/remote-program/`。

它不是把 DeepInk 做成 IDE，也不是新增一个服务器管理台，而是把 VSCode Remote 的主要能力边界迁移到 DeepInk 的工作空间模型里：

```text
本地 DeepInk 桌面工作台
  -> 连接远端机器
  -> 打开远端目录为工作空间
  -> 浏览 / 编辑远端文件
  -> 在远端运行 Terminal
  -> 在远端运行 Codex / Claude Code / DeepInk Agent
  -> 把会话、文件、命令、审计和任务状态归入同一个远程工作空间
```

如果远端已经安装 Codex 或 Claude Code，DeepInk 应优先把它当成远端执行后端使用。DeepInk 负责连接、上下文组织、可视化、权限确认、审计和结果检查；远端负责真实文件系统、shell、Agent CLI、凭证和运行环境。

从商业和项目边界上，Remote 必须按下面这句话落地：

```text
DeepInk 主项目开发 Remote 工作台，private-serv 控制账号和 entitlement，chatcc-agent 作为唯一远端 runtime，CCLink 是首发 transport，Direct 是后续 transport，不改变 Remote 作为付费产品能力的定位。
```

这意味着 DeepInk Remote 是 DeepInk 的付费工作空间能力，不是一个单独出售的 CCLink 产品，也不是免费基础设施。CCLink 只是首发连接通道，chatcc-agent 是远端能力 runtime，private-serv 是账号、订阅、授权和 pairing 的真相源。

## 产品定位

一句话：

```text
远程 Codex 工作空间 = 在 DeepInk 里打开的一台远端机器上的 AI 工作现场。
```

用户看到的是“工作空间”，不是“服务器”。服务器、SSH、CCLink、VPN、Gateway 都只是连接方式。

DeepInk 对齐 VSCode Remote 的能力边界，但不复刻 VSCode 的产品重心：

| 维度 | VSCode Remote | DeepInk Remote |
|---|---|---|
| 产品中心 | 代码编辑器 | AI 工作入口 |
| 主对象 | 远程文件夹 / workspace | 远程工作空间 |
| 主要操作者 | 用户写代码 | 用户 + Agent 协作完成任务 |
| 执行环境 | 远端 shell / extension host | 远端 shell / Codex / Claude Code / MCP |
| UI 现场 | 编辑器、Terminal、端口预览 | 会话、文件、Terminal、浏览器、文档、任务状态 |
| 权限重点 | 远端主机信任 | Agent 操作确认、命令审计、文件写入审计 |

## 商业与项目边界

Remote 按功能付费时，项目职责必须切开：

| 项目 | 职责 | 不承担 |
|---|---|---|
| DeepInk Desktop | Remote 工作台、登录 UI、订阅 UI、Remote Provider、文件 / Terminal / Agent Tab、IPC、Feature Gate、错误展示 | 订单真相、套餐真相、TIM 密钥签发、远端文件真实执行 |
| private-serv | 账号、登录、订阅、entitlement、agent 绑定、pairing 授权、短期 remote token、TIM userSig / relay token、审计索引 | 远端 shell、远端文件操作、Codex / Claude Code runtime |
| chatcc-agent / deepink-remote-agent | 能力探测、文件服务、Terminal、Codex / Claude Code bridge、事件流、本机安全策略、token 验证 | 收费逻辑、套餐判断、订单状态、用户登录 UI |
| Transport | CCLink / Tencent TIM、未来 Direct / SSH / Gateway | 产品定价、workspace UI、远端 runtime 业务逻辑 |

登录逻辑和订阅逻辑不进入 agent。agent 只接受 private-serv 签发的短期 token，并按 token scope 和本机安全策略决定本次请求是否可执行。

Remote 的收费对象不是 `cclink`，而是 entitlement：

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

DeepInk 桌面端通过 entitlement 判断入口和能力可用性。套餐名只存在于后端和订阅 UI，不能散落到 Remote 业务代码里。

### 跨项目开发调试需求

下面两段文字可复制到对应项目，用于同步边界和开发任务。

**给 private-serv 项目：**

```text
DeepInk Remote 是 DeepInk 的付费工作空间能力。private-serv 需要作为账号、订阅、entitlement、agent 绑定和 pairing 授权的真相源，不承担远端文件、shell、Codex 或 Claude Code 的实际执行。

请为 DeepInk Desktop 和 chatcc-agent 提供开发/调试可用的 Remote 授权接口：查询当前用户 entitlements；判断 remote_workspace、remote_pairing、remote_file_write、remote_terminal、remote_agent_session 等能力是否可用；创建和管理远端 agent 绑定；发起 pairing；下发 Tencent TIM userSig / relay token 或未来 direct token；签发短期 remote session token，token 中应包含 userId、agentId、workspace scope、capability scope、expiresAt 和 request trace id。

调试环境需要支持本地 DeepInk 指向 dev/staging API，支持测试用户快速开通/取消 Remote entitlement，支持查看 agent 绑定和 pairing 状态，支持 token 签发日志、entitlement 命中日志、失败原因码，并提供不依赖真实支付的测试套餐/测试订单。所有商业判断留在 private-serv，chatcc-agent 不判断套餐、不知道价格、不处理订单。
```

**给 chatcc-agent / deepink-remote-agent 项目：**

```text
DeepInk Remote 会把 chatcc-agent 作为唯一远端 runtime 使用。agent 不实现登录、订阅、订单或套餐判断，只验证 private-serv 签发的短期 remote session token，并按 token scope、本机 path 安全策略和 capability 决定是否执行请求。

请把现有能力整理成 DeepInk Remote 可消费的协议面：server_meta / capability probe；文件树分页、文件读取、文件写入、创建、重命名、删除、搜索；Terminal 单命令和可选 PTY；Claude Code / Codex runtime 探测与会话事件流；统一错误码；统一 trace id；协议版本上报。事件流至少覆盖 text、thinking、tool_use、tool_result、command_started、command_completed、file_change_started、file_change_completed、approval_request、error。

调试环境需要支持本机启动 agent 并连接 DeepInk dev/staging；支持 mock private-serv token 或读取 dev token；支持 verbose protocol log；支持打印 capability、workspace root、path deny reason、runtime probe 结果、terminal 输出和 agent event stream；支持协议兼容检查，方便 DeepInk Desktop、private-serv 和 agent 三方联调。不要另起第二套 Direct agent，Direct 未来只应是 transport/provider 差异，复用同一 remote runtime 能力协议。
```

## 核心术语

| 术语 | 含义 |
|---|---|
| 远程工作空间 | 远端机器上的一个目录，作为 DeepInk 工作空间打开 |
| 连接通道 | DeepInk 如何连上远端，包括 `direct`、`cclink`、未来 Gateway |
| 远端执行后端 | 远端实际执行任务的能力，如 Codex、Claude Code、DeepInk Agent、自定义后端 |
| Remote Provider | 对远端能力的统一抽象，包括文件、shell、Agent、会话、权限、错误 |
| Capability | 远端当前真实可用能力，如 `file.read`、`file.write`、`shell.exec`、`agent.codex` |
| 远端会话 | 归属于远程工作空间的 Agent 工作线程，可恢复、可审计 |

## 功能边界

### 必须承诺

第一轮产品边界必须承认这些能力最终要成立：

1. **添加远程工作空间**
   - 从“添加工作空间”进入。
   - 支持 CCLink，预留直连 Remote。
   - 本地和远程工作空间平铺展示，用 badge 区分来源。

2. **打开远端目录**
   - 远端目录是工作空间根。
   - 激活后恢复该工作空间自己的 Tab、会话、文件树和任务状态。
   - `workspaceKey` 必须由 transport、endpoint、workspace 生成，不能依赖显示名。

3. **远端文件**
   - 浏览文件树。
   - 打开远端文件。
   - 逐步支持写入、保存、创建、重命名、删除。
   - 写操作需要 capability、权限和错误分层。

4. **远端 Terminal**
   - Terminal 是当前工作空间里的 Tab。
   - 远程工作空间打开的是远端 shell。
   - 远程命令默认更严格确认，必须写审计。
   - 第一版可从单命令执行演进到完整 PTY。

5. **远端 Agent**
   - 如果远端安装 Codex，则可作为 `codex` 后端。
   - 如果远端安装 Claude Code，则可作为 `claude-code` 后端。
   - 如果远端有 `chatcc-agent` 或未来 `deepink-agent`，则可作为 `deepink-agent/custom` 后端。
   - Agent 会话归属于远程工作空间，不是全局聊天。

6. **能力探测**
   - 连接后必须探测远端支持什么。
   - UI 只展示真实可用能力，或者展示明确不可用原因。
   - 不能把“远端没装 Codex”伪装成“执行失败”。

7. **权限与审计**
   - 远端读文件、写文件、执行命令、删除、安装、发布都要有权限等级。
   - Agent 发起的写入和命令不能继承用户手动操作的宽权限。
   - 会话、命令、文件变更和错误必须可追溯。

### 暂缓但预留

以下能力先不纳入当前方案第一阶段，但接口上不能堵死：

- 端口转发 / 服务预览。
- 远程文件监听和实时同步。
- 双向云同步。
- 多人协作编辑。
- 远端环境自动安装和修复。
- 长期后台任务托管。
- 服务器资源监控面板。

端口转发尤其应暂缓。它是远程开发和服务调试的后续能力，不是定义远程 Codex 工作空间的第一步。

## 用户体验

### 添加入口

```text
添加工作空间
├─ 打开本地文件夹
├─ 添加远程工作空间
│  ├─ 通过 CCLink
│  └─ 直连服务器
└─ 新建临时草稿
```

添加远程工作空间的过程：

1. 选择连接方式。
2. 选择或配置远端机器。
3. 选择远端目录。
4. DeepInk 探测 capabilities。
5. 选择默认执行后端：Codex / Claude Code / DeepInk Agent / 仅文件和 Terminal。
6. 添加成功后回到工作空间列表，不停留在连接管理页。

### 工作空间列表

```text
工作空间
├─ [本地] DeepInk
├─ [远程 · CCLink] Mac mini /Users/apple/project-a
└─ [远程 · 直连] GPU Server /data/research

未归档
```

远端机器不作为一级分组。用户选择的是工作空间，不是服务器资产。

### 激活远程工作空间后

左侧：

```text
[远程 · CCLink] Mac mini
/Users/apple/project-a

文件
  README.md
  src/
  docs/

会话
  修复登录问题
  生成发布文案

运行环境
  Codex 可用
  Claude Code 未安装
  Terminal 可用
```

中间：

- 远程文件 Tab。
- 远程 Terminal Tab。
- 远程会话 Tab。
- 文档、浏览器等当前工作现场。

右侧 Agent：

- 默认围绕当前远程工作空间协作。
- 输入区显示当前执行后端和权限模式，例如 `远程 · Codex · ask-risky-command`。
- 高风险操作以确认卡片呈现。

## 能力模型

远程工作空间不应该靠一组散乱 IPC 支撑。需要统一 provider：

```ts
interface RemoteWorkspaceProvider {
  transport: 'direct' | 'cclink'
  getStatus(ref: RemoteWorkspaceRef): Promise<RemoteStatus>
  getCapabilities(ref: RemoteWorkspaceRef): Promise<RemoteCapabilities>
  files?: RemoteFileProvider
  shell?: RemoteShellProvider
  agents?: RemoteAgentProvider
  sessions?: RemoteSessionProvider
}
```

### Capability

```ts
interface RemoteCapabilities {
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

### 远端执行后端

```ts
type RemoteAgentBackend =
  | { kind: 'codex'; command: 'codex'; version?: string }
  | { kind: 'claude-code'; command: 'claude'; version?: string }
  | { kind: 'deepink-agent'; protocol: 'chatcc' | 'direct' }
  | { kind: 'custom'; command: string; protocol: 'stdio' | 'http' | 'sse' }
```

探测顺序建议：

1. 远端 Agent 主动上报 capabilities。
2. shell 可用时，探测 `codex --version`、`claude --version`。
3. 读取远端工作空间约定配置，例如 `.deepink/remote.json`。
4. 所有探测失败都回落为“能力不可用”，不能阻断文件浏览。

## DeepInk 主项目里程碑计划

这组里程碑只约束 DeepInk Desktop 本身。private-serv 和 chatcc-agent 的配合需求放在后面的“跨项目需求包”中。

### M0：Remote 产品边界与命名收口

目标：把 Remote 从“CCLink 功能”收口为 DeepInk 的付费工作空间能力。

DeepInk 怎么干：

- 文档和 UI 统一使用“远程工作空间 / Remote Workspace”。
- `WorkspaceRef` 继续作为本地、远程、全局工作现场的统一引用。
- `cclink` 只作为 `transport`，不作为用户侧主对象。
- Product Milestones、Project System、Remote Plan 三份文档互相引用，不新增“远程项目”“远程 Agent 面板”等并行概念。

验收：

- 工作空间列表中本地和远程平铺展示，远程用 `[远程 · CCLink]` badge。
- Settings 中是“远程连接”，不是“CCLink 控制台”。
- 代码新增类型时能回答：这是 workspace、transport、provider、backend、session 中的哪一类。

跨项目依赖：

- 无硬依赖。
- private-serv 和 chatcc-agent 只需要接受命名边界：DeepInk Remote 是产品名，CCLink 是 transport。

### M1：Entitlement 与付费门控骨架

目标：DeepInk 不再只用 `tier === pro` 判断功能，而是用 entitlement 判断 Remote 能力。

DeepInk 怎么干：

- 在 `src/shared/ipc/subscription.ts` 增加 entitlement 类型和订阅状态字段。
- 将 `src/main/subscription/feature-gate.ts` 升级为 entitlement gate，保留旧 Pro gate 兼容。
- Remote 入口、添加远程工作空间、pairing、远程文件写入、远程 Terminal、远程 Agent session 都通过 entitlement gate。
- Renderer 增加统一升级/登录提示，不在各组件里散落套餐判断。
- 开发环境允许 mock entitlement，避免本地开发被支付链路阻塞。

验收：

- 未登录用户能看到 Remote 入口，但执行云连接和 pairing 时提示登录。
- 登录但无 Remote entitlement 的用户看到升级提示，不能进入 pairing 或远程执行。
- dev 环境可通过 mock 打开 / 关闭 `remote_workspace`、`remote_terminal`、`remote_agent_session`。
- 业务代码中不出现“如果 planCode 是某套餐则允许远程”的判断。

跨项目依赖：

- private-serv 需要提供 entitlement 查询和测试用户开关。
- chatcc-agent 暂无硬依赖。

### M2：RemoteProvider 主进程骨架

目标：让 DeepInk 上层只依赖 RemoteProvider，不直接依赖 `cclink:*` IPC。

DeepInk 怎么干：

- 新增 `src/shared/remote-protocol.ts` 定义 `RemoteStatus`、`RemoteCapabilities`、`RemoteError`、文件、Terminal、Agent 事件类型。
- 新增 `src/shared/ipc/remote.ts` 定义 renderer 可调用的统一 remote IPC。
- 新增 `src/main/remote/`，包含 provider registry、`CclinkRemoteProvider`、capability mapper、错误 mapper。
- 现有 `src/main/cclink/*` 保留为 transport/service 层，由 `CclinkRemoteProvider` 包装。
- Renderer 的远程文件树、远程会话、远程状态逐步改调 `window.deepink.remote.*`。

验收：

- Renderer 打开远程文件树时不再直接调用 `window.deepink.cclink.listFileTree`。
- 添加第二个 provider stub 时，不需要改文件树和工作空间 store 的核心逻辑。
- CCLink 离线、未配对、协议不兼容、远端拒绝能映射到统一 `RemoteError`。
- 单元测试覆盖 provider registry、capability mapper、错误 mapper。

跨项目依赖：

- chatcc-agent 需要稳定 `server_meta` / capability 响应字段。
- private-serv 只需要保证当前 CCLink 登录/pairing 状态可查询。

### M3：远程工作空间状态与能力面板

目标：远程工作空间激活后，用户明确知道“这台远端当前能做什么、不能做什么、为什么”。

DeepInk 怎么干：

- Workspace Sidebar 显示当前 remote transport、机器名、路径、在线状态。
- 显示 capabilities：文件可读/可写、Terminal 可用、Codex 可用、Claude Code 可用、Agent session 可恢复。
- Status Bar 增加远程状态摘要和错误入口。
- Settings > 远程连接显示已绑定 agent、协议版本、最近心跳、诊断入口。
- capability 缺失时禁用对应按钮，并显示具体原因。

验收：

- 远端在线但没装 Codex 时，UI 显示“Codex 未安装”，不是“执行失败”。
- 远端离线时，文件树、Terminal、Agent 入口都显示同一个离线原因。
- 协议版本不兼容时，UI 能提示需要升级 agent。
- 手动刷新能力后，UI 状态能更新，不需要重启 DeepInk。

跨项目依赖：

- chatcc-agent 需要上报协议版本、agent 版本、runtime probe、file/terminal/session capability。
- private-serv 需要提供 agent 绑定状态和 pairing 状态。

### M4：远程文件读写闭环

目标：远程工作空间不只是文件浏览器，能安全打开、编辑、保存远端文件。

DeepInk 怎么干：

- 抽象 `WorkspaceFileProvider`，本地和远程文件访问都通过 workspace ref。
- 远程文件 Tab 使用 `workspaceRef + remotePath`，不伪装成本地 `filePath`。
- Remote 文件读取支持大文件限制、二进制识别、编码错误和 line window。
- 保存、创建、重命名、删除进入权限确认和审计。
- 不支持写入的 provider 显示只读状态，不显示保存按钮。

验收：

- 用户能打开远程 Markdown / TS 文件，修改并保存回远端。
- 远端只读时，编辑器明确只读，不能产生“保存成功”的假象。
- 保存失败时能区分 entitlement、transport、agent、path deny、protocol、unknown。
- 删除和覆盖必须确认，并留下审计记录。

跨项目依赖：

- chatcc-agent 需要实现 `file_write`、`file_create`、`file_rename`、`file_delete`，并补 path deny reason。
- private-serv 需要支持 `remote_file_write` entitlement。

### M5：远程 Terminal 闭环

目标：Terminal Tab 在远程工作空间里真实执行远端命令，并带权限、审计和错误归因。

DeepInk 怎么干：

- Terminal runtime 使用 `workspaceRef` 路由到 local shell 或 RemoteProvider shell。
- CCLink 单命令执行进入统一 Remote Terminal adapter。
- 命令确认区分 user / agent actor，Agent 发起命令更严格。
- 输出流、退出码、错误、cwd、命令风险等级进入 Terminal state 和审计。
- 第一版允许单命令，PTY 作为 capability 增量。

验收：

- 在远程 Terminal Tab 执行 `pwd` 显示远端 workspace root。
- `ls`、`cat`、`git status` 可执行并返回远端输出。
- 破坏性命令必须确认；拒绝后远端不执行。
- 远端离线、超时、无 terminal capability 时错误可定位。

跨项目依赖：

- chatcc-agent 需要稳定 terminal command 协议、输出流、退出码、取消命令、可选 PTY。
- private-serv 需要支持 `remote_terminal` entitlement。

### M6：远程 Agent Session

目标：DeepInk 可以在远程工作空间中启动或连接远端 Codex / Claude Code 会话。

DeepInk 怎么干：

- Agent backend selection 支持 remote workspace scope。
- RemoteProvider 暴露 `createAgentSession`、`sendAgentMessage`、`subscribeEvents`、`cancelSession`。
- 右侧 Agent Panel 显示当前运行位置、backend、权限模式和 workspace。
- 远程事件流映射到现有 conversation model：text、thinking、tool、command、file change、approval、error。
- 远端 Agent 会话归属于当前 remote workspace，可恢复、可归档。

验收：

- 用户在远程工作空间里让 Codex / Claude Code 读取项目文件，事件流显示在 DeepInk。
- 远端命令确认卡片能在 DeepInk 中批准或拒绝。
- 文件变更事件能关联到远程文件路径，并可打开查看。
- 远端没装 Codex / Claude Code 时，DeepInk 不静默降级成本地 backend。

跨项目依赖：

- chatcc-agent 需要稳定 Claude Code / Codex runtime probe、session create、event stream、approval request、cancel。
- private-serv 需要支持 `remote_agent_session` entitlement 和 remote session token。

### M7：发布、诊断与兼容性

目标：把 Remote 从“能跑”推进到“能支持真实用户和真实服务器”。

DeepInk 怎么干：

- Settings > 远程连接增加诊断报告：登录、entitlement、pairing、agent 在线、协议版本、capability、最近错误。
- 增加协议兼容检查和升级提示。
- 增加 Remote 日志导出，包含 trace id、workspace key、provider、error code，不含敏感 token。
- 增加用户可理解的失败恢复动作：重新登录、重新 pairing、刷新能力、升级 agent、查看远端日志。
- 为 remote provider、file、terminal、agent session 补核心自动化测试。

验收：

- 任一 Remote 失败都能在 UI 找到“失败在哪一层”。
- 用户可以复制诊断报告给开发者，不泄露 token。
- agent 协议过旧时，DeepInk 阻止危险操作并提示升级。
- 打包版和 dev 版都能连接 staging Remote。

跨项目依赖：

- private-serv 需要可查 token 签发、entitlement 命中、pairing 状态和失败码。
- chatcc-agent 需要 verbose log、protocol version、diagnostic command、runtime probe 输出。

### M8：Direct Remote 预留与落地

目标：在 CCLink Remote 闭环稳定后，用同一 RemoteProvider 模型接入 Direct，不重写产品。

DeepInk 怎么干：

- 新增 `DirectRemoteProvider`，复用 M2-M7 的 protocol、capability、file、terminal、agent、session 类型。
- Settings > 远程连接增加直连服务器配置、连接测试、凭证管理和清理。
- 第一版 Direct 可选择 SSH bootstrap 或远端 agent 地址，但不能另起第二套 runtime 协议。
- Direct 和 CCLink 在工作空间列表、文件树、Terminal、Agent Panel 中表现一致，只显示 transport badge 不同。

验收：

- 同一个 DeepInk 里可同时存在 `[远程 · CCLink]` 和 `[远程 · 直连]`。
- 上层 UI 不关心 transport 差异。
- Direct 失败和 CCLink 失败进入同一 RemoteError 模型。
- Direct 不影响 CCLink Remote 的付费定位。

跨项目依赖：

- private-serv 需要决定 Direct 是否仍签发 remote token、如何授权设备和 workspace scope。
- chatcc-agent 需要保证 Direct 复用同一 remote runtime 能力协议。

## 跨项目需求包

### 提交给 private-serv

```text
DeepInk Remote 需要 private-serv 提供账号、订阅、entitlement、agent 绑定、pairing 授权和短期 remote token。DeepInk Desktop 不在本地判断套餐，chatcc-agent 不处理订单或价格。

里程碑需求：
M1：提供当前用户 entitlement 查询接口，至少包含 remote_workspace、remote_pairing、remote_file_write、remote_terminal、remote_agent_session；支持 dev/staging 测试用户手动开关 entitlement；返回稳定拒绝原因码。
M2-M3：提供 agent 绑定和 pairing 状态查询；提供 Tencent TIM userSig / relay token 或现有 CCLink 授权材料；返回 agentId、deviceName、lastSeenAt、protocolVersion、pairingStatus。
M4：支持 remote_file_write entitlement，并能在 token scope 中表达 workspace/path/capability 限制。
M5：支持 remote_terminal entitlement，并在 token scope 中区分 terminal command/pty 能力。
M6：支持 remote_agent_session entitlement；签发短期 remote session token，包含 userId、agentId、workspace scope、capability scope、expiresAt、traceId。
M7：提供调试后台或接口，能查看 entitlement 命中、token 签发、pairing 状态、agent 绑定、失败原因码和 traceId；提供不依赖真实支付的测试套餐/测试订单。
M8：评估 Direct Remote 的授权方式，决定 direct token、设备绑定、workspace scope 和审计索引是否继续复用 Remote entitlement 模型。

验收口径：
DeepInk dev/staging 可以用测试账号完整走通登录、开通 Remote entitlement、pairing、获取 remote token、查看失败原因；chatcc-agent 只验证 token scope，不知道套餐、价格和订单。
```

### 提交给 chatcc-agent / deepink-remote-agent

```text
DeepInk Remote 会把 chatcc-agent 作为唯一远端 runtime。agent 不实现登录、订阅、订单或套餐判断，只验证 private-serv 签发的短期 remote token，并按 token scope、本机 path 安全策略和 capability 决定是否执行请求。

里程碑需求：
M2：稳定 server_meta / capability probe，返回 agentVersion、protocolVersion、host、workspace roots、file/terminal/agent/session capability；所有响应带 traceId。
M3：补 runtime probe，至少报告 codex、claude、terminal、file provider 是否可用，以及不可用原因；协议不兼容时返回明确错误码。
M4：补齐文件写能力：file_write、file_create、file_rename、file_delete、file_search；保留分页 file_tree、line-window file_read；所有 path deny 返回结构化 reason。
M5：稳定 terminal 协议：command start/output/exit/error/cancel；输出流可关联 commandId；可选 PTY 通过 capability 标识，不强制首发。
M6：稳定 Claude Code / Codex session 协议：session create/resume/cancel，事件流覆盖 text、thinking、tool_use、tool_result、command_started、command_completed、file_change_started、file_change_completed、approval_request、error。
M7：提供 verbose protocol log、diagnostic command、protocol compatibility check、runtime probe log、path deny log；日志包含 traceId，但不打印敏感 token。
M8：Direct Remote 不另起第二套 agent，不复制 runtime 逻辑；transport 可以不同，能力协议必须复用。

验收口径：
DeepInk Desktop 可以在 dev/staging 下连接本机或远端 chatcc-agent，完成 capability 展示、远程文件读写、远程 Terminal、远程 Codex/Claude Code 会话；失败时 DeepInk 能根据 agent 返回的 code/reason 定位到 path、runtime、protocol、permission 或 transport 层。
```

## 安全与权限

远程 Codex 工作空间默认比本地更保守。

| 操作 | 默认策略 |
|---|---|
| 读取文件树 | 自动 |
| 打开文件 | 自动 |
| 保存文件 | 用户或 Agent 首次确认；后续按工作空间信任策略 |
| 删除 / 覆盖文件 | 必须确认 |
| 运行读命令 | 可自动或轻确认 |
| 安装依赖 / 写配置 | 必须确认 |
| sudo / 提权 / 系统服务 | 必须确认，必要时拒绝 |
| Agent 执行命令 | 不继承用户手动 Terminal 的宽权限 |
| 切换执行后端 | 必须明确显示运行位置和 backend |

信任模型不要做成一个全局开关。至少要包含：

- workspace trust。
- endpoint trust。
- backend trust。
- actor：user / agent / system。
- risk：read / write / network / destructive / privileged / unknown。

## 暂不做

- 不做端口转发 / 服务预览。
- 不做远程服务器资源监控面板。
- 不做完整 IDE 能力。
- 不做自动安装 Codex / Claude Code 的强流程。
- 不做把远端目录同步成本地副本。
- 不做单独“远程 Agent Activity Bar”。
- 不把 Codex、Claude Code 做成工作空间类型。

## Grilling

1. 如果远程工作空间不能执行远端命令，它只是远程文件浏览器，不是远程 Codex。
2. 如果远端 Codex / Claude Code 不是真正在远端目录运行，产品文案就会误导用户。
3. 如果没有 capability 探测，UI 会撒谎：用户分不清是没装后端、远端离线、协议不支持还是权限被拒。
4. 如果先做端口转发，会过早进入远程开发细节，当前最该先闭环文件、Terminal、Agent 会话。
5. 如果 CCLink provider 和 Direct provider 不共用上层模型，未来会出现两套远程产品。
6. 如果写文件没有审计和确认，Agent 在服务器上误写的风险会比本地更大。
7. 如果把服务器作为一级对象，用户会进入运维台心智；DeepInk 的一级对象必须仍然是工作空间。
8. 如果把 Codex、Claude Code、DeepInk Agent 当成工作空间类型，后续 backend 切换会变成迁移问题；它们只能是执行后端。

## 实现方案入口

实现上应把 M1-M3 作为第一个可验证切面：先有 entitlement gate，再有 RemoteProvider 骨架，最后把远程状态和 capability 显示出来。

原因：

- M1 先固定商业边界，避免 Remote 代码继续散落 `tier === pro` 或套餐名判断。
- M2 先固定 provider 边界，避免 UI 继续直接依赖 `cclink:*` IPC。
- M3 先固定 capability 边界，避免 UI 展示不存在的文件、Terminal、Agent 能力。
- 它能把现有远程列表、远程文件、远程会话、远程 Terminal 串到一个真实边界上。
- 它能避免 UI 展示不存在的能力。
- 它是远程 Codex / Claude Code 后端接入前必须有的地基。
- 它不会被端口转发、直连协议、完整 PTY 这些后续复杂点拖住。

## 2026-07-14 M1-M3 第一批实现记录

本批推进先落 DeepInk 主项目内的边界骨架，不等待 private-serv 和 chatcc-agent 完成新协议。

已完成：

- M1：`UserSubscription` 增加 `entitlements`，新增 `Entitlement` / `EntitlementGrant` 类型。
- M1：新增 `checkEntitlement` / `hasEntitlement`，旧 Pro 订阅兼容推导 Remote 能力。
- M1：开发环境支持 `DEEPINK_MOCK_ENTITLEMENTS`，可模拟关闭某个 entitlement。
- M2：新增 `src/shared/remote-protocol.ts` 和 `src/shared/ipc/remote.ts`。
- M2：新增 `src/main/remote/RemoteProviderRegistry` 和 `CclinkRemoteProvider`。
- M2：新增 `remote:getStatus`、`remote:listFileTree`、`remote:readFile` IPC，并挂到 preload。
- M2：远程文件树和远程文件预览改走 `window.deepink.remote.*`，不再直接调用 `window.deepink.cclink.*` 文件接口。
- M3：远程文件树显示在线状态、文件能力、Terminal 能力和 Agent 能力摘要。

验证：

- `pnpm exec tsc -p tsconfig.node.json --noEmit` 通过。
- `pnpm exec vitest run src/main/subscription/feature-gate.test.ts src/main/remote/cclink-remote-provider.test.ts` 通过。

残余风险：

- Web 侧 typecheck 仍被既有 `Sidebar.tsx` 会话筛选 / 删除会话类型问题阻塞，和本批 RemoteProvider 改动无关。
- `CclinkRemoteProvider` 的 capability 目前由 DeepInk 本地已知字段推导，尚未消费 chatcc-agent 新版 `server_meta` capability。
- 文件写入、Terminal、远程 Agent Session 仍只是 capability 边界，真实闭环在 M4-M6。

## 2026-07-14 M4.0 远程文件写入协议骨架记录

本批只落 DeepInk 侧写入入口和失败归因，不宣称 CCLink 远程文件保存已经可用。

已完成：

- `RemoteProvider` 增加 `writeFile`、`createFile`、`renameFile`、`deleteFile` 可选能力。
- `RemoteApiContract` 和 preload 增加 `remote.writeFile/createFile/renameFile/deleteFile`。
- 主进程 `remote:*` 写操作统一走 `remote_file_write` entitlement gate。
- `CclinkRemoteProvider` 对写入、创建、重命名、删除返回 `REMOTE_CAPABILITY_UNAVAILABLE`，明确等待 chatcc-agent 协议接入。
- `REMOTE_ERROR_CODE` 增加 `CAPABILITY_UNAVAILABLE` 和 `ENTITLEMENT_REQUIRED`。

验证：

- `pnpm typecheck` 通过。
- `pnpm exec vitest run src/main/remote/cclink-remote-provider.test.ts src/main/subscription/feature-gate.test.ts src/main/cclink/cclink-file-service.test.ts` 通过。

拷问：

- 如果现在 UI 显示“可保存”，就是撒谎；`capabilities.file.write` 仍必须为 `false`。
- DeepInk 已经有写入入口，但真正 M4 验收还依赖 chatcc-agent 实现 `file_write/file_create/file_rename/file_delete`。
- 后续接编辑器保存时必须走权限确认和审计，不能直接调用 `remote.writeFile`。

## 2026-07-14 M5.0 远程 Terminal entitlement 边界记录

本批先补远程 Terminal 的商业和能力边界，不改完整 PTY。

已完成：

- 新增 `EntitledTerminalExecutionAdapter`，作为执行 adapter 包装层。
- CCLink remote-shell adapter 在进入 `CompositeTerminalExecutionAdapter` 前先经过 `remote_terminal` entitlement gate。
- entitlement 缺失时返回 `REMOTE_ENTITLEMENT_REQUIRED`，错误层为 `account`，并写入 Terminal execution error event。
- `remote:getStatus` 会根据 `remote_terminal` entitlement 屏蔽 shell capability，避免未授权用户看到 Terminal 可用。
- 新增 `terminal-entitled-execution-adapter.test.ts`，覆盖拒绝和放行两条路径。

验证：

- `pnpm typecheck` 通过。
- `pnpm exec vitest run src/main/terminal/terminal-entitled-execution-adapter.test.ts src/main/terminal/terminal-cclink-execution-adapter.test.ts src/main/terminal/terminal-command-orchestrator.test.ts src/main/remote/cclink-remote-provider.test.ts src/main/subscription/feature-gate.test.ts` 通过。

拷问：

- 这不是完整 M5。当前 CCLink Terminal 仍是单命令协议，不是 PTY。
- entitlement gate 只保证商业边界；命令风险确认、审计、输出流仍由现有 Terminal 编排链路承担。
- `remote:getStatus` 现在会屏蔽 shell capability，但 Settings 诊断页还没有展示 entitlement 缺失的专门原因。

## 2026-07-14 M6.0 远程 Agent Session 发送边界记录

本批先把已有 CCLink 远程会话发送迁到 RemoteProvider 边界，不实现新的 Codex / Claude Code 远端事件流。

已完成：

- `RemoteProvider` 增加 `sendAgentMessage` 可选能力。
- `RemoteApiContract` 和 preload 增加 `remote.sendAgentMessage`。
- 主进程 `remote:sendAgentMessage` 统一走 `remote_agent_session` entitlement gate。
- `CclinkRemoteProvider.sendAgentMessage` 复用现有 `CclinkStore.sendLocalMessage`。
- renderer 的 `useCclinkStore.sendLocalMessage` 保留兼容方法名，但内部改为构造 `RemoteWorkspaceRef` 后调用 `window.deepink.remote.sendAgentMessage`。
- `remote:getStatus` 会根据 `remote_agent_session` entitlement 屏蔽 agent capability 和 session stream/resume/archive capability。

验证：

- `pnpm exec vitest run src/main/remote/cclink-remote-provider.test.ts src/renderer/src/stores/cclink-store.test.ts src/main/terminal/terminal-entitled-execution-adapter.test.ts src/main/subscription/feature-gate.test.ts` 通过。

残余风险：

- 这不是完整 M6。远端 Codex / Claude Code 的 `createAgentSession`、事件流、approval、cancel 还没实现。
- `useCclinkStore.sendLocalMessage` 仍保留旧名称，避免一次性重构 UI；后续应改名成 remote agent session 语义。
- `remote:getStatus` 已屏蔽 capability，但 UI 还没有专门解释“缺少 remote_agent_session entitlement”。

## 2026-07-14 M7.0 Remote 诊断报告模型记录

本批先落诊断数据模型和 IPC，不直接做完整 Settings 诊断页。

已完成：

- `RemoteDiagnosticReport` / `RemoteDiagnosticCheck` 进入共享 remote protocol。
- 新增 `buildRemoteDiagnosticReport`，统一生成诊断检查项。
- 新增 `remote:getDiagnostics` IPC，并挂到 preload。
- 诊断检查覆盖：远程工作空间授权、远端连接、文件读取、文件写入授权、文件写入协议、远程 Terminal 授权、Terminal 能力、远程 Agent 会话授权、Agent 会话能力。
- 诊断报告区分 entitlement 失败和 capability 缺失，避免 UI 只显示“不可用”。

验证：

- `pnpm typecheck` 通过。
- `pnpm exec vitest run src/main/remote/remote-diagnostics.test.ts src/main/remote/cclink-remote-provider.test.ts src/renderer/src/stores/cclink-store.test.ts src/main/terminal/terminal-entitled-execution-adapter.test.ts src/main/subscription/feature-gate.test.ts` 通过。

残余风险：

- Settings > 远程连接还没有展示这份诊断报告。
- 诊断报告还没有包含 traceId、最近错误历史、agent 日志位置和协议升级建议。
- chatcc-agent 新 capability probe 未接入前，部分诊断仍依赖 DeepInk 本地推导。

## 2026-07-14 M7.1 Settings Remote 诊断入口记录

本批把 M7.0 的诊断报告接到 Settings > 远程连接，但仍保持设置页只做连接、同步和诊断，不承载日常远程工作。

已完成：

- CCLink 远程设备下的每个 workspace 增加“诊断 / 刷新”入口。
- 点击后构造 `RemoteWorkspaceRef`，调用 `window.deepink.remote.getDiagnostics`。
- 诊断结果展示生成时间、检查项、状态 badge 和失败原因。
- 检查项沿用主进程模型，覆盖 account entitlement、connection、file、terminal、agent session 五类边界。
- 诊断 UI 只读，不提供文件、Terminal、会话操作，避免 Settings 变成第二个 Remote 工作台。

验收：

- 至少一个同步出的 CCLink workspace 可以在设置页触发诊断。
- 缺少 `remote_file_write`、`remote_terminal`、`remote_agent_session` entitlement 时，报告能显示对应失败或 capability 被屏蔽。
- 离线 agent 会显示连接失败，而不是误报为权限失败。

残余风险：

- 还没有复制诊断报告、traceId、最近错误历史和 agent 日志位置。
- 诊断是手动触发，不自动刷新，不做跨 workspace 汇总。
- chatcc-agent capability probe 未升级前，部分能力仍由 DeepInk 本地适配层推导。

## 2026-07-14 M7.2 诊断报告复制记录

本批补齐“把诊断报告给开发者”的基础链路。

已完成：

- Settings > 远程连接的 workspace 诊断结果增加“复制”按钮。
- 复制内容为纯文本报告，包含生成时间、transport、endpoint/workspace 标识、连接状态、agent/protocol 版本、capability 摘要、检查项和结构化 remote error。
- 报告不包含 token、IM userSig、短信验证码、API key 等敏感凭证。

残余风险：

- 复制内容还没有 traceId 和最近错误历史。
- Electron/Chromium clipboard 失败时只在按钮上显示失败，未做降级弹窗。
- 报告仍依赖当前 `remote:getDiagnostics` 的实时结果，没有持久化快照。

## 2026-07-14 M7.3 traceId 与最近错误记录

本批补远程诊断的可追踪性，让 Settings 里的诊断报告能对应到具体失败操作。

已完成：

- `RemoteDiagnosticReport` 增加 `traceId` 和 `recentErrors`。
- 新增主进程 `RemoteDiagnosticLog`，以内存环形日志记录最近远程失败。
- `remote:*` IPC 在 entitlement 失败、capability 缺失、provider 返回 remote error 时写入诊断日志。
- 失败结果的 `remoteError.context.traceId` 会带上本次操作 trace，方便 UI、日志和开发者报告对齐。
- Settings 诊断面板显示当前报告 traceId 和最近错误列表。
- 复制诊断报告时包含 traceId、最近错误、operation、error code、layer、retryable。

验收：

- 远程文件读取/写入/Agent 发送等失败后，再打开 workspace 诊断，可以看到最近错误。
- 复制报告能把 traceId 带给开发者，且不包含请求正文、文件内容、token、IM userSig。
- 同一进程内最近错误按 workspace 过滤，不串到其它远程设备或其它 workspace。

残余风险：

- 诊断日志仍是内存态，应用重启后丢失；后续如果要服务真实用户，需要落到本地只读日志文件并支持导出。
- traceId 还没有传到 chatcc-agent/private-serv，所以只能对齐 DeepInk 本机侧日志。
- 没有对错误事件做采样或分级，频繁轮询失败时可能挤掉更有价值的历史。

## 2026-07-15 P1.0 DeepInk 协议兼容检查记录

本批只做 DeepInk 侧 protocol compatibility，不推进文件写入、Terminal 或 Agent Session。

已完成：

- `RemoteStatus` 增加 `compatibility`。
- 新增 `RemoteProtocolCompatibility`，状态为 `compatible`、`upgrade-required`、`unknown`。
- 新增 `buildRemoteProtocolCompatibility`，当前最低支持和期望版本为 `2`，与 chatcc-agent 当前 IM 协议对齐。
- `CclinkRemoteProvider` 输出 `protocolVersion` 和兼容结果；旧 CCLink agent 未上报时显示 `unknown`。
- DeepInk CCLink 协议常量升级到 `v=2 / min_v=2`。
- `server_meta.protocol_version` 支持 number/string，进入 `ChatccServer.protocolVersion`。
- `server_meta.capabilities` 进入 `ChatccServer.capabilities`。
- `CclinkRemoteProvider` 优先请求实时 `capability_probe_response`，失败时回退 `server_meta.capabilities`，再回退旧本地推导。
- `remote:getStatus` 和 `remote:getDiagnostics` 的 entitlement-blocked 空状态也会返回 `unknown` compatibility。
- 诊断报告新增“远端协议兼容性”检查项。
- Settings > 远程连接的 workspace 诊断面板显示 agentVersion、protocolVersion、compatibility 和升级/降级提示。
- 复制诊断报告包含 protocolVersion、minSupported、currentExpected、compatibility status/message。

验收：

- 新 agent 只要上报 `protocolVersion >= 2`，DeepInk 会显示协议兼容。
- 旧 agent 或未上报 protocolVersion 时，DeepInk 显示协议未知，并提示仅允许安全降级能力。
- 低于最低版本时，DeepInk 会显示需要升级 agent。

残余风险：

- chatcc-agent 已实现标准 capability probe 和 protocolVersion 上报；DeepInk 已接入，但仍需要真实 CCLink 联调确认 transport 请求链路。
- private-serv 尚未记录 agent protocolVersion、binding 状态和 traceId 日志。
- 协议版本比较当前按数字/semver 前缀处理；如果后续采用日期型或带 channel 的协议版本，需要同步调整比较规则。
