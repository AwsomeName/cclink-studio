# Terminal Tab 模型与权限审计

> 状态：M6 第一版可测试闭环；已接本地 shell、CCLink 单命令远程执行、输出事件、权限确认和审计
> 最后更新：2026-07-14
> 关联文档：`docs/features/product-milestones.md`、`docs/features/product-experience-pages.md`、`docs/features/remote-error-model.md`

## 结论

Terminal 不是 Activity Bar 入口，也不是“顺手加一个 shell”。它是工作空间下的高风险 Tab 类型：

```text
Terminal Tab
├─ workspaceRef：属于哪个工作空间
├─ runtime：本地还是远程、走什么 transport、用什么 backend
├─ permissionPolicy：哪些命令必须确认
├─ closePolicy：关闭 Tab 时如何处理进程
└─ auditLogId：命令、审批、输出、退出和错误的审计线索
```

第一版已开放受控执行：本地 Terminal 通过 Node shell 进程执行；CCLink 远程 Terminal 通过 `terminal_command/terminal_output` 做单命令执行。它仍不是完整 PTY，交互式全屏程序和 Direct Remote 尚未完成。

## 产品定位

Terminal 的用户心智：

- 本地工作空间打开的是本机 Terminal。
- 远程工作空间打开的是远端 Terminal。
- 本地和远程只差 `runtime`，不差入口模型。
- Terminal 跟 Markdown、Browser、Android、Conversation 一样，是当前工作空间的工作现场。
- 当前新建菜单可以创建 Terminal 受控 Tab；它展示 runtime / 权限 / 关闭策略，并允许命令进入权限、确认、审计和执行链路。

它不应该成为：

- 全局终端入口。
- CCLink 专属面板。
- Agent 隐式执行命令的黑箱。
- 没有审计的远程 root shell。

## 共享模型

共享类型位于 `src/shared/terminal.ts`。

核心结构：

```ts
interface TerminalTabRef {
  runtime: TerminalRuntimeRef
  permissionPolicy: TerminalPermissionPolicy
  status: TerminalStatus
  closePolicy: TerminalClosePolicy
  sessionId?: string
  processId?: string | number
  auditLogId?: string
}
```

### Runtime

```text
runtime
├─ location: local | remote
├─ transport: local | direct | cclink
├─ backend: local-shell | remote-shell | codex | custom
├─ workspaceRef
├─ cwd
├─ shell
└─ endpointId
```

规则：

- `workspaceRef` 必填；Terminal 必须归属于一个工作空间。
- `location = remote` 时，`workspaceRef.kind` 必须是 `remote`。
- `transport = local` 只能用于本地工作空间。
- `transport = cclink/direct` 只能用于远程工作空间。
- `cwd` 默认使用工作空间路径，不能默认为用户 home 后静默执行。

### Permission Policy

```text
permissionPolicy
├─ mode: read-only | ask-every-command | ask-risky-command | trusted-session
├─ requireConfirmationFor
├─ allowlist
└─ denylist
```

默认建议：

| 场景 | 默认模式 | 说明 |
|---|---|---|
| 本地 Terminal | `ask-risky-command` | 读命令可直接跑，写/破坏/提权需确认 |
| 远程 Terminal | `ask-every-command` | 第一版远程更保守，避免误操作服务器 |
| Agent 发起命令 | `ask-risky-command` 或更严 | 不能继承用户手动 Terminal 的宽权限 |
| 只读诊断 | `read-only` | 只允许 `pwd/ls/cat/git status` 等低风险操作 |

风险分类：

- `read`：查看状态，不改变文件或系统。
- `write`：写文件、改配置、安装依赖。
- `network`：访问外网、下载、上传。
- `destructive`：删除、覆盖、清库、格式化、kill 大范围进程。
- `privileged`：sudo、系统权限、钥匙串、证书、系统服务。
- `unknown`：无法分类，必须按高风险处理。

当前权限判定器位于 `src/main/terminal/terminal-permission.ts`。它只输出 `allow / confirm / deny`，不执行命令、不弹 UI、不写审计。

当前确认服务位于 `src/main/terminal/terminal-confirmation-service.ts`。它负责生成带 `id / createdAt / expiresAt` 的确认请求，通过 `terminal:requestCommandConfirmation` 发给渲染进程，并在用户拒绝、窗口销毁、发送失败或 60 秒超时时返回拒绝。它仍然不执行命令，也不负责展示 UI。

当前 IPC / preload / renderer 接收链路已落地：

- `src/main/ipc/terminal-ipc.ts`：接收渲染进程的 `terminal:resolveCommandConfirmation`。
- `src/preload/index.ts`：暴露 `window.deepink.terminal.onRequestCommandConfirmation / resolveCommandConfirmation`。
- `src/renderer/src/bootstrap/use-terminal-events.ts`：订阅确认事件。
- `src/renderer/src/stores/terminal-store.ts`：保存待确认请求队列，供后续 UI 卡片消费。
- `src/renderer/src/components/agent-panel/TerminalConfirmationCards.tsx`：在 Agent 面板消息流中展示命令、风险、来源、运行位置和允许/拒绝按钮。

判定顺序：

1. 空命令直接拒绝。
2. `denylist` 优先，命中后直接拒绝。
3. `allowlist` 次之，命中后直接允许。
4. 再按命令风险和 `mode` 判定：
   - `read-only`：只允许 `read`。
   - `ask-every-command`：全部确认。
   - `ask-risky-command`：命中 `requireConfirmationFor` 或 `unknown` 时确认。
   - `trusted-session`：已知风险允许，`unknown` 仍确认。

拷问：`allowlist` 不是万能钥匙；它只能放行明确命令前缀，不能替代审计。`denylist` 必须优先，否则用户可能用 allowlist 绕过高危命令。

### Close Policy

关闭 Tab 不等于一定结束进程。第一版必须显式选择：

| closePolicy | 行为 | 适用场景 |
|---|---|---|
| `close-view` | 只关闭视图，进程继续运行 | 长任务、后台构建 |
| `terminate-process` | 关闭 Tab 时结束进程 | 普通交互 shell 默认 |
| `keep-running` | 明确后台保留，并进入任务/会话列表 | 远程长任务 |

默认建议：

- 新建普通 Terminal：`terminate-process`。
- Agent 启动的长任务：先确认，再可选 `keep-running`。
- 远程 Terminal 关闭前必须提示是否仍有活跃进程。

当前落地：

- `idle / exited / error` 状态的 Terminal 关闭 Tab 不弹确认。
- `starting / running / blocked` 且 `terminate-process` 的 Terminal 关闭前弹出“结束并关闭 / 取消”。
- `starting / running / blocked` 且 `keep-running` 的 Terminal 关闭前弹出“关闭视图 / 取消”。
- 本地 shell 会执行真实终止；CCLink 单命令远程当前只清理 DeepInk 侧 session，不代表远端存在持久 PTY 被终止。

## Session 状态机与执行边界

Terminal 的 UI Tab、审计事件、真实进程不能混成一个概念：

- Tab 是否打开，是工作台视图状态。
- Session 是否 `idle / starting / running / blocked / exited / error`，是执行现场状态。
- 审计事件 `created / closed / terminated / output / exit / error` 是可追溯记录，不等同于当前状态。

当前主进程已新增状态机和内存登记表：

- `src/main/terminal/terminal-session-state.ts`：创建 session 快照，校验状态迁移。
- `src/main/terminal/terminal-session-registry.ts`：登记、查询、迁移、移除内存 session。
- `src/main/terminal/terminal-command-orchestrator.ts`：串起权限判定、确认请求、审计写入、session 状态迁移和真实/远程执行 adapter 派发。
- `src/main/terminal/terminal-execution-adapter.ts`：定义未来本地 shell、远程 shell、Codex/custom backend 的执行适配器接口。
- `src/main/terminal/terminal-local-shell-adapter.ts`：本地 shell adapter，使用 `child_process.spawn` 启动本地 shell，转发 stdout/stderr/exit/error 事件。
- `src/main/terminal/terminal-cclink-execution-adapter.ts`：CCLink 远程 adapter，发送 `terminal_command`，等待 `terminal_output`，用于单命令远程维护。
- `src/main/terminal/terminal-composite-execution-adapter.ts`：按 runtime 路由到 local / cclink adapter。
- `src/main/terminal/terminal-noop-execution-adapter.ts`：保留为测试和未来后端未接入时的结构化错误适配器。
- `src/main/ipc/terminal-ipc.ts`：`terminal:recordLifecycleEvent` 写入审计时同步 Registry；`created` 带 runtime 时登记 session，`closed` 移除 session，`terminated` 尝试迁移为 `exited` 后移除 session。
- `terminal:listSessions`：只读返回当前内存 session 快照，用于设置页诊断；不能启动、写入、终止或恢复 session。
- `terminal:submitCommand`：受限命令提交边界，先做输入规整，再进入执行编排器；本地/CCLink 成功派发时返回 `execution: started`。

允许的第一版状态迁移：

```text
idle
├─ starting
│  ├─ running
│  │  ├─ blocked
│  │  │  ├─ running
│  │  │  ├─ exited
│  │  │  └─ error
│  │  ├─ exited
│  │  └─ error
│  ├─ blocked
│  ├─ exited
│  └─ error
├─ blocked
│  ├─ idle
│  ├─ running
│  ├─ exited
│  └─ error
└─ error
```

补充规则：

- `exited / error` 是终态，不能恢复为 `running`。
- 同状态迁移允许，用于刷新 `processId / lastCommand / updatedAt` 等元信息。
- `idle -> blocked -> idle` 只用于“shell 进程尚未启动前先请求命令确认”的路径。
- 关闭 Tab 写 `closed / terminated` 审计；`terminated` 会调用执行 adapter 的 `terminate`。
- 本地 shell 终止会杀掉本机子进程；CCLink 单命令远程 session 当前只清理 DeepInk 侧运行态，不代表远端有持久 PTY 被杀掉。
- 执行适配器接口定义 `start / write / resize / terminate / onEvent`；本地 shell 和 CCLink 单命令远程已接，Direct Remote 和完整 PTY 尚未接。

### 执行编排器

当前 `TerminalCommandOrchestrator` 已落主进程、接入受限 IPC，并已有 Terminal Tab 内的受控命令输入 UI。它的职责是把命令提交路径压成一个可测试闭环：

```text
submitCommand
├─ 查 session 是否存在、状态是否允许提交
├─ evaluateTerminalPermission
├─ deny：写 command-denied 审计，返回 denied
├─ confirm：session -> blocked，发确认请求，确认后恢复原状态
├─ allow / approved：写 command-submitted 审计
├─ 尝试派发到 executionAdapter
├─ adapter 成功：返回 execution: started，并通过 executionEvent 推送输出
├─ adapter 失败：写 error 审计，返回 execution: not-started
└─ renderer 保存输出并同步 Terminal Tab 状态
```

关键边界：

- `accepted + execution: started` 代表命令已提交到执行后端；输出和退出仍以后续 executionEvent 为准。
- `accepted + execution: not-started` 代表权限链路通过，但执行后端未接入或启动失败。
- `command-submitted` 当前代表“已提交到待执行边界”，不是 shell 输出。
- `error` 可能代表本地进程启动失败、CCLink transport 失败、远端 agent 拒绝或后端未接入。
- `blocked` 只表示等待用户确认，不代表 shell 进程一定阻塞。
- 如果 session 不存在，或处于 `blocked / starting / exited / error` 等不可提交状态，会在权限判定前拒绝。

当前受限 IPC 已补：

- `terminal:submitCommand` 只接受 `terminalSessionId / command / actor / permissionPolicy / workspaceKey`。
- 非法 actor、空命令、非法权限模式会直接返回 `rejected`。
- 成功返回包含 `execution: started | not-started`。
- 当前主进程已接入 composite adapter：本地走 `LocalShellExecutionAdapter`，CCLink 远程走 `CclinkTerminalExecutionAdapter`。
- preload 已暴露 `window.deepink.terminal.submitCommand`，Workbench Terminal Tab 已接入受控命令输入入口。
- preload 已暴露 `window.deepink.terminal.onExecutionEvent`，renderer 会持久保存当前 session 输出并更新 Tab 运行态。

拷问：当前仍不是完整 PTY。`vim/top/ssh` 这类交互式全屏命令不应作为验收标准；第一版验收应看 `pwd/ls/git status/pnpm build` 这类维护命令、权限确认、输出和关闭终止。

拷问：如果没有这层状态机，未来“关闭 Tab”“断开远程连接”“命令等待确认”“进程退出”会全部挤在一个布尔值里，最后又会出现看起来在线、实际无进程，或者 UI 关了但远端命令还在跑的混乱。

## 审计模型

Terminal 必须记录审计事件：

```text
created
closed
terminated
command-confirmation-requested
command-confirmation-timeout
command-submitted
command-approved
command-denied
output
exit
error
```

审计不是“开发日志”，而是用户能追溯：

- 谁发起了命令：用户 / Agent。
- 命令在哪个工作空间执行。
- 是否经过确认。
- 输出和退出码是什么。
- 如果失败，`RemoteError` 是什么。

第一版审计先落本地记录；远程 Terminal 接入后，远端也必须能回传执行事件。

当前本地审计存储位于 `src/main/terminal/terminal-audit-store.ts`，写入 `userData/terminal-audit-log.json`。它只负责记录和查询事件，不负责执行命令，也不负责权限判定。

当前 Terminal 确认服务已接入审计写入链路：

- 创建确认请求时写入 `command-confirmation-requested`。
- 用户允许时写入 `command-approved`。
- 用户拒绝、窗口不可用、发送失败或服务销毁时写入 `command-denied`。
- 60 秒无响应超时时写入 `command-confirmation-timeout`。
- 审计写入失败不会阻塞确认结果，但会输出 warning；后续需要诊断页暴露。

当前审计查询 IPC 已落地：

- `terminal:recordLifecycleEvent`：仅允许记录 `created / closed / terminated` 这类 session 生命周期事件。
- `terminal:listSessions`：只读列出当前主进程内存 session，用于诊断 Registry 是否和 Tab 生命周期对齐。
- `terminal:submitCommand`：受限命令提交边界，执行权限/确认/审计/状态迁移闭环；执行后端成功接收时返回 `execution: started`。
- `terminal:listAuditEvents`：按 `terminalSessionId / workspaceKey / limit` 查询。
- `terminal:clearAuditSession`：清理单个 Terminal session 的审计。
- `terminal:clearAuditEvents`：清理全部 Terminal 审计。
- `window.deepink.terminal` 已暴露对应 preload API。

当前最小审计可视化已落地到 `设置 > Agent > Terminal 审计`：

- 展示当前 Terminal session 快照，包括 sessionId、状态、runtime、更新时间、最后命令或错误。
- 展示最近 30 条 Terminal 审计事件。
- 支持手动刷新。
- 支持清空全部 Terminal 审计。
- 当前展示生命周期、确认、审批、拒绝、超时、输出、退出和错误事件；完整 PTY 输出历史仍需继续增强。
- 当前 session 快照是只读诊断信息，不提供终止、恢复、重启等操作入口。

已支持：

- 按时间追加审计事件。
- 按 `terminalSessionId` 查询。
- 按 `workspaceKey` 查询。
- 限制返回最近 N 条事件。
- 清理单个 Terminal session 或全部审计事件。

## 错误模型

Terminal 错误复用 `RemoteError`：

| 错误 | layer | code |
|---|---|---|
| 远端链路不可用 | `transport` | `REMOTE_TRANSPORT_UNAVAILABLE` |
| 远端 Terminal 会话不存在 | `execution-backend` | `REMOTE_SESSION_NOT_FOUND` |
| 执行 backend 未接入 | `execution-backend` | `REMOTE_EXECUTION_BACKEND_UNAVAILABLE` |
| 命令执行失败 | `execution-backend` | `REMOTE_AGENT_ERROR` 或更具体业务码 |
| 权限拒绝 | `execution-backend` | `REMOTE_PERMISSION_DENIED` |
| 协议不兼容 | `remote-agent` | `REMOTE_PROTOCOL_INCOMPATIBLE` |

`REMOTE_PERMISSION_DENIED` 目前还未进入共享通用码表；接更多远程 provider 前需要补入。

## 当前落地状态

已落地：

- 新增 `src/shared/terminal.ts`，定义 runtime、权限策略、关闭策略和审计事件。
- 新增 `src/main/terminal/terminal-audit-store.ts`，持久化 Terminal 审计事件。
- 新增 `src/main/terminal/terminal-session-state.ts`，提供 Terminal session 状态机与非法迁移拦截。
- 新增 `src/main/terminal/terminal-session-registry.ts`，提供主进程内存 session 登记、查询、迁移和移除边界。
- 新增 `src/main/terminal/terminal-command-orchestrator.ts`，提供权限判定、确认、审计、状态迁移和 execution adapter 派发。
- 新增 `src/main/terminal/terminal-execution-adapter.ts`，定义未来本地/远程执行 backend 的适配器接口。
- 新增 `src/main/terminal/terminal-noop-execution-adapter.ts`，提供不会执行 shell 的 no-op 适配器；所有执行操作都会 emit `error` 并抛出 `REMOTE_EXECUTION_BACKEND_UNAVAILABLE`。
- 新增 `src/main/terminal/terminal-permission.ts`，提供命令风险分类和权限判定。
- 新增 `src/main/terminal/terminal-confirmation-service.ts`，提供 Terminal 命令确认请求、超时拒绝、销毁拒绝和审计写入内核。
- 新增 `src/main/ipc/terminal-ipc.ts`、`src/shared/ipc/terminal.ts` 和 preload API，打通 Terminal 确认请求/响应与审计查询/清理通道。
- 新增 `src/renderer/src/stores/terminal-store.ts` 和 `use-terminal-events.ts`，前端能接收并缓存待确认命令。
- 新增 `src/renderer/src/components/agent-panel/TerminalConfirmationCards.tsx`，Terminal 待确认命令能在 Agent 面板中显示，并支持“允许一次 / 拒绝”。
- 新增 `src/renderer/src/utils/terminal-confirmation.ts`，集中维护 Terminal 风险、来源、运行位置和超时显示。
- 新增 `src/renderer/src/utils/terminal-tab.ts`，集中生成本地 / 远程 / 未归档工作空间的 Terminal Tab 占位 runtime 和权限策略。
- 新增 `src/renderer/src/utils/terminal-lifecycle.ts`，把 Terminal 创建、关闭、终止语义和 runtime 通过受限 IPC 写入审计，并供主进程同步 session registry。
- 新增 `src/renderer/src/utils/terminal-command.ts`，把 Terminal Tab 的用户命令提交到受限 IPC，并在恢复后的 session 缺失时重新登记生命周期后重试一次。
- 新增 `src/main/terminal/terminal-local-shell-adapter.ts`，接入本地 shell 执行。
- 新增 `src/main/terminal/terminal-cclink-execution-adapter.ts`，接入 CCLink 单命令远程执行。
- 新增 `src/main/terminal/terminal-composite-execution-adapter.ts`，按 runtime 路由执行后端。
- `terminal:recordLifecycleEvent` 已接入 `TerminalSessionRegistry`：创建时登记，关闭/终止时移除，终止时对活跃 session 先收口到 `exited`。
- `terminal:listSessions` 已提供只读 session 快照，设置页能显示当前 Registry 状态。
- `terminal:submitCommand` 已接入执行编排器，并做 actor、命令、权限策略输入规整；当前 Workbench Terminal Tab 已提供受控 UI 入口。
- `terminal:submitCommand` 权限通过后会触达 composite execution adapter，并把输出/退出/错误事件推给 renderer。
- renderer `terminal-store` 已按 session 缓存输出；Terminal Tab 可显示 stdout/stderr/system/error 行并清空输出。
- `src/renderer/src/utils/close-tab.ts` 已识别 Terminal 活跃状态与 `closePolicy`，活跃 Terminal 关闭前必须确认。
- 设置页 `Agent` 分组新增 `Terminal 审计`，可查看当前 session 快照、最近审计事件、刷新和清空全部审计。
- `TabType` 新增 `terminal`。
- `Tab` 新增 `terminal?: TerminalTabRef`。
- Workbench 新建菜单已提供 `Terminal` 项；`terminal` Tab 已从纯占位升级为受控命令入口和输出面板。
- Tab store 能保存和恢复 Terminal Tab 快照。
- 已补 `terminal-audit-store.test.ts`，覆盖审计写入、重载、过滤、limit 和清理。
- 已补 `terminal-permission.test.ts`，覆盖读、写、网络、破坏、提权、unknown、allowlist、denylist 和四种策略模式。
- 已补 `terminal-confirmation-service.test.ts`，覆盖确认请求结构、允许/拒绝、超时、窗口销毁、发送失败、服务销毁和审计失败不阻塞确认。
- 已补 `terminal-ipc.test.ts` 和 `terminal-store.test.ts`，覆盖确认结果 IPC 回传、受限命令提交、session 快照查询、审计查询/清理、生命周期事件同步 registry、未就绪降级与前端确认队列去重/移除。
- 已补 `terminal-confirmation.test.ts`，覆盖 Terminal 风险/来源标签、运行位置和超时显示。
- 已补 `terminal-session-state.test.ts` 和 `terminal-session-registry.test.ts`，覆盖 session 创建、合法生命周期、终态拦截、重复登记、未知 session 和移除清理。
- 已补 `terminal-command-orchestrator.test.ts`，覆盖低风险命令直通、风险命令确认、确认拒绝、只读策略拒绝、缺失/忙碌 session 拒绝、idle session 触发 adapter start、running session 触发 adapter write，并确认所有路径都不启动真实执行。
- 已补 `terminal-noop-execution-adapter.test.ts`，覆盖 no-op backend 的结构化错误、事件派发、取消监听和操作级上下文。
- 已补 `terminal-local-shell-adapter.test.ts`，覆盖本地 shell 启动、stdout/stderr、写入和终止。
- 已补 `terminal-cclink-execution-adapter.test.ts`，覆盖 CCLink terminal_command、terminal_output 和离线远端结构化错误。
- 已补 `terminal-command.test.ts`，覆盖命令提交、空命令拦截、恢复后 session 缺失时重新登记并重试。

未落地：

- 没有完整 PTY；本地 shell 基于 `child_process.spawn`，不支持 resize 和全屏交互式程序。
- CCLink 远程执行是单命令请求/响应，不是持久远程 PTY。
- Direct Remote 尚未接入。
- 没有完整诊断页或按工作空间/session 深筛的审计页面。
- 没有真实进程生命周期管理；目前只有状态机、内存登记表和 Tab 层关闭确认语义。

## 拷问

- 如果关闭 Terminal Tab 时还有进程，默认杀掉还是后台保留？
- 如果 Agent 发起 `rm -rf`，权限确认应该显示给谁、怎么审计？
- 如果远程 Terminal 断线，用户看到的是链路问题、远端 Agent 问题，还是 shell 进程问题？
- 如果 Terminal 复用工作会话权限，会不会让远程 shell 继承过宽权限？
- 如果没有审计日志，用户怎么知道三分钟前是谁执行了命令？
