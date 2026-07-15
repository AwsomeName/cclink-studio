# CCLink Studio 数据源系统 — 开发者实施计划

> 状态：🔧 分阶段落地中
> 关联方案：`docs/features/data-sources.md`
> 目标读者：负责落地数据源系统的前端、主进程、MCP、Agent 和测试开发者。

## 结论

数据源系统第一版只做一件事：**把远程 Elasticsearch 里的采集资料，以只读、可追溯、可授权的方式接入 CCLink Studio，并让查询结果可以挂载给 Agent 写作。**

不要把它做成数据库管理器。开发顺序必须先安全边界，再主进程能力，再 IPC，再 UI，再 Agent。任何阶段只要出现“Renderer 拿到明文凭证”“Agent 静默扫库”“查询结果无限塞上下文”，都要停下来修边界。

## 总体拆分

```text
D0 需求冻结与风险封口
D1 类型、错误码、目录骨架
D2 凭证存储与配置存储
D3 Elasticsearch 只读 Adapter
D4 DataSourceService 编排层
D5 IPC 与 Preload 白名单
D6 Renderer Store 与 Activity 入口
D7 查询 Tab 与结果视图
D8 Saved Queries 与工作空间恢复
D9 Agent 资源挂载
D10 MCP 只读工具
D11 字段归一化与引用链路
D12 真实 ES 验收与发布门槛
```

推荐开发顺序：

```text
D0 → D1 → D2 → D3 → D4 → D5 → D6 → D7 → D8 → D9 → D10 → D11 → D12
```

D9 和 D10 可以在 D7 稳定后并行，但 D10 不能早于 D4。UI 可以先用 mock service 做壳，但合并前必须接真实主进程 IPC。

## 当前实现进度

> 更新时间：2026-07-15

| 阶段 | 状态 | 说明 |
|------|------|------|
| D0 需求冻结与风险封口 | ✅ 完成 | 产品边界和安全边界已写入 `docs/features/data-sources.md` 与本文档 |
| D1 类型、错误码、目录骨架 | ✅ 完成 | 已新增共享类型、错误模型、adapter registry 和主进程目录 |
| D2 凭证存储与配置存储 | ✅ 完成 | 配置与凭证已分离；数据源凭证无明文 fallback |
| D3 Elasticsearch 只读 Adapter | ✅ 完成 | 已支持 test、list indices、search、get record，并拒绝危险 collection/path |
| D4 DataSourceService 编排层 | ✅ 完成 | 已统一 config、secret、adapter、audit 和错误归一化 |
| D5 IPC 与 Preload 白名单 | ✅ 完成 | 已注册 `data-source:*` IPC，并暴露 `window.deepink.dataSource` |
| D6 Renderer Store 与 Activity 入口 | ✅ 完成 | 已新增数据源 Activity、store、连接表单、连接测试和 index 列表 |
| D7 查询 Tab 与结果视图 | 🔧 部分完成 | 已能从 index 打开查询 Tab、运行 JSON DSL、展示结果和单条 JSON；已补齐错误复制、单条 JSON 复制、结果 JSON/CSV 导出；分页/虚拟滚动仍待补齐 |
| D8 Saved Queries 与工作空间恢复 | ✅ 完成 | 已实现 Saved Query 类型、主进程持久化、IPC、preload、store、侧栏列表和查询 Tab 保存/打开；工作空间恢复依赖现有 Tab 持久化链路 |
| D9 Agent 资源挂载 | ✅ 完成 | 已扩展数据源资源类型，支持 `@` 挂载 Data Source / Saved Query，并支持从查询 Tab 一键挂载查询结果和单条记录 |
| D10 MCP 只读工具 | 🔧 部分完成 | 已注册 DataSourceToolModule，提供 list/search/get/run saved query 等只读工具；sourceId 级首次授权与 Saved Query 单独授权仍待权限系统扩展 |
| D11 字段归一化与引用链路 | 🔧 部分完成 | 已有默认字段归一化；字段映射编辑 UI 和引用链路未完成 |
| D12 真实 ES 验收与发布门槛 | 📋 未开始 | 尚未接真实 ES 走查 |

## 全局原则

- 数据源第一版只读。
- 只有主进程访问远程数据库。
- Renderer 永远不接触明文凭证。
- 工作空间只保存非敏感配置、Saved Queries、字段映射和结果快照 metadata。
- Agent 默认不能读取未授权数据源。
- 所有查询都有超时、条数上限、字节上限和审计日志。
- 所有错误必须结构化，不能把底层堆栈或 secret 透出到 UI / MCP。
- 第一版只支持 Elasticsearch。PostgreSQL / MySQL / HTTP API 等后续通过 adapter 扩展。

## 数据契约

第一阶段不要过度抽象，但要把扩展点留出来：

```ts
type DataSourceType = 'elasticsearch'

type DataSourceScope = 'workspace' | 'global'

type DataSourceAuthType = 'apiKey' | 'basic' | 'bearer' | 'none'

type DataSourceConfig = {
  id: string
  type: DataSourceType
  scope: DataSourceScope
  name: string
  endpoint: string
  defaultCollection?: string
  authRef?: string
  readOnly: true
  timeoutMs: number
  maxRows: number
  fieldMapping?: FieldMapping
  createdAt: string
  updatedAt: string
}

type DataSourceSecret = {
  sourceId: string
  authType: DataSourceAuthType
  username?: string
  password?: string
  apiKey?: string
  token?: string
}

type DataCollection = {
  sourceId: string
  name: string
  kind: 'index'
  docsCount?: number
  health?: 'green' | 'yellow' | 'red' | 'unknown'
}

type NormalizedRecord = {
  id: string
  sourceId: string
  collection: string
  title?: string
  content?: string
  sourceUrl?: string
  author?: string
  publishedAt?: string
  collectedAt?: string
  updatedAt?: string
  tags?: string[]
  score?: number
  raw?: unknown
}

type DataQuerySnapshot = {
  id: string
  sourceId: string
  collection: string
  query: unknown
  executedAt: string
  total: number
  returned: number
  truncated: boolean
  records: NormalizedRecord[]
  nextCursor?: string
}
```

## D0：需求冻结与风险封口

### 目标

冻结第一版边界，避免开发过程中滑向数据库管理器、Kibana 替代品或 ETL 系统。

### 方案

- 确认第一版只支持 Elasticsearch。
- 确认所有操作只读。
- 确认数据源 Activity 是资料入口，敏感凭证管理仍走设置/连接表单。
- 确认 Agent 读取数据源必须经过授权。
- 确认真实验收使用一个只读 ES 账号或只读副本。

### 产物

- `docs/features/data-sources.md` 已定义产品边界。
- 本文档作为开发执行计划。
- 产品里程碑中 M10 指向该能力。

### 验收标准

- 团队能明确回答：第一版做什么、不做什么、凭证放哪里、Agent 怎么授权。
- 没有“顺手支持写入”“顺手支持 index 管理”“顺手做 SQL 编辑器”的任务进入第一版。
- 真实 ES 验收账号权限为只读。

### 拷问

如果现在还说“要不顺便做个管理后台”，这一步没过。第一版目标是让写作项目吃到远程采集资料，不是造数据库客户端。

## D1：类型、错误码、目录骨架

### 目标

先把类型、错误模型和目录结构立住，让后续主进程、IPC、UI、MCP 都围绕同一套契约开发。

### 方案

- 新建 `src/main/data-source/`。
- 新建 `src/main/data-source/types.ts`，放主进程内部类型。
- 新建 `src/shared/data-source.ts` 或复用现有 shared 类型目录，放 renderer/preload/MCP 共享类型。
- 新建 `src/main/data-source/errors.ts`，统一错误码。
- 新建 `src/main/data-source/adapters/adapter.ts`，定义 adapter 接口。
- 建立测试目录 `src/main/data-source/__tests__/`。

### 建议错误码

```text
DATA_SOURCE_NOT_FOUND
DATA_SOURCE_SECRET_MISSING
DATA_SOURCE_AUTH_FAILED
DATA_SOURCE_NETWORK_ERROR
DATA_SOURCE_TLS_ERROR
DATA_SOURCE_TIMEOUT
DATA_SOURCE_COLLECTION_NOT_FOUND
DATA_SOURCE_QUERY_INVALID
DATA_SOURCE_QUERY_REJECTED
DATA_SOURCE_RESULT_TOO_LARGE
DATA_SOURCE_ADAPTER_UNSUPPORTED
DATA_SOURCE_INTERNAL_ERROR
```

### 涉及文件

- `src/main/data-source/types.ts`
- `src/main/data-source/errors.ts`
- `src/main/data-source/adapters/adapter.ts`
- `src/shared/data-source.ts`

### 验收标准

- 类型能表达 config、secret、collection、query snapshot、normalized record、saved query。
- 错误码覆盖网络、认证、超时、查询非法、结果过大和凭证缺失。
- 后续模块不需要自己定义临时错误字符串。
- TypeScript 编译通过。

### 拷问

如果每个模块都开始自造 `DataSourceResult` 或 `EsError`，后面一定会乱。类型不是装饰，是系统边界。

## D2：凭证存储与配置存储

### 目标

实现数据源配置和凭证的分离：配置可持久化、可迁移，凭证只能留在本机安全存储。

### 方案

- 实现 `DataSourceConfigStore`。
- 实现 `DataSourceCredentialStore`。
- 配置文件只保存 `authRef`，不保存 password、token、apiKey。
- 优先复用现有 settings / sync credential 的加密存储模式。
- 如果使用 safeStorage 文件兜底，文件内容必须加密。
- 对外提供 create/update/delete/list/get。
- 删除数据源时同步删除对应 secret。

### 存储建议

```text
~/Library/Application Support/DeepInk/data-source/
├── connections.json
├── saved-queries.json
├── audit-log.jsonl
└── secrets.enc

macOS Keychain:
└── data-source:<sourceId>
```

### 涉及文件

- `src/main/data-source/config-store.ts`
- `src/main/data-source/credential-store.ts`
- `src/main/data-source/__tests__/credential-store.test.ts`
- `src/main/data-source/__tests__/config-store.test.ts`

### 验收标准

- 创建数据源后，配置文件中只有 `authRef`，没有明文 secret。
- 更新凭证不会改变 source id。
- 删除数据源会删除凭证引用。
- `rg "password|apiKey|token" ~/Library/Application Support/DeepInk/data-source` 不应搜到真实 secret。

说明：`Application Support/DeepInk` 是当前兼容保留的 Electron `userData` 目录，不随产品名机械替换。
- 单测覆盖 create/update/delete/list 和 secret 缺失。

### 拷问

如果配置文件复制到另一台机器后能直接连生产 ES，这就是安全事故，不是便利功能。

## D3：Elasticsearch 只读 Adapter

### 目标

封装 ES 访问能力，并在 adapter 层阻断写入类请求。

### 方案

- 实现 `ElasticsearchAdapter`。
- 支持 `test()`：请求根 endpoint 或 `_cluster/health`。
- 支持 `listCollections()`：读取 `_cat/indices?format=json` 或等价 API。
- 支持 `query()`：只允许 `_search`。
- 支持 `getRecord()`：读取 index + id。
- 所有请求使用主进程 fetch / undici，接入 AbortController 超时。
- 默认拒绝 `_bulk`、`_delete_by_query`、`_update_by_query`、`_reindex`、`_tasks` 写入或高风险路径。
- 默认拒绝非 GET / POST `_search` 路径。

### 查询限制

- 默认 `size <= 100`。
- 默认超时 `timeoutMs <= 10000`。
- 默认响应体字节上限，例如 2MB。
- `raw` 默认不返回完整，只保留需要的 `_source` 或归一化字段。

### 涉及文件

- `src/main/data-source/adapters/elasticsearch-adapter.ts`
- `src/main/data-source/adapters/elasticsearch-normalizer.ts`
- `src/main/data-source/__tests__/elasticsearch-adapter.test.ts`

### 验收标准

- 能用只读 ES 账号 test 成功。
- 认证失败返回 `DATA_SOURCE_AUTH_FAILED`。
- 网络失败返回 `DATA_SOURCE_NETWORK_ERROR`。
- 超时返回 `DATA_SOURCE_TIMEOUT`。
- index 不存在返回 `DATA_SOURCE_COLLECTION_NOT_FOUND`。
- 写入类路径被拒绝为 `DATA_SOURCE_QUERY_REJECTED`。
- 单测覆盖路径拒绝、size 限制、超时、错误归一化。

### 拷问

如果 adapter 暴露了“任意 HTTP 请求”能力，后面的 IPC 和 MCP 再怎么设计都挡不住越权。

## D4：DataSourceService 编排层

### 目标

把 config、secret、adapter、审计、错误归一化组合成主进程唯一入口。

### 方案

- 实现 `DataSourceService`。
- 构造时注入 config store、credential store、adapter registry、audit log。
- 所有外部调用都走 service，不让 IPC / MCP 直接调用 adapter。
- service 负责读取 secret、选择 adapter、套用默认 maxRows/timeout。
- service 负责生成 `DataQuerySnapshot`。
- service 负责写审计日志。
- service 负责把底层异常转成稳定错误。

### API 建议

```ts
class DataSourceService {
  listSources(): Promise<DataSourceConfig[]>
  createSource(input: CreateDataSourceInput): Promise<DataSourceConfig>
  updateSource(id: string, patch: UpdateDataSourceInput): Promise<DataSourceConfig>
  deleteSource(id: string): Promise<void>
  testConnection(id: string): Promise<ConnectionTestResult>
  listCollections(id: string): Promise<DataCollection[]>
  runQuery(input: RunDataQueryInput): Promise<DataQuerySnapshot>
  getRecord(input: GetRecordInput): Promise<NormalizedRecord>
}
```

### 涉及文件

- `src/main/data-source/data-source-service.ts`
- `src/main/data-source/audit-log.ts`
- `src/main/data-source/adapter-registry.ts`
- `src/main/data-source/__tests__/data-source-service.test.ts`

### 验收标准

- IPC 和 MCP 都只依赖 `DataSourceService`。
- 审计日志记录 sourceId、collection、caller、executedAt、total、returned、durationMs、errorCode。
- 审计日志不记录 secret 和完整查询结果。
- service 单测能用 fake adapter 覆盖成功、失败、超时、结果截断。

### 拷问

如果 UI、IPC、MCP 各自拼 adapter 调用，权限和审计会散掉。主进程必须有一个唯一门。

## D5：IPC 与 Preload 白名单

### 目标

让 Renderer 通过受控 IPC 使用数据源能力，同时不获得数据库凭证和任意代理能力。

### 方案

- 新建 `data-source-ipc.ts` 注册 IPC。
- 在 `main/index.ts` 装配。
- 在 `preload/index.ts` 暴露 `window.deepink.dataSource`。
- 在 `preload/index.d.ts` 补充类型。
- IPC 输入必须用 Zod schema 校验。
- IPC 层不接收任意 URL、method、headers。
- 对错误进行前端可显示的序列化。

### IPC 列表

```text
data-source:list
data-source:create
data-source:update
data-source:delete
data-source:test
data-source:list-collections
data-source:query
data-source:get-record
data-source:list-saved-queries
data-source:save-query
```

### 涉及文件

- `src/main/data-source/data-source-ipc.ts`
- `src/main/index.ts`
- `src/preload/index.ts`
- `src/preload/index.d.ts`
- `src/shared/ipc/index.ts` 或现有 IPC 共享入口

### 验收标准

- Renderer 能 list/create/test/query/getRecord。
- DevTools 里看不到 secret。
- 非法参数返回结构化错误，不 crash 主进程。
- Renderer 不能传 `headers.Authorization` 覆盖主进程凭证。
- 单测或集成测试覆盖非法参数和错误序列化。

### 拷问

如果 IPC 变成“帮前端 fetch 任何 URL”，就是重新打开 SSRF 和凭证泄漏的大门。

## D6：Renderer Store 与 Activity 入口

### 目标

把数据源作为 Activity Bar 的资料入口接入 UI 状态，不急着做完整查询体验。

### 方案

- 增加 Activity Bar `data-sources` view。
- 新建 `data-source-store`。
- store 负责 sources、collections、saved queries、recent queries、active snapshot。
- `DataSourcesPanel` 第一版先展示连接列表、index 列表、错误状态、loading 状态。
- 新增“添加数据源”入口，打开连接表单。
- 表单提交走 IPC create + test。

### 涉及文件

- `src/renderer/src/stores/data-source-store.ts`
- `src/renderer/src/components/activity-bar/ActivityBar.tsx`
- `src/renderer/src/components/sidebar/Sidebar.tsx`
- `src/renderer/src/components/data-sources/DataSourcesPanel.tsx`
- `src/renderer/src/components/data-sources/DataSourceConnectionForm.tsx`
- `src/renderer/src/assets/main.css`

### 验收标准

- Activity Bar 出现数据源图标。
- 点击后侧栏切到数据源视图。
- 能展示空状态、loading、错误、连接列表。
- 能添加 ES 连接并触发 test。
- 连接失败能显示可读错误，不吞掉错误。
- 不出现大卡片套小卡片，不破坏 VSCode 风格密度。

### 拷问

如果这一步 UI 做成“营销页”或“数据库控制台”，方向就偏了。它应该是左侧资料浏览入口。

## D7：查询 Tab 与结果视图

### 目标

用户能打开查询 Tab、执行查询、查看结果表格和 JSON 详情。

### 方案

- 扩展 Tab 类型：`data-source-query`、`data-source-result`。
- 新建 `DataSourceQueryTab`。
- 查询编辑器先用 textarea 或现有代码编辑控件，后续再升级 Monaco。
- 查询运行走 `deepink.dataSource.runQuery`。
- 新建结果表格，默认展示 title/content/sourceUrl/collectedAt/score。
- 单条记录点击打开详情 drawer。
- 结果过多时分页或虚拟滚动。
- 支持复制 JSON 和导出 JSON/CSV。

### 涉及文件

- `src/renderer/src/types/index.ts`
- `src/renderer/src/components/workbench/Workbench.tsx`
- `src/renderer/src/components/data-sources/DataSourceQueryTab.tsx`
- `src/renderer/src/components/data-sources/DataSourceResultTable.tsx`
- `src/renderer/src/components/data-sources/DataSourceRecordDrawer.tsx`
- `src/renderer/src/components/data-sources/data-source-export.ts`

### 验收标准

- 从侧栏 index 打开查询 Tab。
- 默认查询可以执行，例如 match_all + size 20。
- 查询成功后展示表格、总数、返回数、执行时间。
- 点击行能查看 JSON 详情。
- 查询失败显示错误码、说明和复制按钮。
- 结果 100 条以内不卡顿；更大结果明确分页或截断。
- 深色/浅色主题、窄侧栏、窄主区下无文字重叠。

### 拷问

如果用户看到的是一坨 `_source` JSON，而不是能用于写作的资料列表，这一步只完成了一半。

## D8：Saved Queries 与工作空间恢复

### 目标

让常用查询成为工作空间的一部分，重启后可以继续使用。

### 方案

- 实现 Saved Query 存储。
- Saved Query 包含 name、sourceId、collection、query、fieldMapping、maxRows。
- 查询 Tab 可保存为 Saved Query。
- 数据源侧栏展示 Saved Queries。
- 工作空间快照保存打开的查询 Tab、最近查询、结果快照 metadata。
- 凭证缺失时显示“需要重新授权”，不阻断工作空间打开。

### 涉及文件

- `src/main/data-source/saved-query-store.ts`
- `src/main/data-source/data-source-service.ts`
- `src/renderer/src/stores/data-source-store.ts`
- `src/renderer/src/components/data-sources/DataSourcesPanel.tsx`
- 工作空间状态相关 store / snapshot 文件

### 验收标准

- 查询可保存为 Saved Query。
- 重启后 Saved Query 仍在。
- 重启后打开的查询 Tab 可恢复。
- 导出/复制工作空间配置不包含 secret。
- 换机器后能看到连接配置和 Saved Query，但需要重新输入凭证。

### 拷问

如果“工作空间可恢复”和“凭证不随项目走”冲突，优先保护凭证。恢复体验不能压过安全底线。

## D9：Agent 资源挂载

### 目标

让数据源、Saved Query、查询结果和单条记录成为 Agent 可见的 context chip。

### 方案

- 扩展资源类型：`data-source`、`data-query`、`data-record`、`saved-query`。
- `@` 资源选择器搜索数据源资源。
- 查询结果页提供“挂载给 Agent”按钮。
- 会话顶部 context chips 展示数据源资源。
- 挂载查询结果时不注入完整 raw，只注入摘要和分页引用。
- Agent 需要更多记录时走 MCP 工具或 explicit read。

### Context 摘要建议

```text
Data query result:
- source: 文章素材 ES
- collection: articles-*
- executedAt: 2026-07-15T...
- total: 1280
- returned: 50
- records: normalized preview only
```

### 涉及文件

- Agent 资源模型相关类型文件
- `src/renderer/src/components/agent-panel/*`
- `src/renderer/src/stores/agent-store.ts`
- `src/renderer/src/components/data-sources/DataSourceQueryTab.tsx`
- `src/renderer/src/components/data-sources/DataSourceResultTable.tsx`

### 验收标准

- 查询结果可以一键挂载给当前 Agent 会话。
- Agent 输入区顶部能看到 context chip。
- Agent 总结时能引用 sourceId、collection、recordId、sourceUrl、collectedAt/publishedAt。
- 未挂载的数据源不会被自动注入。
- 大结果不会一次性塞进上下文。

### 拷问

如果 Agent 写出的文章无法追溯来源，这不是 AI 写作能力，是幻觉包装。

## D10：MCP 只读工具

### 目标

让 Agent 在用户授权下主动搜索和读取远程数据源。

### 方案

- 新建 `src/main/mcp/modules/data-source/`。
- 注册 `DataSourceToolModule`。
- 工具全部调用 `DataSourceService`。
- 工具全部只读。
- 接入权限系统。
- 权限粒度至少到 sourceId，Saved Query 可以单独授权。
- 工具响应默认不返回完整 raw。
- 工具响应支持 cursor / limit。

### 工具列表

```text
data_source.list_sources
data_source.list_collections
data_source.search
data_source.get_record
data_source.run_saved_query
```

### 涉及文件

- `src/main/mcp/modules/data-source/index.ts`
- `src/main/mcp/modules/data-source/tools.ts`
- `src/main/mcp/tool-host.ts` 或模块注册入口
- `src/main/mcp/permission.ts`
- `src/main/mcp/modules/data-source/__tests__/data-source-tools.test.ts`

### 验收标准

- Claude Code 能看到数据源工具。
- `list_sources` 不泄漏 endpoint secret。
- `search` 首次读取 source 需要确认。
- strict 模式每次读取都确认。
- 工具返回记录数默认不超过 20。
- 工具错误结构化，不暴露堆栈和 secret。
- 工具调用进入审计日志。

### 拷问

如果 Agent 能在用户无感知的情况下遍历所有 index，这个功能应该立刻回滚。

## D11：字段归一化与引用链路

### 目标

把 ES 原始 hit 转成适合写作、摘要和引用的资料对象。

### 方案

- 实现 `FieldMapping`。
- 默认候选字段：
  - title: `title`, `name`, `headline`
  - content: `content`, `text`, `body`, `summary`
  - sourceUrl: `url`, `sourceUrl`, `link`
  - publishedAt: `publishedAt`, `publishTime`, `date`
  - collectedAt: `collectedAt`, `createdAt`, `crawlTime`
- UI 允许为 source/index 调整字段映射。
- Saved Query 可以绑定字段映射。
- 记录详情显示 normalized 和 raw 两个 Tab。
- Agent 默认消费 normalized。

### 涉及文件

- `src/main/data-source/normalization.ts`
- `src/main/data-source/adapters/elasticsearch-normalizer.ts`
- `src/renderer/src/components/data-sources/FieldMappingEditor.tsx`
- `src/renderer/src/components/data-sources/DataSourceRecordDrawer.tsx`

### 验收标准

- 常见采集数据能自动显示标题、正文、来源、时间。
- 字段缺失时 UI 明确显示“未映射”，不伪造内容。
- 用户能修改字段映射并保存。
- Agent 输出能带引用字段。
- 单测覆盖字段候选、嵌套路径、缺失字段、数组字段。

### 拷问

如果每次写文章前都要人工解释字段含义，CCLink Studio 没有降低工作成本。

## D12：真实 ES 验收与发布门槛

### 目标

用真实远程数据采集项目跑通完整闭环，确认功能可用且不越权。

### 方案

- 准备只读 ES 账号或只读副本。
- 准备至少一个真实 index。
- 准备一条 Saved Query。
- 跑通：
  1. 创建连接
  2. 测试连接
  3. 列出 index
  4. 打开查询 Tab
  5. 执行查询
  6. 查看记录详情
  7. 保存 Saved Query
  8. 挂载给 Agent
  9. Agent 总结
  10. Agent 通过 MCP 追加读取单条记录
  11. 重启恢复
  12. 检查日志和配置无 secret

### 验收标准

- 全链路在真实 ES 上通过。
- 无明文 secret 泄漏。
- Agent 读取有确认和审计。
- 查询结果有来源追溯。
- UI 在宽/窄窗口、深色/浅色主题下可用。
- 失败路径至少覆盖认证失败、网络失败、查询错误、结果过大。
- `pnpm test -- --run` 通过。
- `pnpm build` 通过。
- `git diff --check` 通过。

### 拷问

如果只在 mock 数据上好看，真实 ES 一接就卡住、泄漏或不可追溯，这个功能不能发。MVP 也必须过真实链路。

## 测试矩阵

| 层级 | 必测内容 |
|------|----------|
| Unit | config store、credential store、adapter path guard、normalization、error mapping |
| IPC | schema 校验、错误序列化、缺失凭证、超时、结果过大 |
| Renderer | store 状态、空状态、错误态、查询结果表格、字段映射 |
| MCP | 权限、响应大小、只读工具、错误结构 |
| E2E | 创建连接、查询、保存、挂载 Agent、重启恢复 |
| Security | secret 不进配置、日志、快照、MCP 响应、DevTools 可见状态 |

## 代码评审清单

- [ ] 是否有任何 secret 写入明文文件？
- [ ] Renderer 是否能触碰 Authorization / token / password？
- [ ] IPC 是否允许任意 URL / method / headers？
- [ ] ES adapter 是否只允许只读路径？
- [ ] 查询是否有 timeout、maxRows、byteLimit？
- [ ] Agent 工具是否接入权限系统？
- [ ] MCP 响应是否限制 raw 和记录数量？
- [ ] 审计日志是否记录了 caller / sourceId / duration / result count？
- [ ] 错误是否结构化且不暴露堆栈？
- [ ] UI 是否能处理空、加载、失败、截断和凭证缺失？

## 发布前必须回答的问题

1. 真实 ES 是公网、VPN、内网还是只能远端机器访问？
2. 是否有只读账号或只读副本？
3. index 命名是否稳定？
4. 主要写作字段是哪些？
5. 写文章必须保留哪些引用字段？
6. 查询快照保存完整记录还是只保存 metadata？
7. Agent “始终允许读取某数据源”的权限是否可撤销？

## 最后一刀

这个功能真正的价值不是“CCLink Studio 能连数据库”，而是“用户写文章时，远程采集数据可以被可信、可追溯、可授权地使用”。任何不能服务这句话的功能，都先不要做。
