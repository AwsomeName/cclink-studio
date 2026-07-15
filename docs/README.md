# CCLink Studio 文档索引

> 当前事实源。最后更新：2026-07-15。

## 先读这些

- `README.md`：仓库定位和快速开始。
- `AGENTS.md`：给 Codex/Agent 的项目边界和协作规则。
- `docs/architecture.md`：当前架构事实源。
- `docs/development.md`：当前开发事实源。
- `docs/cclink-studio-boundary-and-migration.md`：商业代码迁移后的边界检查清单。
- `docs/features/project-system.md`：当前 OSS 本地工作空间模型。

## 当前边界

CCLink Studio 是开源桌面壳。官方账号、云函数、配对、TIM、额度、商业发布、签名、公证和生产 API 注入不在 OSS 默认路径里。

真实项目位置：

- Studio OSS：`/Users/apple/Desktop/cclink-dev/cclink-studio`
- 官方闭源构建/overlay：`/Users/apple/Desktop/cclink-dev`
- CCLink 云函数：`/Users/apple/Desktop/chat-cc/deploy`
- CCLink Agent runtime：`/Users/apple/Desktop/chat-cc/Agent`

不存在独立的 `cclink-cloud` 或 `cclink-agent` 项目。`private-serv` 是废弃历史项目。

## 历史文档处理规则

`docs/features/`、`docs/remote-program/` 和部分 `docs/ops/` 文件里仍可能出现 DeepInk、private-serv、Remote Program、订阅、云同步、CCLink/TIM 等旧设计。除非文件头明确标注为当前事实源，否则这些内容只作为历史材料参考。

清理历史文档时按三类处理：

- 本地工作台、浏览器、编辑器、Android、Terminal、MCP、Agent 面板：可留在 Studio 文档，改名为 CCLink Studio。
- 账号、订阅、entitlement、quota、TIM、远程配对、云同步、官方 updater/release：迁到 `cclink-dev/commercial` 或改为历史说明。
- 云函数和 Agent runtime：迁到 `/Users/apple/Desktop/chat-cc/deploy` 或 `/Users/apple/Desktop/chat-cc/Agent`。

已明确封存为历史/商业材料的高风险区域：

- `docs/remote-program/`
- `docs/features/remote-codex-workspace-plan.md`
- `docs/features/remote-error-model.md`
- `docs/features/cclink-integration.md`
- `docs/features/chatcc-agent-structured-error-protocol.md`
- `docs/features/auto-update.md`
- `docs/features/im-system.md`
- `docs/features/subscription.md`
- `docs/features/cloud-sync.md`
- `docs/features/product-milestones.md`
- `docs/architecture-optimization-plan.md`
- `docs/features/historical-remote-workspace-model.md`
- `docs/features/historical-remote-operations-priority.md`

## 不要机械替换

这些历史名称暂时是兼容协议或数据路径的一部分：

- `window.deepink`
- `com.deepink.app`
- `userData/DeepInk`
- `deepink-*` storage key
- 旧 fixture / snapshot / migration case

它们需要兼容迁移方案，不能只因为产品名变化而替换。
