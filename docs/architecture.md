# CCLink Studio 架构说明

> 当前事实源。最后更新：2026-07-28。

## 结论

CCLink Studio 是 CCLink 的开源桌面工作台端，不是 CCLink Studio 接入 CCLink，也不是独立账号体系。

开源仓库的目标是提供本地优先的桌面壳、浏览器/文档/Android/Terminal/Agent 工作台、MCP 工具和可扩展 IPC 边界。官方账号、云函数、配对、消息路由、额度和生产 API 注入由闭源工作区与 CCLink 主项目承接。开源版和商业版各自从自己的不可变 Tag 独立构建、签名、公证和发布。

## 项目边界

| 位置                                            | 角色                                                                                            |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `/Users/apple/Desktop/cclink-dev/cclink-studio` | 开源桌面壳。独立发布开源版，不内置官方生产 API、登录、订阅、官方消息网络或云同步。              |
| `/Users/apple/Desktop/cclink-dev`               | 闭源总控/商业版编译工作区。独立承接官方集成层、生产 API 注入、商业版签名、公证和 release 基线。 |
| `/Users/apple/Desktop/chat-cc/deploy`           | CCLink 云函数与账号体系。                                                                       |
| `/Users/apple/Desktop/chat-cc/Agent`            | CCLink Agent runtime。                                                                          |

不存在额外拆分出的云端或 Agent 独立项目。

## 架构宪法

本节是 CCLink Studio 后续设计、实现和评审的最高工程约束。功能文档只能细化这些原则，不能覆盖这些原则；与本节冲突的实现不得以“先上线再治理”为理由合入。

### 1. 单一产品边界

- Studio OSS 是本地优先的 Electron 桌面工作台，必须可以单仓库、免官方账号启动。
- 官方账号、订阅、消息网络、云同步、生产 API 和发布链路只能通过官方集成层进入。
- renderer 不得直接依赖官方实现、Node.js 或主进程内部模块。

### 2. 最小权限与不可信内容隔离

- renderer、内嵌网页、用户文档、网页下载和 Agent 输出都按不可信输入处理。
- preload 只暴露完成当前界面职责所需的最小 API；主进程必须校验 sender、参数和资源作用域。
- HTML、Markdown、SVG、网页内容不得未经清洗进入拥有高权限 preload 的执行上下文。无法证明安全时，必须放入无 preload 的隔离视图或明确降级。
- 密钥不得进入普通设置、日志、诊断报告或 renderer 全量状态；必须使用本机加密存储，renderer 只能获知是否已配置。
- 会校验浏览器完整性的第三方登录必须使用应用内独立认证子进程：禁用 preload、CDP 和自动化挂钩，启用 sandbox 与 context isolation，并使用按 Profile 隔离的持久化 session。认证子进程只能通过受校验的 contract 回传允许列表内的站点状态，不能把认证窗口变成通用自动化窗口。

### 3. 能力独立、失败可降级

- Agent 核心、浏览器、编辑器、Terminal、Android、数据源和可选插件是独立能力模块。
- 任一可选模块初始化失败，只能使该模块不可用，不得阻断应用启动或无关能力。
- 能力状态必须可查询、可诊断，并区分 `ready`、`degraded`、`unavailable` 和 `failed`，不能只写控制台日志。

### 4. 生命周期必须对称

- 服务由同一个运行时注册表拥有，启动、失败回滚、窗口重建和停止必须使用同一份声明。
- 注册 IPC、事件监听器、子进程、文件监听器和 session 监听器时，必须同时定义释放路径。
- 初始化和清理必须幂等；禁止在不同文件里手工维护两份服务或 IPC 清单。

### 5. 契约先于实现

- IPC、MCP 和持久化数据先定义共享 contract 与运行时 schema，再实现 handler 和调用端。
- 通道名、参数校验、权限、错误模型和清理逻辑应来自同一声明源，不能靠 main、preload、renderer 三处字符串同步。
- 跨边界错误必须结构化并可诊断，不得依赖 UI 猜测或解析日志文本。

### 6. 状态只有一个所有者

- 工作区、浏览器 Profile、会话、标签页和 Terminal 状态必须有明确唯一所有者及作用域标识。
- 可选能力的本地加密凭证必须按需解密。应用启动只能加载非敏感配置和凭证引用；只有用户进入对应凭证管理界面，或实际执行需要该凭证的操作时，能力所有者才能访问 `safeStorage`。Agent 启动所必需的显式 API 凭证和 Chromium 恢复持久化浏览器登录态属于可审计例外。
- 跨 store 协作通过显式 command、service 或 transition 完成，禁止多个 store 相互修改内部状态形成隐式事务。
- 持久化写入必须串行、原子、可迁移、可恢复；快照型分区在写入进行中只保留最新待写值，不能把 Agent 流式中间态排成无界磁盘队列；切换项目时必须验证旧任务、视图和监听器已经解绑。

### 7. 外部副作用由人确认

- AI 可以准备内容、填写表单和执行可撤销的本地步骤。
- 发帖、评论、发送消息、付款、删除远端数据和其他不可逆外部提交，必须在最后一步由用户明确确认。
- 权限模式不能绕过这一产品级确认边界。

### 8. 可观测性是功能的一部分

- 每个长任务必须有稳定 ID、状态、当前步骤、开始/结束时间、失败原因和所属工作区。
- 诊断日志必须覆盖 renderer、IPC、主进程、工具调用、浏览器/Profile 和持久化状态，同时默认脱敏。
- 项目切换、窗口重建或后台运行不得让任务状态变成不可判断。

### 9. 质量门禁优先于功能数量

- `pnpm verify` 和受影响的 smoke 测试通过，才允许合入功能代码。
- 修复失败门禁、P0/P1 缺陷和架构违规，优先级高于新增功能。
- 大功能必须拆成可独立验证的小批次；不得长期在一个工作树堆积跨域改动。

### 10. 用户命令只有一个定义源

- 工具栏、快捷键、命令面板和上下文菜单必须引用同一个稳定 command ID、可用条件和领域执行入口，不能分别复制业务逻辑。
- 菜单只拥有瞬时 UI 状态；文件、Tab、Browser、Terminal、Thread 等业务副作用仍由对应领域模块拥有。
- 各模块通过 contribution 注册上下文操作，不得持续扩张一个包含所有业务的全局菜单组件。
- Browser `WebContentsView` 的网页菜单使用主进程原生适配器和有界 shared contract，不得依赖 DOM 注入、CDP 或高权限 preload。
- 任何入口都不能绕过权限、危险操作确认或不可逆外部副作用的最终人工确认。
- 上下文操作 owner 必须登记在 `docs/ops/context-action-inventory.md` 并通过 `pnpm verify:context-actions`；重复 command/contribution、孤儿 owner、未覆盖 target、第二个菜单 Store 或未登记原生菜单属于架构门禁失败。
- 上下文操作诊断只记录失败分类、稳定 ID、target kind 和脱敏消息，不记录凭证、target payload 或网页正文。

### 11. 用户闭环先于工程完成度

- 新功能必须先定义用户在真实应用中可执行的端到端验收动作，再设计 contract、服务、
  UI、发布和测试任务。只有内部产物、CI 或脚本的阶段不得标记为产品里程碑。
- 构建、签名、公证、Manifest、Schema、重构和测试基建只计入工程准备度，不计入
  用户功能进度。汇报必须分列两者，并默认先报告用户功能进度。
- 实施顺序优先形成最小纵向闭环，使用户尽早看到真实行为；横向基础设施只做到当前
  闭环所需的最小范围，再按失败证据补强。
- 连续开发超过 60 分钟没有产生新的用户可验收能力时，必须执行偏航检查。单项前置
  工作超过 60 分钟或同一阻塞连续失败两次时，必须停止扩张并重新确认主线取舍。
- 产品完成声明必须附真实应用中的用户验收结果。mock、单元测试、CI、Draft Release
  或文档通过，只能证明相应工程门禁，不能证明用户功能完成。
- 阶段总结必须先回答“用户现在能做什么、还不能做什么”，再报告内部里程碑、提交、
  测试或工程准备度。

## 架构变更规则

如果需求确实需要违反上述原则，必须先在 `docs/decisions/` 新增 ADR，写清问题、选择、风险、替代方案、迁移与回收条件，并在实现前完成评审。没有 ADR 的例外视为架构缺陷，而不是默认的新模式。

已关闭的稳定化阶段、修复顺序和退出证据见 `docs/stabilization.md`。后续功能按本架构宪法和 `docs/development.md` 的门禁受控推进。

## 开源版能力

CCLink Studio 开源壳保留这些本地能力：

- Electron + React + TypeScript 桌面工作台。
- VSCode 风格布局：Activity Bar、Sidebar、Workbench、Agent Panel、Status Bar。
- 本地工作空间、标签页、浏览器、Markdown 编辑器、Android/设备视图、Terminal。
- 本地 Agent 会话、本地 Claude Code 后端、MCP 工具系统和权限确认。
- 本地设置、诊断、文件访问和工作台状态恢复。
- updater 的中性检查框架，以及只针对本仓库不可变 Tag 的开源版签名、公证和制品发布链路。

桌面发布与更新的状态所有权、发布权限边界、R0 发布基线和 U0-U5 更新验收以
`docs/features/desktop-release-and-updates.md` 为产品事实源，任务拆解、代码落点、
工作量、失败矩阵和验收证据以
`docs/features/desktop-update-development-plan.md` 为执行事实源。Developer ID
直接分发是当前默认路线；Mac App Store 需要独立 ADR。

这些能力不需要用户登录 CCLink，也不依赖官方云服务。

## 独立启动边界

`cclink-studio` 必须可以作为单仓库独立启动：

- `pnpm dev` 直接启动开发模式。
- `bash scripts/restart.sh restart` 启动后台开发进程。
- 默认启动不得要求存在 `cclink-dev`、`chat-cc/deploy` 或 `chat-cc/Agent`。
- 官方账号、官方运行时和生产 API 只通过官方集成层进入。开源版发布链路不得读取官方集成层。

Android 是本地真机能力：只连接用户自有 USB 或 Wi-Fi ADB 真机。不提供 Android SDK 下载、AVD 创建、模拟器启动或托管设备服务。找不到 `adb` 时，Studio 应继续启动，Android 设备能力降级为不可用。

## 不在开源壳默认路径的能力

以下能力必须通过 `cclink-dev` / `chat-cc` 侧官方集成层接入：

- CCLink account / device / message / runtime 网络。
- 官方消息凭证、消息路由、配对、网络运行时注册。
- 登录、订阅、entitlement、quota、官方 feature gate。
- 云同步、网络文件树、网络文件查看、网络 session sidebar。
- 私有服务配置、生产 API 地址、商业版更新源及商业版发布流程。
- Android SDK/AVD 管理、模拟器启动、托管设备服务。

验收上，开源壳不应默认 import 官方账号、订阅、同步、消息网络或网络工作区实现，也不应默认暴露这些 preload API。

## 运行时分层

```text
renderer
  React UI, Zustand stores, workbench tabs, settings, local Agent panel

preload
  contextBridge exposes local-safe APIs only
  browser / agent / editor / fs / terminal / settings / updater / android ...

main
  Electron app lifecycle
  Browser WebContentsView
  Agent bridge and local Claude Code backend
  MCP tool host
  local filesystem, editor, terminal, diagnostics, updater shell

official integration layer (outside OSS default path)
  account, entitlement, CCLink device/message/runtime network, official release
```

## 状态与诊断基线

稳定化后的状态边界如下。运行事实不能由 renderer 的恢复快照反向覆盖；项目切换只改变可见投影，后台运行是否继续由各自主进程事实源决定。

| 状态域             | 运行事实                                             | renderer 投影                        | 持久化与恢复                                                   |
| ------------------ | ---------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------- |
| workspace/tab      | `workspace-transition` 的 generation 与单一提交事务  | `workspace-store` / `tab-store`      | `WorkspaceStateService` 按 workspace 分区                      |
| Agent conversation | main Agent runtime 的 run/session                    | `agent-store` 的消息与可见运行状态   | workspace conversation snapshot；恢复后与 main 状态对账        |
| Browser/Profile    | `BrowserManager` 的 Tab 绑定与 Electron 持久 Session | Browser Tab 的 URL/Profile/View 状态 | Profile partition 保存 Cookie/localStorage，Tab 快照只保存绑定 |
| BrowserTask        | `BrowserTaskRuntime` 的 task/action 状态             | `browser-task-store`                 | 当前进程内可诊断任务；终态不伪装为持久后台任务                 |
| Terminal           | `TerminalSessionRegistry` / `TerminalSessionStore`   | Terminal Tab 与 renderer store       | 主进程 session record；项目恢复后通过 `listSessions` 对账      |

Agent 发起的浏览器任务在创建时固定 `workspaceKey`、`conversationId`、`agentRunId`、进程内随机 `agentSessionRef`、`tabId` 和 `profileId`。浏览器工具必须由 conversation 找到活动 BrowserTask，再直接使用该 `tabId` 注册的 Playwright Page；不得在同步后重新读取全局活跃 Page，否则项目切换会造成跨项目竞态。浏览器动作通过 `taskRunId` 归因。复制诊断必须报告关联链是 `matched`、`incomplete` 还是 `mismatch`，并列出缺失或错配字段；同一 Tab 上其他会话的任务不能被误选。

`agentSessionRef` 只在主进程当前生命周期内稳定，由随机值生成，不是 Session ID 的哈希或截断，也不能用于认证。诊断可以比较 UI/Main Session 是否一致，但不得输出 Session ID、Cookie 值、密码、验证码或 token。旧任务和手动 BrowserTask 没有关联块时保持兼容，但必须标为 `incomplete`，不能伪称已完整归因。

## 架构复审基线

2026-07-21 的稳定化退出复审未发现需要 ADR 的架构例外：开源/官方边界、renderer 隔离与密钥边界、能力独立降级、生命周期注册表、IPC 单一契约源、状态所有权、人工确认边界和诊断关联均有实现及回归测试。最终退出仍以 `docs/ops/stabilization-s4-acceptance.md` 的当前提交门禁、全新 detached worktree、远端 CI 和真人验收为准，任何一项未完成时不得把稳定化状态改为完成。

已知维护债务包括 `AgentPanel`、`SettingsPage`、`BrowserManager`、Browser MCP、文件服务和部分 store 仍超过约一千行。它们当前有领域边界和行为测试保护，未形成已知 P0/P1，因此不以机械拆文件阻塞稳定化退出；后续改动必须先固定行为，再按状态所有者拆分，不能重新引入第二套事务或写入所有者。

## 文档状态

当前事实源：

- `README.md`
- `AGENTS.md`
- `docs/README.md`
- `docs/architecture.md`
- `docs/development.md`
- `docs/features/context-action-system.md`
- `docs/official-integration-contract.md`

## 拷问

最容易出错的地方是把官方账号、消息、网络运行时或发布链路重新写进 Studio 默认路径。Studio 侧只保留本地工作台能力和清晰的官方集成接口。
