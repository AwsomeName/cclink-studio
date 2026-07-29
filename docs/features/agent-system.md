# Agent 对话系统

> 当前事实源。最后更新：2026-07-29。

## 概述

CCLink Studio 的 Agent 是本地工作台里的 AI 协作入口，能够理解自然语言指令并调用工具完成复杂任务。Agent 不是简单的聊天机器人，而是能够操作浏览器、编辑文档、搜索网络的本地工作助手。

> **CCLink Studio OSS 默认不提供 AI 模型服务，不代理任何官方 API 调用。**

### Agent 后端：本地 Claude Code

Agent 由本地 Claude Code 驱动。运行时来源与模型服务凭证是两件事：

- 本机/自定义 Claude Code 可以使用其自身认证。
- Studio 的内置 Runtime 使用用户在 Studio 中配置的 Provider API Key。
- Studio 不提供 CCLink 模型服务，不代理 Claude.ai Free/Pro/Max 登录材料。

```
┌──────────┐    IPC    ┌────────────┐   stdin/stdout   ┌──────────────┐
│ 渲染进程  │ ←──────→ │  主进程     │ ←──────────────→ │ Claude Code   │
│ (React)  │          │ AgentBridge│                  │ CLI 子进程     │
└──────────┘          └────────────┘                  └──────────────┘
                                                        │
                                                        │ AI 配置
                                                        ↓
                                                   本机 Claude 自身认证
                                                   或 Studio 本地凭证
```

**M9 当前配置层级：**

```
CCLink Studio 设置页（VSCode 风格，在主工作区 Tab 中打开）
│
├── Agent 引擎：Local Claude Code
├── Runtime 来源：内置 / 本机 / 自定义路径
├── Provider：格式 / API 地址 / 模型 / 本地凭证引用
├── 权限模式：auto / categorized / strict
└── 费用策略：只统计，不设置预算或阻止调用
```

CCLink Studio 可以保存用户主动配置的模型 API Key，并只在主进程创建 Agent backend 时使用。当前存储是 ADR 0003 定义的本地明文凭证文件，由统一 `CredentialService` 管理。

本机/自定义 Claude Code 仍可以使用自身认证：

```bash
claude login
# 或按 Claude Code 自身文档配置模型、Key、端点
```

### 当前开发阶段

> **当前阶段**：本仓库已经具备 Agent 内核、Claude Code 后端、Runtime
> 选择与探测、设置页、会话持久化、流式事件、工具桥接、权限确认、诊断和图片输入。
> HTTP API / OpenAI 兼容直连暂不作为完整工具 Agent。

## 设计原则

1. **Human-in-the-loop** — 所有修改性操作必须经过用户确认
2. **透明可观测** — 用户能看到 Agent 的每一步推理和操作
3. **可中断** — 用户随时可以暂停或取消 Agent 操作
4. **上下文感知** — Agent 知道用户当前打开的文件、浏览的页面

费用不是权限。Agent 模型和第三方图片生成的用量由主进程统一记录，但费用、credits
或估算金额不得参与权限判断、预算限制或调用拦截。

### 诊断与排障

真实浏览器任务必须支持一键复制诊断日志。用户遇到“Agent 一直在想”“网页登录失败”“投稿没有填进去”时，应能从右侧 Agent 面板复制当前会话诊断包，直接粘贴给开发者或 Agent 分析。

诊断包设计见 `docs/features/agent-diagnostic-log.md`。第一版重点是当前会话、当前浏览器 tab、浏览器任务日志、工具调用时间线、页面错误摘要和默认脱敏，不做云端日志上传。

## Agent 会话产品模型

这里记录 Agent 系统必须遵守的核心规则：

- 用户只理解 Thread / 会话，不理解 `assistant-panel`、`workbench-tab` 这类工程 surface。
- 有激活工作空间时，新 Thread 自动归属当前工作空间。
- 无激活工作空间时，新 Thread 归属未归档。
- 右侧 Agent Panel 是当前工作流控制台，结构为 Quick Switcher / Messages / Composer。
- Quick Switcher 负责当前 + 运行中 + 最近 Thread 的快速切换和新建，单列表混排，默认最多 5 条，可展开。
- Messages 使用高密度 turn 视图，工具调用默认折叠，raw MCP 名称和 JSON 参数只在展开详情中显示。
- Composer 区域展示已挂载资源，并承载输入框、`@资源`、`/技能` 和发送。
- 左侧 Activity Bar 的“会话”视图是 Thread Center，负责完整历史、搜索、过滤、归档和工作空间级管理。
- Workbench 只打开同一个 Thread 的深度工作视图，关闭 Tab 不删除 Thread。
- Skill、模型、Provider、API Key、默认模式等长期配置只放设置页。

详细产品模型和推进里程碑见 `docs/features/agent-panel-product-model.md`。

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

### 当前方案：Claude Code Runtime 与 Provider 分离

Agent 由本地 Claude Code 驱动。Studio 不代理模型服务，但可以保存用户配置的 Provider API Key，并在创建子进程时注入：

```typescript
// 主进程启动 Claude Code 子进程
const claudeProcess = spawn(claudeCodePath || 'claude', ['-p', '--output-format', 'stream-json'], {
  stdio: ['pipe', 'pipe', 'pipe'],
})

// 本机/自定义 Runtime 也可以继续使用 Claude Code 自身认证。
// Studio 管理的 Key 只由主进程从统一 CredentialService 解析，
// 不进入命令参数、会话快照、日志或诊断。
```

CCLink Studio 设置页负责：

- 选择内置、本机或自定义 Runtime。
- 配置 Provider 格式、API 地址、模型和本地凭证。
- 配置权限模式。
- 查看模型费用统计；费用数据不参与调用限制。

### 后续方案：HTTP Chat / HTTP Tool Agent

OpenAI 兼容 HTTP API 后续可以作为独立能力接入，但不能和当前完整工具 Agent 混为一谈：

- `HTTP Chat`：纯对话、写文案、总结，不承诺浏览器/编辑器工具调用。
- `HTTP Tool Agent`：未来需要完整 tool calling / MCP loop，再作为新后端接入。

### AgentBridge — 统一接口

```typescript
export interface IAgentBackend {
  start(): Promise<void>
  sendMessage(message: string): Promise<void>
  stop(): Promise<void>
  onEvent(callback: (event: AgentEvent) => void): void
}

export class LocalClaudeCodeBackend implements IAgentBackend { ... }
```

### System Prompt

```
你是 CCLink Studio 的 AI 助手，运行在用户的 Mac 桌面上。

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

- **Claude Code 模式**：用户通过 `claude config` 或 CCLink Studio 设置页配置模型
- **直连 API 模式**：未来独立后端，不得把普通 HTTP Chat 伪装成当前完整工具 Agent
- 流式输出：当前 Claude Code 后端支持

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

## 当前能力矩阵

| 能力                                  | 状态   | 边界                                            |
| ------------------------------------- | ------ | ----------------------------------------------- |
| Agent Panel、消息和流式事件           | 已实现 | 同一 Thread 可在右侧和 Workbench 展示           |
| Claude Code backend                   | 已实现 | 当前完整工具 Agent 的唯一主线 backend           |
| Runtime 来源                          | 已实现 | `system` / `custom` / `bundled`，默认 `system`  |
| Provider 与 API Key                   | 已实现 | Key 由主进程 `CredentialService` 保存           |
| 工具调用与权限确认                    | 已实现 | 修改性和高风险操作按权限模型确认                |
| Browser、Editor、FS、Terminal 工具    | 已实现 | 通过主进程和 MCP 边界调用                       |
| 工作空间会话持久化                    | 已实现 | Thread 随工作空间保存和恢复                     |
| 取消、错误状态和诊断复制              | 已实现 | 诊断默认脱敏                                    |
| 图片输入                              | 已实现 | PNG/JPEG/GIF/WebP；单条最多 5 张、单张最多 5 MB |
| HTTP/OpenAI Compatible 完整工具 Agent | 未实现 | 不与普通 Chat Completion 混为一谈               |
| 多 Agent、跨会话记忆、操作回放        | 未实现 | 需要单独产品规格和架构评审                      |

图片可以通过文件选择、粘贴或拖放加入 Composer。图片正文只进入当前待发送消息，
发送成功后从 Composer 清除，不写入工作空间或 conversation 持久化快照。当前本地
Claude Code backend 使用原生多模态输入；诊断只记录数量、MIME 和大小，不记录
base64 正文。
