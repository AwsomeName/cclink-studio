# CCLink Studio 文档编辑器 — 功能规格

> 状态：✅ 已实现（第一阶段：Tiptap 编辑器 + Agent↔编辑器双向通信 + 微信公众号转换）
> 优先级：Phase 5（第一阶段已完成）
> 替代文档：docs/features/wysiwyg-editor.md（本文档包含并扩展了原编辑器规格）

## 产品目标

AI 驱动的文档编辑器：

- **写文档**：Markdown / 富文本 / AI 辅助写作
- **看文档**：PDF / Word / Excel / PPT 预览
- **做文档**：AI 生成、改写、翻译、排版
- **发文档**：本地导出；通过 IM 分享由 CCLink 网络或商业 overlay 提供

**核心差异化**：不是"编辑器 + AI 插件"，而是 AI 和编辑器深度集成——你跟 AI 说"帮我写一份产品方案"，AI 直接在编辑器里生成，你可以实时看到、实时干预。

## 技术方案

### 编辑器核心：Tiptap (ProseMirror)

```
Tiptap 编辑器
├── 基础能力
│   ├── 富文本编辑（标题、段落、列表、引用、代码块）
│   ├── 图片、链接、表格
│   ├── Markdown 快捷输入
│   ├── 协同编辑预留（Yjs）
│   └── 撤销/重做
│
├── AI 扩展（CCLink Studio 自定义 Tiptap Extension）
│   ├── AI 续写（光标处触发 AI 生成）
│   ├── AI 改写（选中文字 → AI 改写/翻译/总结）
│   ├── AI 格式化（一键排版）
│   ├── AI 生成大纲（输入主题 → AI 生成文档大纲）
│   └── AI 对话批注（在文档中插入 AI 对话气泡）
│
└── CCLink Studio 集成
    ├── 保存到本地（云存储由商业 overlay 或插件提供）
    ├── 导出为 PDF / DOCX
    ├── 导出 / 分享（IM 自定义消息由 CCLink 网络或商业 overlay 提供）
    └── Agent 可操作（MCP EditorToolModule）
```

### 文件格式支持

| 格式 | 编辑 | 预览 | 技术方案 |
|------|------|------|---------|
| `.md` | ✅ 已实现 | ✅ 已实现 | Tiptap Markdown Schema（StarterKit/Markdown/CodeBlock/表格/任务列表） |
| `.docx` | ✅（导入/导出） | ✅ | docx 库解析/生成 |
| `.pdf` | ❌ | ✅ | PDF.js |
| `.xlsx` | ❌ | ✅ | SheetJS |
| `.pptx` | ❌ | ✅ | pptxjs |
| `.txt` | ✅ | ✅ | 原生文本 |

## 架构设计

```
编辑器架构
├── EditorTab (React 组件)
│   ├── Tiptap Editor 实例
│   ├── 工具栏（格式化 + AI 功能按钮）
│   └── 大纲面板（侧栏中显示文档大纲）
│
├── EditorStore (Zustand)
│   ├── 当前打开的文档列表
│   ├── 活跃文档 ID
│   ├── 脏标记（未保存）
│   └── 文档元数据
│
├── EditorService (主进程)
│   ├── 文件读写（本地文件系统）
│   ├── 格式转换（MD ↔ DOCX ↔ ProseMirror JSON）
│   ├── 自动保存（定时保存 + 失焦保存）
│   └── 本地保存（云同步由商业 overlay 或插件提供）
│
└── MCP EditorToolModule（5 个工具）
    ├── editor_write — Agent 写入 Markdown（替换全部，无 Tab 自动创建）
    ├── editor_append — Agent 在末尾追加
    ├── editor_insert — Agent 在 start/end 插入
    ├── editor_read — Agent 读取当前 Markdown 内容
    └── editor_save — Agent 保存到磁盘
```

### 编辑器数据流

```
文件系统 → Parser → ProseMirror Document → Tiptap Renderer → React UI
                                  ↑↓
                            用户编辑操作
                                  ↑↓
                     AI 生成内容（Tiptap Extension）
                                  ↓
ProseMirror Document → Serializer → 文件系统 / 云存储
```

## UI 设计

### 编辑器作为 Workbench Tab

```
主工作区
┌──────────────────────────────────────────┐
│ [🌐 百度] [📄 产品方案.md] [📄 周报.docx] ×│  ← Tab 栏
├──────────────────────────────────────────┤
│ 工具栏                                    │
│ [B] [I] [U] | [H1▼] | [🔗] [📷] [📋]   │
│ [AI 续写▼] | [🤖 改写] [🌐 翻译] [📝 总结]│
├──────────────────────────────────────────┤
│                                          │
│  # 产品方案 v2.0                          │
│                                          │
│  ## 背景与目标                            │
│  在 AI 时代，用户需要一个一站式桌面...      │
│                                          │
│  ## 核心功能                              │
│  - 内嵌浏览器自动化                        │
│  - AI Agent 系统                          │
│  - 即时通讯                               │
│                                          │
│  |█ 这里是 AI 正在生成的内容...            │  ← AI 续写动画
│                                          │
├──────────────────────────────────────────┤
│ Ln 42, Col 18 | UTF-8 | Markdown | 已保存 │
└──────────────────────────────────────────┘
```

### AI 交互方式

**1. 侧边 AI 对话（在右侧 Agent 面板中）**

```
右侧 Agent 面板
┌─────────────────────────┐
│ 🤖 当前文档：产品方案.md    │  ← 自动识别上下文
├─────────────────────────┤
│ 你: 帮我写"市场分析"部分    │
│                           │
│ Agent: 好的，正在生成...    │
│                           │
│ ✅ 已在文档中插入以下内容：  │
│ "## 市场分析               │
│  当前市场呈现以下趋势..."   │
│                           │
│ [查看文档] [重新生成]       │
└─────────────────────────┘
```

**2. 行内 AI 操作（选中文字后浮现）**

```
  AI 时代的用户需要一个一站式桌面服务。  ← 选中这段文字
  ┌──────────────────────────────┐
  │ [✏️ 改写] [🌐 翻译] [📝 总结] │
  │ [📊 展开论述] [🎯 精简]       │
  └──────────────────────────────┘
```

**3. AI 续写（光标在段落末尾时）**

```
  ## 核心功能
  在 AI 时代，用户需要

  ┌──────────────────────────────────┐
  │ ✨ 按 Tab 接受 AI 续写              │
  │ "一个能够整合浏览器、文档编辑、即时通讯 │
  │  和 AI Agent 的一站式桌面工作平台。"  │
  └──────────────────────────────────┘
```

## AI 驱动的编辑功能

### 写作辅助

| 功能 | 触发方式 | 说明 |
|------|---------|------|
| **AI 续写** | 光标在段落末 → 自动触发/手动 Tab | AI 根据上下文续写内容 |
| **AI 改写** | 选中文字 → 改写按钮 | 改变语气、风格、长度 |
| **AI 翻译** | 选中文字 → 翻译按钮 | 支持中英互译，保持格式 |
| **AI 总结** | 选中段落 → 总结按钮 | 提取要点 |
| **AI 格式化** | 工具栏按钮 | 一键排版（标题层级、列表、间距） |
| **AI 生成大纲** | 右侧面板输入主题 | 生成完整的文档大纲 |
| **AI 生成全文** | 右侧面板对话 | 根据描述生成完整文档 |

### 智能操作

| 功能 | 说明 |
|------|------|
| **语音输入** | 口述内容，AI 转写为格式化文本 |
| **表格 AI 分析** | 选中表格数据 → AI 分析/生成图表描述 |
| **PPT 大纲生成** | 文档内容 → AI 提取 PPT 大纲 |
| **一键分享** | 文档 → IM 分享给好友（自定义消息类型） |

## MCP 工具集成 ✅ 已实现

Agent 通过 `EditorToolModule`（`src/main/mcp/modules/editor/index.ts`）操作编辑器，共 **5 个工具**，通过 IPC 推送内容到渲染进程并等待 ack 确认（30s 超时）：

| 工具 | 说明 |
|------|------|
| `editor_write` | 将 Markdown 写入编辑器（替换全部内容），无 Tab 时自动创建 |
| `editor_append` | 在文档末尾追加 Markdown |
| `editor_insert` | 在指定位置（start/end）插入 Markdown |
| `editor_read` | 读取当前编辑器的 Markdown 内容 |
| `editor_save` | 保存当前编辑器内容到磁盘（需已关联文件路径） |

**数据流**：Agent 调用工具 → 主进程 `EditorToolModule` 通过 IPC 推送 `editor:contentUpdate` / `readRequest` / `saveRequest` → 渲染进程 `MarkdownEditor` 应用变更并回 `ack` / `readResponse` / `saveResult` → Promise 解析返回 Agent。

## Store 设计

```typescript
// editor-store.ts
interface EditorState {
  // 打开的文档
  openDocs: OpenDocument[]
  activeDocId: string | null

  // 文档状态
  dirty: Record<string, boolean>  // docId → 是否有未保存修改

  // AI 状态
  aiGenerating: boolean
  aiSuggestion: string | null

  // Actions
  openDocument(filePath: string): void
  closeDocument(docId: string): void
  setActiveDoc(docId: string): void
  markDirty(docId: string): void
  saveDocument(docId: string): Promise<void>
  aiContinue(docId: string): void
  aiRewrite(docId: string, selection: string, instruction: string): void
  aiTranslate(docId: string, selection: string, targetLang: string): void
}
```

## 开发任务拆解

### 第一阶段：基础编辑器（3-4 周）

- [x] Tiptap 集成到 Workbench Tab 系统
- [x] 基础工具栏（格式化、标题、列表、链接、图片）
- [x] Markdown 快捷输入支持
- [x] 文件读写（.md 文件）
- [x] 自动保存
- [x] editor-store

### 第二阶段：AI 写作辅助（2-3 周）

- [ ] AI 续写 Extension
- [ ] AI 改写（选中 → 改写）
- [ ] AI 翻译
- [ ] AI 总结
- [ ] 右侧面板 AI 对话与编辑器联动

### 第三阶段：多格式支持（2-3 周）

- [ ] DOCX 导入/导出
- [ ] PDF 预览（PDF.js）
- [ ] Excel 预览（SheetJS）
- [ ] PPT 预览（pptxjs）

### 第四阶段：MCP + 分享集成（1-2 周）

- [x] EditorToolModule（Agent 操作编辑器，5 个工具）
- [ ] 文档分享到 IM（自定义消息类型，📋 IM 未开始）
- [ ] 从 IM 消息中打开文档（📋 IM 未开始）

### 第五阶段：高级功能（后续）

- [ ] AI 生成大纲
- [ ] AI 一键排版
- [ ] 表格编辑器
- [ ] PPT 编辑器
- [ ] 协同编辑（Yjs）
