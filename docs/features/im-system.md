# Historical: 即时通讯系统 — 功能规格

> 当前状态：历史/商业能力规格，不属于 CCLink Studio OSS 默认路径。
>
> TIM SDK、UserSig、好友关系、消息路由、多端同步和官方账号体系属于 CCLink 网络与商业 overlay。开源 Studio 不应默认集成 TIM SDK 或暴露 IM 登录/消息入口。

# DeepInk 即时通讯系统 — 功能规格

> 状态：📋 规划中
> 优先级：Phase 4

## 产品目标

在 DeepInk 中集成 AI-Native 即时通讯，让用户可以：
- 跟好友/同事直接聊天（AI-Native 工作沟通场景）
- 给好友的 AI Agent 发送任务/消息
- 一键分享 AI 完成的工作成果
- Agent 之间自动协作

**不是简单地在 AI 工具上加聊天，而是从第一天起 IM 和 AI 就是一体的。**

## 技术方案：腾讯 IM SDK (TIM)

### 为什么用 TIM

| 自建 IM | 腾讯 TIM |
|---------|---------|
| 需要后端服务器集群 | ✅ 腾讯托管，无需运维 |
| 需要实现离线推送 | ✅ 内置 |
| 需要实现多设备同步 | ✅ 内置 |
| 需要处理消息可靠性 | ✅ 内置 |
| 需要自己过等保 | ✅ 腾讯云已过等保三级 |
| 需要好友关系存储 | ✅ 内置 |
| 3-5 个后端工程师，6+ 个月 | 1 个前端 + 1 个后端，2-3 个月 |

### SDK 选择

```
腾讯云 IM SDK
├── 桌面端（Electron）— tim-js-sdk（Web SDK，Electron 兼容）
├── 移动端 — tim-native-sdk（iOS/Android 原生 SDK）
└── 后端 — tim-server-sdk（用于服务端 API 调用）
```

## 架构设计

### 整体架构

```
DeepInk 渲染进程 (React)
│
│  im-panel UI（消息列表、输入框、分享卡片）
│  sidebar IM 面板（联系人、会话列表）
│
├── im-store (Zustand)
│
├── window.deepink.im.* (preload API)
│
│   IPC
│
DeepInk 主进程
│
├── tim-manager.ts
│   ├── TIM SDK 初始化
│   ├── 登录/登出（复用 DeepInk 用户 ID）
│   ├── 消息收发
│   ├── 会话管理
│   └── 好友关系管理
│
├── message-handler.ts
│   ├── 标准消息处理（文本、图片、文件）
│   ├── 自定义消息处理（AI 工作成果、Agent 通知）
│   └── 消息事件分发 → IPC → Store
│
├── im-ipc.ts
│   └── IM 相关 IPC 处理器
│
└── MCP Tool Module: im-tools
    ├── im_send_message — Agent 可发消息给好友
    ├── im_share_work — Agent 可分享工作成果
    └── im_get_contact — Agent 可查询联系人

        │
        ▼

腾讯 TIM 云服务
├── 消息路由、存储、推送
├── 好友关系链
├── 离线消息
├── 多设备同步
└── 已读回执
```

### 用户体系对接

```
DeepInk 用户系统 ←→ TIM 用户系统

DeepInk 注册/登录 → 后端创建 TIM 账号（或关联已有账号）
                → 返回 TIM UserSig（服务端生成）
                → 主进程 TIM SDK 登录（userID + userSig）

好友关系：
  方案 A：TIM 原生好友关系（推荐，开箱即用）
  方案 B：DeepInk 自有好友表 + TIM 仅做消息通道
```

## 消息类型设计

### 标准消息

| 类型 | TIM 消息元素 | 用途 |
|------|-------------|------|
| 文本 | TIMTextElem | 普通聊天 |
| 图片 | TIMImageElem | 图片分享 |
| 文件 | TIMFileElem | 文件传输 |
| 语音 | TIMSoundElem | 语音消息（移动端） |

### 自定义消息（DeepInk 特有）

**1. AI 工作成果分享（WorkShareMessage）**

```typescript
interface WorkShareMessage {
  type: 'deepink_work_share'
  data: {
    taskId: string          // 任务 ID
    taskTitle: string       // 任务标题（如"帮我分析这个网页"）
    summary: string         // AI 生成的摘要
    resultType: 'text' | 'document' | 'screenshot' | 'data'
    resultPreview: string   // 预览内容（截断的文本/缩略图 URL）
    resultRef: string       // 完整结果引用（本地路径/云链接）
    agentModel: string      // 使用的 AI 模型
    createdAt: number       // 时间戳
  }
}
```

**2. Agent 通知（AgentNotificationMessage）**

```typescript
interface AgentNotificationMessage {
  type: 'deepink_agent_notification'
  data: {
    notificationType: 'task_complete' | 'task_failed' | 'need_confirm' | 'agent_message'
    taskId: string
    title: string
    description: string
    actionUrl?: string      // 点击后的跳转链接
  }
}
```

**3. Agent 协作请求（AgentCollabMessage）**

```typescript
interface AgentCollabMessage {
  type: 'deepink_agent_collab'
  data: {
    fromAgent: string       // 发起方 Agent 名称
    toAgent: string         // 接收方 Agent 名称
    taskDescription: string
    contextRef: string      // 上下文引用
    requireApproval: boolean // 是否需要用户确认
  }
}
```

## UI 设计

### 侧栏 IM 面板

```
Activity Bar 新增图标：💬 消息

侧栏 IM 面板：
┌─────────────────────┐
│ 🔍 搜索联系人/消息    │
├─────────────────────┤
│ 💬 张三          2m │
│   "好的，发给你了"    │
├─────────────────────┤
│ 🤖 李四的 Agent  10m│
│   [任务完成] 报告已生成│
├─────────────────────┤
│ 👥 产品组        1h │
│   王五: 方案已更新    │
├─────────────────────┤
│ 🤖 Agent 通知   3h │
│   [分析完成] 数据报告 │
└─────────────────────┘
```

### 右侧面板：Agent + IM 统一消息流

右侧面板顶部有 Tab 切换，或根据点击侧栏消息自动切换：

```
┌─────────────────────────┐
│ [🤖 Agent] [💬 张三]    │  ← Tab 切换
├─────────────────────────┤
│ 张三                      │
│ 帮我看看这个报告          │
│                           │
│                    你 2:30│
│              好的，发给 AI │
│                           │
│ 🤖 Agent 已完成分析       │
│ ┌──────────────────────┐ │
│ │ 📊 报告分析结果        │ │
│ │ 要点 1: ...           │ │
│ │ 要点 2: ...           │ │
│ │                      │ │
│ │ [查看完整结果]         │ │
│ │ [分享给张三]  ← 一键   │ │
│ └──────────────────────┘ │
│                           │
│                你 2:31    │
│          [已分享分析报告]  │
│                           │
├─────────────────────────┤
│ [📎]  输入消息...   [发送]│
└─────────────────────────┘
```

### 工作成果分享卡片

在 Agent 对话面板中，AI 完成任务后显示分享按钮：

```
┌─────────────────────────────────┐
│ ✅ AI 已完成任务                  │
│                                  │
│ 📊 网页分析报告                   │
│ 该页面是一个电商产品页，主要包含... │
│                                  │
│ [📋 复制结果] [💾 保存为文档]     │
│ [📤 分享给好友]  ← 点击弹出好友列表│
└─────────────────────────────────┘
```

## Preload API 设计

```typescript
// window.deepink.im
interface IMAPI {
  // 登录
  login(): Promise<void>

  // 会话
  getConversationList(): Promise<Conversation[]>
  onConversationUpdate(cb: (conversations: Conversation[]) => void): () => void

  // 消息
  sendMessage(conversationId: string, message: MessageInput): Promise<Message>
  getMessageList(conversationId: string, count?: number): Promise<Message[]>
  onMessageReceived(cb: (message: Message) => void): () => void

  // 自定义消息
  sendWorkShare(conversationId: string, workData: WorkShareData): Promise<Message>
  sendAgentNotification(conversationId: string, notification: AgentNotification): Promise<Message>

  // 好友
  getFriendList(): Promise<Friend[]>
  searchFriends(keyword: string): Promise<Friend[]>

  // 状态
  onFriendOnlineStatus(cb: (statuses: Map<string, OnlineStatus>) => void): () => void
}
```

## Store 设计

```typescript
// im-store.ts
interface IMState {
  // 会话
  conversations: Conversation[]
  activeConversationId: string | null

  // 消息（按会话 ID 索引）
  messages: Record<string, Message[]>

  // 联系人
  friends: Friend[]
  onlineStatuses: Record<string, OnlineStatus>

  // 状态
  connected: boolean
  loading: boolean

  // Actions
  selectConversation(id: string): void
  sendMessage(convId: string, content: string): void
  sendWorkShare(convId: string, data: WorkShareData): void
  loadMoreMessages(convId: string): void
}
```

## MCP 工具集成

Agent 可以通过 MCP 工具发送 IM 消息：

```typescript
// im-tool-module.ts
const imTools: ToolDefinition[] = [
  {
    name: 'im_send_message',
    description: '给好友发送消息',
    inputSchema: {
      friendId: { type: 'string', description: '好友 ID' },
      message: { type: 'string', description: '消息内容' },
    },
    annotations: { readOnly: false },
  },
  {
    name: 'im_share_work',
    description: '将当前任务结果分享给好友',
    inputSchema: {
      friendId: { type: 'string', description: '好友 ID' },
      summary: { type: 'string', description: '分享摘要' },
    },
    annotations: { readOnly: false, destructive: false },
  },
  {
    name: 'im_get_contacts',
    description: '获取好友列表',
    inputSchema: {},
    annotations: { readOnly: true },
  },
]
```

## 合规要求

IM 功能涉及的中国大陆合规资质：

| # | 资质 | 说明 | 状态 |
|---|------|------|------|
| 1 | ICP 备案 | 所有 App 必须 | 需申请 |
| 2 | APP 备案 | 2024 年起新要求 | 需申请 |
| 3 | 软件著作权 | 上架必备 | 需申请 |
| 4 | ICP 经营许可证（B25） | IM 属于"信息即时交互" | 需申请 |
| 5 | 安全评估报告 | IM 有舆论属性 | 需申请 |
| 6 | 等保二级 | IM 系统通常需要 | 需申请 |
| 7 | 算法备案 | 有 AI 生成内容 | 需申请 |
| 8 | 生成式 AI 登记 | 调用已备案模型做省级登记 | 需申请 |

> 用腾讯 TIM 可大幅简化 IM 合规——基础设施合规由腾讯兜底。

## 开发任务拆解

### 第一阶段：基础 IM（2-3 周）

- [ ] TIM SDK 集成到主进程
- [ ] 用户体系对接（DeepInk 用户 → TIM 账号）
- [ ] 基础 IM IPC 处理器
- [ ] im-store 基础版
- [ ] 文本消息收发 UI

### 第二阶段：联系人与会话（1-2 周）

- [ ] 好友列表 UI
- [ ] 添加好友流程
- [ ] 会话列表 UI
- [ ] 在线状态

### 第三阶段：自定义消息（2 周）

- [ ] AI 工作成果分享消息类型
- [ ] Agent 通知消息类型
- [ ] 分享卡片 UI
- [ ] Agent 面板中的"分享给好友"按钮

### 第四阶段：MCP 工具集成（1 周）

- [ ] IMToolModule 实现
- [ ] Agent → 发消息给好友
- [ ] Agent → 分享工作成果

### 第五阶段：文件与富媒体（1-2 周）

- [ ] 图片消息
- [ ] 文件传输
- [ ] 文件与云存储对接
