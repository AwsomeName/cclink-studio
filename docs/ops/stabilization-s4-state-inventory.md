# S4 状态与复杂度库存

> 状态：S4.1、S4.2、S4.3a 已关闭，S4 继续。分支：`codex/stabilization-s4`。起始基线：`1059ba6`。S4.1 实现基线：`7b9f81e`。S4.2 实现基线：`e08150d`。S4.3a 实现基线：`f29e51d`。日期：2026-07-21。

## 结论

S4 不以继续增加 store 或全局协调器来“统一状态”。每类状态必须区分运行事实、可见投影和持久化快照，并且每一层只有一个写入所有者。跨能力协作统一经过有 generation 的 workspace transition；后台资源继续运行，但切回项目时必须从运行事实源重新对账，不能相信离线 Tab 快照仍然新鲜。

S4 分四个可独立回滚和验收的工作包推进：

1. S4.1：Terminal 运行事实与 Tab 投影收敛。
2. S4.2：workspace/tab 的选择、切换和持久化写入边界收敛。
3. S4.3a：browser profile 绑定与 Session 诊断收敛。
4. S4.3b：conversation 投影与 run 编排收敛，并在行为测试保护下拆分超大模块。
5. S4.4：诊断关联、架构复审和稳定化退出验收。

在 S4.4 完成前，S4 和整个稳定化阶段都不算关闭。

## 状态所有权

| 状态域          | 运行事实所有者                                                                                                                                | 可见投影                                                                                 | 持久化所有者                                                   | 当前判断                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------ |
| workspace       | renderer `workspace-transition.ts` 拥有运行时切换事务与 generation；`workspace-store.commitActiveWorkspace` 是唯一身份提交入口                | `fs-store.workspacePath` 只是已挂载文件树根路径，项目条和工作台读取 `activeWorkspaceRef` | main `WorkspaceStateService` 保存按 owner/workspace 分区的快照 | S4.2 候选已把异步准备与最终投影提交分离                            |
| browser profile | Electron 持久化 `session` partition 拥有 Cookie/localStorage 事实，`BrowserManager` 拥有 Tab 到 Profile 的运行绑定                            | Browser Tab 的 `browserProfile` 只保存绑定 ID                                            | Electron userData 下的持久化 partition                         | S4.3a 已关闭；绑定、重建、配置和诊断共用同一 Profile 规则          |
| conversation    | main Agent runtime 拥有连接、run 和 session 的执行事实                                                                                        | renderer `agent-store` 拥有消息文档、输入和可见运行投影                                  | `WorkspaceStateService.agentConversations`                     | S4.3b 已关闭；生产入口统一经过 run controller，工作区快照与恢复规则已从 store 拆出 |
| terminal        | main `TerminalSessionRegistry` 拥有当前进程状态，`TerminalSessionStore` 保存同一 session 的可恢复记录；`terminal:listSessions` 是对外事实入口 | Terminal Tab 与 terminal renderer store 只显示 session 投影                              | main `TerminalSessionStore`；workspace Tab 快照只保存挂载关系  | S4.1 已关闭陈旧 Tab 状态问题                                       |
| tab             | renderer `tab-store` 拥有当前窗口的布局、顺序和激活状态                                                                                       | Workbench/TabBar                                                                         | `WorkspaceStateService.tabs` 是按 workspace 的恢复快照         | S4.2 候选已把 hydrate 收敛到 generation 保护的最终提交点           |

“运行事实所有者”和“持久化所有者”可以是同一领域服务的两个职责，但 renderer 快照不得反向覆盖主进程仍存活的运行事实。任何新状态字段必须先进入本表，说明其 owner、scope、生命周期、诊断 ID 和恢复策略。

## S4.1 Terminal 状态收敛

### 基线问题

Terminal PTY 退出时，主进程 session 已进入 `exited` 或 `error`，但后台 workspace 的 Terminal Tab 不在当前 renderer 快照中，无法接收并写回事件。用户切回项目后，离线 Tab 可能仍显示 `running`，造成“进程是否还在运行”不可判断。

### 方案

- Terminal execution event 先同步主进程 registry，再发布给 renderer，保证查询不会落后于刚收到的事件。
- workspace hydrate 完成后调用现有 `terminal:listSessions`，以主进程 session snapshot 校准当前 workspace 的 Terminal Tab。
- 对账结果带 workspace key 保护；查询期间发生新项目切换时丢弃旧结果。
- renderer 只更新匹配 `sessionId` 的状态、进程 ID 和完整 `terminalRecord`，随后由既有 workspace 持久化订阅保存投影。
- Terminal IPC 不可用或查询失败时记录警告并继续项目切换，保持 S2 的独立降级约束。

### 验收

- [x] 主进程 registry 在 renderer execution event 之前更新。
- [x] 切回项目时，`running` 的离线 Tab 能被权威 `exited` snapshot 修正。
- [x] 只修正目标 workspace 与匹配 session，不污染其他项目。
- [x] 查询返回前发生新切换时丢弃过期结果。
- [x] Terminal 对账失败不阻断 workspace 切换。
- [x] 定向测试和 TypeScript 检查通过。
- [x] 当前工作树 `pnpm verify`、standalone 与严格认证 smoke 通过。
- [x] 实现提交后的全新 detached worktree 完成锁定安装和相同门禁。
- [x] 远端 CI 通过，提交和 run ID 写回本文。

当前工作树证据：`pnpm verify` 通过 141 个测试文件/849 项测试；`pnpm smoke:standalone` 通过 local 9/9、UI 6/6、workflow 5/5、restore 4/4；严格认证 smoke 验证 Profile 的 Cookie/localStorage 跨进程重启保留，干净认证进程到达 Google account validation，CDP 对照被判为不安全浏览器。

S4.1 实现提交为 `7b9f81e`。全新 detached worktree `/tmp/cclink-studio-s4-terminal-verify.x05fBr` 从该提交执行 `pnpm install --frozen-lockfile`，并通过相同的 141 个测试文件/849 项测试、standalone 24/24 与严格认证 smoke；detached HEAD 与工作树均干净。GitHub Actions run `29816406350` 绑定同一提交，`verify`、standalone 和确定性认证 Profile/window job 全部成功。S4.1 已关闭，下一工作包为 S4.2 workspace/tab 状态边界；S4 与稳定化阶段继续。

## S4.2 Workspace/Tab 提交边界

### 基线问题

项目切换曾存在三类并发与所有权缺口：`fs-store.workspacePath`、`workspace-store.activeWorkspaceRef` 和模块级 workspace key 分别写入；独立的全局切换入口绕过文件树切换；Browser 或 Terminal 对账仍在等待时，目标文件树和 workspace identity 已可能部分提交。空的目标文件树快照还会沿用上一项目的展开与选中路径。文件夹选择器等待期间，项目条仍能发起第二次切换。

### 方案

- `workspace-transition.ts` 继续唯一拥有 generation、当前现场持久化、目标快照读取和 Browser/Terminal 运行事实准备。
- 所有异步准备完成并再次校验 generation 后，才在同一同步提交段写入文件树投影、workspace identity、Tab、Browser、Editor 和 Agent 投影。
- `workspace-store` 删除独立全局切换及 local/global 别名，只保留 `commitActiveWorkspace(ref)` 一个身份写入口；启动恢复是唯一允许直接提交的初始化路径。
- `fs-store` 用 `picking/loading/switchingPath` 互斥选择器、最近项目和关闭项目动作；切换失败或过期时保留旧 workspace、文件树和 Tab。
- 新项目没有文件树快照时使用空展开和空选择，不再继承上一项目路径。
- 最近项目规范化/校验移到 `workspace-paths.ts`，文件树快照解析/准备移到 `workspace-tree.ts`；`fs-store` 从 1058 行降到 970 行。
- 启动恢复补做 Terminal 运行事实对账，避免只在人工切换后修正陈旧 Terminal Tab。

### 验收

- [x] workspace identity 只有一个 store 写入口，生产运行时切换只有一个 transition 提交边界。
- [x] Browser/Terminal 异步准备期间，workspace path、identity 和 Tab 均保持旧项目。
- [x] generation 过期或目标读取失败时不部分提交新项目投影。
- [x] 文件夹选择器、最近项目与关闭项目互斥，重复操作返回明确状态。
- [x] 空目标快照不会继承上一项目的文件树展开或选中路径。
- [x] 切到未归档与启动恢复使用相同 owner 规则，启动时补做 Terminal 对账。
- [x] 路径与文件树职责从 `fs-store` 拆出并有行为测试保护。
- [x] 相关 6 个测试文件/53 项测试与 TypeScript 检查通过。
- [x] 当前工作树完整 `pnpm verify`、standalone 与严格认证 smoke 通过。
- [x] 实现提交后的全新 detached worktree 完成锁定安装和相同门禁。
- [x] 远端 CI 通过，提交和 run ID 写回本文。

当前工作树证据：`pnpm verify` 通过 143 个测试文件/858 项测试；`pnpm smoke:standalone` 通过 local 9/9、UI 6/6、workflow 5/5、restore 4/4；严格认证 smoke 验证 Profile 的 Cookie/localStorage 跨进程重启保留，干净认证进程与 automation-controlled 对照到达 Google account validation，CDP 和当前带调试控制路径被判为不安全浏览器。

S4.2 实现提交为 `e08150d`。全新 detached worktree `/tmp/cclink-studio-s4-workspace-verify.BqRT9u` 从该提交执行 `pnpm install --frozen-lockfile`，并通过相同的 143 个测试文件/858 项测试、standalone 24/24 与严格认证 smoke；detached HEAD 与工作树均干净。GitHub Actions run `29823522729` 绑定同一提交，`verify` 和 `smoke` job 全部成功。S4.2 已关闭，下一工作包为 S4.3 conversation/browser profile 投影与高变模块拆分；S4 与稳定化阶段继续。

## S4.3a Browser Profile 绑定与 Session 诊断

### 基线问题

Browser Profile 曾存在三套不一致规则：IPC 允许 128 字符和点号，`BrowserManager` 只允许 64 字符且拒绝后静默回退默认 Session，运营配置则只检查“是字符串”。同时 `createView` 只在 workspace 改变时重建，同一 `tabId` 更换 Profile 仍会复用旧 Electron Session；`reconcileViews` 也只携带 Tab ID，后台旧 View 可能在用户激活前被 Agent 取到。Cookie 诊断和 partition 拼接则散落在 1100+ 行的 `BrowserManager` 内。

### 方案

- `shared/browser-profile.ts` 唯一定义 Profile ID 与 Electron partition 映射；非法值明确失败，不再落入默认凭证域。
- `createView` 同时比较 workspace 与 Profile 绑定，任一变化都销毁旧 View 并使用目标持久化 Session 重建。
- `reconcileViews` 契约从 `validTabIds` 升级为 `tabId + profileId` 绑定列表；同工作区缺失、重复或 Profile 不匹配的 View 被拒绝或清理，后台其他项目 View 保持 warm。
- workspace hydrate 与 Browser lifecycle 都提交完整绑定；激活 Browser Tab 时幂等调用 `createView`，确保 renderer 的 `ready` 投影不能阻止主进程修正绑定。
- 运营账号配置复用同一 Profile 规则，非法配置在进入 Tab 投影前返回定位到字段的校验问题。
- Cookie 观察、脱敏元数据和变化历史迁入 `BrowserSessionDiagnostics`；诊断不包含 Cookie 值，`BrowserManager` 从 1121 行降到 1015 行。

### 验收

- [x] IPC、运营配置、View 创建和诊断使用同一 Profile ID/partition 规则。
- [x] 非法 Profile 明确失败，不会静默读取或写入默认 Session。
- [x] 同一 Tab 的 workspace 或 Profile 绑定变化都会重建 View。
- [x] workspace 对账能在后台 View 被工具复用前清理 Profile 不匹配的运行实例。
- [x] 重复 Tab 绑定被 IPC schema 拒绝，其他工作区的后台 View 不被误删。
- [x] Session 诊断仅返回 Cookie 元数据和变化原因，不暴露 Cookie 值。
- [x] 当前工作树完整 `pnpm verify`、standalone 与严格认证 smoke 通过。
- [x] 实现提交后的全新 detached worktree 完成锁定安装和相同门禁，工作树干净。
- [x] 远端 CI 通过，提交和 run ID 写回本文。

当前工作树与实现提交 `f29e51d` 均通过 144 个测试文件/863 项测试、standalone 24/24 和严格认证 smoke。严格认证结果确认 Profile 的 Cookie/localStorage 跨 Electron 进程重启保留，干净认证进程到达 Google account validation，CDP 与当前调试控制路径继续被判为不安全浏览器；该既有差异没有被 Profile 收敛掩盖。

全新 detached worktree `/tmp/cclink-studio-s4-profile-verify.ZTeLDu` 从 `f29e51d` 执行 `pnpm install --frozen-lockfile`，并通过相同的 144 个测试文件/863 项测试、standalone 24/24 与严格认证 smoke；detached HEAD 与工作树均干净。GitHub Actions run `29825345007` 绑定同一提交，`verify` 和确定性 `smoke` job 全部成功。S4.3a 已关闭；S4.3b conversation 投影与 run 编排仍未完成，因此 S4.3、S4 和稳定化阶段都继续。

## S4.3b Conversation 投影与 Run 编排

### 基线问题

- `AgentPanel` 与工作台会话分别拼装发送、取消和压缩事务，同一行为存在两套失败语义；硬件生产入口还会绕过 `beginRun` 直接调用 Agent IPC。
- 旧 `conversation-runtime-provider` 接受十余个 store 回调，只把组件内部写权限换了位置，没有形成 conversation 级状态边界。
- `agent-store.ts` 同时保存 Zustand 写操作、会话模型、工作区快照归一化、恢复合并和 active conversation 记忆，超过 1400 行，运行投影与持久化规则难以独立审查。

### 收敛结果

- main Agent runtime 继续拥有真实执行、session 和终态；renderer 全局 stream subscriber 继续是后端事件进入可见投影的唯一入口。本轮没有把执行事实搬到 renderer。
- 新 `conversation-run-controller.ts` 以 `conversationId` 为作用域，统一组织发送、取消和压缩命令。它只调用 `agent-store` 的投影 action 和 shared Agent IPC，返回 `accepted/ignored/failed` 结构化结果，不自行判断后端最终完成。
- 发送事务统一检查 missing、archived、busy 和 compacting，建立 `runId` 后再调用后端；后端拒绝或抛错按同一 `runId` 收敛为失败投影。取消请求按 conversation 全局去重，并绑定发起时的 `runId`，不能误取消后续 run。压缩拒绝统一关闭 compaction 投影并留下系统错误消息。
- `AgentPanel`、`WorkbenchAgentConversation` 和硬件生产自动发起入口全部迁入同一控制器；生产 renderer 源码不再直接调用 `agent.sendMessage`、`agent.abort` 或 `agent.compactConversation`，也不再由组件直接拼装 run 事务。
- 会话类型与默认构造迁到 `conversation-state.ts`，工作区快照归一化、合并、active 记忆和持久化裁剪迁到 `conversation-workspace-state.ts`。`agent-store.ts` 从 1444 行降到 1059 行，原有 WorkspaceState schema 和兼容恢复行为不变。

### 验收证据

- [x] 控制器行为测试覆盖成功发送、空消息、归档/忙碌/压缩中拒绝、后端命令拒绝、重复取消、取消失败、压缩失败和缺少 session，共 10 项。
- [x] `agent-store` 48 项与 stream event 9 项行为测试在拆分前后保持通过，迟到 run 事件继续由 active `runId` 过滤。
- [x] 当前工作树通过 `pnpm verify`：144 个测试文件/869 项测试、typecheck 和生产构建全部成功。
- [x] 当前工作树通过 standalone 24/24 和严格认证 smoke。
- [x] 实现提交 `4cdd1d5` 的全新 detached worktree 完成锁定安装、相同 verify、standalone 24/24 与严格认证 smoke，HEAD 和工作树干净。
- [x] GitHub Actions run `29827593012` 绑定实现提交，`verify` 和确定性 `smoke` job 全部成功。

S4.3b 已关闭。真实长任务发送、人工取消和压缩交互仍需在 S4.4 最终人工验收中覆盖，但它们不再拥有第二套 UI 编排或状态 owner。S4 下一工作包只剩 S4.4 诊断关联、架构复审与稳定化退出验收。

## 后续阻断项

| 工作包 | 目标                                                                                    | 退出证据                                                                                   |
| ------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| S4.4   | 统一诊断关联字段并完成架构复审                                                          | workspace/task/run/session/profile 可从脱敏日志串联；完整门禁、detached、CI 和人工验收通过 |

## 拷问

- `listSessions` 绿色不代表 session 永远存在；后续必须明确“找不到记录”是已关闭、被清理还是 runtime 不可用，不能擅自把所有缺失都改成 `exited`。
- workspace transition 等待 Terminal 对账会增加切换延迟；查询必须保持本地、有界且失败可降级，不能演变为等待外部能力。S4.2 只保证提交前状态一致，尚未为本地 IPC 增加超时。
- Browser Profile 已有单一规则不代表第三方站点永不退出登录；站点主动失效 Cookie 仍必须由脱敏 Session 诊断解释，不能伪造续期或保存密码。
- S4.3b 消除了当前生产 renderer 的第二 run 编排入口，但 main runtime 与 renderer 投影仍是异步系统；S4.4 诊断必须证明迟到、丢失和失败事件能按 workspace/conversation/run 关联，不能只依赖 UI 表象。
- 拆大文件不是按行数机械切割。先固定行为与状态边界，再移动职责；否则只是把隐式事务分散到更多文件。
