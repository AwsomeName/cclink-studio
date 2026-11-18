# API Key 与连接验收

## 用户可执行验收

1. 打开设置，应直接看到“API Key 与连接”；切换 Claude Code、Meshy、即梦、Pexels、GitHub 时在同一页面看到相应字段。搜索“即梦”应直接进入 AK/SK 表单。
2. Claude Code 选择服务商，填写地址、模型和 Key。点击“仅保存”，应清空明文输入并显示“已保存、尚未验证”，不发送模型请求。
3. 点击“验证连接”，确认页面展示真实结果。成功后点击“新建 Claude Code 会话”，发送一条消息并收到该服务商的回复。默认 Codex 登录不被切换或覆盖。
4. 改成无效 Key，应显示认证失败。网络错误、模型不可用、运行时缺失以实际测试错误为准；保存失败不得显示验证成功。
5. 替换 Key、地址、模型或运行时后，旧成功结果失效。地址/服务商变化必须重新输入对应 Key。切换服务、通过搜索跳转或切换设置侧栏时，未保存输入会要求确认放弃；取消应保留输入，确认后旧表单明文应清空。保存/验证进行中不能通过这些入口离开表单。
6. 即梦必须同时填写 AK/SK；Meshy、即梦和 Pexels 保存后只显示已保存，不冒充验证通过。GitHub 验证仅证明账号认证，不证明仓库权限。
7. 删除 Key 前应明确受影响功能；删除后 Claude 调用被阻止，重启后仍未配置。高级管理的单项清除、清除全部以及重新加载后移除的 Key 也必须立即失效；有 Agent 任务运行时应拒绝变更并保留配置。高级管理保留打开目录、重新加载、显示、复制和清除操作。
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

## 2026-11-11 自查与修复

- 修复高级管理绕过 Agent 配置锁和热更新的问题：单项写入/删除 Agent 凭证、清除全部及重新加载通过同一配置协调入口；损坏文件加载后的空凭证也同步到后端。未启动 Agent 时不因删除凭证启动运行时。
- 修复搜索跳转、设置侧栏跳转绕过未保存提醒；保存、验证和高级凭证操作期间统一禁用冲突入口。凭证读取失败时撤销旧“已保存/验证通过”显示，删除失败后仍刷新实际存储状态；凭证显示请求和隐藏计时器在离开页面时失效或清理。
- 修复 Claude 删除过程中普通设置写入失败却先移除 Key 的问题，避免失败后界面与运行中的配置不一致。
- 修复 GitHub 替换/删除 Token 后仍显示“已连接”，以及在途验证覆盖已移除 Token 状态的问题；保存新账号的普通设置失败时恢复旧 Token。修改用户名时表单要求同时填写对应 Token。
- 工程门禁：`pnpm typecheck`、受影响文件 ESLint/Prettier、凭证边界检查、构建和 56 项相关测试通过。
- 真实 Electron smoke 通过；除原有保存→验证→新建 Claude 会话→收到回复、401、删除和重启外，新增高级管理三条撤销路径、搜索/侧栏取消保留草稿及确认后清空的验收。
- 本轮证据：`/var/folders/4z/030bqrj52qn9vpf4w6hydk_c0000gn/T/studio-auth-ui-xcToka/result.json`。使用隔离 userData 和本地测试接口，没有使用真实用户密钥、产生付费模型调用或发布安装包。

## 2026-11-18：Claude 安装后自动启用

2026-11-18 安装即启用的验收动作：在组件管理点击“安装并启用”，确认显示“已启用 · Studio
管理”；返回 API Key 与连接，运行时选择自动更新为 Studio 管理版本，自定义路径输入不再出现。
配置 Key 后验证连接并新建 Claude 会话；重启后保持选择，会话仍位于 Studio 私有目录。
已有安装且旧路径失效时，“启用 Studio 版本”应复用文件；任务进行中、安装失败或保存失败时
不得切换。后端应用失败须显示“已安装，但启用失败”并允许重试。

复跑 `node scripts/claude-auth-isolation-ui-smoke.mjs --managed-install`：真实下载固定 npm
包、真实 Electron 与 Claude 进程，使用临时 userData 和本地模拟 API；不需要用户真实 Key。
覆盖旧无效路径、未配 Key 安装、自动启用、已安装复用、设置页刷新、401 不回退、私有会话与重启。

执行结果：

- 真实 Electron + Claude `2.1.211` 完整流程通过，包含官方 npm 实际下载与校验、未配 Key
  安装启用、已有安装记录逐字节不变、自动更新运行时表单、设置保存和重启恢复。
- 配置测试 Key 后，验证连接与首条 UI 会话成功；401 不回退订阅登录，清除 Key 后立即及
  重启均拒绝请求。会话留在 Studio 私有目录，外部配置目录保持不变。
- 证据：`/var/folders/4z/030bqrj52qn9vpf4w6hydk_c0000gn/T/studio-auth-ui-zy7EKg/result.json`，
  同目录包含 `installed-component-row.png`、`reused-component-row.png` 和对话截图。
- 工程门禁：56 项相关测试通过（2 项可选 smoke 未在该命令启用）；另行启用真实进程隔离
  smoke 后 5 项全部通过。类型检查、受影响 ESLint/Prettier、凭证边界、构建和 diff 检查通过。
- 首轮完整 UI 测试停在重启断言：窗口已出现，但 Runtime 仍在异步校验。独立复核确认
  `pending → managed active + AUTH_REQUIRED`，约 2.5 秒完成；脚本改为等待真实初始化结果，
  从空白 profile 重新下载并复验成功，未以延时改动产品启动逻辑。
- 未发布安装包，未操作另一台 Mac 或 Claude 桌面端 UI；本轮不重新宣称旧 packaged 跨版本
  验收已覆盖新流程。

## 验收边界

本地测试接口通过只能证明 UI、IPC、持久化、运行时和请求链路；不能证明真实厂商 Key 的额度、模型权限或可用性。Meshy/即梦/Pexels 的真实生成/搜索、GitHub 真实账号验证、真实厂商 Claude 会话及正式安装包真人验收仍需按以上动作执行。
