# CCLink Studio 开发指南

> 当前事实源。最后更新：2026-07-22。

## 结论

本仓库是 CCLink Studio 的开源桌面壳。开发时默认只依赖本地能力，不假设存在官方生产 API、登录服务、订阅服务、官方消息凭证、云同步、网络工作区或商业更新源。

官方构建、签名、公证和生产 API 注入在 `/Users/apple/Desktop/cclink-dev` 处理；CCLink 云函数与 Agent runtime 在 `/Users/apple/Desktop/chat-cc/deploy` 和 `/Users/apple/Desktop/chat-cc/Agent`。

所有功能开发必须遵守 `docs/architecture.md` 的“架构宪法”。S0-S4 稳定化阶段已经关闭，后续功能可以从当前 `main` 稳定基线受控推进，但不得重新引入跨模块硬依赖、第二状态所有者或未经验证的权限扩张。

统一右键、命令面板、快捷键和工具栏入口的产品与工程事实源见 `docs/features/context-action-system.md`，区域 owner 库存见 `docs/ops/context-action-inventory.md`。新增区域只能贡献结构化 target、command 和 contribution；不得新增独立菜单 Host、第二个菜单 Store 或未登记的原生菜单。`pnpm verify:context-actions` 会执行该边界门禁。

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
pnpm studio:start
pnpm studio:status
pnpm studio:logs
pnpm studio:stop
```

`pnpm studio:start` 是本地实测入口，会在缺少 `node_modules` 时先安装依赖，然后重启后台开发进程并输出状态。底层进程控制仍由 `scripts/restart.sh` 承接。

启动成功后，renderer dev server 默认在 `http://localhost:5173/`。本仓库默认启动不依赖 `cclink-dev`、`chat-cc/deploy` 或 `chat-cc/Agent`。

本地打包：

```bash
pnpm studio:package
bash scripts/studio.sh package:arm64
bash scripts/studio.sh package:x64
```

本地打包只生成开源壳产物；官方签名、公证、上传和生产 API 注入不在本仓库默认路径。

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
pnpm smoke:restore
pnpm smoke:standalone
git diff --check
```

`pnpm verify` 是无 GUI 的代码质量门禁；`pnpm smoke:local` 是 Electron preload/API 本地冒烟；`pnpm smoke:ui` 是真实 UI 点击冒烟；`pnpm smoke:workflow` 是本地工作流闭环冒烟；`pnpm smoke:restore` 是启动自动恢复冒烟；`pnpm smoke:standalone` 会串联全部本地桌面壳冒烟。冒烟说明见 `docs/ops/local-smoke-check.md`。

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
│   ├── restore-smoke.mjs
│   ├── studio.sh
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
| 桌面框架     | Electron 43                   |
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

## 功能开发门禁

开始实现前必须回答：

1. 该功能属于哪个能力模块，失败时如何独立降级？
2. 是否扩大 preload、IPC、文件系统、浏览器或密钥权限面？
3. 状态由谁唯一拥有，工作区、Profile 和会话作用域是什么？
4. 启动、窗口重建、项目切换和退出时如何创建、恢复与释放？
5. 哪些外部副作用必须由用户在最后一步确认？
6. 诊断日志如何证明功能当前处于什么状态、失败在哪里？
7. 哪些自动化测试和 smoke 可以证明没有破坏已有能力？

任一问题没有明确答案时，先补设计，不进入实现。需要违反架构宪法时，先提交 `docs/decisions/` ADR。

合入前必须满足：

- `pnpm verify` 通过。
- 受影响的 smoke 测试通过。
- 没有新增明文密钥、未校验 IPC、跨 store 隐式事务或不可释放的监听器/子进程。
- 功能和降级路径都有测试，文档描述的是当前事实而非未来承诺。

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
