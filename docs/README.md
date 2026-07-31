# CCLink Studio 文档索引

> 当前事实源。最后更新：2026-07-31。

## 先读这些

- `README.md`：仓库定位和快速开始。
- `AGENTS.md`：给 Codex/Agent 的项目边界和协作规则。
- `docs/architecture.md`：当前架构事实源。
- `docs/stabilization.md`：已关闭的 S0-S4 稳定化阶段、工作包和退出证据。
- `docs/decisions/`：架构原则例外和重大取舍的 ADR。
- `docs/development.md`：当前开发事实源。
- `docs/ops/local-smoke-check.md`：验证 Studio 开源壳可独立启动和本地核心能力可用。
- `docs/ops/package-target-check.md`：开源版与商业版打包目标、身份和产物交付检查。
- `docs/ops/oss-release-runbook.md`：开源版打包、签名、公证、Draft 验收和公开发布手册。
- `docs/features/desktop-release-and-updates.md`：桌面发布、自动检查、受控下载、确认安装和 U0-U5 开发计划。
- `docs/features/desktop-update-development-plan.md`：桌面更新 U0-U5 的任务编号、代码落点、工作量、失败矩阵、真人验收和退出证据。
- `docs/ops/stabilization-s0-acceptance.md`：S0 自动化证据和必须真人执行的核心流程验收记录。
- `docs/official-integration-contract.md`：Studio 暴露给官方构建层的接口边界。
- `docs/ops/cclink-dev-official-integration-handoff.md`：发给 `cclink-dev` 的 official loader 接入清单。
- `docs/features/workspace-system.md`：当前 OSS 本地工作空间模型。
- `docs/features/context-action-system.md`：已实现的统一右键、命令与上下文操作系统。
- `docs/features/manual-git-backup.md`：已实现的单用户手动 Git 备份；真实 GitHub 人工验收仍待执行。
- `docs/features/local-credentials.md`：已确认的 OSS 本地明文凭证产品与架构边界。
- `docs/features/local-credentials-development-plan.md`：移除系统钥匙串依赖的 M0-M6 详细开发计划。
- `docs/features/markdown-auto-illustration.md`：Markdown 自动配图的产品边界、MCP 工具、资产事务和失败降级。
- `docs/features/agent-profiles.md`：尚未实现的 Agent 预制角色、Composer 选择入口、Thread 绑定和 Session 隔离提案。
- `docs/features/ai-web-affairs-agent.md`：尚未实现的 AI 网页事务代理人产品事实源，定义跨运行事务、人与 AI 双向交接、外部等待、证据和恢复边界。
- `docs/features/scheduled-tasks.md`：工作空间定时任务的 Activity Bar、侧栏、Workbench Tab、App 内统一调度与本机启用产品方案草稿。
- `docs/features/scheduled-tasks-development-plan.md`：工作空间定时任务 E0、M8.1-M8.3、R1 的详细开发顺序、任务拆解和真人验收计划。
- `docs/features/agent-device.md`：Android 真机和 agent-device 边界。

## 当前边界

CCLink Studio 是开源桌面壳。官方账号、云函数、配对、官方消息网络、额度、商业版发布和生产 API 注入不在 OSS 默认路径里；OSS 正式 Release 由本仓库的受保护工作流独立签名、公证并创建 Draft Release。

Studio 默认可单仓库独立启动，不要求 `cclink-dev`、`chat-cc/deploy` 或 `chat-cc/Agent` 存在。当前凭证实现不依赖系统钥匙串，用户主动配置的第三方凭证保存在本机独立明文文件；发布验收状态见 `docs/features/local-credentials-development-plan.md`。Android 默认只支持用户自有 USB / Wi-Fi ADB 真机；缺少 adb 时只降级设备能力，不阻断启动。

相关代码库位置：

- Studio OSS：`/Users/apple/Desktop/cclink-dev/cclink-studio`
- 官方闭源构建：`/Users/apple/Desktop/cclink-dev`
- CCLink 云函数：`/Users/apple/Desktop/chat-cc/deploy`
- CCLink Agent runtime：`/Users/apple/Desktop/chat-cc/Agent`

不存在额外拆分出的云端或 Agent 独立项目。

## 当前文档集

- 架构与开发：`docs/architecture.md`、`docs/stabilization.md`、`docs/development.md`、`docs/decisions/`。
- 本地验收与发布：`docs/ops/local-smoke-check.md`、`docs/ops/oss-release-runbook.md`、`docs/features/desktop-release-and-updates.md`。
- 桌面更新验收证据：`docs/ops/desktop-update-acceptance.md`。
- 官方集成：`docs/official-integration-contract.md`、`docs/ops/cclink-dev-official-integration-handoff.md`。
- 工作台能力：`docs/features/workspace-system.md`、`docs/features/context-action-system.md`、`docs/features/local-credentials.md`、`docs/features/local-credentials-development-plan.md`、`docs/features/manual-git-backup.md`、`docs/features/agent-system.md`、`docs/features/agent-panel-product-model.md`、`docs/features/agent-profiles.md`、`docs/features/ai-web-affairs-agent.md`、`docs/features/browser-automation.md`、`docs/features/document-editor.md`、`docs/features/markdown-wysiwyg.md`、`docs/features/markdown-auto-illustration.md`、`docs/features/scheduled-tasks.md`、`docs/features/scheduled-tasks-development-plan.md`、`docs/features/file-type-support.md`、`docs/features/terminal-tab-model.md`、`docs/features/agent-device.md`。
- 行业能力：数据源、硬件工作空间、FPC 改版、CAD 转换、工作空间内运营助手。

架构、开发和功能规格描述当前事实；`docs/decisions/` 和带日期的 `docs/ops/`
验收记录保留当时的决策与证据。历史文档与当前实现冲突时，必须通过 superseded
说明指向新的 ADR 或当前事实源，不得静默改写历史证据。
