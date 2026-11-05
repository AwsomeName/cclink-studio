# 会话待发送消息队列

后续操作见[Agent 后续消息操作产品设计](agent-follow-up-actions.md)：本地 Claude Code 已实现“补充当前任务”和“停止并执行这条”，真实应用通过范围见[验收记录](../testing/agent-follow-up-actions.md)。本文继续描述共用排队行为；远程与 Codex ACP 的新增操作仍按能力边界禁用。

## 用户验收动作

分别在本地会话和已登录、在线的 CCLink 远程会话发送一个任务，执行中继续输入两条消息并按 Enter。输入框上方应出现按发送顺序排列的待发送队列；当前轮真正结束后，下一条进入消息历史并执行，直到队列清空。

1. 点击待发送项的“编辑”：内容、资源和当前运行期图片回到输入框，原项退出队列；修改后发送排到队尾，再点击“继续队列”。已有输入草稿时禁用编辑，避免覆盖草稿。
2. 点击某项“删除”：只移除该项；已开始提交的项暂时禁用编辑和删除。
3. 点击“暂停队列”：当前轮继续执行，后续消息等待；“继续队列”恢复派发。
4. 本地点击“停止”：队列保留并暂停，Runtime 确认退出后也不自动继续。远程点击“停止等待”：只停止 Studio 跟踪，队列暂停，不代表远端已取消，继续前必须核对远端状态。任务失败、连接中断和本地压缩失败同样暂停；错误原因仍由原有消息与诊断展示。
5. 切换到另一个会话或收起 Agent 面板，原会话仍可接续。切换工作空间后，未派发项等待返回所属工作空间；归档会话后暂停，恢复归档也需要手动继续。
6. 本地重启 Studio：待发送文字和资源引用恢复，但队列默认暂停。图片正文不进入快照，带图片的待发送项必须移回输入框重新添加图片后发送；禁止静默发送不含原图的消息。

范围包括本地 Claude Code、既有 Codex ACP 发送入口和 CCLink 远程会话。共用输入区显示“停止／停止等待”和“加入队列”，队列位于输入框上方，底部提示顺序发送或暂停状态；窄面板工具栏允许换行，保留可见文字按钮。不增加执行中注入引导或同一会话并行执行。每个会话最多主动排队 20 条；本地若同时有新草稿，发送失败的当前消息可额外保留在队首。

远程队列与远程输入草稿目前为进程内状态：切换会话、收起面板和断线时保留，退出应用或退出账号后不恢复。本轮没有新增远程持久化契约；不能把本地的跨重启恢复能力描述为远程已具备。

## 实现约束与失败边界

- `agent-store` 的每个 `AgentConversationState` 唯一拥有待发送消息、暂停原因和当前提交项 ID。两种面板共用 `AgentPanelView`，不各自保存队列。
- 应用级订阅随现有会话恢复 bootstrap 安装和释放，不依赖当前面板是否挂载。订阅只读 Runtime 驱动的运行/压缩终态，调用既有 `ConversationRunController`；并发保护只用于阻止同一会话重复派发。
- 队列项保存发送时的资源与图片快照，并校验工作空间、运行环境、操作目标、角色和技能配置。配置变化后暂停，要求用户编辑确认再入队。后端仍通过现有 IPC、资源校验、权限审批和角色回执执行，不新增 IPC、MCP、Runtime 账本或权限面。
- 初始发送立即移出本轮临时附件，避免用户继续输入时重复携带。接受回执不会清除后来输入的文字或附件。发送拒绝时恢复原草稿；若已有新草稿，则将失败消息保留在暂停队列中。
- 本地每条消息仅在后端接受且配置回执核对通过后退出队列。重启恢复一律暂停，不能承诺跨进程崩溃的“恰好一次”执行；恢复后应结合消息历史确认是否已经执行。
- 权限与人工确认仍属于原有 Agent/Runtime 链路。排队不扩大用户任务授权，也不跳过工具确认。

## 远程边界与所有权

- `cclink-store` 唯一持有远程草稿、图片及待发送队列，以完整工作空间引用和 session ID 隔离；新会话创建期间的多次输入进入同一个临时队列，创建完成后原子绑定真实 session ID。切换会话不会把草稿发送到另一个会话。
- 队列仍调用原有 `sendAgentMessage`、创建会话、停止跟踪与图片上传 IPC。主进程继续负责账号、能力、工作空间和会话校验，既有权限确认不变；不新增 IPC、Runtime 调度或云端/Agent 修改。
- 应用级订阅随会话恢复 bootstrap 安装/释放。派发前重新核验远程能力、账号、工作空间代次和 session；不同工作空间等待返回，异步核验期间发生切换则暂停。收起面板不会停止当前工作空间内的队列消费。
- `awaitingCompletion` 仅投影原有主进程的 started/streaming/completed/error/untracked 事件；发送接受回执、助手文字和 session 列表刷新均不能放行下一条。先完成后返回发送回执的竞态也必须串行。
- 已提交项等待接受回执时禁止编辑、删除；后写草稿与附件立即分离。失败项留在队首并暂停，重试前应核对消息历史；不能承诺传输结果不明确时的“恰好一次”。手动暂停不打断当前轮，断线重新连接不自动恢复队列。
- 诊断继续使用原消息、连接状态与诊断日志；队列仅显示失败/等待原因，不把 Agent 自述或计时当作成功。

## 验证与交付口径

自动化覆盖顺序、附件隔离、草稿保留、失败暂停、手动恢复、配置变化、工作空间隔离、恢复缺图、容量与订阅释放。

```bash
pnpm typecheck
pnpm exec vitest run src/renderer/src/features/agent-conversations/conversation-message-queue.test.ts src/renderer/src/features/agent-conversations/conversation-run-controller.test.ts src/renderer/src/features/agent-conversations/conversation-workspace-state.test.ts src/renderer/src/stores/agent-store.test.ts src/renderer/src/components/agent-panel/agent-panel-view.test.tsx src/renderer/src/components/agent-panel/unified-agent-panel-architecture.test.ts src/renderer/src/bootstrap/use-agent-conversation-restore.test.ts
node scripts/agent-message-queue-smoke.mjs
node scripts/agent-message-queue-smoke.mjs --real-runtime
# 启动 pnpm dev 后，隔离 Electron + 远程 IPC 夹具：
node scripts/remote-message-queue-smoke.mjs
# 已登录实例的真实远程纯文本验收，显式选择 CDP 和 RemoteWorkspaceRef：
node scripts/remote-message-queue-smoke.mjs --real --cdp-url=http://127.0.0.1:PORT --workspace-ref='<RemoteWorkspaceRef JSON>'
```

默认 smoke 在隔离 Electron 中操作真实输入框，检查入队、编辑、删除和两种布局，发送 Runtime 使用替身；它只证明对应 UI/工程门禁。`--real-runtime` 复用本机 Claude 配置执行三轮纯文本消息，必须看到三轮真实回复，才证明真实模型接续。具体结果见本次测试记录。

## /grilling

结论：队列必须是可撤回的待发送用户消息，运行成功只能由既有 Runtime 事件确认。

尚需拷问：是否把已接受当作执行成功？是否清除了用户后写的新草稿？中断或恢复后是否未经确认继续产生副作用？配置变化后是否换了一套上下文执行原意？本方案分别保留运行终态、隔离每条附件、暂停异常与恢复，并对配置快照进行检查。

主要限制是本地重启后的图片需重附、编辑后排到队尾，以及远程队列尚不跨进程持久化。真实模型接续与夹具 UI 验证必须分开报告；远程没有已登录在线 Agent 时不能宣称远程用户闭环通过。最新实际结果见测试记录。
