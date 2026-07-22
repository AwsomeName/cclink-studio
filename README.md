# CCLink Studio

**CCLink 的开源桌面工作台端：本地 Agent、内嵌浏览器、文档编辑、文件工作区和设备自动化外壳。**

[![GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS-lightgrey)](https://github.com/AwsomeName/cclink-studio)
[![Electron](https://img.shields.io/badge/Electron-43.1-47848F)](https://www.electronjs.org/)

CCLink Studio 是 CCLink 的桌面工作台端。这个仓库承载可以从源码直接运行的桌面壳：本地项目、文件、浏览器自动化、Markdown 编辑、Agent 面板、终端、数据源查询和设备连接能力。

官方账号、设备注册、配对、消息路由、官方消息凭证、订阅、配额、官方更新源、签名、公证和发布上传由 `cclink-dev` 官方构建工作区和 `/Users/apple/Desktop/chat-cc` 中的 CCLink deploy / Agent 侧实现承接。

## 能力边界

| 能力                                   | 开源壳状态         | 说明                                                                                    |
| -------------------------------------- | ------------------ | --------------------------------------------------------------------------------------- |
| 内嵌浏览器 + Playwright 自动化         | 保留               | Electron 内嵌 Chromium，Agent 可在用户监视下操作网页。                                  |
| Markdown 编辑器                        | 保留               | Tiptap/ProseMirror，本地文件读写。                                                      |
| 本地 Agent 面板                        | 保留               | 面向本机 Claude Code / 用户自配 API 的桌面壳能力。                                      |
| 本地文件和项目工作区                   | 保留               | 本地目录浏览、文件读写、workspace state 恢复。                                          |
| 统一上下文操作                         | 保留               | 右键、键盘和命令入口复用同一命令事实源，按对象贡献操作并提供脱敏诊断。                  |
| Terminal                               | 保留               | 本地 shell 和审计；网络执行链路已从开源壳默认路径移除。                                 |
| 数据源只读查询                         | 保留               | 本地配置用户自有数据源，不内置官方云。                                                  |
| Android 真机连接                       | 保留本地能力       | 通过用户自有 USB 或 Wi-Fi ADB 真机运行。                                                |
| CCLink Account / Device / Message 网络 | 不在本仓库默认路径 | 由 `/Users/apple/Desktop/chat-cc/deploy` 和 `/Users/apple/Desktop/chat-cc/Agent` 承接。 |
| 订阅、配额、支付、官方发布             | 不在本仓库默认路径 | 由 `cclink-dev` 官方集成层和 CCLink 服务端承接。                                        |

## 快速开始

```bash
git clone https://github.com/AwsomeName/cclink-studio.git
cd cclink-studio
pnpm install
pnpm dev
```

也可以使用项目脚本独立启动/重启后台开发进程：

```bash
pnpm studio:start
pnpm studio:status
pnpm studio:logs
pnpm studio:stop
```

`pnpm studio:start` 是本地实测入口，会在缺少 `node_modules` 时先安装依赖，然后重启后台开发进程并输出状态。等价脚本入口是 `bash scripts/studio.sh start`。

本地打包入口：

```bash
pnpm studio:package
bash scripts/studio.sh package:arm64
bash scripts/studio.sh package:x64
```

开源壳本地打包只生成 `dist/` 下的 macOS 安装产物，不包含官方签名、公证、上传或生产 API 注入。

本仓库默认启动不依赖 `cclink-dev`、`chat-cc/deploy` 或 `chat-cc/Agent`。这些目录只参与官方账号、官方运行时和发布集成。

验证本地桌面壳是否可独立使用：

```bash
pnpm smoke:local
pnpm smoke:ui
pnpm smoke:workflow
pnpm smoke:restore
pnpm smoke:standalone
```

冒烟检查会启动 Electron、连接真实 renderer，并验证无登录状态下的本地身份、设置、文件系统、浏览器、Agent 状态、Terminal、Android 降级路径、统一上下文操作、本地工作区、Markdown 保存、Terminal cwd 闭环，以及 `lastWorkspacePath` 启动自动恢复。`pnpm smoke:standalone` 会串联全部本地桌面壳冒烟。

### 系统要求

- macOS 13+
- Node.js 20+
- pnpm 9+

### Android

Android 能力只面向用户自有 USB 或 Wi-Fi ADB 真机。CCLink Studio 不下载 Android SDK、不创建 AVD、不启动模拟器，也不依赖托管设备服务。

本地没有 `adb` 时，应用仍应正常启动；设备能力会降级为不可用，并提示连接本机已有 Android SDK/adb 或设置 `ANDROID_HOME` / `ANDROID_SDK_ROOT`。

### Agent

CCLink Studio 不提供模型服务。开源壳可以连接用户本机或用户自有的 Agent 后端；当前主线优先支持本机 Claude Code：

```bash
npm install -g @anthropic-ai/claude-code
claude login
```

在 `设置 > Agent` 中可以配置 `claude` 路径、模型提供商、API 地址和 API Key。密钥只保存于本机设置。

## 项目结构

```text
cclink-studio/
├── docs/                  # 当前架构、开发和功能文档
├── scripts/               # 本地开发和本地打包脚本
├── src/
│   ├── main/              # Electron 主进程与本地服务
│   ├── preload/           # contextBridge 白名单 API
│   ├── renderer/          # React 工作台 UI
│   └── shared/            # 跨进程共享 contract
├── electron-builder.yml   # 开源本地打包配置，不包含官方发布源
└── package.json
```

## 官方实现位置

当前不存在额外拆分出的云端或 Agent 独立项目。

- `cclink-dev`：闭源官方构建工作区，负责发布集成、签名、公证、生产 API 注入、多仓库集成脚本。
- `/Users/apple/Desktop/chat-cc/deploy`：CCLink 云函数和账号体系。
- `/Users/apple/Desktop/chat-cc/Agent`：CCLink Agent runtime。

## 文档

- [架构设计与架构宪法](docs/architecture.md)
- [当前稳定化阶段](docs/stabilization.md)
- [开发指南](docs/development.md)
- [本地冒烟检查](docs/ops/local-smoke-check.md)
- [浏览器自动化](docs/features/browser-automation.md)
- [Agent 系统](docs/features/agent-system.md)
- [文档编辑器](docs/features/document-editor.md)
- [统一上下文操作系统](docs/features/context-action-system.md)
- [数据源](docs/features/data-sources.md)
- [Android agent-device](docs/features/agent-device.md)

## 许可证

CCLink Studio 开源桌面壳使用 [GPL v3](LICENSE) 许可证。
