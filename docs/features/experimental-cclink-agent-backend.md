# 实验性 cclink-agent 后端

> 当前状态：默认关闭；`chatcc-agent 0.8.49` 已返回 `runtime_session_id`，
> 未登录真实 Electron 两轮文本续聊验收通过。这不改变 Claude Code 默认后端。
> 2026-08-25 起该路线冻结：只保留实验和验收证据，不继续补运行控制、工具/权限或默认切换。
> 详见 ADR 0019。

## 启用方式

开发环境从终端显式启用；普通 `pnpm dev` 不受影响：

```bash
CCLINK_STUDIO_EXPERIMENTAL_AGENT_BACKEND=cclink-agent \
CCLINK_AGENT_CLI_PATH="$(command -v chatcc)" \
pnpm dev
```

可选设置：

- `CCLINK_AGENT_PORT`：loopback 端口，默认 `17374`；
- `CCLINK_AGENT_RUNTIME_ID`：chatcc Runtime ID，默认 `claude_code`。

实验模式在整次 App 生命周期内替换本地 Claude backend，但不改变持久默认值，也不增加 UI 选择。
请使用新建的本地 Thread 验收；不要拿已有 Claude Session 的历史 Thread 测试。

## 未登录真实 App 验收

以下步骤已使用 `chatcc-agent 0.8.49` 执行通过。`0.8.42` 的 Session ID 缺失只保留为
历史失败证据，不再是当前阻塞。

1. 确认 Studio 未登录 CCLink；选择一个本地工作区后退出 Studio。
2. 用上面的环境变量启动 Studio。终端应出现
   `Agent 后端就绪 (... cclink-agent ... @ http://127.0.0.1:17374)`；不应出现登录页。
3. 新建一个本地 Thread，发送：`记住校验词是“海盐蓝”，先只回复“已记住”。`
4. 确认回复逐步出现，而不是结束后一次性整段出现；回复结束后 Thread 可以继续发送。
5. 在同一 Thread 发送：`我刚才让你记住的校验词是什么？只回复校验词。`
6. 确认第二轮流式回复为 `海盐蓝`。这证明首轮 `runtime_session_id` 已保存并在第二轮回传。
7. 关闭 Studio，确认 `chatcc cclink-studio` 子进程随 App 退出。
8. 不带实验环境变量重新运行 `pnpm dev`，确认日志回到 Claude Code 默认后端。

如果第 3 步模型主动调用工具，当前服务会进入自身审批路径；该路径尚未接 Studio
`PermissionManager`，不属于本次验收。换成纯文本问题重试，并把工具触发记录为后续协议需求。

## 当前不支持

以下能力是冻结边界，不是当前开发队列或待立即修复的发布阻塞：

- 按 `request_id` 精确取消；
- 服务侧单次 run 状态查询和断线恢复；
- Studio 工具、MCP 与权限确认桥接；
- 上下文压缩、图片、定时任务和外部远程 URL；
- App 运行中切换服务 workspace root。

冻结范围及历史接口设想见 ADR 0018 和 ADR 0019。Studio 会明确拒绝不受支持的取消，不会把
SSE 断开写成 `cancelled`。

## 2026-08-24 测试结果

- Studio 定向自动化：子进程启停、loopback 限制、分片 SSE、理想协议下两轮 ID 回传、无 ID
  fail-closed、取消拒绝和默认路径隔离通过；
- 历史失败：本机 `chatcc-agent 0.8.42` 首轮文本流到达，但 SSE `done` 缺少
  `runtime_session_id`，Studio 以 `cclink_agent_session_id_missing` 失败关闭，未执行第二轮；
- 0.8.49 环境：全局 CLI 位于
  `/Users/apple/.local/node-v22.22.2-darwin-arm64/bin/chatcc`，`chatcc --version` 返回 `0.8.49`；
- 未登录前置：真实 Electron 使用全新隔离 `userData`，`auth.checkSession()` 返回
  `loggedIn: false`，且目录中不存在 `cclink-session.json`；当前本地工作区由主进程成功绑定；
- 两轮对话：首轮回复包含“已记住”并以 `text-delta` 事件到达，Studio 保存服务返回的
  Session ID；同一 conversation 第二轮回复包含“海盐蓝”，run 终态为 `succeeded`；
- 生命周期：验收退出后无 `chatcc cclink-studio` 残留进程；不带实验环境变量重启时，
  日志为 `Agent 后端就绪 (local-claude-code, system, Claude Code 2.1.122)`；
- 最终真实 App smoke：`pnpm smoke:cclink-agent` 通过，证据目录为
  `/tmp/cclink-agent-0849-final3.tFQ2Nz`；默认后端复核证据目录为
  `/tmp/cclink-agent-default-check.0PC5XL`。
- 结论：用户现在可在显式实验开关下完成未登录两轮文本续聊；默认后端未切换。精确取消、
  服务侧 run 恢复和工具/权限闭环仍不支持。
