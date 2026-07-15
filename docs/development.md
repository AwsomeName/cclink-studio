# CCLink Studio 开发指南

> 当前事实源。最后更新：2026-07-15。

## 结论

本仓库是 CCLink Studio 的开源桌面壳。开发时默认只依赖本地能力，不假设存在官方生产 API、登录服务、订阅服务、TIM UserSig、云同步、远程工作区或商业更新源。

商业 overlay、官方构建、签名、公证和生产 API 注入在 `/Users/apple/Desktop/cclink-dev` 处理；CCLink 云函数与 Agent runtime 在 `/Users/apple/Desktop/chat-cc/deploy` 和 `/Users/apple/Desktop/chat-cc/Agent`。

## 环境准备

- macOS 13+ 优先。
- Node.js 20+。
- pnpm 9+。

```bash
pnpm install
pnpm dev
```

常用验证：

```bash
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

## 项目结构

```text
cclink-studio/
├── AGENTS.md
├── README.md
├── docs/
│   ├── README.md
│   ├── architecture.md
│   ├── development.md
│   └── cclink-studio-boundary-and-migration.md
├── scripts/
│   ├── package.sh
│   ├── restart.sh
│   └── baidu-login.mjs
├── src/
│   ├── main/
│   │   ├── agent/              # Agent bridge and conversation context
│   │   ├── agent-core/         # local Claude Code backend and tools
│   │   ├── android/            # local device / emulator integration
│   │   ├── browser/            # WebContentsView browser shell
│   │   ├── cdp/                # CDP port discovery
│   │   ├── editor/             # markdown editor services
│   │   ├── ipc/                # local-safe IPC handlers
│   │   ├── mcp/                # MCP tool host and modules
│   │   ├── playwright/         # browser automation bridge
│   │   ├── runtime/            # app lifecycle and service composition
│   │   ├── terminal/           # local terminal execution
│   │   └── updater/            # neutral updater shell
│   ├── preload/                # contextBridge API
│   ├── renderer/               # React UI
│   └── shared/                 # public IPC/contracts shared by main/renderer
├── electron.vite.config.ts
├── electron-builder.yml
├── package.json
└── pnpm-lock.yaml
```

## 已移出的目录类型

开源壳默认不应再有这些商业模块：

- `src/main/auth`
- `src/main/subscription`
- `src/main/sync`
- `src/main/cclink`
- `src/main/remote`
- `src/shared/ipc/auth.ts`
- `src/shared/ipc/subscription.ts`
- `src/shared/ipc/sync.ts`
- `src/shared/ipc/cclink.ts`
- `src/shared/ipc/remote.ts`
- renderer 登录、订阅、云同步、CCLink、远程工作区 UI/store。

如果 TypeScript 报错指向这些路径，优先判断是不是开源壳接入点还没有降级，而不是把商业文件搬回来。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 桌面框架 | Electron 35 |
| 前端 | React 19 + TypeScript 5.9 |
| 构建 | electron-vite 5 + Vite 6 |
| 状态管理 | Zustand 5 |
| 浏览器自动化 | Playwright CDP |
| MCP | `@modelcontextprotocol/sdk` |
| Schema | Zod |
| 样式 | CSS variables + component CSS |

## 开发规范

- TypeScript strict mode。
- 文件名 `kebab-case`，组件 `PascalCase`，函数和变量 `camelCase`。
- 代码注释使用中文；public API 文档可中英双语。
- 新能力优先接入现有 runtime/service/IPC 模式，不绕过 preload 直接给 renderer Node 权限。
- Electron 保持 `contextIsolation: true`，不开 `nodeIntegration`。

## IPC 边界

开源壳 preload 只暴露本地安全能力，例如：

- browser
- agent
- editor
- fs/workspace
- terminal
- settings
- updater
- android/device

不要在 OSS 默认路径重新暴露：

- auth
- subscription
- sync
- cclink
- remote

这些能力应由 commercial overlay 明确注入，或在当前仓库中降级为不可用状态。

## 发布与签名

OSS 默认构建可以产出本地测试包，但不包含官方生产更新源、COS 上传、签名和公证配置。

官方发布链路由 `/Users/apple/Desktop/cclink-dev` 承接：

- release overlay
- 生产 API 注入
- electron-builder 商业基线
- 签名和公证
- updater feed
- 上传脚本

## 兼容性注意

不要机械替换这些 runtime key：

- `window.deepink`
- `com.deepink.app`
- Electron `userData/DeepInk`
- `deepink-*` localStorage key
- 历史 fixture 和旧 workspace snapshot 的 DeepInk 文本

改这些名字前必须先设计兼容迁移。

## 拷问

如果一个改动需要“把登录/订阅/CCLink/remote 文件搬回来”才能通过 typecheck，通常说明开源壳接入点没有降级干净。

如果一个文档需要描述官方账号、云函数、TIM UserSig 或付费 entitlement，它大概率不该继续留在 Studio 当前事实源里，而应该转到 `cclink-dev/commercial` 或 `/Users/apple/Desktop/chat-cc`。
