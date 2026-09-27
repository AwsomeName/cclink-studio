# Agent 重启恢复后假性卡住：根因与修复验证

环境：已安装 Studio 0.1.93，Claude Agent SDK 0.3.211，managed Claude Code 2.1.211。

## 根因

原会话上一次执行了后台 Bash smoke 任务后中断。恢复时 Runtime 为残留后台任务生成 task_notification，并在处理新用户消息之前发出一个空的 result/success。Studio 和 SDK 均错误地把第一个 result 当作当前用户请求的最终结果。

1. Studio 无图片时向 SDK 传入字符串 prompt（local-claude-code-backend.ts:894）。SDK 的 single-turn readMessages 分支在第一个 result 到达时执行 transport.endInput()，关闭 CLI 的 stdin。
2. CLI 随后处理真正的新用户消息，需要通过双向协议调用 PreToolUse/canUseTool；stdin 已关闭，回调无法正常交互，Bash 返回通用“用户不愿执行”拒绝文案。现场无用户审批事件，不能归因于用户点击拒绝。
3. Studio handleEvent 对任意 result 直接 emit complete（local-claude-code-backend.ts:756）。AgentRuntime 收到 complete 后清空 activeRunId，并在后续事件到达时直接 return（agent-runtime.ts:293）。因此后续真实输出不会送到界面。
4. consumeQuery 在处理 result 前 await captureContextUsage，首个提前结果的交付时间可能延后；磁盘 completedAt 并不能证明它对应最后一条真实回复。

## 现场证据

原会话主进程状态为 succeeded，UI 为 completed/loading=false，消息列表却停在用户输入。原始 Runtime transcript 包含 Bash 被拒及最终助手回复。上述观察通过运行中应用的只读 CDP、run 状态文件和会话 transcript 交叉核对。

## 对照复现

不修改原会话。复制其 13:41 重启前的 transcript 到权限隔离的临时 config，用相同 SDK、Runtime、模型和账号执行诊断。只允许 Bash 的精确命令 pwd，其他动作拒绝；未提交、推送或发布。

- 新建会话：pwd 成功，正常返回流式事件和最终结果。
- 恢复副本 + 字符串 prompt：先出现空 success；后续 pwd 被拒；PreToolUse 和 canUseTool 均未被调用；最终回复仍生成。见 resume-probe.jsonl。
- 恢复副本 + 保持开放的异步输入：仍先出现空 success，但 PreToolUse 正常触发，pwd 成功，最终回复正确。见 resume-held-probe.jsonl。

## 修复边界

需要同时处理输入管道生命周期和用户轮次终态归属：保持双向输入直到当前用户轮次真正结束，不能让恢复通知结果抢先结束 Run。单纯改成会立即结束的 async generator 仍不足，因为 SDK streamInput 也会在 firstResult 后关闭输入。不能简单忽略所有空 result：正常无正文完成和错误也必须收敛。

完整 assistant 消息兜底是另一处可改进点，但不是本次主因；此次消息在 AgentRuntime 层已经因 activeRunId 清空而被丢弃。

初次诊断阶段只完成根因与隔离对照。后续修复结果见下节。


## 修复结果（2026-09-23）

已修改现有 LocalClaudeCodeBackend，并保留工作区原有未提交改动：

- 所有用户输入（含图片和 /compact）统一使用保持开放的异步输入，在所属用户结果、取消、启动失败或传输终止时释放；未新增调度器或状态 owner。
- 仅按 SDK 明确的 `result.origin.kind === 'task-notification'` 跳过通知轮次终态。不以正文为空、num_turns 或等待时长猜测；正常空结果及用户轮次错误保持原有收敛路径。
- 跳过通知结果时不发 complete、不采集阻塞性的终态用量、不释放工具会话，并记录有界诊断。
- 未改变授权判定、工作区路径保护和调度禁用策略。

### 验证

- 后端单测 49 项通过，覆盖通知成功/失败、真实工具授权继续、回复转发、单次完成、正常空结果、通知后断流、取消、启动失败，以及既有图片和压缩行为。
- AgentRuntime、AgentBridge run 生命周期、持久状态、授权 broker 与 renderer 流事件共 69 项测试通过。
- `pnpm typecheck`、改动文件 ESLint、Prettier 与 `git diff --check` 通过。
- 使用 esbuild 编译本次实际后端源码，再连接真实 SDK 0.3.211 / Runtime 2.1.211，恢复原会话重启前的隔离副本。`pwd` 成功、流式正文包含实际目录、且只发出一个 complete。Query 最终 disconnected、工具 session 释放一次。见 fixed-backend-smoke.log。
- 本次未运行全量 verify；受影响的真实 Runtime smoke 与定向回归通过。

### 用户验收动作与当前边界

安装包含本次修复的版本或运行修复后的开发应用后：启动一个后台只读任务，中断退出，重启并恢复会话，发送“执行 pwd 并回复路径”；应看到工具执行与最终回复，旧任务通知不能使新一轮提前结束。再发送新消息应可继续；执行期间取消应收敛。

实际完成的是隔离真实 Runtime 验证；尚未在完整 Electron 界面中重跑上述动作，不能把它记作真人 UI 验收通过。当前运行的已安装 0.1.93 未替换，本次未打包、提交、推送或发布。
