# ADR 0002：内置固定版本 Claude Code 运行时

- 状态：accepted
- 日期：2026-07-22
- 负责人：CCLink Studio Maintainers

## 结论

CCLink Studio 将固定版本的 Claude Code 可执行运行时作为新安装的默认本地 Agent 运行时，同时保留“使用本机 Claude Code”和“使用自定义可执行文件”两种显式选择。

内置运行时只是 Agent 执行引擎，不包含模型、账号、API 凭证、额度或 CCLink 官方服务。运行时来源与模型服务配置相互独立；密钥继续由 Studio 的本机加密设置管理，不写入安装包、普通设置、renderer 状态或诊断日志。

当前 `@anthropic-ai/claude-agent-sdk` 已锁定为 `0.3.211`，其平台包声明携带 Claude Code `2.1.211`。当前后端却在未配置路径时强制传入 `claude`，绕过了 SDK 内置运行时。本决策将这一隐式 PATH 行为改为显式、可探测、可诊断、可回滚的运行时选择。

本 ADR 接受架构方向，不代表已经批准发布二进制。内置 Claude Code 的再分发许可和第三方认证方式必须通过 M0 门禁；门禁未通过时，只能保留技术验证，不能在公开安装包中启用或分发内置运行时。

## 当前事实依据

- [`package.json`](../../package.json) 将 `@anthropic-ai/claude-agent-sdk` 固定为 `0.3.211`；该版本的平台可选依赖声明 Claude Code `2.1.211`。
- [`local-claude-code-backend.ts`](../../src/main/agent-core/backends/local-claude-code-backend.ts) 当前把空路径替换为 `'claude'` 并始终传入 `pathToClaudeCodeExecutable`，因此仍依赖系统 PATH，没有使用 SDK 的内置运行时解析。
- SDK 类型契约说明未传 `pathToClaudeCodeExecutable` 时使用 built-in executable，但 Electron 发布包仍需解决 optional dependency、ASAR 和目标架构问题。
- 平台包当前许可证不是普通开源许可证，而是指向 Anthropic 法律协议；[Anthropic Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance) 同时说明第三方 Agent SDK 产品应使用 API Key 或受支持云服务，不能向用户提供 Claude.ai 登录或代用户路由 Free/Pro/Max 凭证。
- 2026-07-22 本机安装的 darwin-arm64 Claude Code `2.1.211` 原生二进制约 231 MB。该数字只用于容量规划，正式产物必须由 M0/M2 重新测量并记录。

## 问题

当前本地 Agent 存在四个结构性问题：

1. Studio 依赖用户预先安装 `claude`，全新机器无法获得开箱即用的基础 Agent。
2. PATH 中的 Claude Code 可以独立升级，SDK 与 CLI 版本组合不可复现，故障难以定位。
3. `claudeCodePath` 同时承担“自动检测”和“自定义路径”两种含义，UI 无法说明当前实际使用的来源、版本和路径。
4. Agent 设置变化会立即重建所有 conversation backend，并中断正在运行的任务；运行时切换缺少探测、提交和回滚边界。

用户需要的是一个稳定默认值，同时保留对本机环境的控制权。这个需求不能通过“把一个 `claude` 文件复制进安装包”完成，因为它同时改变：

- 原生二进制打包和双架构产物；
- 运行时解析与完整性校验；
- Agent 子进程生命周期；
- 会话恢复兼容性；
- 认证和许可边界；
- 设置迁移与诊断事实源。

## 目标

- 新安装的 Studio 在没有系统 `claude` 命令时，也具备可用的本地 Agent 执行引擎。
- 安装包中的 Agent SDK 与 Claude Code 版本形成可审计组合，并随 Studio 版本一起升级。
- 用户可以明确选择内置、本机或自定义运行时，并看到实际生效的来源和版本。
- 运行时切换不静默中断任务，不隐式跨来源回退，不伪装会话恢复成功。
- Agent 运行时故障只使 Agent 能力降级，不阻断浏览器、编辑器、Terminal 或工作区启动。
- 不扩大 renderer、IPC、模型凭证和外部副作用的权限面。

## 非目标

- 不把 Claude 模型或推理服务打包到桌面应用。
- 不提供 Claude.ai、Free、Pro 或 Max 的第三方 OAuth 登录入口。
- 不复制、导入或上传用户现有 Claude 凭证。
- 不让内置 Claude Code 自行在线更新；版本更新通过 Studio 发布完成。
- 不在开源仓库引入 CCLink 官方账号、订阅、配额或生产 API。
- 不在本 ADR 中增加新的 Agent provider 或 HTTP Chat 后端。
- 不保证不同 Claude Code 版本之间的 SDK Session ID 可以安全恢复。

## 架构原则

### 1. 运行时来源必须显式

运行时来源只允许三种稳定值：

```typescript
type ClaudeRuntimeSource = 'bundled' | 'system' | 'custom'
```

- `bundled`：由当前 Studio 安装包提供的固定版本。
- `system`：由主进程在本机已知路径和 shell PATH 中探测。
- `custom`：由用户明确选择的绝对可执行文件路径。

不提供会在来源之间静默跳转的 `auto` 模式。来源失败必须显示真实失败，用户可以主动选择另一个来源。

### 2. 选择、解析和运行事实分离

设置保存的是用户意图 `ClaudeRuntimeSelection`，不是已验证的运行事实：

```typescript
interface ClaudeRuntimeSelection {
  source: ClaudeRuntimeSource
  customPath: string
}
```

主进程解析器输出不可变的 `ResolvedClaudeRuntime`：

```typescript
interface ResolvedClaudeRuntime {
  source: ClaudeRuntimeSource
  executablePath: string
  sdkVersion: string
  claudeCodeVersion: string
  platform: NodeJS.Platform
  arch: string
  fingerprint: string
  resolvedAt: number
}
```

backend 只能接收已经解析并验证过的 `ResolvedClaudeRuntime`，不得自行读取 PATH、renderer 设置或项目状态。

### 3. 主进程是唯一状态所有者

新增主进程领域服务 `ClaudeRuntimeManager`，唯一拥有以下状态：

- 用户期望的 runtime selection；
- 当前已提交的 resolved runtime；
- 待生效 selection；
- probe 状态、结构化失败原因和最后成功时间；
- runtime generation 与 fingerprint；
- 当前 generation 上的活动 Agent run 数量。

renderer 只展示投影并发送显式 command。设置页、Agent Panel 和诊断页不能各自探测或推断可执行路径。

### 4. 打包产物必须可审计

内置二进制不提交到 Git。构建阶段从锁文件确定的平台依赖中提取，并生成 manifest：

```json
{
  "sdkVersion": "0.3.211",
  "claudeCodeVersion": "2.1.211",
  "platform": "darwin",
  "arch": "arm64",
  "sha256": "...",
  "relativeExecutablePath": "agent-runtime/darwin-arm64/claude"
}
```

打包后的路径位于 `process.resourcesPath` 下的真实文件系统，不依赖从 `app.asar` 内直接 spawn。主进程根据当前 `process.platform` 和 `process.arch` 选择对应 manifest，并验证：

- 路径仍在预期 `agent-runtime` 目录内；
- 文件是普通可执行文件；
- 架构与当前进程匹配；
- SHA-256 与 manifest 一致；
- `claude --version` 在有界超时内返回 manifest 声明的版本。

### 5. 运行时与认证相互独立

选择“内置”或“本机”只决定执行哪个 Claude Code，不决定模型服务和凭证来源。

- 安装包不带 API Key、OAuth token 或官方服务地址。
- Studio 管理的 API Key 继续保存在 `safeStorage`，只在主进程构造子进程环境时注入。
- 不新增 Claude.ai OAuth 登录 UI，不代理 Free/Pro/Max 凭证。
- 本机和自定义运行时也使用同一套 Studio provider 配置，不因可执行文件来自本机就自动导入账号材料。
- 没有可用认证时，probe 可以为 runtime `ready`，但 Agent 能力必须显示 `degraded/auth-required`，不能把认证失败误报为运行时损坏。

许可与认证政策属于发布门禁。技术上能够执行，不等于允许作为第三方产品默认分发或认证。

### 6. 配置切换采用探测后提交

切换流程固定为：

```text
选择候选来源
  -> 主进程 probe
  -> 返回版本、路径摘要和风险
  -> 保存期望设置
  -> 等待生命周期安全点
  -> 提交新 runtime generation
  -> 新 backend 使用新 generation
```

候选 runtime 探测失败时，当前已提交 runtime 保持不变。不得先销毁旧 backend 再验证新路径。

存在活动 Agent run 时，默认行为是“任务结束后生效”。只有用户明确选择“立即切换并中止任务”，才允许中止，并必须列出受影响会话数量。

### 7. 会话恢复必须诚实

每个 Agent backend 在创建时绑定不可变的 runtime fingerprint。会话持久化记录以下非敏感 provenance：

- runtime source；
- SDK version；
- Claude Code version；
- runtime fingerprint；
- provider 类型，不记录密钥。

当 runtime fingerprint 或 provider 身份发生变化时：

- UI Thread 消息历史继续保留；
- 旧 SDK Session ID 不自动交给新 runtime 恢复；
- 会话状态显示“运行时已变化，后续从新的 Agent 上下文继续”；
- 必要的项目路径、挂载资源和宿主工具上下文仍由 Studio 提供；
- 不伪造 SDK 已继承完整上下文，也不自动回放无界历史。

只有 fingerprint 和 provider 身份兼容时，才允许沿用原 SDK Session ID。兼容规则由主进程单一函数判断并有测试覆盖。

### 8. 权限边界不随来源变化

无论 runtime 来源是什么，都必须经过同一套：

- workspace boundary hook；
- MCP tool session 与 conversation/workspace 绑定；
- allowed/disallowed tools；
- permission mode；
- 不可逆外部副作用最终人工确认；
- 诊断脱敏。

“用户选择了本机 CC”不能成为放宽文件范围、工具权限或人工确认的理由。

### 9. 失败独立降级

运行时能力沿用架构宪法的四态模型：

| 能力状态      | 含义                                              | UI 行为                    |
| ------------- | ------------------------------------------------- | -------------------------- |
| `ready`       | runtime 与认证均可启动                            | 可发送任务                 |
| `degraded`    | runtime 可用，但认证、provider 或版本策略需要处理 | 显示修复入口，禁止误发任务 |
| `unavailable` | 当前来源在本机不存在或不适配                      | 可切换来源，其他模块正常   |
| `failed`      | manifest 损坏、hash 不符、probe 崩溃等异常        | 显示错误码和诊断入口       |

首批结构化错误码至少包括：

- `BUNDLED_RUNTIME_MISSING`
- `BUNDLED_RUNTIME_INTEGRITY_FAILED`
- `RUNTIME_ARCH_MISMATCH`
- `RUNTIME_NOT_EXECUTABLE`
- `RUNTIME_VERSION_MISMATCH`
- `SYSTEM_RUNTIME_NOT_FOUND`
- `CUSTOM_RUNTIME_INVALID`
- `RUNTIME_PROBE_TIMEOUT`
- `AUTH_REQUIRED`
- `RUNTIME_SWITCH_PENDING`
- `RUNTIME_SESSION_INCOMPATIBLE`

### 10. 更新和回滚必须可控

- 内置 Claude Code 版本只随 Studio 版本更新，不运行 CLI 自更新。
- 升级前后的 manifest 和 runtime fingerprint 进入诊断事实。
- 新内置版本 probe 失败时，Agent 降级并允许用户显式切换到本机/自定义版本；不得静默改变来源。
- 开源版不依赖远程 feature flag。紧急回滚通过设置切换或发布修复版本完成。
- 官方构建层可以选择是否携带相同的内置 runtime，但不能改变本 ADR 的密钥、权限和诊断边界。

## 总体架构

```text
renderer
  Settings / Agent Panel / Diagnostics
          |
          | shared IPC contract
          v
main
  ClaudeRuntimeManager                 single state owner
    |- BundledRuntimeLocator           resources manifest + hash + version
    |- SystemRuntimeDetector           known paths + shell PATH
    |- CustomRuntimeValidator          explicit absolute path
    |- RuntimeProbe                    executable/version/arch/auth readiness
    `- RuntimeSwitchCoordinator        pending -> committed generation
          |
          v
  AgentRuntime
    |- conversation backend A          immutable runtime fingerprint
    |- conversation backend B          immutable runtime fingerprint
    `- run/session lifecycle
          |
          v
  LocalClaudeCodeBackend
    |- explicit executable path
    |- workspace boundary hook
    |- MCP session binding
    |- provider env from safeStorage
    `- structured events and diagnostics
```

### 状态作用域

| 状态               | 作用域               | 所有者                                 | 持久化                                 |
| ------------------ | -------------------- | -------------------------------------- | -------------------------------------- |
| runtime selection  | 设备/应用全局        | SettingsService + ClaudeRuntimeManager | 全局设置                               |
| bundled manifest   | 安装包               | 构建系统                               | `resources/agent-runtime`              |
| resolved runtime   | 当前主进程           | ClaudeRuntimeManager                   | 不直接持久化，启动时重建               |
| pending switch     | 当前主进程           | ClaudeRuntimeManager                   | selection 已持久化，pending 状态可重建 |
| runtime provenance | conversation/session | Agent runtime                          | 项目 conversation snapshot             |
| API secret         | 设备/应用全局        | SettingsSecretStore                    | `safeStorage`                          |

运行时选择属于设备能力，不属于项目。项目只能记录某个会话实际使用过的 runtime provenance，不能把另一台机器的绝对可执行路径写入项目目录并强制恢复。

## 设置与交互设计

设置页“Agent 后端”区域改为：

```text
Claude Code 运行时

(*) 内置版本（推荐）
    Claude Code 2.1.211 · Agent SDK 0.3.211 · 已验证

( ) 使用本机版本
    /opt/homebrew/bin/claude · Claude Code x.y.z

( ) 自定义路径
    [选择可执行文件...] [重新检测]

生效状态
    当前：内置版本 2.1.211
    待生效：无
```

交互规则：

- 来源使用单选/分段选择，不再让空字符串承担自动模式。
- 选择来源后先 probe；失败只显示候选错误，不改变当前 runtime。
- 有活动任务时显示“任务结束后生效”，并提供受控的立即切换操作。
- Agent Panel 紧凑显示当前来源和版本；详细路径、fingerprint 和 probe 只放设置或诊断。
- 诊断中的 home path 使用 `~` 脱敏，绝不输出 API Key、token、Cookie 或完整 Session ID。

## 设置迁移

新增设置 schema 版本和字段：

```typescript
claudeRuntimeSource: 'bundled' | 'system' | 'custom'
claudeRuntimeCustomPath: string
```

旧字段 `claudeCodePath` 分阶段废弃，不直接删除：

1. 旧设置存在非空 `claudeCodePath`：迁移为 `custom`，保留原路径。
2. 旧设置文件存在且路径为空：迁移为 `system`，保持老用户当前行为。
3. 全新安装没有旧设置：默认 `bundled`。
4. 迁移成功后写入 schema version；迁移必须幂等、原子并有回滚测试。
5. 一个兼容周期内保留只读旧字段解析；新代码不再写旧字段。

这样既兑现“新安装默认内置”，也不在升级时偷偷改变现有用户正在使用的 Agent 来源。

## 里程碑

### M0：许可、认证与技术可行性门禁

#### 目标

在进入产品实现前，确认内置 Claude Code 可以被当前开源/官方安装包合法分发，并证明 Electron 安装包能从真实资源路径启动固定版本二进制。

#### 方案

- 记录 Agent SDK 和平台包的许可证、适用条款及再分发结论。
- 明确第三方应用只提供 API Key/兼容 provider 配置，不提供 Claude.ai OAuth 登录。
- 制作不进入正式功能路径的 arm64 技术探针：从锁定依赖提取二进制，生成 manifest，打入 `extraResources`，在安装包内执行 `--version`。
- 记录原始体积、压缩后体积、启动耗时和完整性校验耗时。
- 验证未安装系统 `claude` 时，SDK 使用显式内置路径能够启动最小 query；测试凭证只来自本机安全测试环境。

#### 验收标准

- 有可引用的书面许可结论；结论不明确视为未通过。
- 认证方案不依赖 Free/Pro/Max OAuth，不复制原机 token。
- arm64 安装包内 `claude --version` 返回 manifest 声明版本。
- 删除或隐藏系统 PATH 中的 `claude` 后，最小 Agent query 仍能启动。
- 二进制缺失、hash 被修改、无执行权限三个故障均返回结构化错误，Studio 其他能力仍启动。
- M0 未全部通过，不进入默认启用和公开分发。

### M1：运行时 contract、解析器与状态所有者

#### 目标

建立单一 `ClaudeRuntimeManager`，把用户选择、候选探测、已提交运行事实和诊断状态分开。

#### 方案

- 在 shared 定义 selection、status、probe result、error code 和 IPC contract。
- 在 main 实现 bundled/system/custom 三个 locator 和统一 RuntimeProbe。
- backend config 从 `claudeCodePath?: string` 迁移为 `ResolvedClaudeRuntime`。
- RuntimeProbe 使用有界 `execFile`，校验 realpath、可执行权限、版本与架构。
- capability registry 投影 Agent runtime 的四态状态。

#### 验收标准

- renderer/preload/main 使用同一份 contract 和运行时 schema。
- 三种来源的成功、缺失、无权限、超时、版本错误和架构错误均有单元测试。
- backend 不再自行读取 PATH，也不再以 `'claude'` 作为隐式默认值。
- probe 失败不会销毁当前 backend 或改变 committed generation。
- capability 状态可在设置和诊断中读取，错误不依赖解析控制台文本。

### M2：可复现的多架构打包

#### 目标

让 arm64、x64 和 universal macOS 产物携带正确架构的固定 Claude Code，并阻止缺包或错架构产物发布。

#### 方案

- 新增 staging 脚本，从 pnpm 锁定的平台包复制二进制并生成 manifest。
- arm64 和 x64 构建分别只选择匹配架构资源；universal 产物包含两个隔离目录并按运行架构选择。
- 不从 `app.asar` 直接 spawn；二进制进入真实 `resources/agent-runtime/<platform>-<arch>`。
- package 脚本在构建前检查目标平台依赖，在构建后解包验证 manifest、hash、Mach-O 架构和 `--version`。
- 更新打包说明，报告内置 runtime 对安装包体积的真实影响。

#### 验收标准

- arm64 机器只选择 arm64 runtime，Intel 机器只选择 x64 runtime。
- universal 产物在两种机器上完成相同 packaged Agent smoke。
- 删除任一目标架构依赖后，构建在产物生成前明确失败。
- `file`、SHA-256 和 `claude --version` 与 manifest 一致。
- DMG/ZIP 解压、首次启动和 Agent 子进程退出清理均通过。
- package 脚本不再提示“claude-code 后端需目标机安装 claude CLI”。

### M3：设置 UI、迁移与候选探测

#### 目标

让用户清楚选择并验证内置、本机或自定义运行时，同时保护老用户现有行为。

#### 方案

- 按本 ADR 增加 runtime source 和 custom path 设置。
- UI 展示当前 committed runtime 与候选/待生效 runtime，不用输入框猜状态。
- 实现旧 `claudeCodePath` 的版本化迁移。
- 自定义路径通过原生文件选择器选择；renderer 不获得任意文件执行权限。
- 系统检测展示命中的真实路径和版本，并支持手动重新探测。

#### 验收标准

- 全新设置默认 `bundled`。
- 旧空路径安装迁移为 `system`，旧自定义路径迁移为 `custom`。
- 重启后 selection 保持，resolved runtime 重新 probe 并与 UI 对账。
- 无效候选不会覆盖当前可用 runtime。
- 自定义路径只接受主进程验证过的普通可执行文件。
- 设置页不显示或泄露 API Key，诊断路径完成 home 脱敏。

### M4：安全切换、会话兼容与恢复现场

#### 目标

消除设置热重载中断所有任务的问题，并使 runtime 变化后的会话恢复语义真实、可解释。

#### 方案

- RuntimeSwitchCoordinator 维护 desired、pending 和 committed generation。
- 活动 run 存在时默认延迟提交；用户立即切换必须二次确认并列出影响范围。
- backend 创建时绑定 immutable runtime fingerprint。
- runtime/provider 不兼容时清除 SDK Session ID，但保留 UI Thread 历史、工作区和挂载资源。
- conversation snapshot 增加 runtime provenance 和迁移逻辑。
- Agent Panel 显示“运行时已切换，新 Agent 上下文”边界事件。

#### 验收标准

- 保存设置不会无提示中断活动任务。
- 延迟切换在最后一个活动 run 终态后只提交一次。
- 立即切换会给所有受影响 run 发送明确的 `runtime_reconfigured` 终态。
- 同 fingerprint 重启可以恢复 SDK Session；不兼容 fingerprint 不会复用旧 Session ID。
- 项目切换不改变 runtime generation，也不会把其他项目的 session provenance 串入当前项目。
- 窗口重建、应用退出和失败回滚均释放 probe/子进程/监听器，无悬挂 Claude 进程。

### M5：认证、诊断和独立降级闭环

#### 目标

让用户能够区分“运行时坏了”“没有认证”“provider 失败”和“会话不兼容”，并从 UI 完成修复。

#### 方案

- RuntimeProbe 与 provider readiness 分开报告。
- provider readiness 通过设置页显式触发的无工具、单轮隔离请求验证；测试只读取主进程加密凭证，不复用正式会话。
- 设置页显示版本、架构、来源、最后探测时间和修复动作。
- Agent 诊断加入 runtime manifest、fingerprint 摘要、generation、provider 类型、认证是否配置和最近失败码。
- 继续使用 safeStorage；诊断只输出布尔认证状态。
- capability registry 将 Agent 降级独立于 Browser、Editor、Terminal 和 Android。

#### 验收标准

- 缺少 API Key 显示 `AUTH_REQUIRED`，不显示“Claude Code 未安装”。
- provider 401、网络失败、runtime spawn 失败和会话不兼容呈现不同错误码。
- 一键诊断不包含 API Key、OAuth token、Cookie、完整 Session ID 或未脱敏 home path。
- Agent failed 时仍可打开项目、编辑文件、使用浏览器和 Terminal。
- 修复设置后可以重新 probe，不要求重启整个应用，除非错误明确标记为 restart-required。

### M6：发布候选与默认启用

#### 目标

在干净机器和真实安装包上证明默认内置 Agent 可交付，并保留明确回滚路径。

#### 方案

- 从干净 detached worktree 构建 arm64、x64 和 universal 候选产物。
- 在没有系统 Claude Code 的干净 macOS 用户环境运行安装包 smoke。
- 覆盖新安装、旧设置迁移、升级、runtime 损坏、provider 缺失、任务中切换和项目恢复。
- 更新用户文档、诊断说明、第三方许可清单和包体积说明。
- 默认值只对新安装设为 `bundled`；升级用户按 M3 迁移保留原行为。

#### 验收标准

- `pnpm verify`、`pnpm smoke:standalone` 和新增 packaged Agent smoke 全部通过。
- 当前工作树、干净 detached worktree 和 CI 使用同一锁文件通过。
- arm64 与 Intel 真人安装验收通过；universal 产物两端均使用正确 runtime。
- 新机器无系统 `claude` 时，配置受支持 provider 后可以完成读文件、写文件和 MCP 工具任务。
- runtime 损坏只降级 Agent，切换到有效 system/custom 后可恢复。
- 第三方许可、隐私、认证和数据使用说明随安装包提供。
- 任一 M0 法务/认证门禁失效，默认启用和二进制分发立即停止。

## 测试矩阵

| 维度         | 必测组合                                                         |
| ------------ | ---------------------------------------------------------------- |
| 安装类型     | 全新安装、旧版升级、设置迁移失败回滚                             |
| 架构         | darwin-arm64、darwin-x64、universal 两端                         |
| runtime 来源 | bundled、system、custom                                          |
| runtime 状态 | 正常、缺失、不可执行、hash 错误、版本不符、架构不符、probe 超时  |
| 认证         | API Key 已配置、未配置、401、兼容 provider 网络失败              |
| 生命周期     | 空闲切换、运行中延迟切换、确认立即切换、窗口重建、应用退出       |
| 会话         | 同 fingerprint 恢复、版本变化、provider 变化、项目切换、归档恢复 |
| 能力降级     | Agent 失败时 Browser、Editor、Terminal、Android 独立可用         |
| 安全         | 路径越界、manifest 篡改、诊断脱敏、renderer 伪造 probe 结果      |

## 备选方案

### 1. 继续只使用系统 Claude Code

拒绝。安装前置条件、PATH 差异和版本漂移仍然存在，无法形成稳定默认 Agent。

### 2. 下载并缓存最新版 Claude Code

拒绝作为默认路径。它引入更新源、下载完整性、代理、离线、供应链和回滚问题，也违背固定可复现版本的目标。

### 3. 直接依赖 SDK 在 `node_modules` 中自动解析内置二进制

拒绝作为 Electron 发布方案。开发环境可工作，但打包后会受到 optional dependency、目标架构和 ASAR 真实路径影响，产物不可审计。发布包必须使用显式 staged resource 和 manifest。

### 4. 把内置二进制提交到 Git

拒绝。仓库体积、许可审计、版本更新和供应链来源都会失控。二进制必须来自锁定依赖并在构建阶段生成证据。

### 5. 运行时失败后自动回退系统 PATH

拒绝。静默回退会让实际版本不可判断，并可能改变认证、权限和会话恢复行为。用户必须明确选择来源。

### 6. 切换运行时后继续复用所有 SDK Session ID

拒绝。不同 runtime/provider 的会话格式和上下文兼容性无法保证，伪恢复比明确开启新上下文风险更高。

## 风险与影响

- 单架构 Claude Code 原生二进制当前约 231 MB，universal 产物需要携带两个架构，安装包体积会明显增加。
- Agent SDK 与 Claude Code 形成更紧密的供应链依赖，升级必须同时做 packaged smoke。
- 系统/自定义模式仍可能发生用户自行升级导致的行为变化，但诊断将记录实际版本。
- runtime 切换导致 SDK Session 重建时，用户可能感知上下文边界；UI 必须明确说明，不能假装无损。
- Anthropic 许可或认证政策变化可能使内置分发不再可行；因此 M0 和发布前复审必须长期保留。
- 三种来源增加设置和测试组合，但其复杂度由单一 manager 和 contract 收敛，不能扩散到各 conversation/UI。

## 迁移与提交计划

每个里程碑形成可独立验证和回滚的工作包：

1. M0 只增加证据、探针和非默认打包实验，不改变用户路径。
2. M1 只建立 contract/manager/backend 注入边界，默认行为保持 system。
3. M2 接通打包资源，但仍由非默认开关验证 bundled。
4. M3 上线设置和迁移，新安装默认值先受构建期 gate 控制。
5. M4 修复切换和会话生命周期后，才允许 bundled 进入常规使用。
6. M5 完成诊断与降级，关闭“失败但原因不可判断”的缺口。
7. M6 满足全部门禁后，正式对新安装启用 bundled 默认值。

任何工作包不得顺手重构无关 Agent Panel、Browser 或 Settings 大文件。需要拆分时先固定行为并保持状态所有者不变。

## 回滚方案

- M1-M2 回滚：删除 manager/staging 接线，恢复 system 路径，不影响设置数据。
- M3 回滚：保留新字段读取但将默认选择映射为 system，避免设置文件不兼容。
- M4-M5 回滚：停止 bundled 提交，保留 runtime provenance 只读兼容。
- M6 发布后回滚：发布补丁将新安装默认值改回 system；现有用户的显式 selection 不被静默覆盖。
- 许可或安全问题：立即停止在新产物中携带二进制，保留 system/custom 模式和诊断说明。

## 回收或复审条件

出现以下任一情况必须复审本 ADR：

- Anthropic 改变 Claude Agent SDK、Claude Code 的分发许可或认证政策；
- SDK 不再携带平台原生二进制，或其版本关系不再可审计；
- 单架构二进制体积或启动成本超过产品可接受范围；
- macOS 签名、公证或安全策略不允许当前资源布局；
- SDK Session 在版本间提供官方兼容契约，可以安全放宽恢复规则；
- CCLink Studio 引入新的本地 Agent runtime，需要从 Claude 专用 manager 抽象为通用 runtime registry。

## 验证

本 ADR 的实现完成条件不是“设置页出现三个选项”，而是：

- 许可与认证门禁有书面结论；
- runtime 来源、版本、架构和 generation 可以被主进程查询和诊断；
- packaged app 在无系统 `claude` 的干净机器完成 Agent 工作流；
- 设置切换不无提示中断任务；
- 会话恢复不跨不兼容 fingerprint 伪续接；
- Agent 故障保持独立降级；
- 三种来源和双架构测试矩阵通过；
- `pnpm verify`、受影响 smoke、干净 worktree 与真实安装包验收全部通过。

## 拷问

- 我们真正解决的是“默认 Agent 可复现”，还是只把外部依赖藏进了更大的安装包？
- 安装包能找到二进制，不代表许可证允许再分发，也不代表用户已经具备合法认证方式。
- 内置版本减少版本漂移，但不会解决模型服务网络、上下文压缩、provider 质量或 MCP 工具自身故障。
- 三种来源如果没有单一状态所有者和 runtime fingerprint，很快会重新退化成“到底运行了哪个 claude”无法判断。
- 最危险的失败不是启动失败，而是切换后继续拿旧 Session ID 伪装上下文完整。恢复语义必须宁可明确中断，也不能假装无损。
