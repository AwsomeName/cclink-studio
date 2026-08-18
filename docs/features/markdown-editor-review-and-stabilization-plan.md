# Markdown 编辑器产品与架构审查及稳定化方案

> 状态：审查与文档状态更正已完成；M1 两条 P0 数据损坏路径已完成最小修复和回归覆盖，A3/A5 真实应用验收与 P1 稳定化仍待完成。
> 审查日期：2026-08-18。
> 审查范围：Markdown 打开、编辑、保存、关闭、恢复、外部冲突、Agent 操作、资源组、文件类型路由、状态所有权、IPC、生命周期与测试门禁。
> 本文是本轮 Markdown 稳定化的整改事实源；产品支持范围仍以 `docs/features/markdown-wysiwyg.md` 为准，但其中“首轮完成”的声明在本文退出条件满足前暂停生效。

## 结论

当前 Markdown 只形成了窄范围 happy path：用户可以打开支持范围内的普通 Markdown，使用
Tiptap 所见即所得编辑，并在没有外部并发、Agent 写入、快速重复保存或大资源压力时手动保存。

当前仍不能可靠完成：

- Agent 与用户共同修改同一文档；
- 所有 Markdown 写入统一经过版本检查、原子写入、保真门禁和资源组处理；
- 常见但超出 WYSIWYG 支持范围的 Markdown 继续安全编辑；
- `.txt`、`.json`、`.ts`、`.py` 等普通文本和代码文件使用正确的源码编辑体验；
- 大图片、多图片文档保持可预测的内存和交互性能。

因此，当前实现不得继续标记为“Markdown S 级完成”或“可发布稳定闭环”。问题并非一个
Tiptap 兼容 bug，而是缺少统一的文档会话领域：Tiptap、`editor-store`、磁盘和 Agent 工具
分别拥有部分正文事实，并通过 React 组件生命周期和文件监听器做隐式同步。已经发现的
本轮已封闭已知的错目标覆盖和冲突关闭丢草稿路径，但 Agent 直写、文件路由、
保真边界、保存并发与资源预算等 P1 仍是缺少统一文档会话领域的直接结果。

## 用户端到端验收基线

整改任务必须先以以下真实应用动作验收，再报告工程完成度。

### A1：普通 Markdown 编辑闭环

1. 用户从本地工作空间打开包含标题、粗体、斜体、删除线、行内代码、列表、表格、链接、
   图片和代码块的 Markdown。
2. 打开完成后显示“已保存”，不产生草稿。
3. 用户只修改一个段落并保存。
4. 关闭并重新打开后，修改存在，未触碰结构和行内标记完整保留。
5. 磁盘文件可由普通 Markdown 工具读取。

### A2：范围外语法安全退路

1. 用户打开包含 Frontmatter、脚注、原始 HTML 或 directive 的 `.md`。
2. Studio 不把这些结构丢弃或转换成普通正文。
3. 用户可以选择“按源码安全编辑”，清楚看到当前不是所见即所得模式。
4. 只修改一处普通文本并保存后，范围外结构逐字保留。
5. 用户可以随时回到文件树和其他本地能力，不被错误页困住。

### A3：外部冲突与关闭

1. 用户编辑已打开的 Markdown，使其处于 dirty 状态。
2. 外部程序修改同一文件。
3. Studio 明确显示冲突，并保留内存草稿和外部版本。
4. 用户关闭 Tab，选择“保存”。
5. Studio 不得关闭 Tab，直到用户完成重新载入、另存为、合并或明确覆盖之一。
6. 任一路径失败后，草稿仍可继续编辑和恢复。

### A4：Agent 与用户共同编辑

1. 用户打开 Markdown 并产生未保存修改。
2. Agent 对同一路径执行覆盖、追加或插入。
3. Agent 请求必须命中该文档会话，不得直接绕过草稿写磁盘。
4. 界面实时显示 Agent 变更，dirty、撤销和保存状态一致；或者在策略不允许合并时，Agent
   收到结构化冲突，不得覆盖任何一方。
5. 用户保存后，磁盘内容与当前会话一致。

### A5：精确目标保存

1. 工作台当前显示文档 A，同时另有已打开或未打开文档 B。
2. Agent 调用 `editor_save` 指定 B。
3. 只有 B 可以被保存；A 的正文绝不能写入 B。
4. B 没有可保存会话时，工具立即返回结构化错误，不等待 30 秒超时。

### A6：文件类型路由

1. 用户分别打开 `.md`、`.txt`、`.json`、`.ts`、`.py` 和 `.html`。
2. 只有 `.md` / `.markdown` 默认进入 Markdown 文档模式。
3. 普通文本和代码进入源码编辑器，标点、缩进和换行不被 Markdown 解析。
4. HTML 的预览与源码编辑入口保持明确分离。

### A7：重复保存和大图片

1. 用户快速连续触发两次保存，Studio 只形成有序保存，不把自身写入误报为外部冲突。
2. 保存过程中继续输入，新输入保持 dirty，不被旧保存响应覆盖。
3. 打开包含多张大图片的 Markdown 时，图片按预算和可见性加载；超限资源显示降级提示，
   不冻结工作台。

只有 A1-A7 在真实应用中通过，且相关自动化门禁通过，才可以恢复“稳定完成”声明。

## 当前实现数据流

```text
用户输入
  -> Tiptap / ProseMirror 文档
  -> Markdown 序列化
  -> renderer editor-store 草稿
  -> fs:saveTextDocument
  -> MarkdownDocumentService
  -> 磁盘

Agent editor_write / append / insert
  -> EditorToolModule
  -> FileService.writeFile
  -> 磁盘
  -> 当前已挂载 MarkdownEditor 的目录监听器
  -> editor-store 自动重载或外部冲突

Agent editor_save
  -> 全窗口 editor:saveRequest 广播
  -> 当前已挂载的编辑器组件
  -> 按当前组件内容决定保存结果

关闭 dirty Tab
  -> close-tab
  -> editor-store.saveFile
  -> 组件挂载期间才存在的 SaveGuard
  -> 关闭 Tab 并删除 store 草稿
```

这些路径没有汇合到同一个文档命令、状态机和持久化事务。

## 代码证据索引

| 问题                                   | 主要代码位置                                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `editor_save` 广播而非精确路由         | `src/main/mcp/modules/editor/index.ts:293-311`                                                       |
| 只有当前活动编辑器挂载                 | `src/renderer/src/components/workbench/WorkbenchContent.tsx:95-120`                                  |
| 挂载编辑器精确校验保存目标             | `src/renderer/src/features/editor-save-target.ts`                                                    |
| Markdown / Source 只保存匹配会话       | `src/renderer/src/components/workbench/MarkdownEditor.tsx`、`SourceTextEditor.tsx`                   |
| 冲突返回后保留 Tab 和草稿              | `src/renderer/src/utils/close-tab.ts:95-125`                                                         |
| 保存返回 `'saved' \| 'conflict'`       | `src/renderer/src/stores/editor-store.ts:283-380`                                                    |
| Agent 写工具直接使用原始 `writeFile`   | `src/main/mcp/modules/editor/index.ts:203-223`                                                       |
| 原始文件写入不是 Markdown 受管保存     | `src/main/fs/file-service.ts:280-317`                                                                |
| 普通文件统一归入 `editor`              | `src/renderer/src/utils/model-files.ts:15-28`                                                        |
| 非 HTML editor 统一进入 MarkdownEditor | `src/renderer/src/components/workbench/WorkbenchContent.tsx:107-120`                                 |
| 保真签名缺少行内标记                   | `src/renderer/src/features/markdown/markdown-codec.ts:49-64, 308-323`                                |
| SaveGuard 依赖组件注册                 | `src/renderer/src/features/editor-save-guard.ts:1-14`                                                |
| MarkdownEditor 聚合多领域职责          | `src/renderer/src/components/workbench/MarkdownEditor.tsx:83-1250`                                   |
| 本地图片整文件 Base64 预览             | `src/renderer/src/features/markdown/MarkdownImage.tsx:73-111`、`src/main/fs/file-service.ts:155-164` |
| 工具栏直接复制 Tiptap action           | `src/renderer/src/components/workbench/EditorToolbar.tsx:76-177`                                     |

## 审查验证边界

本轮执行：

```bash
pnpm exec vitest run \
  src/renderer/src/features/markdown \
  src/renderer/src/features/editor-save-target.test.ts \
  src/renderer/src/stores/editor-store.test.ts \
  src/renderer/src/utils/close-tab.test.ts \
  src/main/mcp/modules/editor/index.test.ts
```

结果为 15 个测试文件、122 项测试全部通过；新回归已覆盖目标不匹配和冲突关闭两条 P0。
该结果只证明局部预期成立，不代替 A1-A7 真实应用验收；后续精确 SHA 的远端 CI 与
发布门禁仍需全部通过。

## 产品逻辑问题

### P0-1（已最小修复）：Agent 保存可能把当前文档写入另一个目标文件

修复前证据：

- `EditorToolModule.requestSave()` 把 `filePath` 作为全窗口事件广播；
- `WorkbenchContent` 只挂载当前活动编辑器；
- `MarkdownEditor` 和 `SourceTextEditor` 在目标路径不同于当前路径时，读取当前组件的正文并
  写入请求目标。

修复前用户影响：当前显示 A、Agent 请求保存 B 时，A 的正文可能覆盖 B；当前没有编辑器时，
请求等待到超时。

根因：IPC 契约没有稳定 `sessionId` 和资源 owner，错误地用“当前挂载组件”代替目标路由。

最小修复：挂载编辑器只接受与自身路径精确一致的保存请求；不匹配时在任何 I/O 前
立即返回结构化失败，不再把当前缓冲写入其他文件。目标会话的完整定向路由仍属 M4。

### P0-2（已最小修复）：冲突后选择“保存并关闭”会丢弃草稿

修复前证据：

- `editor-store.saveFile()` 用返回值 `'conflict'` 表示冲突，不抛异常；
- `closeNamedEditorFile()` 忽略返回值，随后调用 `closeFile()` 和 `closeTab()`。

修复前用户影响：用户明确选择“保存”，但未保存内容仍从 EditorStore 和工作台草稿中删除。

根因：关闭流程把“函数没有抛错”误当作“已保存”，保存结果缺少统一的终态模型。

最小修复：关闭流程只在 `saveFile()` 明确返回 `'saved'` 时销毁 Tab 和草稿；`'conflict'`
保留当前 Tab、内存草稿和已有冲突状态。

### P1-1：Agent 写入绕过 Markdown 安全边界

`editor_write`、`editor_append` 和 `editor_insert` 直接使用 `FileService.writeFile()`：

- 不比较磁盘版本；
- 不经过原子替换；
- 不经过 Markdown 支持范围和往返检查；
- 不经过资源组 metadata / manifest；
- 不与打开中的 dirty 文档会话协调；
- 不产生可撤销的编辑器事务。

写后回读只能证明“刚写入的字节可以读回”，不能证明没有覆盖用户修改或破坏 Markdown
文档事务。

### P1-2：文件类型路由错误

`getTabTypeForFile()` 将所有非预览、非模型文件归为 `editor`；`WorkbenchContent` 又只为 HTML
路径选择 `SourceTextEditor`，其余 `editor` 全部进入 `MarkdownEditor`。

因此 `.txt`、`.json`、`.ts`、`.js`、`.css`、`.py` 等文件会被 Markdown 解析。以 `#`、
`-`、`1.`、`>` 开头的源码或正文可能被转换为文档结构，JSX/HTML 可能进入只读保护。

### P1-3：保真门禁没有覆盖全部承诺结构

当前关键结构签名覆盖标题、列表、表格、引用、代码块、图片、链接、公式和正文，但没有覆盖：

- 粗体；
- 斜体；
- 删除线；
- 行内代码；
- 标记嵌套关系。

首次水合若改变这些标记，往返检查仍可能判定等价。用户第一次真实输入后，整篇 Tiptap
序列化结果进入 `currentContent`，未被检测的格式损失成为新草稿基线。

### P1-4：产品承诺与实际支持范围冲突

Agent prompt 宣称编辑器支持“完整 Markdown”，实际 WYSIWYG 会拒绝 Frontmatter、原始 HTML、
脚注和 directives。拒绝后界面只提供重新读取和复制诊断，没有安全源码编辑退路。

结果是 Agent 可以成功写出 Studio 随后无法编辑的文件，真实项目中的常见 Markdown 也可能
直接落入只读错误态。

### P1-5：保存没有串行生命周期

`editor-store` 没有 `saving` 状态、保存 generation 或 per-file mutex。快速连续保存可能携带同
一个旧 `expectedHash` 并发执行，第二次请求可能把第一次自身写入误判为外部修改。保存过程中
的新编辑虽然部分得到保留，但保存状态、冲突提示和调用方返回仍不稳定。

### P1-6：图片加载没有资源预算

- renderer 粘贴图片时把整个文件读入 ArrayBuffer，再复制为 Base64 字符串；
- 主进程预览本地图片时再次整文件读入 Buffer 和 Base64；
- 每个图片 NodeView 创建完整 data URL；
- 没有单图大小、文档总量、并发数、可见性或取消预算。

多张大图片会产生多份内存副本，并让 IPC、React 和 Chromium 同时承担压力。

### P2-1：外部删除和移动没有明确状态

文件监听把所有 `rename` 事件映射为 `add`，renderer 随后直接读取目标文件。文件已删除或移动
时，异步读取可能拒绝且没有文档级 `deleted/moved` 状态，用户只能在后续保存或重新载入时看到
模糊错误。

### P2-2：命令入口没有真正共享同一实现

快捷键和命令面板使用 Markdown command/context surface，工具栏仍大量直接调用
`editor.chain()`。相同能力存在不同可用条件、失败反馈和诊断路径，违反“用户命令只有一个
定义源”的架构约束。

## 代码架构问题

### 1. 文档事实没有唯一 owner

当前至少有三份正文状态：

| 状态                           | 当前 owner                                | 问题                                               |
| ------------------------------ | ----------------------------------------- | -------------------------------------------------- |
| ProseMirror 文档               | `MarkdownEditor` React 组件               | 组件卸载即丢失运行时，只能靠序列化镜像恢复         |
| Markdown 草稿、dirty、磁盘基线 | renderer `editor-store`                   | 同时承担文件 I/O、Agent 队列、路径迁移和恢复持久化 |
| 磁盘 Markdown                  | `FileService` / `MarkdownDocumentService` | 可被受管保存和原始 `writeFile` 两条路径修改        |

三者之间没有一个统一 transition owner。Tiptap 在用户输入时像 owner，EditorStore 在关闭和恢复
时像 owner，Agent 写入时磁盘又成为 owner。

### 2. `MarkdownEditor` 是组件、领域服务和运行时注册表的混合体

单个组件同时拥有：

- Tiptap 扩展与视图；
- 打开、水合、解析和往返保护；
- 保存、另存为、覆盖、重新载入和冲突 UI；
- 文件监听器；
- Agent read/save/update IPC；
- 图片资源导入与预览；
- 搜索、选区源码映射和会话挂载；
- 诊断发布；
- 命令和上下文菜单 surface。

组件是否挂载决定了保存门禁、文件监听和 Agent 请求是否存在，违反生命周期对称原则。

### 3. SaveGuard 是隐藏的全局可选依赖

`editor-save-guard.ts` 使用模块级 `Map`。`saveFile()` 的类型无法表达 guard 是否存在，同一保存
调用会因当前 Tab 是否活跃而具有不同安全强度。安全红线不能依赖 React 生命周期。

### 4. IPC 没有资源寻址和代次

现有 read/save 请求只有操作 ID 和可选路径，没有：

- `workspaceRef`；
- `sessionId`；
- renderer generation；
- 预期磁盘版本；
- 目标是否已打开；
- 结构化错误类型。

请求只能广播并等待任一组件响应；窗口重建、Tab 切换、同路径重开和目标不在当前 Tab 时均
缺少可靠语义。

### 5. 持久化契约允许绕过领域不变量

renderer 和 Agent 同时可访问原始 `writeFile` 与受管 `saveTextDocument`。只要 Markdown 可以走
原始写入口，版本检查、原子写入、资源组和保真门禁都只是调用约定，不是架构保证。

### 6. 状态机由布尔值、可选字段和 Ref 隐式组成

`loading`、`dirty`、`externalContent`、`parseBlockedReason`、`protectedPreviewAvailable`、
`hydratedVersion`、`hydratingRef`、`loadedVersionRef` 和 `reloadGenerationRef` 可以形成大量未定义
组合。没有 reducer 或 transition service 阻止诸如：

- `hydrating + dirty`；
- `saving + external-conflict`；
- `readonly + pending-agent-update`；
- `deleted + overwrite-ready`；
- 旧异步响应修改新 session。

### 7. 多 Store 协作不是显式事务

Markdown 组件直接读取或修改 Editor、Tab、Workspace、Command、Settings、Toast 和 ContextMenu
Store。另存为、文件重定位、Tab 路径更新、Agent 挂载和工作空间切换依靠调用顺序保持一致，
没有统一 command/transition 回滚。

### 8. 错误模型不统一

同一保存领域同时使用：

- `'saved' | 'conflict'` 返回值；
- 抛异常；
- IPC `success: boolean + error?: string`；
- 30 秒超时；
- Store 的自由文本 `error`；
- Toast 和控制台日志。

调用方只能猜测“没有抛错是否等于成功”，P0-2 正是这种契约分裂的结果。

### 9. 测试覆盖集中在局部算法而非领域生命周期

本轮运行的 14 个相关测试文件、117 项测试全部通过，但没有覆盖：

- 冲突后保存并关闭；
- Agent 保存非当前目标；
- 当前没有编辑器时的 Agent 保存；
- Agent 与 dirty 草稿并发；
- 快速连续保存；
- 非活动 Tab 保存时 SaveGuard 是否存在；
- 外部删除或移动；
- 大图片内存预算；
- 行内标记在“打开、改一处、保存、重开”中的完整保留。

测试绿色只能证明现有局部预期成立，不能证明文档领域闭环成立。

## 目标产品逻辑

### 1. 明确两种模式，不再把失败页当产品退路

`.md` / `.markdown` 提供：

- **文档模式**：支持范围内的 Markdown 进入 WYSIWYG；
- **源码安全模式**：范围外语法、用户主动选择或文档模式保真失败时，使用纯文本编辑器逐字
  编辑，不经过 Tiptap 转换。

源码安全模式不是“原始内容特殊块”，也不在 WYSIWYG 中混入第二套节点；它是同一磁盘文档
会话的另一种编辑 adapter。模式切换前必须确认 dirty 内容和可逆性。

`.txt` 和代码文件始终进入源码编辑器，不进入 Markdown 分析器。HTML 保持预览与源码入口
分离。

该结论会改变现有“Markdown 不提供源码模式”的产品规格，实施前必须同步更新
`docs/features/markdown-wysiwyg.md`；它不需要违反架构宪法，但不能在文档仍写着“无源码模式”
时直接实现成默认行为。

### 2. Agent 操作语义

- 目标文档已打开：Agent 命令必须命中文档 Session，应用到当前草稿，产生可见、可撤销的
  变更；遇到 dirty 合并边界时按明确策略应用或返回冲突。
- 目标文档未打开：可以创建 headless source session，经版本检查和原子写入落盘；完成后文件
  树和后续打开读取同一版本。
- `editor_save` 只保存指定 session；没有该 session 时立即返回 `session-not-found`，不得借用
  当前 Tab 内容。
- Agent 不允许直接调用 Markdown 的原始 `writeFile`。

### 3. 冲突语义

冲突必须是文档状态而不是一次 Toast：

- 保留 `base`、`draft`、`external` 三份有界快照；
- 提供重新载入、另存为、比较/合并和显式覆盖；
- 关闭时只要冲突未解决且草稿仍 dirty，就不能把“保存”视为成功；
- 外部删除单独进入 `deleted`，不伪装成空文件冲突。

## 目标代码架构

```text
Renderer bootstrap
└── DocumentSessionRegistry
    └── MarkdownDocumentSession (per sessionId)
        ├── explicit state machine
        ├── base snapshot / current draft / conflict snapshot
        ├── editor adapter: wysiwyg | source
        ├── command queue
        ├── undo-visible Agent transactions
        └── disposable listeners and diagnostics

React
└── MarkdownEditor / SourceTextEditor
    └── subscribe projection + send commands

Main process
├── DocumentCommandRouter
│   ├── resolve open session by workspaceRef + filePath
│   └── route targeted IPC with sessionId + generation
└── MarkdownDocumentRepository
    ├── read snapshot
    ├── compare-and-save
    ├── atomic replace
    ├── resource-group transaction
    └── inspect / export / relocate

Agent EditorToolModule
└── DocumentCommandRouter
```

### 状态所有权

| 事实                                                           | 唯一 owner                                                     |
| -------------------------------------------------------------- | -------------------------------------------------------------- |
| 打开文档的 base、draft、dirty、模式、冲突和 session generation | renderer `DocumentSessionRegistry`                             |
| Tiptap ProseMirror 状态                                        | WYSIWYG adapter；只在挂载期间存在，是 Session draft 的编辑投影 |
| 磁盘内容、版本哈希、原子保存和资源组                           | main `MarkdownDocumentRepository`                              |
| 可见 Tab                                                       | `tab-store`；只持有 `sessionId` 和可丢弃投影                   |
| Agent 文档命令                                                 | `DocumentCommandRouter`；不持有正文                            |

### 显式状态机

```text
closed
  -> opening
  -> hydrating
  -> ready.clean
  -> ready.dirty
  -> saving
  -> ready.clean | ready.dirty | conflict | save-failed

hydrating
  -> readonly.unsupported | source.ready | failed

ready.*
  -> conflict | deleted | relocating | closed
```

所有异步事件携带 `sessionId + generation`。只允许状态机声明的 transition；旧 generation 的
读取、监听、保存和 Agent ack 必须被丢弃。

### 共享契约

建议定义：

```ts
type DocumentCommandError =
  | { code: 'session-not-found'; message: string }
  | { code: 'stale-session'; message: string }
  | { code: 'conflict'; currentHash?: string; message: string }
  | { code: 'unsupported'; diagnostics: MarkdownDiagnostic[]; message: string }
  | { code: 'deleted'; message: string }
  | { code: 'invalid-target'; message: string }
  | { code: 'io-failed'; message: string }

type SaveDocumentResult =
  | { status: 'saved'; snapshot: FsTextDocumentSnapshot }
  | { status: 'not-dirty' }
  | { status: 'conflict'; external: FsTextDocumentSnapshot }
  | { status: 'failed'; error: DocumentCommandError }
```

read、edit、save、reload、overwrite、save-as、close 和 Agent 命令都使用同一错误分类；UI 不再
解析字符串或把“未抛异常”当作成功。

### 持久化权限面

- renderer 不再为 Markdown 暴露通用 `writeFile`；普通源码文件使用独立文本保存契约。
- Agent Markdown 工具只能调用 `DocumentCommandRouter`。
- `MarkdownDocumentRepository` 是 `.md` / `.markdown` 唯一写盘入口。
- Repository 内部统一完成 CAS、临时文件、原子替换、metadata、manifest 和资源迁移事务。
- 资源组准备阶段的副作用必须可回滚；正文替换成功而 manifest/迁移失败不能返回“完全失败”
  却留下部分已提交状态。

### 生命周期

- Session 生命周期独立于当前 Tab 是否活动；切换 Tab 只销毁 Tiptap view adapter。
- 文件监听、Agent command target 和 SaveGuard 由 Session Registry 注册并对称释放。
- 一个路径在同一工作空间最多有一个可写 Session；重复 Tab 只创建视图或显式副本。
- 窗口重建通过 session snapshot 恢复；恢复完成前不接受旧 generation 的 Agent ack。
- 关闭 Session 前先完成或取消保存、监听和 Agent 命令，不留下悬空 Promise。

### 命令统一

工具栏、快捷键、命令面板和上下文菜单只引用 command ID。具体 Tiptap action 由当前 editor
adapter contribution 实现，工具栏不再直接复制 `editor.chain()` 业务逻辑。

## 分阶段解决方案

### M0：事实纠偏与回归冻结

用户结果：用户不会再从文档或版本说明中看到“Markdown 已稳定完成”的错误承诺。

工程任务：

- 将本文设为整改事实源；
- 暂停 Markdown 新结构和新工具栏功能；
- 为 P0/P1 建立可执行回归用例；
- 明确源码安全模式的产品规格变更。

退出条件：现有完成声明已纠偏，P0/P1 全部具有失败测试或真实复现脚本。

### M1：封闭 P0 数据损坏路径

用户结果：指定保存不会写错文件；冲突后“保存并关闭”不会丢草稿。

工程任务：

- `editor_save` 只接受精确匹配的 session target；不匹配立即失败；
- close policy 必须检查 `SaveDocumentResult.status === 'saved' | 'not-dirty'` 才能关闭；
- 冲突、失败、取消均保留 Tab 和草稿；
- 增加相关单元测试与真实应用回归。

退出条件：A3、A5 通过；P0 测试失败时阻止 `pnpm verify`。

### M2：正确文件路由与用户安全退路

用户结果：Markdown、普通文本和代码使用正确编辑器；范围外 Markdown 可按源码安全编辑。

工程任务：

- 以明确扩展名和 capability 决定 editor adapter；
- `.md` / `.markdown` 才进入 Markdown 文档模式；
- 增加源码安全模式及模式切换确认；
- 更新 Agent prompt，不再宣称“完整 Markdown”。

退出条件：A2、A6 通过。

### M3：建立 DocumentSession 纵向闭环

用户结果：切换 Tab、保存、恢复和外部修改都属于同一文档会话，不再依赖当前组件是否挂载。

工程任务：

- 引入 `DocumentSessionRegistry` 和显式状态机；
- 把打开、水合、dirty、保存、冲突、删除和恢复从 `MarkdownEditor` 移入 Session；
- SaveGuard 变成 Session 内固定阶段；
- 文件监听和诊断绑定 session lifecycle；
- Tab 只持有 session 引用。

退出条件：A1、A3 通过；非活动 Tab 保存和窗口恢复有回归覆盖。

### M4：统一 Agent 和持久化入口

用户结果：Agent 对打开文档的修改实时可见且不会覆盖用户草稿；关闭文档通过同一受管写入保存。

工程任务：

- 引入 `DocumentCommandRouter` 和 targeted IPC；
- 移除 EditorToolModule 对 Markdown 原始 `writeFile` 的依赖；
- 定义打开 session 与 headless source session 行为；
- per-session 命令串行化和 generation 校验；
- Repository 统一 CAS、原子写入与资源组事务。

退出条件：A4、A5 通过；Agent 与用户并发矩阵全部有自动化和真实应用证据。

### M5：补齐保真、性能和可观测性

用户结果：行内格式不会因修改其他位置而丢失；重复保存不自冲突；大图片文档明确降级而不冻结。

工程任务：

- 往返签名覆盖全部承诺结构及嵌套关系；
- per-session save queue，只保留必要的最新保存请求；
- 图片大小、总量、并发和可见性预算；
- Blob/流式本地图片加载，避免 Base64 多份复制；
- 文档诊断记录 sessionId、状态、generation、命令、耗时和脱敏失败分类。

退出条件：A1、A7 通过；长文档和大资源达到明确性能预算。

### M6：综合真实验收与完成声明恢复

用户结果：A1-A7 在正式构建或等价真实应用中全部通过。

工程任务：

- `pnpm verify` 与受影响 smoke 全绿；
- 真实应用执行 A1-A7，并保存版本、平台和结果；
- 更新 `markdown-wysiwyg.md`、`document-editor.md` 和格式总览状态；
- 删除被新 Session/Router 取代的旧广播、组件 SaveGuard 和原始 Markdown 写入口。

退出条件：没有未关闭 P0/P1，真实验收和工程门禁同时通过。只有此时才能恢复“Markdown S 级
完成”声明。

## 实施策略

采用受控绞杀迁移，不做一次性重写：

1. 先用测试封闭 P0，保持现有 UI。
2. 在现有 EditorStore 外建立 DocumentSession facade，先接管一个普通 Markdown 的打开和保存。
3. 逐步迁移冲突、恢复、监听和 Agent 命令；每迁移一个入口就删除旧旁路。
4. `MarkdownEditor` 最终只保留 Tiptap adapter 和视图交互。
5. 迁移期禁止新代码继续直接调用 Markdown 原始 `writeFile` 或新增组件级 IPC listener。

如果迁移期同时长期保留旧广播和新 Router，两套生命周期会形成新的双 owner；每个批次必须
明确旧入口删除条件。

## 测试矩阵

| 领域       | 必测场景                                                                       |
| ---------- | ------------------------------------------------------------------------------ |
| 打开与水合 | 空文档、长文档、支持范围、范围外语法、解析异常、窗口恢复、快速切 Tab           |
| 保真       | 所有承诺块结构、所有行内标记、嵌套标记、只改一处、保存重开                     |
| 保存       | 未修改、单次保存、连续保存、保存中继续输入、失败、磁盘删除、权限失败           |
| 冲突       | dirty 外部修改、clean 自动重载、冲突后关闭、另存为、覆盖、删除、移动           |
| Agent      | 当前目标、非当前目标、无 session、dirty session、连续命令、旧 generation、超时 |
| 路由       | md/markdown、txt、json、ts/js、py、html、二进制、无扩展名                      |
| 资源组     | 图片导入、manifest、另存为、移动、失败回滚、孤立资源、大图片预算               |
| 生命周期   | 非活动 Tab、重复 Tab、关闭、工作空间切换、窗口重建、Agent 命令未完成时关闭     |

测试层级必须包括：

- 纯状态机和 contract 单元测试；
- Repository 文件系统集成测试；
- renderer Session 与 Tiptap adapter 集成测试；
- Agent Router 的跨进程测试；
- 真实 Electron 工作流 smoke；
- A1-A7 真人验收。

## 诊断要求

每个文档会话至少记录：

- 脱敏 sessionId、workspaceKey 和文件名；
- editor mode；
- 当前状态和 generation；
- base/draft/external hash，不记录全文；
- 命令 ID、来源（用户、Agent、文件监听、恢复）；
- 保存开始、结束、冲突和失败分类；
- 被丢弃的 stale response；
- 图片预算命中与降级原因。

诊断不得记录文档全文、凭证、Agent prompt 或图片 Base64。

## 非目标

本轮不顺带实现：

- 协同编辑或 Yjs；
- Markdown 方言的 WYSIWYG 全覆盖；
- Mermaid、数学公式或脚注的专用可视化编辑；
- Word 式分页和排版；
- 新的 AI 行内改写产品；
- 通用多格式 Document Framework。

源码安全模式解决“任何文本都能安全编辑”，不等于所有 Markdown 方言均获得 WYSIWYG 支持。

## 风险与止损

- 如果 M1 仍需要大规模重写才能封闭 P0，应先做最小精确目标检查和关闭结果检查，不得让
  P0 等待完整 Session 架构。
- 如果 DocumentSession 迁移超过 60 分钟仍未产生新的 A1-A7 可验收增量，停止横向抽象，
  回到单文档打开、编辑、保存纵向闭环。
- 如果同一路径同时出现旧 EditorStore owner 和新 Session owner，停止扩展并先删除一条写路径。
- 如果源码安全模式仍经过 Tiptap parse/serialize，它不是安全退路，不能验收。
- 如果 Agent Router 仍按当前 Tab 猜目标，M4 不得标记完成。
- 如果只有单元测试绿色而 A1-A7 未执行，只能报告工程准备度。

## 拷问与退出条件

- 谁拥有当前正文？答案必须是一个具体 DocumentSession，而不能是“Tiptap、Store 和磁盘视情况而定”。
- 谁可以写 `.md`？答案必须只有 MarkdownDocumentRepository，不能保留公开旁路。
- 组件卸载后能否保存、冲突和接收精确 Agent 命令？如果不能，生命周期仍未修复。
- `editor_save(B)` 在 A 活跃时如何证明不会读取 A？必须由 target contract 和 owner lookup 证明，
  不能依赖 UI 条件分支。
- 范围外 Markdown 用户下一步能做什么？如果只能复制诊断，产品闭环仍未成立。
- 快速保存、外部修改、Agent 写入和工作空间切换同时发生时，哪一个 generation 有效？如果
  状态机无法回答，不能宣称稳定。
- 是否还有任一测试或工具直接把 Markdown 传给原始 `writeFile`？只要存在，统一持久化边界
  就没有完成。
