# CCLink Studio

**CCLink 的开源桌面工作台端：本地 Agent、内嵌浏览器、文档编辑、文件工作区和设备自动化外壳。**

[![GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS-lightgrey)](https://github.com/AwsomeName/cclink-studio)
[![Electron](https://img.shields.io/badge/Electron-^35.7-47848F)](https://www.electronjs.org/)

CCLink Studio 是 CCLink 的桌面工作台端。这个仓库只承载可以从源码直接运行的开源桌面壳：本地项目、文件、浏览器自动化、Markdown 编辑、Agent 面板、终端、数据源查询和设备连接能力。

官方账号、设备注册、配对、消息路由、TIM UserSig、订阅、配额、官方更新源、签名、公证和发布上传不在本仓库默认路径中。它们分别由 `cclink-dev` 官方构建工作区和 `/Users/apple/Desktop/chat-cc` 中的 CCLink deploy / Agent 侧实现承接。

## 能力边界

| 能力 | 开源壳状态 | 说明 |
| ---- | ---------- | ---- |
| 内嵌浏览器 + Playwright 自动化 | 保留 | Electron 内嵌 Chromium，Agent 可在用户监视下操作网页。 |
| Markdown 编辑器 | 保留 | Tiptap/ProseMirror，本地文件读写。 |
| 本地 Agent 面板 | 保留 | 面向本机 Claude Code / 用户自配 API 的桌面壳能力。 |
| 本地文件和项目工作区 | 保留 | 本地目录浏览、文件读写、workspace state 恢复。 |
| Terminal | 保留 | 本地 shell 和审计；远程执行链路已从开源壳默认路径移除。 |
| 数据源只读查询 | 保留 | 本地配置用户自有数据源，不内置官方云。 |
| Android 真机连接 | 保留本地能力 | 不再默认安装或启动官方托管模拟器/云手机。 |
| CCLink Account / Device / Message 网络 | 不在本仓库默认路径 | 由 `/Users/apple/Desktop/chat-cc/deploy` 和 `/Users/apple/Desktop/chat-cc/Agent` 承接。 |
| 订阅、配额、支付、官方发布 | 不在本仓库默认路径 | 由 `cclink-dev` overlay 和 CCLink 服务端承接。 |

## 快速开始

```bash
git clone https://github.com/AwsomeName/cclink-studio.git
cd cclink-studio
pnpm install
pnpm dev
```

### 系统要求

- macOS 13+
- Node.js 20+
- pnpm 9+

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
├── docs/                  # 开源壳架构、功能和迁移边界文档
├── scripts/               # 本地开发和本地打包脚本
├── src/
│   ├── main/              # Electron 主进程与本地服务
│   ├── preload/           # contextBridge 白名单 API
│   ├── renderer/          # React 工作台 UI
│   └── shared/            # 跨进程共享 contract
├── electron-builder.yml   # 开源本地打包配置，不包含官方发布源
└── package.json
```

## 私有/官方实现位置

当前不存在独立的 `cclink-cloud` 或 `cclink-agent` 项目；`private-serv` 是废弃旧项目。

- `cclink-dev`：闭源官方构建工作区，负责 release overlay、签名、公证、生产 API 注入、多仓库集成脚本。
- `/Users/apple/Desktop/chat-cc/deploy`：CCLink 云函数和账号体系。
- `/Users/apple/Desktop/chat-cc/Agent`：CCLink Agent runtime。

## 文档

- [CCLink Studio 边界与迁移复查](docs/cclink-studio-boundary-and-migration.md)
- [架构设计](docs/architecture.md)
- [开发指南](docs/development.md)
- [浏览器自动化](docs/features/browser-automation.md)
- [Agent 系统](docs/features/agent-system.md)
- [文档编辑器](docs/features/document-editor.md)
- [数据源](docs/features/data-sources.md)

部分历史规划文档仍保留旧 DeepInk 命名，用于追溯设计演进；它们不是当前开源壳边界的事实来源。以 `README.md`、`AGENTS.md` 和 `docs/cclink-studio-boundary-and-migration.md` 为准。

## 兼容命名

为避免破坏历史数据和插件调用，本阶段暂不机械替换以下运行时兼容名：

- `window.deepink`
- `appId: com.deepink.app`
- userData 目录 `DeepInk`
- `deepink-*` localStorage key
- 历史 workspace/tab snapshot 中的 `cclink` / `remote-file` 类型

这些会在后续兼容迁移阶段通过显式迁移方案处理。

## 许可证

CCLink Studio 开源桌面壳使用 [GPL v3](LICENSE) 许可证。
