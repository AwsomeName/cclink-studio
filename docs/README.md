# CCLink Studio 文档索引

> 当前事实源。最后更新：2026-08-21。

## 先读这些

- `README.md`：仓库定位和快速开始。
- `AGENTS.md`：给 Codex/Agent 的项目边界和协作规则。
- `docs/architecture.md`：当前架构事实源。
- `docs/stabilization.md`：已关闭的 S0-S4 稳定化阶段、工作包和退出证据。
- `docs/decisions/`：架构原则例外和重大取舍的 ADR。
- `docs/development.md`：当前开发事实源。
- `docs/project-memo.md`：尚未进入正式方案或计划的候选想法备忘录，不作为当前实现事实源。
- `docs/ops/local-smoke-check.md`：验证 Studio 开源壳可独立启动和本地核心能力可用。
- `docs/ops/package-target-check.md`：开源版与商业版打包目标、身份和产物交付检查。
- `docs/ops/cclink-remote-entitlement-audit.md`：CCLink 远程服务端身份与付费门禁审计。
- `docs/ops/cclink-remote-stage-1-acceptance.md`：单一 Studio 远程第一阶段真实 App 验收结果与未完成闭环。
- `docs/ops/oss-release-runbook.md`：开源版打包、签名、公证、Draft 验收和公开发布手册。
- `docs/features/desktop-release-and-updates.md`：桌面发布、自动检查、受控下载、确认安装和 U0-U5 开发计划。
- `docs/features/desktop-update-development-plan.md`：桌面更新 U0-U5 的任务编号、代码落点、工作量、失败矩阵、真人验收和退出证据。
- `docs/features/runtime-components-and-capability-plugins.md`：已交付的固定 Runtime 管理与已暂停的双版本更新/能力插件边界。
- `docs/features/npm-updatable-capability-inventory.md`：当前 npm 只用于固定 Runtime 下载的事实清单、暂停项与必须走完整 App 更新的边界。
- `docs/features/component-management-settings.md`：组件管理配置页、首次安装自动打开、清单字段、状态所有权和页面验收标准。
- `docs/features/runtime-components-and-capability-plugins-development-plan.md`：已暂停的参考计划；只有重启门禁成立并提交新 ADR 后才可恢复。
- `docs/ops/stabilization-s0-acceptance.md`：S0 自动化证据和必须真人执行的核心流程验收记录。
- `docs/official-integration-contract.md`：Studio 暴露给官方构建层的接口边界。
- `docs/ops/cclink-dev-official-integration-handoff.md`：发给 `cclink-dev` 的 official loader 接入清单。
- `docs/features/workspace-system.md`：当前 OSS 本地工作空间模型。
- `docs/features/recent-session-switcher.md`：本地/远程工作空间统一最近会话切换器、唯一新建入口、标题策略和验收边界。
- `docs/features/unified-agent-panel.md`：本地/远程 Agent Panel 统一方案；UAP-1 必须原子切换为单一 Panel/Composer 并删除远程重复 UI，不以独立 IME 补丁代替统一；UAP-2 再按契约强化远程事务生命周期。
- `docs/features/context-action-system.md`：已实现的统一右键、命令与上下文操作系统。
- `docs/features/configurable-keybinding-system.md`：已实现的统一可配置快捷键系统事实源，定义命令事实源、作用域路由、设置页录制与冲突处理、Browser `WebContentsView` 适配和验收门禁。
- `docs/features/detachable-workbench-tabs.md`：方案、P0a/P0b 与 ADR 0017 已通过；Browser-only M1
  生产实现和真实 App 自动门禁已完成，物理双屏/真实账号真人签收待执行，拖拽和其他 Tab 类型仍未授权。
- `docs/ops/detachable-workbench-tabs-p0-acceptance.md`：Electron 43.1.1 / macOS arm64 的跨窗口
  Browser 身份、回滚、Recovery Host、事件路由与释放证据。
- `docs/ops/detachable-workbench-tabs-m1-acceptance.md`：Browser-only M1 的生产能力、真实 App 7/7
  自动验收、故障门禁和待执行物理双屏真人签收。
- `docs/features/git-source-control.md`：已确认、尚未实现的左下角 Git 状态、变更 Diff、可控提交、显式 Push 和旧备份收敛产品事实源。
- `docs/features/git-source-control-development-plan.md`：Git 状态与提交推送 E0、G1-G5 开发顺序、用户验收、失败矩阵和退出门禁。
- `docs/features/manual-git-backup.md`：已实现的单用户手动 Git 备份；真实 GitHub 人工验收仍待执行。
- `docs/features/local-credentials.md`：已确认的 OSS 本地明文凭证产品与架构边界。
- `docs/features/local-credentials-development-plan.md`：移除系统钥匙串依赖的 M0-M6 详细开发计划。
- `docs/features/markdown-auto-illustration.md`：Markdown 自动配图的产品边界、MCP 工具、资产事务和失败降级。
- `docs/features/promotional-video-workbench.md`：宣发视频工作台产品事实源，定义稿件、分镜、素材、AI 生成、合成和导出的用户闭环与架构边界。
- `docs/features/promotional-video-development-plan.md`：宣发视频 M0-M6 开发事实源；M0 已完成，后续连续推进 Agent 分镜、素材、国内云视频、合成导出和统一验收。
- `docs/features/agent-role-configuration.md`：Agent 角色中心事实源；包含已实现待异机验收的会话配置、全局单例配置页、运行回执和 Session 隔离，Skill / `SOUL.md` 内容扩展，以及 AI 员工暂停后的 R0-R4 角色开发里程碑。
- `docs/features/ai-employees.md`：已确认但暂停的 AI 员工领域边界；角色与员工分离、产品组合、单一 Studio 交付，当前商业范围仅保留 CCLink 托管远程功能。
- `docs/features/agent-profiles.md`：v0.1.14 旧角色方案的兼容与迁移说明。
- `docs/features/ai-web-affairs-agent.md`：AI 网页事务代理人产品事实源；网站与账号按 ADR 0014
  全局管理，事务继续属于项目，Agent 账号执行按 ADR 0016 使用明确任务、显式账号和人工接管。
- `docs/features/global-web-accounts-development-plan.md`：全局网站账号、跨项目 Profile/Session 复用、运营矩阵、v2→v3 迁移和事务引用兼容的 E0、G1–G4、T1、R1 正式施工计划。
- `docs/testing/browser-http-basic-auth.md`：内嵌浏览器 HTTP Basic Auth challenge 被 Electron 默认取消的
  P1 缺陷记录、凭证安全边界、修复方案和真实 FRP 验收门禁。
- `docs/testing/browser-tab-bar-native-view-occlusion.md`：`v0.1.54` 内嵌浏览器原生层覆盖 Tab 栏、
  当前本地与后台打开远程项目状态误判的事故记录，以及 `v0.1.55` 不可回归约束。
- `docs/testing/browser-session-mode-separation.md`：普通浏览、已保存账号和添加新账号三种 Session
  模式的事故根因、架构边界与真人端到端验收步骤。
- `docs/features/ai-web-affairs-agent-development-plan.md`：AI 网页事务代理人的开发管理事实源；保留项目账号和事务历史证据，当前账号施工以全局账号专项计划为准。
- `docs/features/scheduled-tasks.md`：工作空间定时任务的 Activity Bar、侧栏、Workbench Tab、App 内统一调度、本机启用和保存快捷键产品事实源。
- `docs/features/scheduled-tasks-development-plan.md`：工作空间定时任务 E0、M8.1-M8.3、R1 的详细开发顺序、任务拆解和真人验收计划。
- `docs/features/agent-device.md`：Android 真机和 agent-device 边界。

## 当前边界

CCLink Studio 是唯一桌面 App。本地能力免费免登录；账号、设备、消息 transport 和远程工作区作为可选内置域，只在用户明确进入远程入口，或项目条仍有打开的远程工作空间时按需启动。当前激活本地工作空间与后台打开远程工作空间可以同时成立，连接不会改变本地工作空间类型。云服务、Agent runtime NPM 发布、支付和发布凭证仍保持独立。

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
- 工作台能力：`docs/features/workspace-system.md`、`docs/features/recent-session-switcher.md`、`docs/features/unified-agent-panel.md`、`docs/features/context-action-system.md`、`docs/features/configurable-keybinding-system.md`、`docs/features/detachable-workbench-tabs.md`、`docs/features/local-credentials.md`、`docs/features/local-credentials-development-plan.md`、`docs/features/git-source-control.md`、`docs/features/git-source-control-development-plan.md`、`docs/features/manual-git-backup.md`、`docs/features/agent-system.md`、`docs/features/agent-panel-product-model.md`、`docs/features/agent-role-configuration.md`、`docs/features/ai-employees.md`、`docs/features/agent-profiles.md`、`docs/features/ai-web-affairs-agent.md`、`docs/features/global-web-accounts-development-plan.md`、`docs/features/ai-web-affairs-agent-development-plan.md`、`docs/features/browser-automation.md`、`docs/testing/browser-http-basic-auth.md`、`docs/testing/browser-tab-bar-native-view-occlusion.md`、`docs/features/document-editor.md`、`docs/features/markdown-wysiwyg.md`、`docs/features/markdown-auto-illustration.md`、`docs/features/promotional-video-workbench.md`、`docs/features/scheduled-tasks.md`、`docs/features/scheduled-tasks-development-plan.md`、`docs/features/file-type-support.md`、`docs/features/terminal-tab-model.md`、`docs/features/agent-device.md`、`docs/features/runtime-components-and-capability-plugins.md`、`docs/features/runtime-components-and-capability-plugins-development-plan.md`。
- 行业能力：数据源、硬件工作空间、FPC 改版、CAD 转换、工作空间内运营助手。

架构、开发和功能规格描述当前事实；`docs/decisions/` 和带日期的 `docs/ops/`
验收记录保留当时的决策与证据。历史文档与当前实现冲突时，必须通过 superseded
说明指向新的 ADR 或当前事实源，不得静默改写历史证据。
