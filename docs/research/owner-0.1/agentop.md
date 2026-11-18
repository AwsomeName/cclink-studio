# AgentOp：从目标页进入执行会话

2026-11-18 · Owner 0.1 独立调研。核对作者文档、页面截图和源码，未运行上游产品。决定：借鉴交互，不引入代码、依赖或数据库结构。

## 用户怎么用

用户描述目标，规划器生成总体思路和有先后关系的任务。同一目标下，独立任务可以交给不同的 Copilot 会话。用户在目标层看计划和总体结果；需要追问某一项时，才进入任务层查看会话。用户澄清的约束可以在目标内共享。

| 官方页面（含原图） | 用户从中看到什么 | 对 Owner 的取舍 |
| --- | --- | --- |
| [Goal Planning](https://github.com/macromania/agentop/blob/main/docs/features/goal-planning.md) | 一句交办变为总体方案和执行顺序 | 保留可读的计划；首版串行，不搬并行分组和任务树 |
| [Goal Summary](https://github.com/macromania/agentop/blob/main/docs/features/goal-summary.md) | 目标页顶部有模型生成的摘要，不必逐个点任务 | 总览放首屏，但把“已核对”的依据、阻塞和下一步独立列出，摘要不能替它们作证 |
| [Task Details](https://github.com/macromania/agentop/blob/main/docs/features/task-details.md) | 下钻到一段执行的工具调用和输出 | 会话是可打开的关联记录，打开不会丢失事务页；原始日志默认折叠 |

![AgentOp 作者提供的 Goal Summary 页面，远程原图](https://raw.githubusercontent.com/macromania/agentop/main/docs/images/goal-summary.png)

## 实现与引入判断

[规划源码](https://github.com/macromania/agentop/blob/main/apps/electron/src/main/agent/planner.ts)将目标转为带 `sequenceGroup`、人工输入标志和阻塞原因的任务，写入数据库并通知界面；[主进程调度器](https://github.com/macromania/agentop/blob/main/apps/electron/src/main/agent/orchestrator.ts)启动会话、传递执行事件并处理决定。它交付的是一套带提供方、存储和页面的桌面应用，而非可以独立挂到 Studio 的事务视图。[项目与许可证](https://github.com/macromania/agentop)。

**取其阅读顺序：目标 → 当前判断 → 一项工作 → 对应会话。** 不另建 Copilot 运行链路、会话库或进度账本。对本项目最有用的反例：即使摘要写着“比较完成”，三个项目中只要还有一项没有可核对的来源，事务就不能完成。
