# 新会话独立审查指令：文章发布 Runtime 终态收敛方案

把下面整段原样发给一个新的 Codex 会话。新会话必须独立检查仓库，不依赖本会话结论。

---

你现在只做**独立架构与实现可行性审查**，不要修改代码、不要补文档、不要提交、不要发布。不要接受之前会话的结论；以当前工作区源码和事实文档为准。

仓库：`/Users/apple/Desktop/cclink-dev/cclink-studio`

目标：复审“文章发布开始执行无反应 / Attempt 假 running”的可施工修订版。首版和第一次修订先后暴露 9 项阻塞：执行代次、统一跨对象收敛、实际 Browser 动作的一次性副作用消费、renderer 启动、owner/CDP 代次、全量重启修复、事件/文件上限、静默任务误杀与永久续租。本次仍不得继承“已经修正”的假设，必须重新对照源码找反例。判断修订版是否真的能覆盖 Agent、BrowserTask、Browser Tab/CDP 任一方中断、漏终态、重试失败、重启恢复和最终发布结果未知，且不制造第二状态所有者或重复发布风险。

必须先完整阅读：

1. `/Users/apple/Desktop/cclink-dev/cclink-studio/AGENTS.md`
2. `/Users/apple/Desktop/cclink-dev/cclink-studio/docs/architecture.md`
3. `/Users/apple/Desktop/cclink-dev/cclink-studio/docs/testing/article-publishing-runtime-convergence.md`
4. `/Users/apple/Desktop/cclink-dev/cclink-studio/docs/features/article-platform-publishing.md`
5. `/Users/apple/Desktop/cclink-dev/cclink-studio/docs/features/article-platform-publishing-development-plan.md`

然后至少检查这些实现，不得只审文档：

- `src/main/web-affairs/web-affair-service.ts`
- `src/main/web-affairs/web-affair-store.ts`
- `src/shared/web-affairs/web-affair-types.ts`
- `src/shared/web-affairs/web-affair-schema.ts`
- `src/shared/article-publishing/article-publishing-types.ts`
- `src/main/article-publishing/` 下全部相关实现
- `src/main/agent/agent-bridge.ts`
- `src/main/agent/agent-runtime-state-store.ts`
- `src/main/agent/claude-runtime-manager.ts` 及其他可选 Agent backend 的 Runtime owner/代次实现
- `src/main/browser/browser-task-runtime.ts`
- `src/main/browser/browser-manager.ts` 及 Browser/CDP 生命周期相关实现
- `src/main/playwright/playwright-bridge.ts`
- `src/main/mcp/modules/browser/index.ts`
- `src/renderer/src/features/article-publishing/ArticlePublishingTab.tsx`
- 与上述链路直接相关的测试和 IPC contract/preload 代码

先运行只读命令确认当前 `HEAD`、分支、工作区差异、最近提交和 `v0.1.72` 的边界。明确区分：已经发布的版本、当前 `main` 已有但未发布的候选修复、方案中尚未实现的内容。

审查时必须逐项回答：

1. 截图中“按钮无反应”是否确实由持久 `execution.status === 'running'` 导致 renderer 禁用？给出代码证据。
2. 当前多 BrowserTask 修复究竟覆盖了哪些路径，哪些路径仍能让 Attempt 假运行？至少构造 5 个具体事件时序。
3. `WebAffairService` 是否仍是唯一持久状态 owner？拟议 Coordinator、租约、runtime binding 和重试队列有没有暗中变成第二状态机？
4. `executionGeneration + launchOperationId` 是否在创建/恢复 Attempt 时先原子持久化，再创建 Runtime？Agent prompt、Agent Run、BrowserTask、Tab、租约、事件、副作用授权是否全部携带？旧 generation/launch operation 是否在所有入口都 no-op？
5. 唯一幂等收敛命令的输入是否足以抵御旧 Run 迟到事件、重复事件、乱序事件、工作空间切换和窗口重建？`eventId` 是否稳定绑定 generation、launch operation 和完整 owner identity，还是重试时会换 ID？
6. 一个 Attempt 对多个 generation、Agent Run / BrowserTask 的 binding 历史是否必要、字段是否足够、上限和迁移是否安全？
7. Agent 不发送终态时，`checking-runtime` 三阶段看门狗能否发现孤儿任务？owner lease 与 progress lease 分开了吗？什么活动信号可信？什么情况下会误杀长任务或人工接管？
8. 收敛落盘失败后的重试是否真的最终可达，还是进程崩溃后仍可能遗漏？启动扫描能否完整兜底？
9. 所有文章生命周期入口是否真正委托同一个 reducer？重点验证当前 `Attempt=cancelled`、`execution=running` 的矛盾能否被结构性消除，而不是只补一个 if；checkpoint、asset、publication、节点和事务是否同时满足投影不变式？
10. 最终发布动作已经 dispatched/verifying 时，方案能否严格阻止重复发布？用户“终止”“检查状态”“继续”并发时是否存在漏洞？
11. 上传、保存和最终发布是否真的满足 write-ahead？重点检查当前 `allow-once + sideEffectKey` 是否从策略一路传到实际 Playwright 公共动作入口并被原子消费；相同 key 第二次、旧 generation、错误 fingerprint 是否都在 Playwright 前拒绝？
12. 在 capability 消费成功但 Playwright 尚未调用、调用后尚未返回、返回后尚未核验的每个崩溃窗口，恢复逻辑是否宁可进入结果未知也不会重复动作？
13. “当前步骤所需 Runtime”是否可从持久检查点明确判定？是否仍存在“任意一个无关 Runtime active 就永久续租”的假运行路径？
14. BrowserTask 内部订阅、Agent 事件、Tab/CDP 事件的创建和 disposer 是否能遵守项目 IPC/生命周期约束？shutdown 顺序是否可实现？
15. renderer 恢复入口是否只发命令、不自行成为状态 owner？禁用原因、核验失败和结果未知是否对用户可理解、可操作？
16. 诊断项是否足以在一份通用框架日志中还原问题，同时避免泄露 Cookie、Token、正文和完整 Session 标识？
17. 测试矩阵是否缺少关键竞态、迁移、持久化故障、真实 Electron/CDP 或真实 CSDN 场景？已有测试数量为什么能或不能证明上述崩溃窗口？
18. 该方案是否需要 ADR？如果不需要，说明为何符合现有架构宪法；如果需要，指出具体违反条款。
19. 启动是否完整移入 main 的一个幂等 operation？逐个检查持久 Attempt、打开账号 Tab、创建 Agent 会话/Run、绑定 BrowserTask 和失败收敛；在每个 await 后销毁 renderer 是否仍能结束，还是仍依赖 renderer `recoverTaskLaunch()`？
20. 事件 identity 是否同时包含发布 `executionGeneration` 和 owner 自身代次？至少审查 Agent runtime binding/epoch、Browser View runtime generation、WebContents ID、Playwright connection/page binding generation；CDP 重连后旧动作回执是否会误伤新 binding？
21. startup 是否扫描全部文章 Affair 的跨对象不变式，而不只看瞬态 Attempt？事件 2,000 条、文件达到 high-water、journal 合并和 ENOSPC 时，关键收敛分别会怎样？任何日志 append 能否阻断状态修复？
22. `checking-runtime` 是否是持久状态并冻结副作用？owner lease 与 progress lease 是否分开？只有 heartbeat、没有进度的任务是否会在有界时间转人工处理；合法慢任务是否通过显式 waiting-external 避免误杀？

输出格式必须是：

1. 第一行给出唯一结论：`通过`、`有条件通过` 或 `驳回`。
2. 第二段用人话说明：按这个方案做完后，用户能做什么；还可能卡在哪里。
3. `阻塞问题`：只列会导致假 running、误中断、状态分叉、数据损坏或重复发布的 P0/P1 问题。每项必须包含严重级别、具体失败时序、源码/文档证据（绝对路径和行号）、必须修改的方案内容。
4. `非阻塞改进`：列 P2 或可维护性问题，也要给证据。
5. `遗漏测试`：给出可执行的测试前置、动作和预期，不要只写测试标题。
6. `最小纵向施工顺序`：指出最少几步才能先让用户获得可验收的防假死闭环，不能用重构或测试数量冒充用户进度。
7. `最终门禁清单`：用复选框列出在实现者宣称完成前必须拿到的自动化证据和真人验收证据。

禁止使用“看起来合理”“建议加强”一类空话。没有代码证据时明确写“未找到证据”。不要因为方案写得完整就判通过；要主动寻找反例，并明确写出**实现后仍可能让 Attempt 假 running 的每一条路径**。

---
