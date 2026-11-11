# API Key 与连接验收

## 用户可执行验收

1. 打开设置，应直接看到“API Key 与连接”；切换 Claude Code、Meshy、即梦、Pexels、GitHub 时在同一页面看到相应字段。搜索“即梦”应直接进入 AK/SK 表单。
2. Claude Code 选择服务商，填写地址、模型和 Key。点击“仅保存”，应清空明文输入并显示“已保存、尚未验证”，不发送模型请求。
3. 点击“验证连接”，确认页面展示真实结果。成功后点击“新建 Claude Code 会话”，发送一条消息并收到该服务商的回复。默认 Codex 登录不被切换或覆盖。
4. 改成无效 Key，应显示认证失败。网络错误、模型不可用、运行时缺失以实际测试错误为准；保存失败不得显示验证成功。
5. 替换 Key、地址、模型或运行时后，旧成功结果失效。地址/服务商变化必须重新输入对应 Key。切换服务前，未保存输入会要求确认放弃。
6. 即梦必须同时填写 AK/SK；Meshy、即梦和 Pexels 保存后只显示已保存，不冒充验证通过。GitHub 验证仅证明账号认证，不证明仓库权限。
7. 删除 Key 前应明确受影响功能；删除后 Claude 调用被阻止，重启后仍未配置。高级管理保留打开目录、重新加载、显示、复制和清除操作。
8. 不登录 CCLink、断开远程服务时仍可进入页面；数据源入口打开原有连接管理。

## 工程验证

- `pnpm typecheck`。
- SettingsService、Settings IPC/schema、Credential IPC、SettingsPage 受影响测试：覆盖密钥不进入公开设置、受信 renderer/有界参数、忙碌 Agent 拒绝修改、保存失败恢复旧 Key、磁盘冲突保留原设置。
- `node scripts/claude-auth-isolation-ui-smoke.mjs`：真实 Electron 和 Claude 可执行文件，隔离 userData、临时凭证、仅使用 loopback API。检查表单保存、真实测试请求、Claude 会话入口及首条 UI 消息、401、删除、重启和本机订阅隔离。运行前需构建应用，并已有 `.agent-runtime-staging/darwin-{arch}/claude`。

## 2026-11-11 执行结果

- 类型检查、受影响文件 ESLint/Prettier、凭证边界检查、构建通过；受影响测试共 49 项通过。
- 真实 Electron smoke 通过：统一表单、仅保存不请求、连接测试、Claude 会话入口和首条 UI 消息、401、删除、重启、四个第三方服务的本地保存、即梦双字段校验、搜索直达、切换时丢弃明文草稿。
- 最终成功证据目录：`/var/folders/4z/030bqrj52qn9vpf4w6hydk_c0000gn/T/studio-auth-ui-xkov85`（`result.json`、`connections-verified.png`、`claude-conversation.png`）。
- 一次复跑在启动阶段进入 Chromium 错误页，未进入设置功能；同一构建不改代码重跑通过。该启动异常原因尚未确认，没有作为设置链路的成功证据。

## 验收边界

本地测试接口通过只能证明 UI、IPC、持久化、运行时和请求链路；不能证明真实厂商 Key 的额度、模型权限或可用性。Meshy/即梦/Pexels 的真实生成/搜索、GitHub 真实账号验证、真实厂商 Claude 会话及正式安装包真人验收仍需按以上动作执行。
