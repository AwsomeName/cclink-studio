# CCLink Studio 开发指南

> 当前事实源。最后更新：2026-07-16。

## 结论

本仓库是 CCLink Studio 的开源桌面壳。开发时默认只依赖本地能力，不假设存在官方生产 API、登录服务、订阅服务、官方消息凭证、云同步、网络工作区或商业更新源。

官方构建、签名、公证和生产 API 注入在 `/Users/apple/Desktop/cclink-dev` 处理；CCLink 云函数与 Agent runtime 在 `/Users/apple/Desktop/chat-cc/deploy` 和 `/Users/apple/Desktop/chat-cc/Agent`。

## 环境准备

- macOS 13+ 优先。
- Node.js 20+。
- pnpm 9+。

```bash
pnpm install
pnpm dev
```

后台独立启动：

```bash
bash scripts/restart.sh restart
bash scripts/restart.sh status
```

启动成功后，renderer dev server 默认在 `http://localhost:5173/`。本仓库默认启动不依赖 `cclink-dev`、`chat-cc/deploy` 或 `chat-cc/Agent`。

常用验证：

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm verify
pnpm smoke:local
pnpm smoke:ui
pnpm smoke:workflow
git diff --check
```

`pnpm verify` 是无 GUI 的代码质量门禁；`pnpm smoke:local` 是 Electron preload/API 本地冒烟；`pnpm smoke:ui` 是真实 UI 点击冒烟；`pnpm smoke:workflow` 是本地工作流闭环冒烟。三者会启动真实桌面壳并验证无登录状态下的核心本地能力。冒烟说明见 `docs/ops/local-smoke-check.md`。

## 项目结构

```text
cclink-studio/
├── AGENTS.md
├── README.md
├── docs/
│   ├── README.md
│   ├── architecture.md
│   ├── development.md
│   ├── official-integration-contract.md
│   ├── ops/local-smoke-check.md
│   └── ops/cclink-dev-official-integration-handoff.md
├── scripts/
│   ├── local-smoke.mjs
│   ├── ui-smoke.mjs
│   ├── workflow-smoke.mjs
│   ├── verify-oss-boundary.mjs
│   ├── package.sh
│   ├── restart.sh
│   └── baidu-login.mjs
├── src/
│   ├── main/
│   │   ├── agent/              # Agent bridge and conversation context
│   │   ├── agent-core/         # local Claude Code backend and tools
│   │   ├── android/            # local physical-device integration
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

## 当前边界

开源壳默认只保留本地桌面能力。官方账号、订阅、同步、消息网络、网络工作区和官方发布链路由 `cclink-dev` 与 `/Users/apple/Desktop/chat-cc` 承接。

如果 TypeScript 报错需要引入官方账号、订阅、同步、消息网络或网络工作区实现才能通过，优先判断是不是本地接入点边界没有收干净。

## 技术栈

| 层级         | 技术                          |
| ------------ | ----------------------------- |
| 桌面框架     | Electron 35                   |
| 前端         | React 19 + TypeScript 5.9     |
| 构建         | electron-vite 5 + Vite 6      |
| 状态管理     | Zustand 5                     |
| 浏览器自动化 | Playwright CDP                |
| MCP          | `@modelcontextprotocol/sdk`   |
| Schema       | Zod                           |
| 样式         | CSS variables + component CSS |

## Android 真机边界

开源壳只支持用户自有 Android 真机：

- 支持 USB ADB 或 Wi-Fi ADB。
- 使用系统已有 `adb`，优先从可选自带 platform-tools、`ANDROID_HOME`、`ANDROID_SDK_ROOT`、常见 SDK 目录和 PATH 发现。
- 不下载 Android SDK。
- 不创建 AVD。
- 不启动模拟器。
- 不接托管设备服务。

没有 `adb` 时，应用仍必须能启动；Android MCP / agent-device 能力可以报告不可用。联调 Android 前，测试机器需要安装 adb 或配置 `ANDROID_HOME` / `ANDROID_SDK_ROOT`。

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
- official account
- sync
- cclink
- network

这些能力应由官方集成层明确注入，或在当前仓库中降级为不可用状态。

## 发布与签名

OSS 默认构建可以产出本地测试包，但不包含官方生产更新源、制品上传、签名和公证配置。

官方发布链路由 `/Users/apple/Desktop/cclink-dev` 承接：

- release integration
- 生产 API 注入
- electron-builder 官方发布基线
- 签名和公证
- updater feed
- 上传脚本

## 拷问

如果一个改动需要“把登录/订阅/CCLink/network 文件搬回来”才能通过 typecheck，通常说明开源壳接入点没有降级干净。

如果一个文档需要描述官方账号、云函数、官方消息凭证或 entitlement，它大概率不该继续留在 Studio 当前事实源里，而应该转到 `cclink-dev` 或 `/Users/apple/Desktop/chat-cc`。
