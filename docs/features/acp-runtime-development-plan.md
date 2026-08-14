# ACP Runtime 最小开发方案

> 状态：评审草案，尚未开始实现。
> 最后更新：2026-08-14。
> 相关事实源：[`agent-system.md`](./agent-system.md)、
> [`agent-panel-product-model.md`](./agent-panel-product-model.md)、
> [`architecture.md`](../architecture.md)、
> [`ADR 0006`](../decisions/0006-owned-agent-runtime-model-service-boundary.md)。

## 1. 结论

Claude Code 与 ACP 是两个平级的 Agent Runtime：

```text
Agent Thread
├── Claude Code Runtime（默认，继续直接使用 Claude Agent SDK）
└── ACP Runtime（可选，首个支持对象为 Codex）
```

ACP 不位于 Claude Code 上层，不代理 Claude Code，也不成为统一 Runtime 管理框架。现有 Claude
Code 路径保持默认、直接和可独立运行；ACP 只新增一个 `IAgentBackend` 实现及其必要的协议适配。

本方案选择最小纵向闭环：

1. 首版只支持本地 stdio ACP。
2. 首个真实 Agent 只支持 Codex，使用 `codex-acp`。
3. 用户自行安装 `codex-acp`，Studio 只探测系统命令或用户选择的绝对路径；首版不建设自动安装。
4. 首版只使用用户在 Studio 中显式配置的 API Key，不接入 ChatGPT 登录，不读取用户已有
   `~/.codex`，不访问系统钥匙串。
5. 每个 Thread 在首次发送前选择 Claude Code 或 ACP；首次发送后 Runtime 绑定不可原地切换。
6. 首版完成文本流、工具状态、权限确认、取消、工作空间绑定和会话恢复；图片、手动压缩、
   定时任务、远程 ACP、公共 Registry 和任意 Agent 配置全部后移。

现行 ADR 0006 明确将 ACP 列为非目标，因此实现前必须新增 ADR 复审这一条款。新 ADR 只允许
“受控、本地、显式选择的 ACP Runtime”，不自动批准公共 Agent Registry 或任意远程 Agent。

## 2. 用户目标与最小验收

### 2.1 当前用户能做什么

- 新建和恢复 Studio Thread。
- 默认使用本地 Claude Code Runtime。
- 使用 Claude Code 的流式输出、工具调用、权限确认、取消和会话恢复。

### 2.2 首版完成后用户能做什么

1. Claude Code 仍是新 Thread 的默认 Runtime，现有 Thread 自动继续使用 Claude Code。
2. 用户安装 `codex-acp` 后，可在设置中探测系统命令或选择其绝对路径。
3. 用户新建空 Thread，在第一次发送前把 Runtime 从“Claude Code”改为“Codex（ACP）”。
4. 用户配置 OpenAI API Key 后，在真实本地工作空间向 Codex 发送任务。
5. Studio 展示 Codex 的流式文本、工具执行状态和权限请求。
6. Codex 能在当前工作空间读取文件并完成一次真实文件修改。
7. 用户可以拒绝一次工具权限请求，也可以在运行中点击停止。
8. 退出并重启 Studio 后，原 Thread 和消息仍存在；原生 ACP Session 可恢复时恢复，不能恢复
   时保留可见历史并明确建立新 Session。
9. `codex-acp` 缺失、认证失败、协议不兼容或进程崩溃时，只使该 ACP Thread 不可用；Claude
   Code、工作空间、浏览器、编辑器、Terminal、数据源和 Android 继续可用。

完成上述真实应用动作后，只能声明“Codex 可通过 ACP 使用”。在第二个真实 ACP Agent 通过
同一验收矩阵前，不声明“通用 ACP Agent 平台完成”。

## 3. 首版明确不做

- 不修改 Claude Code 的默认地位和直接 SDK 接入。
- 不把 Claude Code 改造成 ACP Agent。
- 不做 Provider Registry、依赖注入框架或通用插件系统。
- 不接入公共 ACP Registry。
- 不下载、安装或自动更新 `codex-acp`。
- 不接受任意 shell command、参数模板或远程 URL。
- 不支持 HTTP、WebSocket 或远程 ACP transport。
- 不支持 ChatGPT OAuth、订阅登录或历史 Codex 登录迁移。
- 不读取 `~/.codex`，不使用 Keychain、`safeStorage` 或 `keytar`。
- 不承诺图片、上下文占用、手动压缩、slash command、Skill、角色、定时任务和多 Agent 并发
  与 Claude Code 完全一致。
- 不为了 ACP 先重写整个 AgentBridge、Thread Store 或组件管理系统。

这些项目只有在首个 Codex 闭环真实可用后，依据用户需求和失败证据逐项评审。

## 4. 最小产品模型

### 4.1 Runtime 是 Thread 配置，不是全局运行开关

设置页只保存新 Thread 的默认值：

```typescript
type AgentRuntimeKind = 'claude-code' | 'acp'

interface AgentRuntimeDefaults {
  defaultRuntime: AgentRuntimeKind // 默认始终是 'claude-code'
  acpAgent: 'codex'
  acpExecutablePath: string
}
```

每个 Thread 保存最小绑定：

```typescript
interface AgentRuntimeBinding {
  kind: 'claude-code' | 'acp'
  implementationId: 'claude-code' | 'codex-acp'
  sessionId: string | null
  compatibilityFingerprint: string | null
}
```

约束：

- 旧 Thread 没有 `runtimeBinding` 时按 Claude Code 读取。
- 空 Thread 可以切换 Runtime。
- Thread 第一次发送后锁定 Runtime。
- 用户要换 Runtime 时新建 Thread；首版不做自动 fork 或历史导入。
- Claude session ID 不能交给 ACP，ACP session ID 不能交给 Claude。

这比继续使用全局 `switchBackend()` 更安全，也避免切换设置时中断所有正在运行的 Thread。

### 4.2 最小 UI

设置页只新增：

```text
新会话默认 Runtime
  Claude Code（默认）
  Codex（ACP）

Codex ACP
  可执行文件：系统命令 / 绝对路径
  状态：未探测 / 可用 / 不兼容 / 不可用
  API Key：已配置 / 未配置
  [探测]
```

Composer 在空 Thread 中显示一个简单 Runtime 下拉框。第一次发送后变成只读标签。首版不新增
Runtime 管理侧栏、市场页、安装页或复杂能力矩阵页面。

## 5. 最小技术架构

```text
renderer Agent Panel
        |
        | existing bounded IPC
        v
main AgentBridge / AgentRuntime
        |
        +-- LocalClaudeCodeBackend（现有默认路径）
        |
        +-- LocalAcpBackend
              |
              +-- spawn codex-acp
              +-- ACP JSON-RPC over stdio
              +-- ACP event -> minimal Studio event
```

首版不增加通用 Provider Registry。只扩展当前 factory：

```typescript
type BackendConfig =
  | { type: 'local-claude-code'; claudeCode: ClaudeCodeBackendOptions }
  | { type: 'local-acp'; acp: AcpBackendOptions }
```

`AgentRuntime` 继续一条 Thread 对应一个 backend 实例。`LocalAcpBackend` 一条活动 Thread 启动
一个 `codex-acp` 子进程，优先换取简单的会话归属、故障隔离和清理逻辑。首版不实现多个 Thread
共享一个 ACP 进程。

## 6. 最小事件契约

当前 renderer 直接理解 Claude SDK 原始事件。ACP 不应伪装成 Claude `stream_event`，但首版也
不建设覆盖所有供应商能力的大型事件系统。

只增加 UI 当前必需的最小事件：

```typescript
type AgentBackendEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'text-delta'; messageId: string; text: string }
  | {
      type: 'tool'
      toolCallId: string
      name: string
      status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
      input?: Record<string, unknown>
      output?: string
    }
  | { type: 'complete'; stopReason?: string; usage?: AgentUsage }
  | { type: 'error'; code: string; message: string }
```

实施顺序：

1. 先在主进程为现有 Claude backend 增加一个薄映射层，把当前事件转换为上述最小事件。
2. renderer 改为只处理最小事件。
3. ACP backend 把 `session/update`、prompt 终态和错误转换为同一事件。

不在首版统一 reasoning、plan、diff、图片、context usage 或所有 ACP 扩展。ACP tool call 的输入、
状态和结果足以复用现有高密度工具行；更丰富的 Codex diff 展示留到真实需求出现后。

## 7. ACP 连接与生命周期

### 7.1 启动

每个 ACP Thread 第一次发送时：

1. 主进程解析并校验 `codex-acp` 绝对路径；禁止通过 shell 字符串启动。
2. 使用 `spawn(executablePath, fixedArgs, { shell: false })` 启动子进程。
3. 子进程环境使用 allowlist，不继承 Anthropic、OpenAI、Codex 或其他模型凭证。
4. 仅注入用户为 Codex 显式配置的 API Key。
5. 设置 Studio 管理的隔离 `CODEX_HOME`，不读取用户 `~/.codex`。
6. 通过 stdio 完成 ACP `initialize`。
7. 校验协议版本、agentInfo、认证方法和必要 capability。
8. 创建或恢复 ACP Session，并把 cwd 固定为 Thread 所属工作空间。

### 7.2 运行

- 同一 Thread 同时只允许一个 prompt。
- prompt 开始前写入 `activeRunId`。
- 所有更新必须按 `conversationId + runId + sessionId` 关联。
- 收到终态后清除 busy 状态。
- 迟到事件不能写入已经结束或被新 run 取代的消息。

### 7.3 取消

1. 发送 ACP `session/cancel`。
2. 所有待确认请求按 cancelled 解决。
3. 等待短暂宽限期。
4. 若 Agent 未结束，终止子进程并把 run 标记为 cancelled，而不是 failed。

### 7.4 清理

- Thread 关闭或删除时关闭 ACP Session 和子进程。
- Window 重建不复制子进程 owner；主进程继续拥有运行态并向新 renderer 重放状态投影。
- App shutdown 按顺序取消 prompt、解决待确认、关闭 stdin、终止进程。
- ACP 进程退出必须清除所有 busy、listener 和 pending request。

## 8. 工作空间与权限

### 8.1 首版信任边界

ACP 协议本身不能替代进程沙箱。首版只对 `codex-acp` 做兼容验证，并要求 Codex 使用工作空间
受限模式；不因为一个任意 Agent 能完成 ACP handshake 就允许其进入写模式。

首版只向 ACP 提供：

- 当前 Thread 的绝对 workspace cwd；
- 不超过当前工作空间的读写范围；
- Codex 自身通过 ACP 上报的工具和权限请求。

Studio Browser、Editor、Android 和数据源 MCP 工具不作为首版完成门槛。这样可以先验证 Codex
真实代码任务，避免同时改造 ACP、MCP 长会话 token 和所有业务工具。Studio MCP 接入作为下一
个独立纵向切片。

### 8.2 权限映射

首版复用现有确认 UI 和 `PermissionManager`，增加一个 ACP permission adapter：

- ACP 请求只包含当前 Session 和当前 run 时才显示。
- 用户允许、拒绝或取消后，原样映射到 ACP response。
- Runtime 自报的“只读”不能覆盖主进程对工作空间的检查。
- 不提供 Full Access。
- 不把 ACP 的一次批准解释成对 Studio 不可逆外部动作的批准。

不新增第二个权限 Store，也不先设计跨所有 Runtime 的复杂策略语言。

## 9. 凭证与 NO_SYSTEM_KEYCHAIN

首版只支持 API Key：

- Key 由现有 `CredentialService` 保存。
- renderer 只知道是否已经配置。
- Key 不进入普通设置、Thread、工作空间、命令参数或诊断。
- 启动 ACP 前删除继承环境中的 `OPENAI_API_KEY`、`CODEX_API_KEY`、ChatGPT token 和其他
  Codex 认证变量，再注入 Studio 当前明确选择的凭证。
- `CODEX_HOME` 指向 `userData` 下新的隔离目录。
- 设置中强制关闭或隐藏浏览器登录。
- 不读取或迁移 `~/.codex/auth.json`。
- 不允许 Codex 自动选择系统 keyring。

ChatGPT 登录需要让 Codex 持久化 refresh token，并改变当前“CredentialService 是通用凭证
唯一 owner”的边界，因此不进入首版。若未来需要，必须单独 ADR 和验收。

## 10. 持久化迁移

只做两个新增字段：

1. 设置新增 `defaultAgentRuntime`，默认值为 `claude-code`。
2. Thread 新增 `runtimeBinding`。

迁移规则：

- 缺少新字段的设置按 `claude-code` 处理。
- 缺少 `runtimeBinding` 的所有历史 Thread 按 Claude Code 处理。
- 保留现有 `sessionId` 和 `sessionCompatibilityFingerprint` 字段名，首版不为追求命名纯度做
  大规模持久化重构。
- fingerprint 必须加入 runtime kind、实现 ID、协议版本、可执行版本和模型身份。
- fingerprint 不匹配时清空原生 session ID，但保留消息和 Thread。

## 11. 代码落点

预计只新增或修改以下边界：

```text
docs/decisions/
  0012-peer-acp-runtime.md                    # 实现前新增

src/main/agent-core/backends/
  types.ts                                   # BackendConfig union + minimal event
  backend-factory.ts                         # local-acp 分支
  local-acp-backend.ts                       # ACP stdio client
  local-acp-backend.test.ts

src/main/agent-core/runtime/
  agent-runtime.ts                           # 每 Thread runtime binding

src/main/agent/
  agent-bridge.ts                            # runtime 解析、凭证和事件转发
  acp-runtime-detector.ts                    # 有界 path/version/protocol probe

src/shared/
  agent-protocol.ts                          # minimal normalized event
  settings-constants.ts                      # defaultAgentRuntime + ACP path

src/shared/ipc/
  agent-schema.ts
  settings-schema.ts

src/renderer/src/
  stores/agent-store.ts                      # runtimeBinding 持久化
  bootstrap/use-agent-stream-events.ts       # 处理 normalized event
  components/settings/SettingsPage.tsx       # ACP path/probe/API Key 状态
  features/agent-composer/                   # 空 Thread runtime selector
```

首版不新增 `AgentRuntimeProviderRegistry`、`AcpProcessSupervisor`、公共 Catalog、独立 Runtime
Store 或 ACP 专用 renderer Store。只有当第二个 ACP Agent 或进程复用产生真实需求时再抽取。

## 12. 实施里程碑

| 阶段 | 类型 | 用户可验收结果 | 退出门禁 |
| ---- | ---- | -------------- | -------- |
| D0 决策与真实探针 | 工程准备 | 无新增用户能力 | 新 ADR accepted；固定 `codex-acp` 版本；stdio、权限、取消和 cwd 探针通过 |
| M1 Codex 最小闭环 | 用户功能 | 空 Thread 选择 Codex，真实流式回答并可停止 | Claude 默认不变；API Key 隔离；进程失败独立降级 |
| M2 工作空间代码任务 | 用户功能 | Codex 读取并修改当前工作空间文件，用户可拒绝权限 | workspace 边界、工具状态、取消竞态和 session 恢复通过 |
| M3 Studio MCP 切片 | 用户功能 | Codex 调用一个真实 Studio MCP 工具 | MCP token 只在活动 run 有效；不出现重复确认；其他工具不扩张 |
| M4 发布候选 | 工程准备 + 用户门禁 | packaged App 完成 M1-M3 真人验收 | `pnpm verify`、受影响 smoke、断网/坏路径/崩溃/重启恢复通过 |

M1 之前不要先做自动安装；M2 之前不要扩展第二个 ACP Agent；M3 只接一个能够证明价值的
Studio MCP 工具，不一次性迁移 Browser、Editor、Android 和数据源全部能力。

## 13. 测试与失败矩阵

### 13.1 自动化

- `BackendConfig` 和设置 schema 兼容旧数据。
- 历史 Thread 默认迁移到 Claude Code。
- Claude 与 ACP session fingerprint 不能互相恢复。
- ACP initialize 超时、错误版本、非法 JSON、重复响应 ID。
- 文本 delta、工具 pending/running/completed/failed 映射。
- permission allow/deny/cancel。
- cancel 与 complete 同时到达时只产生一个终态。
- 子进程退出后 busy、pending request 和 listener 全部清理。
- workspace path 必须来自主进程 Thread 绑定，而不是 renderer 自报。
- 环境变量不继承历史 OpenAI/Codex/Anthropic 凭证。
- ACP 不可用时 Claude Code backend 仍为 ready。

### 13.2 真实应用验收

1. 保持 Claude Code 默认，新建 Claude Thread 完成一次原有任务。
2. 新建空 Thread，选择 Codex，完成一次真实文本请求。
3. 在真实 workspace 让 Codex 修改一个指定文件，并检查 diff。
4. 对一个权限请求选择拒绝，确认工具未执行且对话可继续。
5. 运行中点击停止，确认 UI 退出 busy 且进程没有继续写文件。
6. 重启 App 并继续原 Thread。
7. 把 `codex-acp` 路径改为不存在，确认只有 Codex Thread 降级。
8. 断网启动，确认 Studio、Claude Code 本地路径和其他工作台能力不被 ACP 初始化阻断。

最终必须通过 `pnpm verify` 和新增的受影响 smoke；没有真实 Codex/API Key/工作空间验收时，
只能声明协议和自动化门禁通过。

## 14. 工作量预估

| 工作项 | 预估 |
| ------ | ---- |
| ADR、`codex-acp` 真实协议探针 | 2-3 人日 |
| 最小事件契约与 Claude 适配 | 2-4 人日 |
| `LocalAcpBackend`、stdio、Session、取消 | 4-6 人日 |
| Thread runtime binding、迁移和 UI 选择 | 3-5 人日 |
| API Key、环境隔离、权限适配 | 3-5 人日 |
| 恢复、错误、诊断和自动化 | 3-5 人日 |
| 真实 App 验收与缺陷修复 | 2-4 人日 |

M1-M2 合计约 19-32 人日，单人约 4-7 周。M3 Studio MCP 切片预计另需 3-5 人日。自动安装、
ChatGPT 登录、第二 ACP Agent 和公共 Registry 不计入本估算。

## 15. 止损与替代路径

D0 出现以下任一结果时，不继续 ACP 实现：

1. `codex-acp` 无法稳定通过 stdio 完成 initialize、prompt 和 cancel。
2. Codex 无法被限制在当前 workspace，或必须使用 Full Access 才能完成基本任务。
3. 权限请求无法与当前 run 可靠关联。
4. API Key 隔离后仍会读取 `~/.codex` 或系统凭证。
5. Session 恢复失败会破坏可见 Thread 历史。

替代路径是只实现 Codex App Server 专用 backend。它仍与 Claude Code 平级，但不宣称 ACP
支持；这比为了协议名绕过权限和凭证边界更诚实。

## 16. /grilling

本方案必须持续拷问：

1. 是否无意中把 ACP 做成了 Claude Code 的上层？正确答案必须是否。
2. 是否为了未来可能接入多个 Agent，提前建设了 Registry、Provider 框架或进程池？首版不需要。
3. 是否把“Codex 返回文字”当成完成？最小产品闭环至少包含真实工作空间文件任务、拒绝权限、
   取消和重启恢复。
4. 是否让 ACP 初始化失败影响 Claude Code 或整个工作台？任何此类影响都是架构缺陷。
5. 是否为减少代码而把 ACP 事件伪造成 Claude SDK 事件？应使用最小中性事件，而不是制造长期
   隐式兼容层。
6. 是否读取用户已有 Codex 登录、使用系统钥匙串或继承环境凭证？首版全部禁止。
7. 是否在首个闭环前加入自动安装、ChatGPT 登录、远程 ACP、第二 Agent 或公共 Registry？出现
   任一项都应执行范围止损。

下一步只做 D0：新增替代 ADR，并用固定版本 `codex-acp` 完成不接 UI 的真实协议探针。D0 通过
后再开始 `LocalAcpBackend`；D0 失败则转为 Codex App Server 专用 backend 评估。
