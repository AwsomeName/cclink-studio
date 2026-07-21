# S4 状态与复杂度库存

> 状态：进行中。分支：`codex/stabilization-s4`。起始基线：`1059ba6`。日期：2026-07-21。

## 结论

S4 不以继续增加 store 或全局协调器来“统一状态”。每类状态必须区分运行事实、可见投影和持久化快照，并且每一层只有一个写入所有者。跨能力协作统一经过有 generation 的 workspace transition；后台资源继续运行，但切回项目时必须从运行事实源重新对账，不能相信离线 Tab 快照仍然新鲜。

S4 分四个可独立回滚和验收的工作包推进：

1. S4.1：Terminal 运行事实与 Tab 投影收敛。
2. S4.2：workspace/tab 的选择、切换和持久化写入边界收敛。
3. S4.3：conversation/browser profile 投影收敛，并在行为测试保护下拆分超大模块。
4. S4.4：诊断关联、架构复审和稳定化退出验收。

在 S4.4 完成前，S4 和整个稳定化阶段都不算关闭。

## 状态所有权

| 状态域          | 运行事实所有者                                                                                                                                | 可见投影                                                    | 持久化所有者                                                   | 当前判断                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------ |
| workspace       | renderer `workspace-transition.ts` 拥有当前切换事务与 generation                                                                              | `fs-store`、项目条和工作台读取当前 workspace                | main `WorkspaceStateService` 保存按 owner/workspace 分区的快照 | S4.2 继续减少选择与切换入口的重复编排                              |
| browser profile | Electron 持久化 `session` partition 拥有 Cookie/localStorage 事实，`BrowserManager` 拥有 Tab 到 Profile 的运行绑定                            | Browser Tab 的 `browserProfile` 只保存绑定 ID               | Electron userData 下的持久化 partition                         | 登录凭证不进入 renderer；S4.3 复核重建与诊断投影                   |
| conversation    | main Agent runtime 拥有连接、run 和 session 的执行事实                                                                                        | renderer `agent-store` 拥有消息文档、输入和可见运行投影     | `WorkspaceStateService.agentConversations`                     | 已有恢复对账；S4.3 继续拆分 1400+ 行 store，禁止组件直接拼跨域事务 |
| terminal        | main `TerminalSessionRegistry` 拥有当前进程状态，`TerminalSessionStore` 保存同一 session 的可恢复记录；`terminal:listSessions` 是对外事实入口 | Terminal Tab 与 terminal renderer store 只显示 session 投影 | main `TerminalSessionStore`；workspace Tab 快照只保存挂载关系  | S4.1 正在关闭陈旧 Tab 状态问题                                     |
| tab             | renderer `tab-store` 拥有当前窗口的布局、顺序和激活状态                                                                                       | Workbench/TabBar                                            | `WorkspaceStateService.tabs` 是按 workspace 的恢复快照         | S4.2 复核所有写入口必须经过 tab-store/transition                   |

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
- [ ] 实现提交后的全新 detached worktree 完成锁定安装和相同门禁。
- [ ] 远端 CI 通过，提交和 run ID 写回本文。

当前工作树证据：`pnpm verify` 通过 141 个测试文件/849 项测试；`pnpm smoke:standalone` 通过 local 9/9、UI 6/6、workflow 5/5、restore 4/4；严格认证 smoke 验证 Profile 的 Cookie/localStorage 跨进程重启保留，干净认证进程到达 Google account validation，CDP 对照被判为不安全浏览器。

## 后续阻断项

| 工作包 | 目标                                                                                                            | 退出证据                                                                                   |
| ------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| S4.2   | 盘点并收敛 workspace/tab 的 command、transition、hydrate 和持久化入口                                           | 项目快速切换、失败回滚、窗口恢复和写入时序测试；超大 workspace/fs 模块缩小                 |
| S4.3   | 明确 conversation 与 browser profile 的事实/投影边界，拆分 AgentPanel、agent-store 和 BrowserManager 的高变职责 | 拆分前后行为测试不变；无第二凭证源、第二 run owner 或组件级跨 store 事务                   |
| S4.4   | 统一诊断关联字段并完成架构复审                                                                                  | workspace/task/run/session/profile 可从脱敏日志串联；完整门禁、detached、CI 和人工验收通过 |

## 拷问

- `listSessions` 绿色不代表 session 永远存在；后续必须明确“找不到记录”是已关闭、被清理还是 runtime 不可用，不能擅自把所有缺失都改成 `exited`。
- workspace transition 等待 Terminal 对账会增加切换延迟；查询必须保持本地、有界且失败可降级，不能演变为等待外部能力。
- 把 owner 写进文档不等于 owner 已唯一；S4.2/S4.3 必须用源码入口审计和行为测试证明没有旁路写入。
- 拆大文件不是按行数机械切割。先固定行为与状态边界，再移动职责；否则只是把隐式事务分散到更多文件。
