# 会话待发送消息队列

## 用户验收动作

在本地会话发送一个任务，执行中继续输入两条消息并按 Enter。输入框上方应出现按发送顺序排列的待发送队列；当前轮真正结束后，下一条进入消息历史并执行，直到队列清空。

1. 点击待发送项的“编辑”：内容、资源和当前运行期图片回到输入框，原项退出队列；修改后发送排到队尾，再点击“继续队列”。已有输入草稿时禁用编辑，避免覆盖草稿。
2. 点击某项“删除”：只移除该项；已开始提交的项暂时禁用编辑和删除。
3. 点击“暂停队列”：当前轮继续执行，后续消息等待；“继续队列”恢复派发。
4. 点击当前任务的停止按钮：队列保留并暂停，Runtime 确认退出后也不自动继续。任务失败、连接中断和压缩失败同样暂停；错误原因仍由原有消息与诊断展示。
5. 切换到另一个会话或收起 Agent 面板，原会话仍可接续。切换工作空间后，未派发项等待返回所属工作空间；归档会话后暂停，恢复归档也需要手动继续。
6. 重启 Studio：待发送文字和资源引用恢复，但队列默认暂停。图片正文不进入快照，带图片的待发送项必须移回输入框重新添加图片后发送；禁止静默发送不含原图的消息。

本轮范围为本地会话，包括 Claude Code 和既有 Codex ACP 发送入口。CCLink 远程会话保持原入口行为；不增加执行中注入引导、并行执行或跨会话调度。每个会话最多主动排队 20 条；若同时有新草稿，发送失败的当前消息可额外保留在队首。

## 实现约束与失败边界

- `agent-store` 的每个 `AgentConversationState` 唯一拥有待发送消息、暂停原因和当前提交项 ID。两种面板共用 `AgentPanelView`，不各自保存队列。
- 应用级订阅随现有会话恢复 bootstrap 安装和释放，不依赖当前面板是否挂载。订阅只读 Runtime 驱动的运行/压缩终态，调用既有 `ConversationRunController`；并发保护只用于阻止同一会话重复派发。
- 队列项保存发送时的资源与图片快照，并校验工作空间、运行环境、操作目标、角色和技能配置。配置变化后暂停，要求用户编辑确认再入队。后端仍通过现有 IPC、资源校验、权限审批和角色回执执行，不新增 IPC、MCP、Runtime 账本或权限面。
- 初始发送立即移出本轮临时附件，避免用户继续输入时重复携带。接受回执不会清除后来输入的文字或附件。发送拒绝时恢复原草稿；若已有新草稿，则将失败消息保留在暂停队列中。
- 每条仅在后端接受且配置回执核对通过后退出队列。重启恢复一律暂停，不能承诺跨进程崩溃的“恰好一次”执行；恢复后应结合消息历史确认是否已经执行。
- 权限与人工确认仍属于原有 Agent/Runtime 链路。排队不扩大用户任务授权，也不跳过工具确认。

## 验证与交付口径

自动化覆盖顺序、附件隔离、草稿保留、失败暂停、手动恢复、配置变化、工作空间隔离、恢复缺图、容量与订阅释放。

```bash
pnpm typecheck
pnpm exec vitest run src/renderer/src/features/agent-conversations/conversation-message-queue.test.ts src/renderer/src/features/agent-conversations/conversation-run-controller.test.ts src/renderer/src/features/agent-conversations/conversation-workspace-state.test.ts src/renderer/src/stores/agent-store.test.ts src/renderer/src/components/agent-panel/agent-panel-view.test.tsx src/renderer/src/components/agent-panel/unified-agent-panel-architecture.test.ts src/renderer/src/bootstrap/use-agent-conversation-restore.test.ts
node scripts/agent-message-queue-smoke.mjs
node scripts/agent-message-queue-smoke.mjs --real-runtime
```

默认 smoke 在隔离 Electron 中操作真实输入框，检查入队、编辑、删除和两种布局，发送 Runtime 使用替身；它只证明对应 UI/工程门禁。`--real-runtime` 复用本机 Claude 配置执行三轮纯文本消息，必须看到三轮真实回复，才证明真实模型接续。具体结果见本次测试记录。

## /grilling

结论：队列必须是可撤回的待发送用户消息，运行成功只能由既有 Runtime 事件确认。

尚需拷问：是否把已接受当作执行成功？是否清除了用户后写的新草稿？中断或恢复后是否未经确认继续产生副作用？配置变化后是否换了一套上下文执行原意？本方案分别保留运行终态、隔离每条附件、暂停异常与恢复，并对配置快照进行检查。

主要限制是重启后的图片需重附、编辑后排到队尾，以及远程会话未纳入本轮。Claude Code 的三轮真实模型接续已通过；Codex ACP 的真实模型与人工现场验收仍需单独执行，不能用静态队列 UI 或替身测试代替。
