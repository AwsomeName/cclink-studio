# CCLink Studio 文档索引

> 当前事实源。最后更新：2026-07-20。

## 先读这些

- `README.md`：仓库定位和快速开始。
- `AGENTS.md`：给 Codex/Agent 的项目边界和协作规则。
- `docs/architecture.md`：当前架构事实源。
- `docs/stabilization.md`：当前稳定化阶段、工作包和退出标准。
- `docs/decisions/`：架构原则例外和重大取舍的 ADR。
- `docs/development.md`：当前开发事实源。
- `docs/ops/local-smoke-check.md`：验证 Studio 开源壳可独立启动和本地核心能力可用。
- `docs/official-integration-contract.md`：Studio 暴露给官方构建层的接口边界。
- `docs/ops/cclink-dev-official-integration-handoff.md`：发给 `cclink-dev` 的 official loader 接入清单。
- `docs/features/project-system.md`：当前 OSS 本地工作空间模型。
- `docs/features/manual-git-backup.md`：规划中的单用户手动 Git 备份方案和开发里程碑。
- `docs/features/agent-device.md`：Android 真机和 agent-device 边界。

## 当前边界

CCLink Studio 是开源桌面壳。官方账号、云函数、配对、官方消息网络、额度、官方发布、签名、公证和生产 API 注入不在 OSS 默认路径里。

Studio 默认可单仓库独立启动，不要求 `cclink-dev`、`chat-cc/deploy` 或 `chat-cc/Agent` 存在。Android 默认只支持用户自有 USB / Wi-Fi ADB 真机；缺少 adb 时只降级设备能力，不阻断启动。

真实项目位置：

- Studio OSS：`/Users/apple/Desktop/cclink-dev/cclink-studio`
- 官方闭源构建：`/Users/apple/Desktop/cclink-dev`
- CCLink 云函数：`/Users/apple/Desktop/chat-cc/deploy`
- CCLink Agent runtime：`/Users/apple/Desktop/chat-cc/Agent`

不存在额外拆分出的云端或 Agent 独立项目。

## 当前文档集

- 架构与开发：`docs/architecture.md`、`docs/stabilization.md`、`docs/development.md`、`docs/decisions/`。
- 本地验收：`docs/ops/local-smoke-check.md`。
- 官方集成：`docs/official-integration-contract.md`、`docs/ops/cclink-dev-official-integration-handoff.md`。
- 工作台能力：`docs/features/project-system.md`、`docs/features/manual-git-backup.md`、`docs/features/agent-system.md`、`docs/features/agent-panel-product-model.md`、`docs/features/browser-automation.md`、`docs/features/document-editor.md`、`docs/features/markdown-wysiwyg.md`、`docs/features/file-type-support.md`、`docs/features/terminal-tab-model.md`、`docs/features/agent-device.md`。
- 行业能力：数据源、硬件工作区、FPC 改版、CAD 转换、项目内运营助手。

文档只描述最新产品方向和当前工程边界，不保留旧方案细节。
