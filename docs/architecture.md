# DeepInk 架构设计

## 设计哲学

**DeepInk — 下一代一站式 AI 桌面服务。**

不是 AI 工具，不是 AI 助手，是 AI 时代的工作入口。把文档编辑、即时通讯、浏览器自动化、AI Agent 全部融在一个产品里。

交互设计遵循 VSCode 精神（Activity Bar + Sidebar + 主工作区 + Panel），但不做代码编辑和 Git。Terminal 会作为工作空间 Tab 支持，用于本地/远程执行现场，不把 DeepInk 变成 IDE。

## 产品信息架构

DeepInk 的核心产品原则：

```text
DeepInk 以 Home 为入口，以工作空间组织工作，以标签页承载当前操作，以文件、草稿、会话和记忆沉淀结果。
```

DeepInk 是本地优先桌面工作台。用户不登录也应进入本地工作台并恢复工作现场；登录只解锁云同步、订阅、CCLink/TIM、跨设备和好友协作等云能力。详细身份设计见 `docs/features/local-first-identity.md`。

用户侧只使用清晰的产品概念：Home、工作空间、标签页、文件、草稿、会话、记忆。“项目”作为工作空间的旧称或口语同义词保留，不另造新概念。

工程命名短期保持现状：用户看到的“工作空间”在代码中继续由 `workspace` 表示。`workspacePath` 是当前本地工作空间路径，`WorkspaceState` 是工作空间状态快照。随着远程工作区接入，需逐步从单一 `workspacePath` 扩展为统一 `WorkspaceRef`，并把 `direct`、`cclink` 等连接通道放进 WorkspaceRef/Transport 层，避免到处散落 `if remote` 分支。

核心体验页面的职责边界见 `docs/features/product-experience-pages.md`；工作空间信息架构见 `docs/features/project-system.md`；Agent Panel 的项目会话、资源挂载和右侧会话列表模型见 `docs/features/agent-panel-product-model.md`。

### Home

Home 是 DeepInk 的总入口和默认界面，负责回答“从哪里继续”和“还有什么未处理”。

Home 展示：

- 最近工作空间、最近标签页、最近会话。
- 未归档草稿、未归档会话、Agent 等待确认和失败任务。
- 快速开始：新建 Markdown、打开网页、新建 AI 会话、打开文件夹作为工作空间。
- 个人资料与记忆入口。

### 工作空间

工作空间是 DeepInk 的核心工作容器。它不只等同本地文件夹，而是一个可承载文件、会话和 Tab 状态的工作归属。

工作空间来源包括：

- 本地工作空间：本机文件夹，复用当前 `workspacePath`。
- 远程工作空间：用户远端机器上的目录，可以通过直连 Remote 或 CCLink 接入，例如 `direct://endpointId/pathHash`、`cclink://serverId/workspaceId`。
- 未归档：没有明确工作空间归属的系统区域，用于临时草稿和全局会话。

Remote 是 DeepInk 的远程工作能力，CCLink 只是 Remote 的连接通道之一。直连 Remote、CCLink Remote 在工作空间列表中平级展示，只用 badge 区分来源，不新增“远程服务器”一级目录。

Codex、DeepInk Agent、Claude Code 和自定义后端属于执行后端，不属于工作空间类型。本地和远程工作空间都可以选择不同执行后端。

会话是统一产品对象：本地会话和远程会话都显示为工作空间里的 `会话`，区别只体现在运行位置、连接通道、执行后端和状态元信息上，不新增“远程 Agent 面板”作为一级入口。

每个工作空间拥有自己的：

- 文件树和文件浏览状态（本地或远程 provider）。
- Markdown 草稿和未保存文件。
- AI 会话和任务记录。
- 浏览器、Android、Terminal、预览等标签页状态。

现有“文件区”将升级为“工作空间区”：工作空间列表平铺展示本地工作空间和远程工作空间，用 badge 区分来源；激活某个工作空间后，在该工作空间下展开文件树和会话。未归档固定在侧栏底部，不作为普通工作空间管理。

### 本地身份与登录

DeepInk 运行时始终应有一个稳定的本地身份：

```text
LocalIdentity
├─ localId
├─ deviceId
├─ deviceName
├─ createdAt
└─ updatedAt
```

登录后再叠加云身份：

```text
EffectiveIdentity = LocalIdentity + optional CloudIdentity
```

本地身份负责：

- 本机工作台状态归属。
- 未登录状态下的 tabs、drafts、browser state、agent conversations 恢复。
- 登录/登出之间保持本地工作现场稳定。

云身份负责：

- 订阅与支付。
- CCLink/TIM identity、远程配对和实时连接。
- 云同步、云存储、跨设备。
- IM、好友协作和需要后端账号的能力。

认证系统不能作为主工作台入口守卫。主工作台应在本地身份 ready 后挂载；云能力入口单独判断 cloud session。

### 标签页

中间工作区展示当前工作空间的标签页集合。切换工作空间时，保存当前工作空间标签页快照，隐藏当前工作空间标签页，并恢复目标工作空间标签页。

工作空间标签页包括 Markdown、浏览器、Android、Terminal、预览、会话和草稿。Home、设置、账号、订阅等属于全局标签页，不随工作空间切换消失。Terminal 跟随工作空间归属：本地工作空间打开本机 shell，远程工作空间打开远端 shell，并接受权限确认、审计和生命周期管理。

### 系统工作空间

DeepInk 维护一个默认隐藏的系统工作空间，用来承接没有明确归属的内容和 App 自己的长期资料。

系统工作空间包含：

- `Memory`：用户可查看、编辑、删除的长期记忆。
- `Inbox`：未归档会话和 Agent 产物。
- `Drafts`：未归档 Markdown 草稿。
- `Temp`：临时下载、截图、附件和中间产物。
- `Global Sessions`：没有归属工作空间的全局会话。

系统工作空间不作为普通工作空间管理。Home 和工作空间区可以展示其中的未归档内容，但不能让用户误以为它是一个可随意删除或重命名的普通工作空间。工作空间区中“未归档”固定在底部，类似 Codex 的未归档会话区域。

> **状态标记约定**：本文档用三档标记区分实现成熟度，便于读者一眼看清现状。
>
> - `✅ 已实现` — 功能完整、生产可用
> - `🔧 技术验证中` — 全链路已打通，作为新功能仍在验证/打磨
> - `📋 未开始` — 仅有规划、零代码

## 整体架构

```
┌──────────────────────────────────────────────────────────────────┐
│                        DeepInk Desktop                           │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                     Electron 主进程                         │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │  │
│  │  │ 内嵌浏览器 │ │ 内嵌     │ │ Agent    │ │ 认证/订阅    │  │  │
│  │  │ Playwright│ │ Android  │ │ 可插拔   │ │ Token 管理   │  │  │
│  │  │ (Web 自动 │ │ 模拟器   │ │ 后端     │ │ 微信/手机支付│  │  │
│  │  │  化支柱)  │ │(移动支柱)│ │          │ │              │  │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │  │
│  │  │ MCP 工具  │ │ 文档编辑 │ │ 云同步   │ │ 文件系统     │  │  │
│  │  │ 权限管理  │ │ (Tiptap) │ │ (WebDAV) │ │ 微信格式转换 │  │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │  │
│  └────────────────────────┬───────────────────────────────────┘  │
│                           │ contextBridge (preload)              │
│  ┌────────────────────────┴───────────────────────────────────┐  │
│  │                     渲染进程 (React)                        │  │
│  │  ┌──┬────────┬──────────────────┬────────────────────┬─┐   │  │
│  │  │  │        │                  │  🤖 AI 对话        │  │   │  │
│  │  │A│ 侧栏    │    主工作区       │  💬 好友消息       │S │   │  │
│  │  │c│ 工作空间│  (编辑器/浏览器/  │  🤝 Agent 通知     │t │   │  │
│  │  │t│ 联系人  │   Android Tab)   │  📎 工作分享       │a │   │  │
│  │  │i│ 消息    │  (Tab 切换)      │                    │t │   │  │
│  │  │v│        │                  │                    │u │   │  │
│  │  │B│ ~250px │    flex: 1       │     ~350px         │s │   │  │
│  │  │a│        │                  │                    │B │   │  │
│  │  │r│        │                  │                    │a │   │  │
│  │  │ │        │                  │                    │r │   │  │
│  │  └──┴────────┴──────────────────┴────────────────────┴─┘   │  │
│  │  ┌───────────────────────────────────────────────────────┐  │  │
│  │  │                    Status Bar                          │  │  │
│  │  └───────────────────────────────────────────────────────┘  │  │
│  └─────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
                                       │
                    ┌──────────────────┼──────────────────┐
                    │                  │                  │
              ┌─────┴─────┐    ┌──────┴──────┐    ┌──────┴──────┐
              │ AI 后端    │    │ IM 云服务   │    │ 文件存储    │
              │ (可插拔)   │    │ (腾讯 TIM)  │    │ (云盘/自有) │
              │            │    │  📋未开始   │    │  📋未开始   │
              │ Claude Code│    │             │    │             │
              │ 国内模型API│    │             │    │             │
              │ BYOK 直连  │    │             │    │             │
              └───────────┘    └─────────────┘    └─────────────┘
```

DeepInk 的近期自动化主线收敛为**内嵌浏览器 + 远程工作空间**：浏览器解决网页账号、平台运营、资料提交和内容发布；远程工作空间解决服务器项目的文件、Terminal、Agent 执行和维护现场。Android 模拟器与云手机路线自 2026-07-14 起封存；后续 Android 只考虑用户自有真实手机的 USB / Wi-Fi 连接。

## Agent 面板双形态布局

Agent 面板不是固定的右侧聊天栏，而是根据工作台状态在两种角色间切换：

| 状态                                 | Agent 角色 | 默认布局                   |
| ------------------------------------ | ---------- | -------------------------- |
| 空工作台 / 无工作 Tab                | 工作入口   | 居中大面板                 |
| 浏览器 / 文档 / Android / 预览已打开 | 协作侧栏   | 右侧固定面板，压缩主工作区 |

### 默认状态：居中工作入口

当用户刚进入 DeepInk，或当前没有打开任何工作 Tab 时，Home 与 Agent 面板共同构成默认入口。Agent 面板居中显示，类似 Codex 的默认对话布局，负责承接“想做什么”的第一条指令。

适合入口动作：

- 写一份文档
- 打开并操作网页
- 提交本地材料到网站
- 总结当前文件夹
- 操控 Android App
- 继续上次任务

### 工作状态：右侧协作面板

当用户打开浏览器、Markdown 文档、Android、预览等工作内容后，Agent 面板自动切到右侧，主工作区被压缩而不是被浮层遮挡。

```
┌──────────────┬──────────────────────────┬────────────────────────────┐
│ Activity/侧栏 │ 主工作区                  │ Agent Panel                │
│              │ 浏览器/文档/Android/预览   │ 主对话区 │ 会话列表窄列      │
└──────────────┴──────────────────────────┴────────────────────────────┘
```

右侧 Agent Panel 内部仍分主次：

- 主对话区在左，承载已挂载资源横列、消息流、输入框和底部 Agent/模型/推理模式选择。
- 会话列表窄列在主对话区右边，只展示当前项目的激活会话。
- 会话列表底部提供“已关闭历史”展开入口，用于查看和恢复当前项目已关闭会话。
- 如果没有激活项目，会话归属默认项目 / 未归档。
- Agent 框架、模型、Skill、Provider 等长期配置不在 Agent Panel 内编辑，统一进入设置页。

### 布局状态模型

```typescript
type AgentPanelMode = 'center' | 'right' | 'hidden'
type AgentPanelModeSource = 'system' | 'user'
type WorkContext = 'empty' | 'browser' | 'editor' | 'android' | 'preview' | 'settings'

interface AgentLayoutState {
  mode: AgentPanelMode
  source: AgentPanelModeSource
  width: number
}
```

系统自动布局只在 `source === 'system'` 时生效：

| WorkContext                                  | 系统默认 mode |
| -------------------------------------------- | ------------- |
| `empty`                                      | `center`      |
| `browser` / `editor` / `android` / `preview` | `right`       |
| `settings`                                   | `right`       |

用户一旦拖拽宽度、隐藏面板、手动切换居中/右侧，`source` 变为 `user`，后续 Tab 切换不再自动介入。只有“重置布局”会把 `source` 恢复为 `system`。

### Agent 资源挂载策略

Agent 不再用含糊的“自动上下文绑定”作为主要产品概念，而是用用户可见的资源挂载模型：

- 会话自动归属当前激活项目；没有激活项目时归属默认项目 / 未归档。
- 会话顶端展示当前会话已挂载资源横列。
- 输入框 `/` 用于挂 Skill，例如 `/grill-me`。
- 输入框 `@` 用于挂资源，包括项目文件、草稿、打开的文档 Tab、浏览器 Tab、Android/设备 Tab、任务产物和后续云资源。
- `@` 默认优先搜索当前项目资源，其次搜索打开 Tab、最近资源和默认项目资源。

Agent 真实消费资源内容需要由后续上下文协议明确实现；UI 不应把“资源已显示”误表达为“模型已读取全文”。

## 进程模型

### 主进程 (Main Process)

职责与模块（实际代码结构）：

```
src/main/
├── index.ts              # 入口：装配 13 个子系统 + 优雅退出
├── browser/              # ✅ 内嵌浏览器管理
│   └── browser-manager.ts    # WebContentsView（多视图）+ 缩放 + 设备模式
├── cdp/                  # ✅ CDP 端口发现
│   └── cdp-port-discovery.ts # DevToolsActivePort 轮询
├── playwright/           # ✅ Playwright 集成
│   ├── playwright-bridge.ts  # CDP 连接到内嵌 Chromium
│   ├── playwright-actions.ts # 46 种操作执行器
│   └── verify-capabilities.ts # 能力验证
├── android/              # 🔧 内嵌 Android 模拟器（技术验证中）
│   ├── emulator-manager.ts   # 模拟器全生命周期（启动/停止/状态）
│   ├── avd-manager.ts        # AVD 创建与管理
│   ├── sdk-setup.ts          # 一键安装 SDK + 系统镜像
│   ├── sdk-repository.ts     # SDK 包仓库元数据
│   ├── adb-bridge.ts         # ADB 命令封装（对标 playwright-bridge）
│   ├── scrcpy-bridge.ts      # scrcpy 投屏（H.264 推流 + 触摸注入）
│   ├── android-actions.ts    # 15 种设备操作执行器
│   └── android-platform.ts   # 跨平台 SDK 路径（macOS/Win/Linux + arm64/x86_64）
├── agent/                # ✅ Agent 桥接
│   ├── agent-bridge.ts       # 协调层（委托给 IAgentBackend）
│   └── backend/              # 可插拔后端实现
│       ├── types.ts          # IAgentBackend 接口
│       ├── claude-code-backend.ts  # Claude Code CLI 子进程
│       ├── http-api-backend.ts     # HTTP API + SSE 流式（OpenAI 兼容）
│       └── backend-factory.ts      # 按 config.type 分发
├── mcp/                  # ✅ MCP 工具系统
│   ├── tool-host.ts          # 模块化 MCP 服务器 + HTTP 传输
│   ├── permission.ts         # 3 模式权限管理
│   ├── client-manager.ts     # 外部 MCP 服务器配置
│   ├── types.ts              # 工具模块接口定义
│   └── modules/
│       ├── browser/          # 46 个浏览器工具
│       ├── android/          # 15 个 Android 工具
│       └── editor/           # 5 个编辑器工具
├── auth/                 # ✅ 认证系统
│   ├── auth-service.ts       # 后端 HTTP API 客户端（腾讯云 CloudBase）
│   ├── auth-ipc.ts           # IPC 处理器
│   └── token-manager.ts      # 加密 Token 持久化（safeStorage/Keychain）
├── subscription/         # ✅ 订阅系统
│   ├── subscription-service.ts # 套餐 + 微信支付 + Apple IAP
│   ├── feature-gate.ts       # 功能门禁（Pro 专属）
│   └── subscription-ipc.ts
├── sync/                 # ✅ 云同步
│   ├── sync-service.ts       # WebDAV 同步引擎（双向/增量/冲突解决）
│   ├── webdav-client.ts      # WebDAV 客户端
│   ├── sync-credential-store.ts # 凭证加密存储
│   ├── sync-history.ts       # 同步历史
│   └── sync-ipc.ts
├── settings/             # ✅ 设置持久化
│   ├── settings-service.ts   # SettingsService + 热重载通知
│   └── settings-ipc.ts
├── fs/                   # ✅ 文件系统服务
│   ├── file-service.ts       # Home 目录浏览 + 读写
│   └── fs-ipc.ts
├── wechat/               # ✅ 微信公众号格式转换
│   └── convert.ts            # Markdown → 内联样式 HTML（markdown-it + juice）
└── ipc/                  # ✅ IPC 处理器
    ├── browser-ipc.ts / agent-ipc.ts / android-ipc.ts
    ├── editor-ipc.ts / wechat-ipc.ts / dialog-ipc.ts / window-ipc.ts
    └── （auth/fs/sync/settings/subscription 各自模块内带 *-ipc.ts）

📋 未开始（仅有规划、零代码）：
├── im/                   # 即时通讯（规划：TIM SDK 集成）
├── memory/               # 独立 AI 记忆系统（规划）
└── storage/              # 云文件存储扩展（规划，与 sync/ 的 WebDAV 不同）
```

### 渲染进程 (Renderer Process)

```
src/renderer/src/
├── App.tsx               # 认证守卫 + 主布局 + 命令注册
├── types/index.ts        # 全局类型定义
├── stores/               # Zustand 状态管理（共 19 个 store，见下表）
├── components/
│   ├── activity-bar/         # 左侧图标栏
│   ├── sidebar/              # 侧栏面板（工作空间区、文件树、搜索、同步）
│   ├── workbench/            # 主工作区
│   │   ├── Workbench.tsx         # 主工作区 Tab 容器
│   │   ├── MarkdownEditor.tsx    # ✅ Tiptap 编辑器
│   │   ├── EditorToolbar.tsx     # 编辑器工具栏
│   │   ├── AndroidDisplay.tsx    # 🔧 Android 投屏渲染（WebCodecs 解码）
│   │   ├── AndroidToolbar.tsx    # 🔧 Android 操控工具栏
│   │   └── wechat/WeChatPreview.tsx # ✅ 微信公众号预览
│   ├── agent-panel/          # AI 对话面板
│   ├── command-palette/      # ✅ Command Palette
│   ├── sidebar/SyncPanel.tsx # ✅ 云同步面板
│   ├── settings/SettingsPage.tsx # ✅ VSCode 风格设置页
│   ├── subscription/         # ✅ 订阅/定价/支付
│   ├── login/                # 登录页
│   ├── loading/              # 启动画面
│   ├── status-bar/           # 底部状态栏
│   └── common/               # 通用组件（Icons、ResizeHandle、ErrorBoundary、Toast）
└── constants/                # 常量
```

📋 未开始的组件目录：`im-panel/`、`editor/`（独立编辑器目录，当前编辑器实现在 `workbench/`）。

### Preload 脚本

通过 `contextBridge` 暴露白名单 API（`contextIsolation: true`、`nodeIntegration: false`）：

```typescript
// preload/src/index.ts — 当前已实现的 API
contextBridge.exposeInMainWorld('deepink', {
  browser: {
    /* 浏览器视图生命周期 + 缩放 + 设备模式 + URL 监听 */
  },
  agent: {
    /* AI 对话 + 流式事件 + 权限管理 + 外部 MCP Server */
  },
  android: {
    /* SDK 安装 + 模拟器生命周期 + ADB 操控 + scrcpy 投屏 */
  },
  editor: {
    /* Agent ↔ 编辑器双向通信（write/read/save）*/
  },
  fs: {
    /* 工作空间文件夹浏览 + 文件读写 */
  },
  sync: {
    /* WebDAV 配置 + 触发同步 + 历史 */
  },
  settings: {
    /* 设置读写 + 权限模式 */
  },
  subscription: {
    /* 套餐 + 下单 + 订单查询 + Apple IAP */
  },
  auth: {
    /* 手机验证码 + 会话检查 */
  },
  wechat: {
    /* Markdown → 微信公众号 HTML */
  },
  dialog: {
    /* 文件选择 / 保存对话框 */
  },
  window: {
    /* 全屏 / 开发者工具 */
  },
})
```

## 核心模块

### ✅ 已实现

#### 1. 内嵌浏览器（Web 自动化支柱）

DeepInk 的基础能力。在 Electron 窗口内嵌入完整 Chrome。

```
BrowserWindow (主窗口)
├── 渲染进程 React UI（侧栏、Agent 面板等）
└── WebContentsView (内嵌 Chrome，多视图，按 tabId 索引)
    ├── Electron 30+ 官方嵌入方案
    ├── 通过 CDP 端口暴露控制接口
    ├── 渲染在主窗口的主工作区区域
    └── ResizeObserver 实时上报坐标 → 主进程定位
```

**技术要点：**

1. **WebContentsView 多视图嵌入**：主进程管理多个视图实例，`setBounds()` 控制位置大小，一次只显示活跃视图
2. **CDP 连接**：`--remote-debugging-port=0`，轮询 `DevToolsActivePort` 发现端口
3. **Playwright 集成**：`chromium.connectOverCDP()` 连接内嵌 Chromium
4. **46 个 MCP 工具**：涵盖导航、点击填写、截图提取、文件上传/下载、Cookie、网络拦截/mock、iframe、多 Tab、坐标鼠标、对话框、控制台日志等（详见 `docs/features/browser-automation.md`）
5. **反指纹检测**：清理 UA 中的 `Electron/deepink`，屏蔽 `AutomationControlled` 特征，清除 `navigator.webdriver`
6. **智能缩放**：适应宽度模式（测量页面实际宽度自动计算 zoomFactor）+ 手动模式
7. **设备模式**：桌面/移动切换（iOS Safari UA + 414px viewport）

**核心产品场景**：本地 Markdown 文档（简历/审核材料）→ Agent 通过 `browser_navigate` + `browser_upload_file` + `browser_fill` + `browser_click` 自动提交到阿里云等审核网站或招聘系统。

#### 2. Agent 系统（可插拔 AI 后端）

AI Agent 驱动一切操作。后端可插拔。

```
渲染进程 (Agent 对话面板 UI)
        │ IPC
主进程 (AgentBridge — 协调层)
        │ 委托
┌───────┴────────┐
│  IAgentBackend  │ ← 可插拔接口（types.ts）
│  ┌────────────┐│
│  │Claude Code ││ ← ClaudeCodeBackend：CLI 子进程 + NDJSON 流式
│  └────────────┘│
│  ┌────────────┐│
│  │HTTP API    ││ ← HttpApiBackend：OpenAI 兼容 + SSE 流式
│  └────────────┘│
└────────────────┘
```

- **多提供商支持**：Anthropic / DeepSeek / 智谱 GLM / 通义千问 / Moonshot / 硅基流动 / OpenAI / 自定义
- **双 API 格式**：
  - Anthropic 格式 → Claude Code CLI + 环境变量注入（`ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY`）
  - OpenAI 格式 → HTTP POST + SSE 流式（`HttpApiBackend`）
- **设置热重载**：切换提供商/API 格式/密钥后通过 `backend-factory` 自动重建后端，无需重启
- **流式对话**：NDJSON 事件解析，支持 thinking/text/tool_use/tool_result
- **预算控制**：`--max-budget-usd`
- **外部 MCP 服务器**：用户可配置 stdio/http/sse 外部服务器，注入到 Claude Code 的 `--mcp-config`

#### 3. MCP 工具系统

模块化的工具注册，Agent 可调用浏览器、编辑器、Android 等能力。

```
McpToolHost (HTTP Server, 随机端口)
├── 注册工具 → McpServer → StreamableHTTPServerTransport
├── 工具调用 → 权限检查 → 模块路由 → 执行 → 返回结果
│
├── BrowserToolModule ✅ — 46 个浏览器工具
├── EditorToolModule   ✅ — 5 个编辑器工具（write/append/insert/read/save）
└── AndroidToolModule  🔧 — 15 个 Android 工具（tap/swipe/screenshot/dump_ui/install_apk/shell...）
```

所有工具模块实现统一的 `ToolModule` 接口，通过 `toolHost.registerModule()` 注入，加新工具域无需改 host。

**权限系统（3 模式）：**

- `auto`：自动批准所有操作
- `categorized`：自动批准只读操作，确认写入/破坏性操作
- `strict`：确认所有操作
- 支持"始终允许"特定工具
- 确认流程：IPC → 渲染进程卡片 → 用户操作 → IPC 返回 → Promise 解析
- 超时自动拒绝（工具调用 60s、编辑器操作 30s）

#### 4. 文档编辑器

AI 驱动的 Markdown 文档编辑，作为主工作区的 Tab，与浏览器 Tab 并列。

- **Tiptap (ProseMirror)** 富文本编辑，扩展集：StarterKit、Markdown、CodeBlockLowlight（highlight.js）、Image、TaskList/TaskItem、Table、Link、Placeholder
- **Agent ↔ 编辑器双向通信**：Agent 通过 5 个 MCP 工具读写编辑器内容，渲染进程实时渲染为富文本并回 ack 确认
- **微信公众号格式转换**：Markdown → 全内联样式 HTML（markdown-it + highlight.js + juice，Atom One Dark 主题），可直接粘贴到公众号编辑器
- **草稿体验规划**：未命名 Markdown 作为工作空间草稿存在；没有当前工作空间时进入隐藏系统工作空间的 `Drafts`，关闭时可选择保存为文件、保留草稿或丢弃
- 当前已实现 `.md` 编辑；DOCX/PDF/XLSX/PPTX 多格式预览为后续规划

详见 `docs/features/document-editor.md`。

#### 5. 认证系统

- **登录方式**：手机验证码（UniSMS）
- **Token 管理**：RS256 JWT（access + refresh token）、Electron safeStorage 加密（macOS Keychain）、自动刷新、安全登出（服务端撤销）
- **后端服务**：私有仓库（`private-serv`），桌面端通过显式配置的 `DEEPINK_API_URL` 访问
- 详见 `docs/features/` 相关文档

> 注：`cloud/`（CloudBase）和 `backend/`（SCF + MySQL）均已迁移至独立私有仓库维护。

#### 6. 订阅系统

- **套餐**：免费 + Pro（月卡/年卡）
- **支付渠道**：微信支付（Native 扫码）、Apple IAP
- **功能门禁**：`feature-gate.ts` 控制 Pro 专属功能
- 详见 `docs/features/subscription.md`

#### 7. 云同步

- **WebDAV 同步**：支持坚果云等 WebDAV 服务
- **双向增量同步**：本地 ↔ 远程，基于时间戳 + 文件哈希的冲突解决
- **凭证加密存储**：密码经 safeStorage 加密
- **自动同步**：定时 + 文件保存触发 + 启动拉取
- **选择性同步**：可指定一级子目录
- **同步历史**：记录每次同步的增删改
- 详见 `docs/features/cloud-sync.md`

### 🔧 技术验证中

#### 8. Android 真机连接（原模拟器方向已封存）

原“内嵌 Android 模拟器 / 云手机”方向已于 2026-07-14 调整为封存状态，不再作为近期产品支柱推进。现有代码保留为历史技术验证和未来真机能力的可复用材料。

```
Android 真机方向
├── 已封存：模拟器全生命周期（emulator-manager.ts / avd-manager.ts / sdk-setup.ts）
│   └── 不再默认安装 SDK、创建 AVD 或启动 QEMU 模拟器
│
├── 保留复用：ADB 桥接（adb-bridge.ts）
│   └── 基于 @yume-chan/adb 纯 TS 实现，Node net.Socket 桥接 ADB Server (5037)
│
├── 可复用：scrcpy 投屏（scrcpy-bridge.ts）
│   └── 目标设备改为用户主动连接的 USB / Wi-Fi 真机
│
└── 默认降级：Android MCP 工具
    └── 未检测到用户主动连接的真实设备时不可用
```

**与核心产品的关系**：Android 不再与浏览器并列作为近期支柱。浏览器和远程工作空间是当前可用闭环主线；Android 只作为未来真实设备连接能力保留。

详见 `docs/features/android-mirror.md`（历史投屏技术方案）与 `docs/features/cloud-phone.md`（已封存云手机调研）。

### 📋 未开始

以下模块仅有架构规划，**当前零代码**，保留方向供后续实现：

- **即时通讯（IM）** — 基于腾讯 TIM SDK。消息路由/存储/推送由腾讯托管；自定义消息类型承载 AI 工作成果与 Agent 通知；核心场景含用户聊天、给好友的 Agent 发任务、Agent 间协作。详见 `docs/features/im-system.md`。
- **独立 AI 记忆系统** — 长期记忆、对话历史持久化、跨会话上下文衔接、记忆权限（用户可查看/编辑/删除）。不依赖任何外部 AI 服务的记忆。
- **云文件存储扩展** — DeepInk 自有云盘（付费）+ 用户自有网盘接入（百度/阿里云盘适配器）+ 多设备同步。与当前 `sync/`（WebDAV）不同，是更深层的存储抽象。

### Agent 在环（Human-in-the-loop）

Agent 的所有操作都必须在用户的许可和监视下进行：

- 操作前需用户确认（权限系统 3 模式）
- 操作过程可视化（浏览器/Android 动作实时展示）
- 用户可随时中断（abort）

## 状态管理

渲染进程使用 **Zustand**。按业务域拆分 Store，组件通过 selector 精确订阅。

### Store 划分（共 19 个）

| Store                    | 职责                                    | 状态      |
| ------------------------ | --------------------------------------- | --------- |
| `ui-store`               | activePanel、面板可见性、面板宽度       | ✅        |
| `tab-store`              | 主工作区 Tab 列表、活跃 Tab、开/关/切换 | ✅        |
| `browser-store`          | 浏览器视图状态、缩放、设备模式          | ✅        |
| `agent-store`            | 消息列表、流式消息、权限确认、费用      | ✅        |
| `auth-store`             | 登录状态、用户信息、表单数据            | ✅        |
| `editor-store`           | 编辑器文档、脏标记、Agent 更新队列      | ✅        |
| `android-store`          | 模拟器状态、scrcpy 连接、设备 ID        | 🔧        |
| `fs-store`               | 工作区路径、文件树                      | ✅        |
| `sync-store`             | 同步配置、状态、历史                    | ✅        |
| `settings-store`         | 应用设置缓存                            | ✅        |
| `subscription-store`     | 套餐、订阅状态、订单                    | ✅        |
| `theme-store`            | 主题（深色/浅色）+ 持久化               | ✅        |
| `command-store`          | Command Palette 命令注册                | ✅        |
| `context-menu-store`     | 右键菜单状态                            | ✅        |
| `tab-context-menu-store` | Tab 右键菜单状态                        | ✅        |
| `im-store`               | IM 消息/联系人                          | 📋 未开始 |

### 设计原则

1. **按业务域拆分 Store**，而非单一巨型 Store
2. **组件通过 selector 精确订阅**，避免不相关重渲染
3. **Action 内聚在 Store 中**，组件不直接修改状态
4. **预留 Electron 特有需求**：Zustand 可在 React 外使用，支持 `persist` middleware 和 IPC 多窗口同步

## 数据存储

```
~/Library/Application Support/DeepInk/
├── config.json               # 应用配置（UI 偏好等，不含 API Key）
├── settings.json             # 用户设置（VSCode 风格设置页）
├── keybindings.json          # 自定义快捷键
├── auth/
│   ├── tokens.enc            # 加密的 access/refresh token（safeStorage）
│   └── user.json             # 用户基本信息缓存
├── agent/
│   ├── conversations/        # 对话历史（规划：独立记忆系统管理）
│   └── mcp-servers.json      # 外部 MCP 服务器配置
├── sync/
│   ├── credentials.enc       # 加密的 WebDAV 凭证
│   └── history.json          # 同步历史
├── android/                  # 🔧 Android SDK 与 AVD 数据
│   ├── sdk/                  # 自动下载的 SDK + 系统镜像
│   └── avd/                  # AVD 虚拟设备
├── memory/                   # 📋 AI 记忆系统数据（未开始）
└── cache/                    # 浏览器缓存等

macOS Keychain (DeepInk)      # 认证 Token + AI API Key（BYOK）+ WebDAV 密码
```

## 安全模型

1. **进程隔离** — 渲染进程无直接 Node.js 访问（`contextIsolation: true`、`nodeIntegration: false`）
2. **API 白名单** — Preload 只暴露必要的 IPC 方法
3. **CSP 策略** — 限制脚本加载来源
4. **用户确认** — Agent 的所有修改性操作需确认（3 模式权限系统），浏览器 `evaluate` 与 Android `shell`/`install_apk` 等破坏性工具走严格确认
5. **浏览器沙箱** — 内嵌浏览器独立运行，不共享主进程状态
6. **AI 后端可插拔** — 不绑定特定 AI 服务，支持国内模型（无数据出境）
7. **IM 走国内服务器** — 腾讯 TIM SDK，消息不出境（📋 未开始）
8. **Token/凭证加密存储** — Electron safeStorage + macOS Keychain
9. **AI 记忆用户可控** — 用户可查看、编辑、删除 AI 的所有记忆（📋 未开始）

## 性能考量

1. **懒加载** — 编辑器、IM 模块按需加载
2. **虚拟滚动** — 文件树、对话历史、IM 消息列表使用虚拟列表
3. **Worker 线程** — 文档解析放在 Worker 中
4. **缓存策略** — 文档解析结果缓存，避免重复解析
5. **增量更新** — 文件监听 + 增量同步
6. **IM 消息分页** — 历史消息按需加载，不全量拉取
7. **Android 投屏零拷贝** — WebCodecs 硬件解码 + WebGL 渲染，避免主进程参与视频流
