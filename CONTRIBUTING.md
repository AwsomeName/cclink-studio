# Contributing to CCLink Studio

Thank you for considering a contribution to CCLink Studio.

## Code of Conduct

This project and everyone participating in it is governed by the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## Quick Start

```bash
git clone https://github.com/AwsomeName/cclink-studio.git
cd cclink-studio
pnpm install
pnpm dev
```

### Requirements

- macOS 13+ (Ventura or later)
- Node.js 20+
- pnpm 9+

### Agent Backend

CCLink Studio OSS does not provide model services. Use a local or user-owned Agent backend.

**Local Claude Code CLI**
```bash
npm install -g @anthropic-ai/claude-code
claude login
```

## How to Contribute

### 1. Find or Create an Issue

- Check [existing issues](https://github.com/AwsomeName/cclink-studio/issues) for something you'd like to work on
- If you're adding a new feature, please open a feature request issue first to discuss the approach

### 2. Branch

```bash
git checkout -b feat/your-feature-name
```

Use prefix `feat/` for features, `fix/` for bug fixes, `docs/` for documentation.

### 3. Make Changes

- Read and follow the architecture constitution in `docs/architecture.md`
- During the active stabilization phase, confirm the change is allowed by `docs/stabilization.md`
- Write code following the project conventions (see below)
- Keep commits clean and focused
- Run `pnpm verify` before submitting

### 4. Commit

Use [Conventional Commits](https://www.conventionalcommits.org/) format with Chinese descriptions:

```
feat: 添加内嵌浏览器缩放功能
fix: 修复 Agent 流式消息解析异常
docs: 更新架构设计文档
```

### 5. Open a Pull Request

- PRs should target the `main` branch
- Include a clear description of what the PR does
- Reference the related issue number

## Code Style

| Rule | Convention |
|------|-----------|
| Language | TypeScript strict mode (`"strict": true`) |
| File names | `kebab-case` (e.g., `browser-manager.ts`) |
| Components | `PascalCase.tsx` (e.g., `AgentPanel.tsx`) |
| Functions/vars | `camelCase` (e.g., `updateSettings`) |
| Comments | Code comments in Chinese, public API docs in Chinese + English |
| Styling | Pure CSS with CSS variables (no CSS-in-JS, no CSS Modules) |
| State | Zustand stores with selector subscriptions |
| Icons | SVG components in `components/common/Icons.tsx` |

## Architecture Overview

```
src/
├── main/       # Electron main process (Node.js)
├── preload/    # contextBridge API (IPC bridge)
└── renderer/   # React UI (Zustand stores + components)
```

Main process is organized by domain:
- `browser/` — Embedded Chromium WebContentsView
- `playwright/` — CDP-based browser automation
- `agent/` — AI Agent backend (Claude Code CLI / HTTP API)
- `android/` — ADB + scrcpy device control
- `mcp/` — Modular MCP tool system (browser/editor/android)
- `settings/` — Settings persistence
- `fs/` — File system service

See [docs/architecture.md](docs/architecture.md) for full details.

Changes that alter security boundaries, module dependencies, lifecycle ownership, state ownership, or persistence contracts require an ADR under `docs/decisions/` before implementation.

## Boundary

CCLink Studio is the open source desktop shell. It must run without official production endpoints or official account services.

Do not add official account, subscription, quota, payment, message-network, cloud-sync, network-workspace, signing, notarization, artifact-upload, Android SDK download, AVD management, emulator launch, or hosted-device implementations to the OSS default path.

Official integration belongs to `/Users/apple/Desktop/cclink-dev` and `/Users/apple/Desktop/chat-cc`.

## Testing

```bash
pnpm test          # Run all tests
pnpm test:watch    # Watch mode
```

## What to Contribute

Ideas for contributions:

- Bug fixes for existing features
- New browser automation tools (MCP modules)
- New Android device tools
- Documentation improvements
- Test coverage expansion
- UI/UX improvements
- Performance optimizations

## License

By contributing, you agree that your contributions will be licensed under the [GPL v3 License](LICENSE).
