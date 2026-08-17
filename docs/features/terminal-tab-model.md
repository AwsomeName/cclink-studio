# Terminal Tab 模型与权限审计

> 当前事实源。最后更新：2026-08-17。

## 结论

CCLink Studio 默认提供免登录的本地受控 Terminal：本地 PTY、本地 shell、权限确认、审计、
session 状态、输出事件和只读诊断。用户进入已登录、已配对的 CCLink 远程工作空间时，同一套
Terminal 状态机可以选择 CCLink 远程 PTY adapter；远程能力失败不得影响本地 Terminal。

官方单命令执行、通用直连网络 runtime 和客户端 entitlement 安全边界仍不属于本地默认能力。
CCLink 远程 PTY 只能通过 Studio 统一 Terminal adapter 接入，不得复制 Tab、session、审计或
生命周期状态。

## 产品定位

Terminal 是当前工作空间里的高风险 Tab 类型，不是全局黑箱，也不是 Agent 隐式执行命令的后门。

用户心智：

- 本地工作空间打开的是本机 Terminal。
- 远程工作空间只在用户明确进入 CCLink 远程入口后打开对应 Agent 的远程 Terminal。
- Terminal 默认从当前工作空间路径启动。
- Terminal 跟 Markdown、Browser、Android、Conversation 一样，是工作空间内的工作现场。
- 活进程才叫可恢复；已退出或 App 重启后的 session 只能作为只读记录查看。

它不应该成为：

- 脱离工作空间的全局 shell。
- 没有权限确认的 Agent 执行通道。
- 没有审计的后台任务系统。
- OSS 默认网络 root shell。

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

本地默认 runtime 边界：

```text
runtime
├─ location: local
├─ transport: local
├─ backend: local-shell
├─ workspaceRef
├─ cwd
└─ shell
```

可选 CCLink 远程 runtime 边界：

```text
runtime
├─ location: remote
├─ transport: cclink
├─ backend: remote-shell
├─ RemoteWorkspaceRef
├─ endpointId
└─ cwd
```

约束：

- `workspaceRef` 必填。
- `cwd` 默认使用当前工作空间路径。
- 没有工作空间时，Terminal 可归属未归档/global workspace，但必须明确 cwd。
- OSS 默认不创建 `network` runtime。

## 权限策略

权限判定位于 `src/main/terminal/terminal-permission.ts`。

```text
permissionPolicy
├─ mode: read-only | ask-every-command | ask-risky-command | trusted-session
├─ requireConfirmationFor
├─ allowlist
└─ denylist
```

默认建议：

| 场景                  | 默认模式                   | 说明                               |
| --------------------- | -------------------------- | ---------------------------------- |
| 用户手动本地 Terminal | `ask-risky-command`        | 读命令可直接跑，写/破坏/提权需确认 |
| Agent 发起命令        | `ask-risky-command` 或更严 | 不能继承用户手动 Terminal 的宽权限 |
| 只读诊断              | `read-only`                | 只允许低风险查看命令               |

风险分类：

- `read`：查看状态，不改变文件或系统。
- `write`：写文件、改配置、安装依赖。
- `network`：访问外网、下载、上传。
- `destructive`：删除、覆盖、清库、格式化、kill 大范围进程。
- `privileged`：sudo、系统权限、钥匙串、证书、系统服务。
- `unknown`：无法分类，必须按高风险处理。

判定顺序：

1. 空命令直接拒绝。
2. `denylist` 优先。
3. `allowlist` 次之。
4. 再按风险和模式判定。

`allowlist` 不是万能钥匙，只能放行明确命令前缀，不能替代审计。

## 确认链路

确认服务位于 `src/main/terminal/terminal-confirmation-service.ts`。

职责：

- 生成带 `id / createdAt / expiresAt` 的确认请求。
- 通过 `terminal:requestCommandConfirmation` 发给渲染进程。
- 用户允许后继续执行。
- 用户拒绝、窗口销毁、发送失败、服务销毁或 60 秒超时后拒绝。
- 写入确认相关审计事件。

已接入：

- `src/main/ipc/terminal-ipc.ts`
- `src/preload/index.ts`
- `src/renderer/src/bootstrap/use-terminal-events.ts`
- `src/renderer/src/stores/terminal-store.ts`
- `src/renderer/src/components/agent-panel/TerminalConfirmationCards.tsx`

## 关闭策略

关闭 Tab 不等于一定结束进程。

| closePolicy         | 行为                                      | 适用场景             |
| ------------------- | ----------------------------------------- | -------------------- |
| `close-view`        | 只关闭视图，进程继续运行                  | 长任务               |
| `terminate-process` | 显式终止时结束进程；关闭 Tab 仍只关闭视图 | 普通交互 shell 默认  |
| `keep-running`      | 明确后台保留，并进入任务/会话列表         | 长任务或用户明确选择 |

当前规则：

- 关闭 Terminal Tab 不弹确认，默认只关闭视图。
- `starting / running / blocked` 状态关闭 Tab 时，进程继续运行，session 标记为可恢复。
- 终止本地 shell 必须走显式终止入口；终止会杀掉本机子进程。

## Session 状态机

Terminal 的 UI Tab、真实进程和审计事件必须分开。

- Tab 是否打开，是工作台视图状态。
- Session 是否 `idle / starting / running / blocked / exited / error`，是执行现场状态。
- 审计事件是可追溯记录，不等同于当前状态。

当前主进程模块：

- `src/main/terminal/terminal-session-state.ts`
- `src/main/terminal/terminal-session-registry.ts`
- `src/main/terminal/terminal-session-store.ts`
- `src/main/terminal/terminal-command-orchestrator.ts`
- `src/main/terminal/terminal-execution-adapter.ts`
- `src/main/terminal/terminal-pty-execution-adapter.ts`
- `src/main/terminal/terminal-local-shell-adapter.ts`
- `src/main/terminal/terminal-composite-execution-adapter.ts`
- `src/main/terminal/terminal-noop-execution-adapter.ts`

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
- 一个 Terminal session ID 只对应一次 PTY 生命周期；进入 `exited / error` 后不得再次用该
  session ID 启动 PTY。新进程必须创建新的 session ID，并由此生成新的远程 Terminal ID。
- 同状态迁移允许，用于刷新 `processId / lastCommand / updatedAt` 等元信息。
- `idle -> blocked -> idle` 只用于 shell 进程尚未启动前先请求命令确认。
- 应用重启后，旧活跃进程降级为不可 attach 的只读记录。

## 远程 PTY 断线与 Terminal ID 复用缺陷

2026-08-17 真实远程 Terminal 验收发现：腾讯 IM keepalive 请求超时后，远端 PTY 被结束并
进入 Agent tombstone；Studio 随后的视图重建仍以原 session ID 调用 `startPty`。CCLink
adapter 会把 session ID、endpoint、workspace 和 path 确定性映射为同一个 Terminal ID，
因此 Agent 正确返回 `TERMINAL_CONFLICT: Terminal ID was already used by a recent PTY`。

本缺陷的状态所有者和修复边界如下：

- `TerminalSessionRegistry / TerminalSessionStore` 继续是 session 状态事实源。
- 临时断线只能对仍存活的原 Terminal ID 执行 `attach`，不能创建第二个 PTY。
- `exited / error` session 是只读终态；renderer 挂载、窗口重建和项目切换不得再次启动它。
- 用户明确执行“重启 Terminal”时结束旧生命周期并创建新 session；新 session 才能 `open`。
- Agent tombstone 是防止迟到或重复请求误建 PTY 的安全边界，不通过删除 tombstone、放宽
  冲突或每次请求随机换 ID 来掩盖 Studio 生命周期错误。
- 远程失败只降级当前 Terminal，不阻断本地工作区、编辑器、Agent、浏览器或本地 Terminal。

用户端到端验收动作：

1. 在真实在线 Agent 上打开远程 Terminal，运行能持续输出并可识别进程连续性的命令。
2. 短暂中断并恢复 IM transport，确认 Studio attach 原 PTY，命令和输出从断点继续。
3. 让远端 PTY 确实退出或超过 lease，确认旧 Tab 保持 `exited / error` 且只读，不再发送
   `terminal_pty_open`，也不再出现 Terminal ID 冲突。
4. 明确执行“重启 Terminal”，确认 Studio 创建新 session/Terminal ID 并成功得到新 shell；
   旧输出仍保留为审计记录。
5. 对旧终态 Tab 执行窗口重建、项目切换和反复挂载，确认均不会复用旧 Terminal ID。

修复状态：Studio 代码与自动化门禁已完成；真实在线 Agent 断网验收仍待执行。在第 1-5 步
真人验收通过前，只能声明工程修复完成，不能声明远程 Terminal 用户闭环完成。

## 执行编排器

`TerminalCommandOrchestrator` 把命令提交压成可测试闭环：

```text
submitCommand
├─ 查 session 是否存在、状态是否允许提交
├─ evaluateTerminalPermission
├─ deny：写 command-denied 审计，返回 denied
├─ confirm：session -> blocked，发确认请求，确认后恢复原状态
├─ allow / approved：写 command-submitted 审计
├─ 派发到本地 executionAdapter
├─ adapter 成功：返回 execution: started，并通过 executionEvent 推送输出
├─ adapter 失败：写 error 审计，返回 execution: not-started
└─ renderer 保存输出并同步 Terminal Tab 状态
```

关键边界：

- `accepted + execution: started` 代表命令已提交到本地执行后端。
- 输出和退出仍以后续 `executionEvent` 为准。
- `accepted + execution: not-started` 代表权限链路通过，但执行后端未接入或启动失败。
- `blocked` 只表示等待用户确认。

## 审计模型

Terminal 审计记录：

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

审计回答：

- 谁发起了命令：用户 / Agent。
- 命令在哪个工作空间执行。
- 是否经过确认。
- 输出和退出码是什么。
- 如果失败，是权限拒绝、后端未就绪、进程错误还是用户取消。

本地审计存储位于 `src/main/terminal/terminal-audit-store.ts`，写入 `userData/terminal-audit-log.json`。

设置页 `Agent > Terminal 审计` 已可查看：

- 当前 Terminal session 快照。
- 最近 Terminal 审计事件。
- 手动刷新。
- 清空全部 Terminal 审计。

## 错误模型

Terminal 使用统一 execution error；CCLink adapter 额外保留脱敏、结构化的远程错误码。

错误来源包括：

- session 不存在。
- session 状态不可提交。
- 权限策略拒绝。
- 用户拒绝确认。
- 确认超时。
- PTY 后端未就绪。
- 本地 shell 启动失败。
- 本地进程写入、resize 或 terminate 失败。

不要让远程错误模型接管本地默认路径，也不得把 token、UserSig 或远程身份写入 Terminal
错误、输出或诊断。

## 已落地

- 本地 PTY：`node-pty + @xterm/xterm + @xterm/addon-fit`。
- CCLink 远程 PTY：确定性 Terminal ID、keepalive、断线 attach、输出重放和工作空间绑定校验。
- raw input、resize、基础交互式程序。
- 本地 shell 启动、写入、终止。
- session registry、session store、状态机。
- 命令权限判定、确认服务、审计写入。
- preload API：`window.cclinkStudio.terminal.*`。
- Terminal Tab 受控命令输入和输出面板。
- 活跃 Terminal 关闭确认。
- 设置页 Terminal 审计诊断。
- 单元测试覆盖权限、确认、审计、session、orchestrator、本地 shell、PTY、IPC、renderer store 和 Tab 生命周期。

## 未落地

- 官方单命令执行。
- 通用直连网络运行时。
- 官方 entitlement gate。
- 完整按工作空间/session 深筛的审计页面。
- CCLink 远程 PTY 的真实在线 Agent 全失败矩阵验收仍需持续补齐；自动化测试不能替代真人
  断网、lease 到期和进程连续性验收。

## 拷问

第一问：本地 Terminal 已经能跑，为什么还要强调 OSS 不做网络执行？因为网络执行需要账号、transport、Agent runtime、token、entitlement、端侧审计和错误归因；这些都不在开源壳默认边界里。

第二问：最危险的失败路径是什么？Agent 或用户命令绕过权限确认，或者关闭 Tab 后进程仍在跑但 UI 以为结束了。

第三问：为什么不接网络执行？因为网络执行需要账号、runtime、entitlement、端侧审计和错误归因；这些由官方集成层负责。

第四问：下一步最该验收什么？本地 `pwd/ls/git status/pnpm build/top`、resize、关闭终止、重启后只读记录、审计可追溯。
