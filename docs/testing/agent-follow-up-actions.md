# Agent 后续消息操作验收

日期：2026-11-06（Asia/Shanghai）。产品规则见[设计文档](../features/agent-follow-up-actions.md)，[效果图](../design/agent-follow-up-actions/README.md)仍作为设计原型单独保存。

## 用户功能进度

本地 Claude Code 现在支持运行中继续排队、纯文字补充当前任务，以及确认停止后优先执行新消息。真实 Electron + 本机 Runtime 已跑通补充和停止后执行；旧队列及后写草稿保留。CCLink 远程和 Codex ACP 的两项新增操作明确禁用，尚不支持这两项能力。

验证使用隔离工作空间、独立 userData、真实 Studio 输入框和现有本地模型配置，没有替换本地 Runtime。实际使用系统 Claude Code 2.1.267，通过 SDK 0.3.211 接入；不代表所有 Runtime 版本均已通过。

### 真人复验动作与实际结果

1. 新建本地 Claude Code 会话，发送“请使用 Bash 执行 sleep 30，等待结束后回复 ORIGINAL_DONE。仅执行这条等待命令，不读取或修改文件。”。
2. 执行期间分别输入“请只回复 QUEUE_B，不调用工具。”和 QUEUE_C 同类消息，各按一次 Enter。观察到两条待发送消息。
3. **停止后执行路径：** 等出现未完成 Bash 动作，输入“请只回复 REPLACEMENT_OK，不调用工具。”，打开“更多发送方式”，点击“停止并执行这条”。立即继续输入新草稿。实际旧 Run 经 running → cancelling → cancelled 后，新 Run 才开始；只提交一次新消息并得到 REPLACEMENT_OK。B、C 顺序保留且暂停，后写草稿仍在。
4. **补充路径：** 用另一会话重复前两步，先点“暂停队列”以便保留 B、C 检查。Bash 动作执行期间输入“补充当前任务：最终只回复 STEER_OK，不要回复 ORIGINAL_DONE，不要再调用新工具。”，按 Cmd+Enter（macOS）或 Ctrl+Enter（其他系统）。立即继续输入新草稿。实际历史显示“补充当前任务 · 已接收”，输出 STEER_OK；整个过程中只有原来一个 Studio Run，B、C 与草稿保留。
5. 原队列需要用户显式点击“继续队列”才恢复。普通连续发送及 FIFO 真实模型验收见[队列记录](agent-message-queue.md)；本轮测试特意保留 B、C 暂停，没有用其自动执行掩盖暂停语义。

实际证据（正文已从 JSON 中省略，仅保留标记与状态；PNG 为真实应用截图）：

- [停止后执行事件及结果](agent-follow-up-actions/stop-and-replace.json)：旧 Run 的 `cancelled.updatedAt=1793898620306`，新 Run 的 `running.startedAt=1793898620341`，后者晚 35ms；取消请求接受本身未触发新任务。
- [真实操作菜单](agent-follow-up-actions/follow-up-menu.png)、[停止后执行完成截图](agent-follow-up-actions/replacement-complete.png)。菜单截图中旧任务仍有未完成 Bash 动作。
- [居中会话补充复验](agent-follow-up-actions/supplement-center.json)、[居中完成截图](agent-follow-up-actions/supplement-center.png)：修正长工具回执等待后，真实 Runtime 复验通过，仍只有一个 Run。
- [右侧会话补充结果](agent-follow-up-actions/supplement-right.json)、[补充完成截图](agent-follow-up-actions/supplement-complete.png)。接收状态来自匹配消息 UUID 的 Runtime started 事件，不以模型自述或本地入队作为回执。

### 本轮发现并修正的问题

- 归档会话后，迟到取消确认可能使停止后执行意图继续生效。现在归档将该意图转为暂停，恢复会话也不自动启动；工作空间变化、手动暂停、停止超时有同样保护。
- 首次居中视图复验中，Bash 等待结束后补充实际被采纳，但 30 秒接收等待窗口先超时，界面停在未知状态。接收等待调整为 120 秒，并通过现有带 Run 身份的事件流处理迟到接收证明：同一消息可以从未知更新为已接收；已确认状态不会被迟到的 IPC 超时结果降级。依旧不通过延时推断接收，不自动重发。
- 初次停止 smoke 的异步等待判断过早读取状态；改为明确轮询实际完成状态和目标输出后通过。该失败属于验收脚本，未作为成功证据保留。

## 工程准备度

- web/node TypeScript 检查、受影响文件 ESLint、统一上下文操作边界检查通过。
- 15 个受影响测试文件共 258 项通过；迟到接收修正后另跑后端、事件消费、队列 3 个文件共 106 项通过（其中新加 1 项，随后队列上下文隔离又新增 1 项并通过队列与控制器回归，按文件并集为 260 项）。
- 覆盖停止终态先后、重复点击、停止失败、超时、归档恢复、工作空间变化、草稿/附件隔离、重启暂停、补充消息 ID 幂等、版本能力不足、原任务先结束、未知回执不重发，以及迟到接收的单向状态更新。
- 排队任务的补充上下文固定为该条消息实际发送的资源快照，不能把稍后草稿挂载的新资源误当成当前 Run 上下文；定向回归已覆盖。
- 新增 `node scripts/agent-follow-up-smoke.mjs`，默认验证真实停止后执行；`--supplement` 验证真实补充；`--center` 使用居中聊天视图。脚本会使用本机模型配置产生实际调用，在隔离目录中只要求等待命令及标记回复。
- 提交前在独立工作树验证本功能快照，排除并行开发的会话导航改动。全量测试 426 个文件、3,624 项通过、10 项跳过；边界检查、ESLint、格式、web/node 类型检查及构建通过。初次统一入口在一个测试文件的格式检查处停止，格式化该文件后继续执行剩余门禁。此前真实 Runtime 动作证据保留，未因本次提交重复调用模型。
- 提交前重跑真实 Electron + 远程 IPC 夹具，队列及两项新增操作禁用检查通过；输出 `runtimeWasStubbed=true`。证据目录：`/var/folders/4z/030bqrj52qn9vpf4w6hydk_c0000gn/T/studio-remote-queue-ZIdE7b`。这不代表真实远程执行通过。
- 本次仅提交源码及证据，不打包或发布；真实远程、ACP 和以下未覆盖验收不因此视为通过。

## 未覆盖范围与交付拷问

- 用户暂不登录 CCLink；远程真实在线执行未验收。本轮[远程 Electron + IPC 夹具通过](agent-follow-up-actions/remote-ui-fixture.json)，[截图](agent-follow-up-actions/remote-follow-up-unavailable.png)证明两项操作禁用且保留“停止等待”；不能冒充真实远端执行。
- Codex ACP 没有通过补充/精确取消确认验收，保持禁用；普通发送与队列不受这一能力门槛影响。
- 本轮真实输入快捷键仅在 macOS 验证；Windows/Linux、原生中文输入法、权限等待交叉场景、全部浅深色及窄尺寸组合未做真人验收。现有 IME、键盘、共用面板回归通过不能替代这些现场验证。
- 补充只支持纯文字和原执行上下文；不保证立即中断当前工具，“已接收”也不等于模型必然采纳。超过 120 秒仍无证明时保留未知状态，禁止自动重发。
- 停止后的验证范围是 Runtime 取消终态和受管理执行链；已经完成的外部操作及脱离管理的后台任务不承诺回滚或自动取消。
- 后续最值得补的验收是权限等待时的补充/停止、已登录真实远端及 ACP 精确取消协议；不能据当前本地结果宣传所有后端能力一致。
