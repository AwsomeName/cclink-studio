# S4 与稳定化退出验收

> 状态：自动化候选验证中，真人验收未开始。分支：`codex/stabilization-s4`。日期：2026-07-21。

## 范围

本记录只验收 S4.4 新增的诊断关联，以及 S1-S4 改造后仍需真人操作的 Agent 运行、取消、压缩和项目切换。S0 的 Markdown、Terminal 应用内 URL、真实 V2EX 登录持久化、双项目隔离和长 Terminal 任务已在 `docs/ops/stabilization-s0-acceptance.md` 留证；本轮不重复输入密码、验证码或执行任何远端发布动作。

退出稳定化阶段必须同时满足：最新提交当前工作树门禁、全新 detached worktree 门禁、远端 CI、以下 H1-H4、工作树干净。未全部满足前，S4 和稳定化阶段保持进行中。

## 自动化证据

- 候选提交：待填写。
- 当前工作树 `pnpm verify`：通过，145 个测试文件/874 项测试，typecheck 与生产构建成功。
- 当前工作树 `pnpm smoke:standalone`：通过，local 9/9、UI 6/6、workflow 5/5、restore 4/4。
- 当前工作树严格 `smoke:auth-window`：通过；Profile Cookie/localStorage 跨进程重启保留，干净认证进程到达 Google account validation，CDP 对照被拒绝。
- detached worktree 路径与结果：待填写。
- GitHub Actions run：待填写。
- 安全检查：复制报告不得包含真实 Session ID、Cookie 值、密码、验证码、token 或完整手机号/邮箱。

## 真人验收

每次只执行一个低风险步骤。结果只能是 `通过`、`失败` 或 `阻塞`；失败必须先转成复现测试并修复，不能靠重复点击涂绿。

### H1：真实 Agent 浏览器任务完成与关联日志

1. 在本地项目选择一个已打开的普通网页 Tab，不执行登录、发布或删除。
2. 在绑定该浏览器的 Agent 会话发送一个只读任务，例如读取页面标题并概括首屏。
3. 等待任务完成，确认会话不再显示运行中，BrowserTask 有明确终态。
4. 点击复制诊断，确认 `关联链` 为 `matched`，workspace、conversation、taskRunId、run、session 引用、tab 和 profile 均可判断，时间线中的浏览器动作带同一 `taskRunId`。

- 结果：待验收
- 时间：待填写
- 证据：待填写脱敏摘要；不粘贴真实 Session ID 或 Cookie 值。

### H2：人工取消收敛

1. 启动一个可安全取消、持续足够时间的只读 Agent 任务。
2. 在运行中点击停止一次，再重复点击一次。
3. 确认只有一次取消生效，会话退出运行态，不出现重复错误或空白状态。
4. 复制诊断，确认 BrowserTask 为 `cancelled`、`failureReason=user_interrupted`，关联链没有串到其他会话。

- 结果：待验收
- 时间：待填写
- 证据：待填写。

### H3：手动上下文压缩

1. 在已有 backend Session 且当前不运行的会话触发手动压缩。
2. 等待压缩完成，确认会话消息不重复、不丢失，压缩状态回到 idle/完成态。
3. 再发送一条短消息，确认沿用同一会话继续运行；失败时必须显示明确错误而不是一直 loading。

- 结果：待验收
- 时间：待填写
- 证据：待填写。

### H4：运行中项目切换与回切

1. 在项目 A 启动一个持续至少 20 秒的低风险 Agent 只读任务。
2. 切到项目 B，确认 B 不显示 A 的会话、BrowserTask 或确认卡。
3. 切回 A，确认任务仍明确显示 running/completed/cancelled/failed 之一，不出现“看不出是否停止”的状态。
4. 完成或取消任务后复制诊断，确认 workspace/conversation/task/run/session/profile 仍属于 A。

- 结果：待验收
- 时间：待填写
- 证据：待填写。

## 退出结论

待全部证据通过后填写。当前不得宣称 S4 或稳定化阶段已关闭。
