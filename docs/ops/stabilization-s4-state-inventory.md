# S4 状态与复杂度库存

> 状态：S4.1、S4.2 已关闭，S4 继续。分支：`codex/stabilization-s4`。起始基线：`1059ba6`。S4.1 实现基线：`7b9f81e`。S4.2 实现基线：`e08150d`。日期：2026-07-21。

## 结论

S4 不以继续增加 store 或全局协调器来“统一状态”。每类状态必须区分运行事实、可见投影和持久化快照，并且每一层只有一个写入所有者。跨能力协作统一经过有 generation 的 workspace transition；后台资源继续运行，但切回项目时必须从运行事实源重新对账，不能相信离线 Tab 快照仍然新鲜。

S4 分四个可独立回滚和验收的工作包推进：

1. S4.1：Terminal 运行事实与 Tab 投影收敛。
2. S4.2：workspace/tab 的选择、切换和持久化写入边界收敛。
3. S4.3：conversation/browser profile 投影收敛，并在行为测试保护下拆分超大模块。
4. S4.4：诊断关联、架构复审和稳定化退出验收。

在 S4.4 完成前，S4 和整个稳定化阶段都不算关闭。

## 状态所有权

| 状态域          | 运行事实所有者                                                                                                                                | 可见投影                                                                                 | 持久化所有者                                                   | 当前判断                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------ |
| workspace       | renderer `workspace-transition.ts` 拥有运行时切换事务与 generation；`workspace-store.commitActiveWorkspace` 是唯一身份提交入口                | `fs-store.workspacePath` 只是已挂载文件树根路径，项目条和工作台读取 `activeWorkspaceRef` | main `WorkspaceStateService` 保存按 owner/workspace 分区的快照 | S4.2 候选已把异步准备与最终投影提交分离                            |
| browser profile | Electron 持久化 `session` partition 拥有 Cookie/localStorage 事实，`BrowserManager` 拥有 Tab 到 Profile 的运行绑定                            | Browser Tab 的 `browserProfile` 只保存绑定 ID                                            | Electron userData 下的持久化 partition                         | 登录凭证不进入 renderer；S4.3 复核重建与诊断投影                   |
| conversation    | main Agent runtime 拥有连接、run 和 session 的执行事实                                                                                        | renderer `agent-store` 拥有消息文档、输入和可见运行投影                                  | `WorkspaceStateService.agentConversations`                     | 已有恢复对账；S4.3 继续拆分 1400+ 行 store，禁止组件直接拼跨域事务 |
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

## 后续阻断项

| 工作包 | 目标                                                                                                            | 退出证据                                                                                   |
| ------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| S4.3   | 明确 conversation 与 browser profile 的事实/投影边界，拆分 AgentPanel、agent-store 和 BrowserManager 的高变职责 | 拆分前后行为测试不变；无第二凭证源、第二 run owner 或组件级跨 store 事务                   |
| S4.4   | 统一诊断关联字段并完成架构复审                                                                                  | workspace/task/run/session/profile 可从脱敏日志串联；完整门禁、detached、CI 和人工验收通过 |

## 拷问

- `listSessions` 绿色不代表 session 永远存在；后续必须明确“找不到记录”是已关闭、被清理还是 runtime 不可用，不能擅自把所有缺失都改成 `exited`。
- workspace transition 等待 Terminal 对账会增加切换延迟；查询必须保持本地、有界且失败可降级，不能演变为等待外部能力。S4.2 只保证提交前状态一致，尚未为本地 IPC 增加超时。
- 把 owner 写进文档不等于 owner 已唯一；S4.3 必须继续用源码入口审计和行为测试证明 conversation/browser 没有旁路写入。
- 拆大文件不是按行数机械切割。先固定行为与状态边界，再移动职责；否则只是把隐式事务分散到更多文件。
