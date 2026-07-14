# DeepInk

**An open-source AI-powered desktop workspace — embedded browser, document editor, and AI agent, all in one.**

[![GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS-lightgrey)](https://github.com/<org>/deepink)
[![Electron](https://img.shields.io/badge/Electron-^35.7-47848F)](https://www.electronjs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](CONTRIBUTING.md)

DeepInk 是面向 AI 时代的一站式桌面工作台。它将内嵌浏览器、文档编辑器、AI Agent 融为一体——让 AI 真正成为用户的"数字双手"：不仅会对话，还能看见网页、编辑文档、操控应用，并且一切都在用户的掌控之中。

---

## ✨ 特性一览

| 特性                              | 状态             | 说明                                              |
| --------------------------------- | ---------------- | ------------------------------------------------- |
| 🖥️ 内嵌浏览器 + Playwright 自动化 | ✅ OSS Core      | Electron 窗口内运行完整 Chrome，AI 可直接操控网页 |
| 📝 所见即所得文档编辑器           | ✅ OSS Core      | Tiptap/ProseMirror 富文本编辑，支持 Markdown      |
| 🤖 AI Agent 对话                  | ✅ OSS Core      | 可插拔后端（Claude Code CLI / HTTP API / BYOK）   |
| 📱 Android 设备操控               | 🔧 OSS Core      | ADB + scrcpy 投屏，AI 操控手机 App                |
| 📁 项目与文件管理                 | ✅ OSS Core      | 本地项目文件夹浏览、文件读写、项目状态恢复        |
| 🔄 WebDAV 云同步                  | ✅ OSS Core      | 支持坚果云等，用户选择自己的同步服务器            |
| 🎨 VSCode 风格布局                | ✅ OSS Core      | Activity Bar + Sidebar + Workbench + Panel        |
| 🔐 手机认证登录                   | ✅ Cloud Service | 短信验证码登录，需云服务后端                      |
| ⭐ Pro 订阅 / 支付                | ✅ Cloud Service | 微信支付 / Apple IAP，需云服务后端                |

> **开源核心（OSS Core）**：从源码完整可运行，无需任何云服务。云服务功能降级后应用仍正常使用。

---

## 🚀 快速开始

```bash
git clone https://github.com/<org>/deepink.git
cd deepink
pnpm install
pnpm dev
```

### 系统要求

- macOS 13+ (Ventura 及以上)
- Node.js 20+
- pnpm 9+

### BYOK — 自带 AI 后端

DeepInk **不提供** AI 服务。你需要自行配置 AI 后端：

**方式一：Claude Code（推荐）**

```bash
# 安装 Claude Code
npm install -g @anthropic-ai/claude-code

# 配置 API Key
claude config set apiKey sk-ant-xxxxx
```

**方式二：HTTP API（支持 OpenAI 兼容端点）**
在 DeepInk 设置页中配置：提供商、API Key、模型名称。支持 Anthropic、DeepSeek、智谱 GLM、通义千问、Moonshot、OpenAI 等。

> 所有 API Key 加密存储在 macOS Keychain 中。

---

## 🧭 产品定位

DeepInk 不是代码编辑器，不是聊天机器人，不是传统办公套件。

它是**一个全功能的 AI 工作入口**——把浏览器自动化、文档编辑、AI 对话、设备操控整合在一个遵循 VSCode 设计精神的桌面应用中。

产品组织方式：

- **Home**：总入口，展示继续工作、最近项目、未归档草稿和待确认任务。
- **项目区**：由现有文件区升级而来，管理项目列表、当前项目文件、草稿和会话。
- **标签页工作区**：当前项目内打开的浏览器、Markdown、Android、预览和会话。
- **Agent Panel**：当前项目的 AI 会话工作区；主对话区在左，会话列表窄列在右，`/` 挂 Skill，`@` 挂文件、Tab 和任务资源。
- **系统项目**：隐藏的默认项目，用于承接未归档内容、临时草稿和用户长期记忆。

```
┌──────────┬─────────────────────┬──────────────────────────┐
│          │                     │ Agent Panel              │
│  Activity│   主工作区            │ 主对话区 │ 会话列表窄列   │
│  Bar     │   (浏览器 / 编辑器    │ / Skill  │ 当前项目会话   │
│  + 侧栏  │    / Android / 设置)  │ @ 资源   │ 历史展开       │
│          │                     │ 模型选择 │                │
└──────────┴─────────────────────┴──────────────────────────┘
```

---

## 🔧 技术栈

| 层级           | 技术                                         |
| -------------- | -------------------------------------------- |
| 桌面框架       | Electron ^35.7                               |
| 前端           | React ^19 + TypeScript ^5.9（严格模式）      |
| 构建           | electron-vite ^5（Vite ^6）                  |
| 状态管理       | Zustand ^5（19 个 Store）                    |
| 浏览器自动化   | Playwright ^1.52（内嵌 CDP，46 个 MCP 工具） |
| Android 自动化 | @yume-chan/adb + scrcpy（15 个 MCP 工具）    |
| 文档编辑       | Tiptap / ProseMirror ^3（5 个 MCP 工具）     |
| MCP 工具系统   | @modelcontextprotocol/sdk ^1.29              |
| Schema         | Zod ^4                                       |
| 样式           | 纯 CSS（CSS 变量 + 暗色/亮色主题）           |

---

## 📖 文档

- [架构设计](docs/architecture.md)
- [开发指南](docs/development.md)
- [贡献指南](CONTRIBUTING.md)
- 功能规格：
  - [内嵌浏览器 & Playwright 自动化](docs/features/browser-automation.md)
  - [AI 工作浏览器路线](docs/features/ai-work-browser.md)
  - [Agent 对话系统](docs/features/agent-system.md)
  - [项目系统与 Home](docs/features/project-system.md)
  - [所见即所得编辑器](docs/features/document-editor.md)
  - [Android 设备操控](docs/features/android-mirror.md)
  - [云同步](docs/features/cloud-sync.md)

---

## 🤝 贡献

欢迎贡献！请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 了解开发流程和代码规范。

---

## 📄 许可证

**DeepInk 核心代码** © DeepInk Contributors，使用 [GPL v3](LICENSE) 许可证。

**云服务**（认证、订阅、支付）的后端实现在独立的私有仓库中维护。客户端 HTTP 调用代码已开源，并设计为优雅降级——云服务不可用时，核心功能不受影响。

---

> **告诉世人的方式不是大张旗鼓的宣传，而是创作出足够优秀的东西。**
> — Linus Torvalds
