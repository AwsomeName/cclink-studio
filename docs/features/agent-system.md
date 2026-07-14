# Agent 对话系统

## 概述

DeepInk 的 Agent 是一个基于 AI 的智能助手，能够理解自然语言指令并调用工具完成复杂任务。Agent 不是简单的聊天机器人，而是能够操作浏览器、编辑文档、搜索网络的"数字助手"。

> **DeepInk 不提供 AI 模型服务，不代理任何 API 调用。**

### Agent 后端：本地 Claude Code

Agent 由本地 Claude Code 驱动。Claude Code 自身有完整的 AI 服务配置能力（模型选择、API Key、自定义端点等），DeepInk 不需要自建 AI 调用层。

```
┌──────────┐    IPC    ┌────────────┐   stdin/stdout   ┌──────────────┐
│ 渲染进程  │ ←──────→ │  主进程     │ ←──────────────→ │ Claude Code   │
│ (React)  │          │ AgentBridge│                  │ CLI 子进程     │
└──────────┘          └────────────┘                  └──────────────┘
                                                        │
                                                        │ AI 配置
                                                        ↓
                                                   用户自行配置:
                                                   ~/.claude/config.json
                                                   (模型、Key、端点)
```

**AI 服务配置层级：**

```
DeepInk 设置页（VSCode 风格，在主工作区 Tab 中打开）
│
├── Agent 模式
│   ├── Claude Code 模式（默认）
│   │   └── AI 配置由 Claude Code 管理
│   │        ├── 模型选择 (claude config set model)
│   │        ├── API Key (claude config set apiKey)
│   │        └── 自定义端点 (OpenAI 兼容)
│   │        DeepInk 设置页暴露 UI 入口，底层写入 Claude Code 配置
│   │
│   └── 直连 API 模式（可选）
│        └── DeepInk 直接调用 AI 服务商 API
│             ├── Anthropic (Claude)
│             ├── OpenAI (GPT)
│             └── OpenAI 兼容端点 (Ollama, DeepSeek, vLLM...)
│             Key 存 macOS Keychain
│
└── 模型选择
```

**BYOK — 用户自带 Key：**

无论哪种模式，DeepInk 都不提供 AI 服务：

- **Claude Code 模式**：用户在自己终端执行 `claude config set apiKey` 或在 DeepInk 设置页中配置（底层调用 Claude Code 的配置命令）
- **直连 API 模式**：用户在 DeepInk 设置页中填写 Key，存 macOS Keychain

### 当前开发阶段

> ⚠️ **当前阶段**：先做对话面板 UI 页面（Mock 数据驱动）和设置页 UI，Agent 后端对接后续进行。

## 设计原则

1. **Human-in-the-loop** — 所有修改性操作必须经过用户确认
2. **透明可观测** — 用户能看到 Agent 的每一步推理和操作
3. **可中断** — 用户随时可以暂停或取消 Agent 操作
4. **上下文感知** — Agent 知道用户当前打开的文件、浏览的页面

## Agent Panel 产品模型

Agent Panel 的详细产品模型见 `docs/features/agent-panel-product-model.md`。这里记录 Agent 系统必须遵守的核心规则：

- 有激活项目时，新会话自动归属当前项目。
- 无激活项目时，新会话归属默认项目 / 未归档。
- 右侧 Agent Panel 内部采用“主对话区 + 会话列表窄列”布局，**会话列表窄列在主对话区右边**。
- 会话列表窄列只展示当前项目的激活会话。
- 会话列表底部提供已关闭历史展开入口。
- 会话顶端用一行横列展示当前会话已挂载资源。
- 输入框 `/` 挂 Skill。
- 输入框 `@` 挂资源，包括项目文件、打开的文档 Tab、浏览器 Tab、Android/设备 Tab、任务产物等。
- 输入区底部选择 Agent 框架、模型和推理模式。
- Skill、模型、Provider、API Key、默认模式等长期配置只放设置页。

Agent Panel 负责当前项目会话的使用体验，不负责全局历史管理和复杂配置。

## 系统架构

### 整体流程

```
┌─────────────────────────────────────────────────────────┐
│                    Agent 对话面板                         │
│                                                         │
│  用户: "帮我搜一下字节跳动的前端岗位并投递简历"           │
│                                                         │
│  🤖 Agent:                                              │
│  ┌─────────────────────────────────────────────┐        │
│  │ 我来帮你完成以下步骤:                          │        │
│  │ 1. 搜索字节跳动前端岗位                       │        │
│  │ 2. 分析匹配的 JD                             │        │
│  │ 3. 优化你的简历                              │        │
│  │ 4. 在招聘网站投递                             │        │
│  │                                              │        │
│  │ 现在开始第 1 步...                            │        │
│  └─────────────────────────────────────────────┘        │
│                                                         │
│  🔧 工具调用: browser_navigate("https://www.zhipin.com")│
│  ┌──────────────────────────────────┐                   │
│  │ 📸 [截图预览]                     │  [✅ 确认] [❌ 拒绝]│
│  └──────────────────────────────────┘                   │
│                                                         │
│  ⏸️ 暂停  ⏹️ 停止                                        │
└─────────────────────────────────────────────────────────┘
```

### 组件结构

```typescript
// Agent 系统由以下模块组成

// 1. 对话管理器 — 管理对话历史和上下文
class ConversationManager {
  conversations: Map<string, Conversation>
  createConversation(): Conversation
  addMessage(convId: string, message: Message): void
  getHistory(convId: string): Message[]
}

// 2. 工具注册器 — 注册 Agent 可调用的工具
class ToolRegistry {
  private tools: Map<string, ToolDefinition>

  register(tool: ToolDefinition): void
  execute(toolName: string, params: any): Promise<ToolResult>
  listTools(): ToolDefinition[]
}

// 3. 确认管理器 — 管理需要用户确认的操作
class ConfirmationManager {
  private pending: Map<string, PendingAction>

  requestConfirmation(action: Action): Promise<boolean>
  approve(actionId: string): void
  reject(actionId: string): void
}

// 4. Agent 编排器 — 协调以上模块
class AgentOrchestrator {
  constructor(
    private conversation: ConversationManager,
    private tools: ToolRegistry,
    private confirmation: ConfirmationManager,
  ) {}

  async processMessage(userMessage: string): AsyncGenerator<AgentEvent>
}
```

## 工具定义

### 浏览器工具组

```typescript
const browserTools = {
  browser_navigate: {
    description: '导航到指定 URL',
    parameters: { url: { type: 'string', description: '目标 URL' } },
    requiresConfirmation: false, // 只读不修改
    mode: 'async',
  },
  browser_click: {
    description: '点击页面元素',
    parameters: { selector: { type: 'string', description: 'CSS 选择器' } },
    requiresConfirmation: true, // 可能触发表单提交
  },
  browser_fill: {
    description: '填写表单字段',
    parameters: {
      selector: { type: 'string' },
      value: { type: 'string' },
    },
    requiresConfirmation: true, // 写入操作
  },
  browser_screenshot: {
    description: '截取当前页面截图',
    parameters: {},
    requiresConfirmation: false, // 只读
  },
  browser_extract: {
    description: '提取页面文本内容',
    parameters: {
      selector: { type: 'string', description: '可选，提取特定元素' },
    },
    requiresConfirmation: false,
  },
  browser_select: {
    description: '选择下拉框选项',
    parameters: {
      selector: { type: 'string' },
      value: { type: 'string' },
    },
    requiresConfirmation: true,
  },
  browser_wait: {
    description: '等待元素出现',
    parameters: {
      selector: { type: 'string' },
      timeout: { type: 'number', default: 5000 },
    },
    requiresConfirmation: false,
  },
  browser_scroll: {
    description: '滚动页面',
    parameters: {
      direction: { type: 'enum', values: ['up', 'down'] },
      amount: { type: 'number' },
    },
    requiresConfirmation: false,
  },
}
```

### 编辑器工具组

```typescript
const editorTools = {
  editor_write: {
    description: '将 Markdown 写入编辑器（替换全部内容），无 Tab 时自动创建',
    parameters: {
      content: { type: 'string' },
      filePath: { type: 'string' },
      title: { type: 'string' },
    },
    requiresConfirmation: false,
  },
  editor_append: {
    description: '在文档末尾追加 Markdown',
    parameters: { content: { type: 'string' }, filePath: { type: 'string' } },
    requiresConfirmation: false,
  },
  editor_insert: {
    description: '在指定位置（start/end）插入 Markdown',
    parameters: { content: { type: 'string' }, position: { type: 'string' } },
    requiresConfirmation: false,
  },
  editor_read: {
    description: '读取当前编辑器的 Markdown 内容',
    parameters: { filePath: { type: 'string' } },
    requiresConfirmation: false,
  },
  editor_save: {
    description: '保存当前编辑器内容到磁盘（需已关联文件路径）',
    parameters: { filePath: { type: 'string' } },
    requiresConfirmation: false,
  },
}
```

### 搜索工具组

```typescript
const searchTools = {
  search_web: {
    description: '搜索互联网',
    parameters: {
      query: { type: 'string' },
      maxResults: { type: 'number', default: 5 },
    },
    requiresConfirmation: false,
  },
  search_read_page: {
    description: '读取网页内容',
    parameters: {
      url: { type: 'string' },
    },
    requiresConfirmation: false,
  },
}
```

### 文件工具组

```typescript
const fileTools = {
  file_read: {
    description: '读取文件内容',
    parameters: { path: { type: 'string' } },
    requiresConfirmation: false,
  },
  file_write: {
    description: '写入文件',
    parameters: {
      path: { type: 'string' },
      content: { type: 'string' },
    },
    requiresConfirmation: true,
  },
  file_list: {
    description: '列出目录内容',
    parameters: { path: { type: 'string' } },
    requiresConfirmation: false,
  },
}
```

## 确认机制

### 操作分类

| 类别       | 示例                 | 需要确认               |
| ---------- | -------------------- | ---------------------- |
| 只读       | 截图、读取内容、搜索 | ❌ 自动执行            |
| 轻微修改   | 滚动、导航           | ❌ 自动执行            |
| 内容修改   | 填写表单、编辑文档   | ✅ 需要确认            |
| 不可逆操作 | 提交表单、删除文件   | ✅ 需要确认 + 二次确认 |

### 确认 UI

操作请求以卡片形式展示在对话中：

```
┌──────────────────────────────────────┐
│ 🔧 Agent 请求执行操作                 │
│                                      │
│ 操作: 填写表单                        │
│ 目标: #resume-upload input[type=file] │
│ 内容: /Users/xxx/简历.docx            │
│                                      │
│ 📸 [操作预览截图]                      │
│                                      │
│       [✅ 允许]  [❌ 拒绝]  [✏️ 修改]  │
└──────────────────────────────────────┘
```

### 批量确认

当 Agent 连续执行多个相关操作时，可以打包请求确认：

```
┌──────────────────────────────────────┐
│ 🔧 Agent 请求执行 3 个操作            │
│                                      │
│ 1. 导航到 boss.zhipin.com            │
│ 2. 填写登录邮箱 xxx@gmail.com        │
│ 3. 填写密码 *******                   │
│                                      │
│  [✅ 全部允许]  [逐个确认]  [❌ 全部拒绝]│
└──────────────────────────────────────┘
```

## 上下文管理

### Agent 感知的环境信息

Agent 在每次对话时自动获得以下上下文：

```typescript
interface AgentContext {
  // 当前打开的文件
  activeFile: {
    path: string
    name: string
    type: 'markdown' | 'docx' | 'xlsx' | 'pptx' | 'text'
    content: string // 当前编辑器内容
    selection: string | null // 当前选中的文本
  } | null

  // 当前浏览器状态
  browser: {
    url: string | null
    title: string | null
    screenshot: string | null // base64 截图
  }

  // 当前工作区
  workspace: {
    rootPath: string
    recentFiles: string[]
  }

  // 对话历史摘要
  conversationSummary: string
}
```

## AI 模型调用

### 主方案：Claude Code 集成

Agent 默认由本地 Claude Code 驱动。Claude Code 自身有完整的 AI 配置能力：

```typescript
// 主进程启动 Claude Code 子进程
const claudeProcess = spawn('claude', ['--output-format', 'stream-json'], {
  stdio: ['pipe', 'pipe', 'pipe'],
})

// AI 服务配置由 Claude Code 管理
// 用户可在终端运行:
//   claude config set model claude-sonnet-4-6
//   claude config set apiKey <key>
// 或在 DeepInk 设置页中配置（底层调用 Claude Code 的配置）
```

**Claude Code 的 AI 配置能力**：

- 模型选择（Sonnet / Opus / Haiku，或 OpenAI 兼容模型）
- API Key 管理
- 自定义 API 端点（支持 Ollama、vLLM、DeepSeek 等）
- DeepInk 设置页暴露这些配置的 UI 入口，底层通过 `claude config` 命令写入

### 可选方案：直连 AI API（BYOK）

用户也可选择绕过 Claude Code，由 DeepInk 直连 AI 服务商：

```typescript
// packages/main/src/agent/provider-registry.ts

export const BUILTIN_PROVIDERS = [
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    type: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    models: ['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-4-5'],
  },
  {
    id: 'openai',
    name: 'OpenAI (GPT)',
    type: 'openai',
    baseUrl: 'https://api.openai.com',
    models: ['gpt-4.1', 'o3'],
  },
  {
    id: 'custom',
    name: '自定义端点 (OpenAI 兼容)',
    type: 'openai-compatible',
    // Ollama, vLLM, DeepSeek, 通义千问, 智谱, Moonshot 等
  },
]
```

此模式下的 Key 存 macOS Keychain：

```typescript
// 仅直连模式使用
await keytar.setPassword('DeepInk', 'provider:anthropic', apiKey)
```

### AgentBridge — 统一接口

```typescript
export interface IAgentBackend {
  start(): Promise<void>
  sendMessage(message: string): Promise<void>
  stop(): Promise<void>
  onEvent(callback: (event: AgentEvent) => void): void
}

// 主方案: Claude Code（AI 配置由 Claude Code 管理）
export class ClaudeCodeBackend implements IAgentBackend { ... }

// 可选方案: 直连 API（AI 配置由 DeepInk 管理，BYOK）
export class DirectAPIBackend implements IAgentBackend { ... }
```

### System Prompt

```
你是 DeepInk 的 AI 助手，运行在用户的 Mac 桌面上。

你可以通过以下工具帮助用户：
- 浏览器操作：导航网页、填写表单、提取内容
- 文档编辑：修改当前打开的文档
- 文件操作：读写工作区文件
- 网络搜索：搜索信息

重要原则：
1. 所有修改操作都需要用户确认
2. 描述你要做的操作，让用户理解
3. 如果不确定，先询问用户
4. 操作过程中提供实时反馈

当前环境信息：
{context}
```

### 模型选择

- **Claude Code 模式**：用户通过 `claude config` 或 DeepInk 设置页配置模型
- **直连 API 模式**：用户在设置页选择服务商 + 具体模型
- 流式输出：所有模式均支持

## 对话管理

### 对话持久化

```typescript
interface Conversation {
  id: string
  title: string // 自动生成
  messages: Message[]
  createdAt: number
  updatedAt: number
  context: {
    workspacePath: string
    activeFiles: string[]
  }
}

interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
  timestamp: number
}
```

### 对话历史

- 自动保存所有对话
- 支持搜索历史对话
- 支持从历史对话恢复上下文
- 对话摘要（长对话自动压缩）

## 功能清单

### P0 — 对话 UI + 设置页面（当前阶段）

> 先做页面，不对接后端。UI 用 Mock 数据驱动。

- [ ] 对话面板布局（消息列表 + 底部输入框）
- [ ] 消息气泡渲染（用户 / Agent / 系统）
- [ ] 流式文本展示（打字机效果）
- [ ] 工具调用卡片 UI（展示操作描述 + 确认/拒绝按钮）
- [ ] 操作状态指示器（进行中 / 已确认 / 已拒绝）
- [ ] 暂停 / 停止按钮
- [ ] 截图预览（在工具调用卡片中展示）
- [ ] **VSCode 风格设置页（在主工作区 Tab 中打开，不是弹窗）**
  - [ ] 顶部搜索框，实时过滤设置项
  - [ ] 设置项按分组展示（常用、外观、Agent、浏览器、快捷键等）
  - [ ] 右上角 GUI / JSON 编辑模式切换
  - [ ] Agent 分组：
    - [ ] Agent 模式切换（Claude Code / 直连 API）
    - [ ] Claude Code 配置区域：模型选择、API Key、端点（底层写 Claude Code 配置）
    - [ ] 直连 API 配置区域：服务商选择、API Key（存 Keychain）、模型选择
    - [ ] 连接测试按钮
  - [ ] 外观分组：主题（深色/浅色）、字体大小等
  - [ ] 浏览器分组：默认搜索引擎、代理、下载目录等

### P1 — 对接 Claude Code 后端

- [ ] AgentBridge：管理 Claude Code 子进程
- [ ] stdin/stdout JSON 消息协议
- [ ] Claude Code 事件流 → UI 渲染
- [ ] 用户确认 → 工具执行 → 结果回传
- [ ] 浏览器工具桥接（browser\_\* → Playwright → BrowserView）
- [ ] 编辑器工具桥接（editor\_\* → Tiptap）
- [ ] 上下文注入（当前文件、浏览器状态）

### P2 — 增强

- [ ] 对话历史管理
- [ ] 批量确认
- [ ] 操作回滚
- [ ] 搜索工具集成
- [ ] 上下文摘要（长对话压缩）
- [ ] 对话模板（预设常用任务流程）

### P3 — 高级

- [ ] 多 Agent 协作（不同专长的 Agent）
- [ ] Agent 记忆（跨对话记住用户偏好）
- [ ] 操作录制与回放
- [ ] 自定义工具插件
- [ ] Agent 市场（分享 Agent 配置）
- [ ] 演进为直接 Claude API 调用（可选）
