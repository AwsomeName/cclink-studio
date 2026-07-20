# S0 工作树盘点

> 盘点日期：2026-07-20。分支：`codex/stabilization-s0`。基线 HEAD：`8130c63`。

## 现场规模

- 修改或新增项：104。
- 已跟踪差异：77 个文件，约新增 3057 行、删除 444 行。
- 当前通过：lint、typecheck、build、107 个测试文件和 718 项测试。
- 当前失败：OSS 边界检查 6 处、格式检查 5 个文件。

本清单只归属现场，不表示所有改动都已验收。文件跨越两个领域时归入“跨域集成点”，最后统一收口。

## A. 架构治理

目标：建立架构宪法、稳定化阶段、ADR 和需求/PR 门禁。

主要文件：

- `AGENTS.md`
- `README.md`
- `CONTRIBUTING.md`
- `.github/ISSUE_TEMPLATE/feature_request.md`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `docs/README.md`
- `docs/architecture.md`
- `docs/development.md`
- `docs/stabilization.md`
- `docs/decisions/README.md`

验收：文档链接有效，`git diff --check` 通过，不描述未实现能力。

## B. 浏览器登录与 Terminal 网页回接

目标：应用内独立登录窗口、持久化 Profile、Terminal URL 默认进入 Studio 浏览器。

主要文件：

- `src/main/browser/browser-auth-*`
- `src/main/browser/clean-browser-*`
- `src/main/browser/browser-manager.ts`
- `src/main/terminal/terminal-browser-launcher*`
- `src/main/terminal/terminal-pty-execution-adapter*`
- `src/main/ipc/browser-ipc.ts`
- `src/main/ipc/window-ipc*`
- `src/shared/ipc/browser.ts`
- `src/shared/ipc/window.ts`
- `src/renderer/src/stores/browser-store*`
- `src/renderer/src/components/workbench/BrowserToolbar.tsx`
- `src/renderer/src/components/workbench/use-browser-events.ts`
- `src/renderer/src/components/sidebar/browser-sidebar-view-model*`
- `scripts/auth-window-smoke.cjs`

验收：单元测试、`smoke:auth-window`、登录完成回到主窗口、Profile 重启后仍可诊断。

## C. Markdown、文件与编辑器

目标：文档资源目录、图片保存、移动/另存、编辑器与 Agent 文件契约一致。

主要文件：

- `src/main/fs/file-service*`
- `src/main/fs/fs-ipc.ts`
- `src/main/fs/markdown-document-service.ts`
- `src/shared/ipc/fs.ts`
- `src/shared/markdown-document.ts`
- `src/main/mcp/modules/editor/*`
- `src/renderer/src/components/workbench/MarkdownEditor.tsx`
- `src/renderer/src/components/workbench/markdown-editor.css`
- `src/renderer/src/features/markdown/*`
- `src/renderer/src/stores/editor-store*`
- `src/renderer/src/stores/fs-store.ts`
- `docs/features/document-editor.md`
- `docs/features/file-type-support.md`
- `docs/features/markdown-wysiwyg.md`
- `docs/features/wysiwyg-editor.md`

验收：文件服务、Markdown codec/document、编辑器 store 和 MCP editor 测试通过；人工验证图片和重启恢复。

## D. Agent 会话与上下文

目标：会话上下文、资源挂载、消息渲染和 Composer 状态一致。

主要文件：

- `src/main/agent-core/backends/local-claude-code-backend*`
- `src/renderer/src/bootstrap/use-agent-stream-events*`
- `src/renderer/src/components/agent-panel/AgentPanel.tsx`
- `src/renderer/src/components/common/ConversationMessageRenderer*`
- `src/renderer/src/components/workbench/ConversationShell.tsx`
- `src/renderer/src/components/workbench/WorkbenchAgentConversation.tsx`
- `src/renderer/src/features/agent-composer/*`
- `src/renderer/src/features/agent-conversations/context-candidate-menu.tsx`
- `src/renderer/src/stores/agent-store*`

验收：Agent backend、stream、store、composer 和 conversation renderer 测试通过；发送、终止和恢复状态可诊断。

## E. UI 基础设施

目标：统一浮层定位、上下文菜单、面板尺寸和标签交互。

主要文件：

- `src/renderer/src/components/common/ContextMenu.tsx`
- `src/renderer/src/components/common/FloatingSurface.tsx`
- `src/renderer/src/components/common/floating-surface-*`
- `src/renderer/src/components/common/ResizeHandle.tsx`
- `src/renderer/src/components/common/TabContextMenu.tsx`
- `src/renderer/src/stores/tab-context-menu-store*`
- `src/renderer/src/utils/panel-layout*`
- `src/renderer/src/components/common/BrowserFavicon.tsx`

验收：浮层、菜单、布局和 tab 测试通过；桌面窗口中无越界、遮挡和尺寸跳动。

## F. 开发与构建

目标：Electron 43 本地开发入口、固定应用元数据和打包配置一致。

主要文件：

- `package.json`
- `pnpm-lock.yaml`
- `electron-builder.yml`
- `scripts/dev.sh`
- `scripts/prepare-dev-electron.mjs`
- `scripts/restart.sh`
- `src/main/runtime/app-metadata.ts`
- `src/main/runtime/user-data-path*`
- `src/renderer/src/app-metadata.ts`
- `tsconfig.web.json`

验收：冻结锁文件安装、`pnpm dev`、`pnpm build` 和后台 restart/status 入口通过。

## 跨域集成点

以下文件同时承载多个领域，必须在各工作包稳定后最后审查：

- `src/main/index.ts`
- `src/main/runtime/core-services.ts`
- `src/main/runtime/main-window.ts`
- `src/main/ipc/ipc-cleanup.ts`
- `src/preload/index.ts`
- `src/renderer/index.html`
- `src/renderer/src/App.tsx`
- `src/renderer/src/assets/main.css`
- `src/renderer/src/components/sidebar/Sidebar.tsx`
- `src/renderer/src/components/status-bar/StatusBar.tsx`
- `src/renderer/src/components/workbench/TabBar.tsx`
- `src/renderer/src/components/workbench/Workbench.tsx`
- `src/renderer/src/components/workbench/WorkbenchContent.tsx`
- `src/renderer/src/utils/workspace-runtime.ts`

验收：逐项说明权限、状态、生命周期和回滚影响；不得因多个功能都需要而跳过归属审查。

## 当前未决事项

1. 已完成：旧账号文件兼容已收敛到显式 migration 模块和精确允许列表。
2. 已完成：五个格式失败文件已局部执行 Prettier。
3. 已完成：`pnpm verify`、`pnpm smoke:standalone` 和严格模式 `smoke:auth-window` 已通过。
4. 已完成：从候选提交创建 detached 干净 worktree，使用锁文件安装后复现完整门禁、standalone smoke 和严格 auth-window smoke。
5. 待完成：按 `docs/ops/stabilization-s0-acceptance.md` 执行 Markdown、Terminal、登录回接、项目切换和任务状态的真人验收并归档日志。
6. 已处理：`49da3b2` 依据 ADR 0001 保留为不可改写的现场快照；库存继续承担领域归因，后续提交不得复用该例外。
7. 待完成：取得 GitHub CI 结果，并确认与本机、干净 worktree 一致。
