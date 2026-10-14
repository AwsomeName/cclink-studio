# CCLink Studio 开发指南

> 当前事实源。最后更新：2026-10-12。

## 结论

本仓库是唯一 CCLink Studio 桌面 App。本地能力默认启动、免费且免登录；CCLink 账号、设备和远程工作区作为可选内置功能域，只在用户打开远程入口后初始化。缺配置、未登录和远程故障都不得影响本地功能。

本地主进程 Agent 是 Studio 本地聊天的唯一运行面。开发本地发送、流、取消、run 终态或
Claude Session 恢复时，必须扩展现有 Agent IPC/Runtime，不得新增
`chatcc cclink-studio --local-runtime` 或其他并行本地服务。现有 `chatcc cclink-studio`
默认只属于远程 debug/integration；ADR 0018 允许通过显式环境开关把该现有 loopback surface
作为默认关闭的实验 `IAgentBackend`，但 Studio 仍独占 Thread/run/Session 状态，且不得伪造
缺失的取消与状态能力。2026-08-22 的正式闭环范围见 `docs/features/agent-system.md`。

CCLink 云函数与 Agent runtime 仍位于 `/Users/apple/Desktop/chat-cc/deploy` 和
`/Users/apple/Desktop/chat-cc/Agent`，分别独立部署和通过现有 NPM 包发布。本次不修改它们。
支付和生产服务秘密不在当前实施范围；桌面正式 Release 的 Developer ID 签名与 Apple 公证
只存在于受保护的 GitHub 工作流，不进入应用运行时。

所有功能开发必须遵守 `docs/architecture.md` 的“架构宪法”。S0-S4 稳定化阶段已经关闭，后续功能可以从当前 `main` 稳定基线受控推进，但不得重新引入跨模块硬依赖、第二状态所有者或未经验证的权限扩张。

第三方凭证边界见 `docs/features/local-credentials.md` 和 ADR 0003。CCLink Session 是明确例外：只用权限为 `0600` 的本地 Session 文件持久化 refresh token；access token、IM UserSig 和完整远程身份只驻留主进程内存。禁止使用或迁移任何系统钥匙串数据，旧密文只能隔离并要求重新登录。

统一右键、命令面板、快捷键和工具栏入口的产品与工程事实源见 `docs/features/context-action-system.md`，区域 owner 库存见 `docs/ops/context-action-inventory.md`。新增区域只能贡献结构化 target、command 和 contribution；不得新增独立菜单 Host、第二个菜单 Store 或未登记的原生菜单。`pnpm verify:context-actions` 会执行该边界门禁。

统一可配置快捷键的实现事实源见 `docs/features/configurable-keybinding-system.md`。新增快捷键不得
增加组件级 `window/document keydown` 业务监听；必须先定义稳定 command ID、作用域、输入框
策略、冲突行为和真实应用验收动作，并由统一 Shortcut Router 执行。

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
pnpm package:local
```

本地打包只生成 arm64 Studio 验收产物，不修改版本；官方签名、公证和上传不在本地路径。
当前包产品名必须为 `CCLink Studio 开源版`，输出到本仓库
`dist/`，并使用 ad-hoc 签封。执行前后必须按照
`docs/ops/package-target-check.md` 核对目标。`cclink-dev` 中的旧 commercial overlay 仅是迁移期
只读参考和回滚遗留，不是当前 Studio 的构建或发布入口。

正式包采用文件允许列表，只包含 `out/`、运行时 `package.json`、生产依赖和
`electron-builder.yml` 明确声明的额外资源。本机 `.cache`、`.env`、工作空间状态、
设计稿、源码与开发脚本不得进入 `app.asar`。只由 renderer 使用的库属于构建期依赖，
由 Vite 写入 renderer bundle 后不再重复复制完整 npm 包。`pnpm verify:package-boundary`
负责检查这些边界；它不设置安装包体积阈值。

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

## 仓库结构

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

本仓库拥有唯一 CCLink Studio 桌面 App：本地能力免费、免登录；手机号登录、设备状态、
消息 transport、RemoteProvider、远程工作空间、远程 Agent 会话和远程 PTY 作为可选内置
功能域随 Studio 源码交付。缺少配置、未登录、协议不兼容或远程服务故障时，本地工作台
必须继续可用。

`/Users/apple/Desktop/chat-cc/deploy` 继续拥有云函数和账号体系，
`/Users/apple/Desktop/chat-cc/Agent` 继续发布远程 Agent runtime；它们不拥有第二套桌面 App。
`/Users/apple/Desktop/cclink-dev` 只作迁移期只读参考与云端/发布运维工作区，不得重新成为
Studio 的源码覆盖层或独立桌面发布入口。

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

## Runtime 组件与已暂停的能力插件扩展

固定版本 Runtime 的按需安装和 App 替换复用已经实现；真实双版本更新、远程版本目录、内容包和能力插件自 2026-08-15 起暂停。产品边界以 `docs/features/runtime-components-and-capability-plugins.md` 为准；`docs/features/runtime-components-and-capability-plugins-development-plan.md` 只是重启后的冻结参考，不是当前开发计划。

ADR 0007/0010 已处理 Claude Runtime 独立安装和瘦包边界。若未来通过新 ADR 重启能力插件，仍遵守：

- npm 只提供维护者允许目录中的精确 tarball；客户端不运行 npm/pnpm、不解析 `latest`、
  不运行 lifecycle script。
- 普通插件构建为单一 browser ESM bundle，在 `sandbox: true`、`nodeIntegration: false`、
  `contextIsolation: true` 的独立 Host 中运行。
- 插件不直接读取文件、网络、环境变量、Shell 或凭证，只能调用主进程有界 broker。
- Plugin Host、Manager 和 broker 必须进入统一 `ServiceRegistry`，启动、失败回滚、窗口重建和
  退出使用同一生命周期声明。
- 完整 App、Runtime 组件和插件分别保留明确状态 owner；renderer 只投影状态。
- 第一版更新后允许重启插件宿主或 Studio 生效，不为“热更新”提前增加运行中卸载分支。
- 当前桌面 updater 的自动安装和真实升级仍是核心发布主线，插件不能替代它。

## Android 真机边界

Studio 的 Android 能力只支持用户自有真机：

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
4. 启动、窗口重建、工作空间切换和退出时如何创建、恢复与释放？
5. 哪些外部副作用必须由用户在最后一步确认？
6. 诊断日志如何证明功能当前处于什么状态、失败在哪里？
7. 哪些自动化测试和 smoke 可以证明没有破坏已有能力？

任一问题没有明确答案时，先补设计，不进入实现。需要违反架构宪法时，先提交 `docs/decisions/` ADR。

合入前必须满足：

- `pnpm verify` 通过。
- 受影响的 smoke 测试通过。
- 没有把凭证新增到工作空间、普通设置、日志、诊断或 renderer 全量状态；明文凭证只能进入 `CredentialService` 管理的独立本地文件。
- 没有新增系统钥匙串依赖、未校验 IPC、跨 store 隐式事务或不可释放的监听器/子进程。
- 功能和降级路径都有测试，文档描述的是当前事实而非未来承诺。

## IPC 边界

Studio preload 只暴露界面职责所需的有界、类型化能力，例如：

- browser
- agent
- editor
- fs/workspace
- terminal
- settings
- updater
- android/device
- cclink account/device/realtime
- remote workspace/file/Agent/PTY adapter

远程 API 必须使用共享 contract、运行时 parser 和 trusted renderer guard，并继续由主进程
拥有 token、UserSig、完整远程身份、transport 和请求生命周期。preload 不得暴露：

- access token、refresh token、IM UserSig 或完整远程身份
- 原始 `ipcMain`、`ipcRenderer` 或任意 channel 调用
- 绕过 `RemoteWorkspaceRef` 和能力检查的通用网络文件、shell 或消息发送入口
- 第二套 Workspace、Tab、Terminal、Agent Session 或生命周期状态

缺配置、未登录、配对失败或远程离线时，这些有界入口返回结构化不可用状态，本地 API 继续可用。

## 发布与签名

Studio 默认构建可以产出本地测试包，使用 ad-hoc 签封，但不包含生产发布凭证、
Developer ID 签名和公证配置。唯一 Studio 打包目标的强制检查见
`docs/ops/package-target-check.md`。

正式包由本仓库 `.github/workflows/release-oss.yml` 从不可变 Tag 构建：

- `studio-release` Environment Secrets 提供受保护的签名和公证凭证。
- arm64 固定在 Apple Silicon runner 构建。
- 工作流完成 Developer ID 签名、Apple 公证、staple 和制品验证。
- 工作流在全部自动门禁通过后直接创建公开稳定 Release。

维护者从与 `origin/main` 一致、源码 CI 已全绿且 `package.json` 无本地改动的
`main` 执行；其他未提交开发文件会被保留并排除在发布之外：

```bash
pnpm release -- --patch
# 或指定版本
pnpm release -- --version 0.1.3
```

该命令复用当前源码 SHA 已通过的普通 CI，只创建修改 `package.json.version` 的版本
提交，在独立临时 worktree 中完成发布预检，然后创建不可变 Tag、原子推送并触发
GitHub 发布工作流，等待公开稳定 Release 完成。正式签名、公证和 DMG 只在线上
执行；需要额外本地 ad-hoc 包时显式提供 `--local-artifacts`。
若 main 与 Tag 已成功推送，但工作流触发失败，可只重试远端构建：

```bash
pnpm release -- --dispatch-only v0.1.3
```

命令会在全部自动门禁通过后公开稳定 Release，但不会把签名、公证或 GitHub 凭证写入
源码和安装包。真实安装与更新反馈在发布后进行，不再设置人工 Publish 步骤。
首次配置、逐步操作、验收标准和失败恢复见
`docs/ops/oss-release-runbook.md`。

本仓库的 Release 是唯一桌面正式发布入口。`cclink-dev` 中的遗留 commercial workflow
不得触发、覆盖或替代本仓库 Release，也不得被描述为当前第二条桌面产品线。

## 拷问

如果一个改动需要从旧 commercial overlay 复制 App、Settings、Sidebar、preload、Terminal
或 Workspace 实现，说明它正在重新制造第二套桌面基础层。远程能力应扩展 Studio 现有
`cclink-remote` 功能域和统一 shared contract。

Studio 文档可以描述账号入口、远程客户端契约、降级和服务端授权边界；云函数部署、服务端
秘密和远程 Agent 包发布细节分别属于 `/Users/apple/Desktop/chat-cc/deploy` 与
`/Users/apple/Desktop/chat-cc/Agent`，不得复制进桌面事实源。
