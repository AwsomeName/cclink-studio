# CCLink Studio 文档编辑器

> 状态：Markdown S 级首轮实现与集中验收已完成；AI 写作辅助仍属后续专项。
> Markdown S 级产品规格：`docs/features/markdown-wysiwyg.md`。
> 多格式 S 级状态：`docs/features/wysiwyg-editor.md`。

## 产品方向

文档编辑器的长期方向是：

- **写文档**：Markdown / 富文本 / AI 辅助写作
- **看文档**：PDF / Word / Excel / PPT 预览
- **做文档**：AI 生成、改写、翻译、排版
- **发文档**：本地导出；官方消息分享由 CCLink 网络提供

**核心差异化**：不是"编辑器 + AI 插件"，而是 AI 和编辑器深度集成——你跟 AI 说"帮我写一份产品方案"，AI 直接在编辑器里生成，你可以实时看到、实时干预。

以上是产品方向，不代表所有格式和 AI 交互已经实现。实际完成度以本文的格式表和各专项规格为准。

## 当前技术基础

```
Workbench Editor Tab
├── Tiptap / ProseMirror
│   ├── Markdown 解析与序列化
│   ├── 常用富文本扩展
│   └── 撤销与重做
├── EditorStore
│   ├── Markdown 文本
│   ├── dirty 与 loading
│   ├── 工作台恢复草稿
│   └── Agent 更新队列
├── 本地文件 IPC
│   ├── UTF-8 读取
│   └── 手动保存
└── MCP EditorToolModule
    ├── 全文写入、追加和首尾插入
    ├── 全文读取
    └── 保存请求
```

### 文件格式支持

| 格式               | 当前编辑       | 当前预览     | 当前事实                                                         |
| ------------------ | -------------- | ------------ | ---------------------------------------------------------------- |
| `.md`, `.markdown` | 支持           | 所见即所得   | 常用 Markdown 单界面编辑、安全保存、本地图片、冲突处理和选区引用已完成 |
| `.docx`            | 不支持         | 只读内容预览 | 提取标题、段落、列表和表格，不支持保存回 DOCX                    |
| `.pptx`            | 不支持         | 只读内容预览 | 按幻灯片提取标题和正文，不支持保存回 PPTX                        |
| `.pdf`             | 不支持         | 支持         | 内嵌只读预览                                                     |
| `.xlsx`            | 不支持         | 不支持       | 识别后明确降级                                                   |
| `.txt` 和代码文本  | 文本编辑       | 文本编辑     | 当前与 Markdown 共用编辑 Tab 路径，后续可独立文本编辑器          |

## 当前数据流

```
文件系统 → 安全 IPC → Markdown 文本 → Tiptap / ProseMirror
                                      ↑↓
                                  用户编辑
                                      ↓
                              Markdown 序列化
                                      ↓
                           EditorStore → 手动保存
```

## 当前用户能力

- 在工作台 Tab 中打开 Markdown 和文本文件。
- 使用基础富文本工具栏和 Markdown 快捷输入。
- 手动保存文件并恢复未保存草稿。
- 让当前 Agent 会话读取、覆盖、追加或保存 Markdown。
- 将 Markdown 转换为微信公众号兼容 HTML。

Markdown S 级保持单一所见即所得文档体验，只支持明确列出的常用 Markdown。完整图片和表格交互、保存冲突以及选区带行号发送到会话已完成。Frontmatter、Mermaid 图表、原始 HTML、MDX、公式、脚注和 directives 不在本轮范围。AI 行内改写、翻译、续写等能力属于后续专项。

## MCP 工具集成 ✅ 已实现

Agent 通过 `EditorToolModule`（`src/main/mcp/modules/editor/index.ts`）操作编辑器，共 **5 个工具**，通过 IPC 推送内容到渲染进程并等待 ack 确认（30s 超时）：

| 工具            | 说明                                                      |
| --------------- | --------------------------------------------------------- |
| `editor_write`  | 将 Markdown 写入编辑器（替换全部内容），无 Tab 时自动创建 |
| `editor_append` | 在文档末尾追加 Markdown                                   |
| `editor_insert` | 在指定位置（start/end）插入 Markdown                      |
| `editor_read`   | 读取当前编辑器的 Markdown 内容                            |
| `editor_save`   | 保存当前编辑器内容到磁盘（需已关联文件路径）              |

**数据流**：Agent 调用工具 → 主进程 `EditorToolModule` 通过 IPC 推送 `editor:contentUpdate` / `readRequest` / `saveRequest` → 渲染进程 `MarkdownEditor` 应用变更并回 `ack` / `readResponse` / `saveResult` → Promise 解析返回 Agent。

## 开发任务拆解

### 已有基础

- [x] Tiptap 集成到 Workbench Tab 系统
- [x] 基础格式工具栏（标题、强调、列表、引用、代码块）
- [x] Markdown 快捷输入支持
- [x] 文件读写（.md 文件）
- [x] 手动保存和工作台恢复草稿
- [x] editor-store
- [x] Agent 全文读取、覆盖、追加和保存

### Markdown S 级

产品边界、支持范围、选区行号引用、保存安全和里程碑统一见
`docs/features/markdown-wysiwyg.md`，本文不重复维护第二套清单。

### 后续 AI 写作辅助

- [ ] AI 续写 Extension
- [ ] AI 改写（选中 → 改写）
- [ ] AI 翻译
- [ ] AI 总结
- [ ] 右侧面板 AI 对话与编辑器联动

### MCP + 分享集成

- [x] EditorToolModule（Agent 操作编辑器，5 个工具）
- [ ] 文档分享到 IM（自定义消息类型，📋 IM 未开始）
- [ ] 从 IM 消息中打开文档（📋 IM 未开始）

### 高级功能（后续）

- [ ] AI 生成大纲
- [ ] AI 一键排版
- [ ] 协同编辑（Yjs）
