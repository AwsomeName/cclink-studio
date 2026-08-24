# 实验性 cclink-agent 后端

> 当前状态：默认关闭；Studio 适配器能启动服务并接收文本流，但现有 chatcc SSE 不返回
> `runtime_session_id`，两轮 Session 续聊真实闭环尚未完成。

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

## 未登录真人验收

以下是 Agent 补齐 SSE Session ID 后的正式验收步骤。以当前 `chatcc-agent 0.8.42` 执行时，
第 4 步结束会明确显示 `cclink_agent_session_id_missing`，第 5 步不能继续；这是已知真实阻塞，
不得记录为通过。

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

- 当前 chatcc SSE 成功终态没有 `runtime_session_id`，因此首轮不能安全保存 Session；
- 按 `request_id` 精确取消；
- 服务侧单次 run 状态查询和断线恢复；
- Studio 工具、MCP 与权限确认桥接；
- 上下文压缩、图片、定时任务和外部远程 URL；
- App 运行中切换服务 workspace root。

缺失接口及精确语义见 ADR 0018。Studio 会明确拒绝不受支持的取消，不会把 SSE 断开写成
`cancelled`。

## 2026-08-24 测试结果

- Studio 定向自动化：子进程启停、loopback 限制、分片 SSE、理想协议下两轮 ID 回传、无 ID
  fail-closed、取消拒绝和默认路径隔离通过；
- 真实 Electron + 本机 chatcc：Studio 启动、未出现 CCLink 登录墙、服务/runtime 探测和首轮
  文本流通过；首轮成功终态因缺少 `runtime_session_id` 失败，第二轮未执行；
- 结论：工程适配器可验证，用户两轮最小闭环 blocked，等待 Agent SSE 契约补齐后重跑本节步骤。
