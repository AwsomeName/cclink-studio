# 新会话独立审查指令：定时任务通过 Git 随工作空间共享

把下面整段原样发给一个新的 Codex 会话。新会话必须独立检查仓库，不依赖本会话结论。

---

你现在只做**独立产品、架构、安全与施工可行性审查**，不要修改代码、不要补文档、不要提交、
不要发布。不要接受上一会话的判断；以当前工作区源码、Git 事实和项目事实文档为准。主动寻找
能推翻方案的反例，不要因为文档完整就判通过。

仓库：`/Users/apple/Desktop/cclink-dev/cclink-studio`

待审目标：用户在 A 电脑的本地工作空间创建定时任务 X，显式选择“随项目共享”，通过用户
自己的 Git Commit/Push/Clone/Pull 把定义带到 B；B 打开不同绝对路径下的工作空间后可以看到
X，但默认不启用，只有人工检查并明确启用后才在 B 本机调度。activation、权限、运行历史、
内部结果和凭证不得通过 Git 传播；多设备同时启用允许重复执行，不承诺 exactly-once。

第一次独立评审结论为“有条件通过”，提出三个开工阻塞：确认未绑定任务版本、occurrence key
缺少 workspaceId、Git ignore 无法保护已经 tracked 的本机状态。第二次复审确认三项已形成可
施工设计，只指出转换恢复表的 source/target 双 hash 条件有歧义；当前文档已改为两者分别匹配
journal 才能删除 source，任一不匹配一律保留现场并进入冲突。本指令再次使用时仍必须独立验证，
不得因为状态写成“可进入 E0”就默认方案正确。

必须先完整阅读：

1. `/Users/apple/Desktop/cclink-dev/cclink-studio/AGENTS.md`
2. `/Users/apple/Desktop/cclink-dev/cclink-studio/docs/architecture.md`
3. `/Users/apple/Desktop/cclink-dev/cclink-studio/docs/features/scheduled-tasks.md`
4. `/Users/apple/Desktop/cclink-dev/cclink-studio/docs/features/scheduled-tasks-development-plan.md`
5. `/Users/apple/Desktop/cclink-dev/cclink-studio/docs/features/scheduled-task-git-sharing.md`
6. `/Users/apple/Desktop/cclink-dev/cclink-studio/docs/features/scheduled-task-git-sharing-development-plan.md`
7. `/Users/apple/Desktop/cclink-dev/cclink-studio/docs/features/workspace-system.md`
8. `/Users/apple/Desktop/cclink-dev/cclink-studio/docs/features/git-source-control.md`
9. `/Users/apple/Desktop/cclink-dev/cclink-studio/docs/features/git-source-control-development-plan.md`
10. `/Users/apple/Desktop/cclink-dev/cclink-studio/docs/features/manual-git-backup.md`
11. `/Users/apple/Desktop/cclink-dev/cclink-studio/docs/decisions/README.md`

然后至少检查以下实现和直接相关测试，不得只审文档：

- `src/shared/scheduled-task/` 全部文件
- `src/main/scheduled-task/` 全部文件
- `src/main/runtime/automation-runtime.ts`
- `src/main/runtime/core-services.ts`
- `src/main/workspace/workspace-state-service.ts` 及相关 workspace contract/tests
- `src/main/git/` 全部文件（如果存在）
- `src/main/git-backup/` 全部文件
- `src/renderer/src/features/scheduled-tasks/` 全部文件
- `src/renderer/src/stores/scheduled-task-store.ts` 或实际 scheduled task store
- `src/renderer/src/components/sidebar/Sidebar.tsx`
- scheduled task IPC、preload、shared contract、command/context action 注册
- `.gitignore`、`.git/info/exclude` 生成逻辑和敏感文件预检

先运行只读命令确认当前分支、`HEAD`、工作区差异和最近提交。工作区可能有与本方案无关的用户
修改；不要覆盖、清理或把未提交实现误判为已发布事实。明确区分：当前已实现能力、当前工作树
中其他增量、两份提案中尚未实现的内容。

审查必须逐项回答：

1. 用户需求是否真实成立？“任务是工作空间资源”是否必然推出“定义应随 Git 传播”，还是存在
   更安全、更符合用户心智的导出/导入或默认共享模型？给出明确产品判断。
2. “不随 Git 共享 / 随项目共享”显式选择是否必要？默认不共享是否会让用户继续困惑；默认共享又
   是否会让旧任务、业务指令或敏感信息意外进入公共仓库？应冻结哪个默认值？
3. `ScheduledTaskService` 是否仍能成为 local/shared 两个目录的唯一 owner？双位置会不会形成
   两个 definition store、重复 ID、删除竞态或恢复分叉？有没有更小的单存储方案？
4. 提议把 shared 定义放到 `.cclink-studio/shared/scheduled-tasks/` 是否能被真实 Git ignore 规则
   正确重包含，同时继续忽略 `.bak`、`.tmp`、journal、非法文件和子目录？必须用临时真实仓库
   验证建议规则，而不是只凭 Git ignore 记忆下结论。
5. 当前 manual backup 的 `.cclink-studio/`、scheduled task 自有规则、用户 `.gitignore`、global
   excludes 和已 tracked 文件之间的优先级是什么？方案的 managed block 迁移是否会误删用户规则、
   仍旧忽略 shared 文件或意外暴露 state/results？
   进一步验证 resulting index 与 outgoing commit range allowlist 是否覆盖 selected Commit、
   stage-all backup 和 pure Push；forbidden 文件在较早未推送 commit、当前 HEAD 已删除时是否仍
   阻止 Push，同时是否允许先形成“删除 forbidden tracked 文件”的本地修复 Commit。
6. 现有 `GitWorkspaceService` 与 `GitBackupService/GitClient` 的 owner 收敛程度是否足以承接
   managed exclude？方案有没有把任务保存硬依赖 Git service，导致非 Git 工作空间或 Git 初始化
   失败时无法保存任务？
7. v2 persisted record 删除绝对 `workspaceRef.path` 后，main 能否仅凭文件所在工作空间安全重绑？
   请检查 realpath、symlink、工作空间替换、复制、移动、worktree 和不同 owner identity 的边界。
8. 当前 workspace/project manifest 默认也被 `.cclink-studio/` 排除。B 产生不同 workspaceId 时，
   activation key、历史、Tab 恢复和定义 discovery 是否仍正确？方案有没有暗中要求跨设备共享
   workspaceId？
9. v1 local → v2 shared 的迁移是否能在写目标成功、删源失败、崩溃、ENOSPC、EACCES 和 App
   shutdown 的每个窗口恢复？journal 是否必要、由谁拥有、是否会成为第二事实源？
10. 同一 task ID 同时存在于 local/shared 时 fail closed 是否足够？当前 `readDefinitions()` 一个
    坏文件导致整个目录失败的行为是否会让单个 Git conflict 使所有合法任务消失或 scheduler 降级？
11. 新设备第一次发现 shared 定义时，当前 `createSnapshot()` 和 activation lookup 是否确实默认
    disabled？旧 activation、相同 task ID、相同或不同 workspaceId、备份恢复是否存在静默启用路径？
12. 普通 Save、`Cmd/Ctrl+S`、Tab restore、App restart、全局 auto、Agent tool、Git Pull 和定义
    文件重新出现，是否都无法绕过“在此设备启用”的人工确认？列出每个实际入口。
    修订方案的 `confirmedTaskRevision + confirmedExecutionDigest` 是否在 runNow、timer、catch-up、
    claim 和出队转 running 前全部由 main 重查？revision 变化但内容不变、revision 未变但执行字段
    变化、仅 JSON 排版变化分别是否得到正确结果？
13. definition revision 是否足以检测 A/B 并发修改？相同 revision 不同内容、Git fast-forward、
    merge conflict、dirty Tab、迟到 watcher 和保存中的外部替换需要什么 hash/generation/expected state？
14. shared 文件外部删除时，activation orphaned/disabled 的持久化语义是否正确？删除发生在 timer
    到期前、已排队、Agent 启动前、运行中和结果落盘前分别应该怎样，方案是否说清且可实现？
    queued run 是否从内存队列和持久账本同时变为 cancelled，出队竞态是否可能再次置 running？
15. 多设备同时启用允许重复执行是否足够诚实？是否存在用户任务天然不可重复、输出 create-only
    冲突、外部副作用未来开放后造成严重后果的场景？首版是否需要更强提示或禁止某些共享任务？
16. shared instruction 可能包含秘密或恶意指令。现有 scheduled allowlist、路径边界、权限确认和
    Git sensitive preflight 能否真正防止打开仓库即执行、凭证泄露和越界读取？哪些只能靠文案，
    哪些必须由 main 强制？
17. manual Git backup 当前只 Push 不 Pull。产品文案和验收是否清楚地区分“Git 可跟踪”与“自动
    同步”？用户如果只使用 Studio 内置 Git 能否完成 A→B；不能的话这是否构成 P1 产品缺口？
18. watcher/focus/explicit refresh 是否应该收敛到一个 main reducer？当前生命周期是否支持工作空间
    切换、窗口重建、App shutdown 和迟到事件，还是会形成重复 watcher/timer 或 renderer 第二 owner？
19. 建议的错误、诊断和 UI 状态是否足以让用户区分：未共享、未 Commit、未 Push、B 未 Pull、
    被 ignore、Git conflict、Schema 损坏、来源冲突、定义删除和本机未启用？哪些状态当前无法由
    Studio 可靠知道，必须避免展示？
20. 方案是否需要 ADR？若不需要，逐条说明为何没有改变架构宪法和长期持久化边界；若需要，指出
    应在实现前冻结的决策和具体 ADR 范围。
21. 19–29 人日估算是否合理？给出最小可施工纵向切片，指出哪些工作是用户功能、哪些只是工程
    准备度；不得用 Schema、测试或 ignore 重构冒充产品进度。
22. 测试矩阵是否覆盖真实 Git、不同绝对路径、隔离 userData、worktree、用户 ignore、外部删除、
    dirty draft、冲突和 App 生命周期？指出仍可能让 B 自动执行、看不到 X、覆盖任务或泄露本机
    状态的每条遗漏路径。
23. 当前 `occurrenceKey(taskId, scheduledFor)` 和全局 run ledger 的真实冲突路径是否被
    `workspaceId + taskId + scheduledFor` 关闭？ledger v1→v2 是否在 catch-up/timer 前原子完成，
    重复 legacy key、非法 workspaceId、迁移失败和回滚版本分别会怎样？
24. 第 4.4 节 journal 字段、phase 和恢复表是否足以覆盖 prepared、target-written、source-removed
    的每个崩溃窗口？target exclusive-create、源备份、hash 不匹配和损坏 journal 会不会覆盖用户
    外部修改、产生双定义或变成第三份定义事实源？

必须至少亲自执行以下只读或临时目录实验；临时数据不得创建在仓库中，结束后清理临时目录：

- 用真实 Git 临时仓库验证 proposed managed exclude 的 local/shared/state/results 可见性；
- 检查当前代码生成的旧两个 marker 组合，并验证迁移前 shared 文件是否确实不可见；
- 用源码现有 parser 构造“相同 task 内容、不同 workspace absolute path”的定义读取判断；
- 检查一个空 B userData 下 snapshot/activation 的默认值；
- 检查 Git conflict marker 对当前 `readDefinitions()` 的影响范围。
- 强制把 local definition、state、result、`.bak` 或 `.tmp` 加入临时仓库 index/HEAD，验证 proposed
  tracked allowlist 在 Commit 和 pure Push 两条路径都能识别；再提交删除，使当前 HEAD 干净，验证
  outgoing commit range 仍阻止 Push，同时验证本地 staged deletion 修复路径。
- 构造两个 workspaceId、相同 taskId/scheduledFor 的 legacy run，验证 proposed ledger v2 key 和
  迁移冲突语义。

若因环境限制无法执行某项，明确写“未执行”及原因，不得用推测冒充证据。

输出格式必须是：

1. 第一行只给唯一结论：`通过`、`有条件通过` 或 `驳回`。
2. 第二段先用人话回答：按该方案做完，A/B 用户具体能做什么，还不能做什么。
3. `阻塞问题`：只列 P0/P1。每项包含严重级别、具体失败时序、源码/文档绝对路径与行号、
   必须修改的需求或方案。
4. `非阻塞改进`：列 P2 和可维护性问题，也必须给证据。
5. `需求裁决`：明确判断默认 local/shared、是否需要分享开关、Git 是否只是运输层、B 是否默认
   disabled，以及首版是否接受重复执行。
6. `最小纵向施工顺序`：先写用户可执行验收动作，再列最少工程步骤；分列“用户功能进度”和
   “工程准备度”。
7. `遗漏测试`：每项写前置、动作、预期，不能只写测试标题。
8. `最终门禁清单`：用复选框列出实现者宣称完成前必须取得的自动化和真人证据。

禁止使用“整体合理”“建议加强”“注意安全”“完善测试”等空话。没有源码证据时明确写“未找到
证据”。必须主动尝试证明以下四件事为假：

- B 不可能未经确认自动启用；
- 不同绝对路径一定能读取共享定义；
- activation/history/results 一定不会进入 Git；
- 一个冲突或坏文件不会破坏其他合法任务。
- 已确认共享任务发生执行内容变化后不可能继续自动运行；
- 同机两个项目副本不可能因为相同 task ID/时间互相吞掉 occurrence；
- 已被 Git 跟踪的本机状态不可能通过任何 Studio Git 写入口继续 Commit/Push。

只要其中任何一项无法被方案和可施工实现证明，就不能判“通过”。

---
