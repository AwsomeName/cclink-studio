# CCLink Studio 数据源系统 — Database / ES 接入计划

> 状态：📋 规划中
> 优先级：P0/P1
> 目标：让本地 CCLink Studio 工作空间可以把远程数据库、搜索索引和数据采集项目作为可浏览、可查询、可挂载给 Agent 的资料来源。
> 开发者实施计划：`docs/features/data-sources-development-plan.md`

## 结论

CCLink Studio 应新增 **数据源（Data Sources）** 能力：左侧 Activity Bar 增加数据库图标，侧栏展示连接、索引和 Saved Queries，主工作区用专门的 Tab 承载查询编辑器和结果视图，右侧 Agent 可以把数据源、查询结果或单条记录作为上下文资源挂载。

第一版只做：

```text
连接远程 Elasticsearch
→ 浏览 index
→ 执行只读查询
→ 查看表格/JSON 结果
→ 把查询结果挂载给 Agent
→ Agent 通过只读 MCP 工具搜索和读取
```

第一版不做数据库管理器，不替代 Kibana，不提供写入、删除、索引管理、mapping 编辑或 ETL 编排。

开发落地以 `docs/features/data-sources-development-plan.md` 为准：该文档按 D0-D12 拆分目标、方案、涉及文件、验收标准、测试矩阵和代码评审清单。

## 产品定位

数据源不是“开发者数据库客户端”，而是 CCLink Studio 的资料入口。

典型场景：

- 远程数据采集项目每天写入 Elasticsearch，本地写作项目需要搜索和引用这些数据。
- 用户在 CCLink Studio 中打开文章草稿，用数据源查询最新素材，挂载结果给 Agent 写文章。
- Agent 在用户授权下调用只读工具，检索资料、读取详情、生成引用和草稿。

与其他模块的关系：

| 模块 | 关系 |
|------|------|
| 工作空间 | 数据源配置可归属当前工作空间，查询 Tab 和 Saved Queries 随工作空间恢复 |
| Agent | 数据源、查询结果、记录可通过 `@` 挂载，也可通过 MCP 工具读取 |
| 设置页 | 管理全局数据源、安全策略、凭证状态和默认超时 |
| Activity Bar | 数据源作为内容入口展示，不把连接配置细节塞进工作空间侧栏 |
| 官方同步 / overlay | OSS 默认不内置云同步；若商业 overlay 同步数据源配置，只能同步非敏感配置，不能同步明文凭证 |

## Activity Bar 与信息架构

数据源进入 Activity Bar 是合理的，但边界必须清楚：

```text
Activity Bar
├─ 工作空间
├─ 搜索
├─ 浏览器
├─ 数据源
└─ 设置
```

数据源 Activity 的职责：

```text
数据源侧栏
├─ 当前工作空间数据源
│  ├─ 采集 ES
│  │  ├─ index: articles-*
│  │  ├─ index: sources-*
│  │  └─ Saved Queries
│  └─ 其他只读数据源
├─ 最近查询
└─ 添加数据源
```

主工作区 Tab：

```text
Data Source Query Tab
├─ 连接选择
├─ Index / Collection 选择
├─ 查询编辑器
├─ 运行按钮
├─ 结果表格
├─ JSON 详情
├─ 导出
└─ 挂载给 Agent
```

Agent Panel：

```text
已挂载资源
├─ 数据源：采集 ES / articles-*
├─ 查询结果：最近 24 小时 AI 文章素材，50 条
└─ 记录：source_doc_123
```

## 范围边界

### 第一版范围

- Elasticsearch 只读连接。
- 连接配置管理：名称、类型、endpoint、默认 index、查询超时、结果上限。
- 凭证加密存储，不把密码/API Key 明文写入项目文件。
- 浏览 index 列表和基础 metadata。
- 执行只读 DSL 查询。
- 查询结果表格、JSON 详情、分页。
- Saved Queries：保存查询模板和默认参数。
- 查询结果作为 Agent context chip。
- MCP 工具：列表、搜索、读取记录、读取 saved query。
- 审计日志：记录查询时间、数据源、index、结果数量和调用方。

### 明确不做

- 不做写入、删除、更新、bulk API。
- 不做 index 创建、mapping 修改、settings 修改。
- 不做 ES 集群管理、节点监控、分片管理。
- 不把几万条结果一次性塞进 Agent 上下文。
- 不把生产数据库凭证提交进工作空间文件。
- 不默认让 Agent 自动读取所有数据库内容。

## 数据模型

工作空间内只保存非敏感配置：

```json
{
  "version": 1,
  "sources": [
    {
      "id": "ds_articles_es",
      "type": "elasticsearch",
      "scope": "workspace",
      "name": "文章素材 ES",
      "endpoint": "https://es.example.com",
      "defaultIndex": "articles-*",
      "authRef": "keychain:ds_articles_es",
      "readOnly": true,
      "timeoutMs": 10000,
      "maxRows": 100,
      "createdAt": "2026-07-15T00:00:00.000Z",
      "updatedAt": "2026-07-15T00:00:00.000Z"
    }
  ]
}
```

凭证进入本机加密存储：

```ts
type DataSourceSecret = {
  sourceId: string
  authType: 'apiKey' | 'basic' | 'bearer'
  username?: string
  password?: string
  apiKey?: string
  token?: string
}
```

查询结果快照：

```ts
type DataQuerySnapshot = {
  id: string
  sourceId: string
  index: string
  query: unknown
  executedAt: string
  total: number
  returned: number
  records: NormalizedRecord[]
  rawSample?: unknown
}
```

Agent 消费的统一记录：

```ts
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
  raw: unknown
}
```

字段归一化第一版可以通过配置完成：

```ts
type FieldMapping = {
  title?: string[]
  content?: string[]
  sourceUrl?: string[]
  publishedAt?: string[]
  collectedAt?: string[]
  tags?: string[]
}
```

## 安全原则

1. Renderer 不直接连接数据库，也不接触明文凭证。
2. 所有数据库访问都通过主进程 IPC。
3. 主进程读取凭证、执行查询、做超时和结果上限控制。
4. Agent 只能调用只读数据源工具。
5. 默认每次新数据源需要用户显式授权后才可被 Agent 使用。
6. 查询日志默认记录 metadata，不记录完整敏感结果。
7. 工作空间配置可导出，凭证不可随配置导出。
8. 生产 ES 推荐使用只读账号或只读副本。

## IPC 设计

```ts
type DataSourceIpc = {
  listSources(): Promise<DataSourceConfig[]>
  createSource(input: CreateDataSourceInput): Promise<DataSourceConfig>
  updateSource(id: string, patch: UpdateDataSourceInput): Promise<DataSourceConfig>
  deleteSource(id: string): Promise<void>
  testConnection(id: string): Promise<ConnectionTestResult>
  listCollections(id: string): Promise<DataCollection[]>
  runQuery(input: RunDataQueryInput): Promise<DataQuerySnapshot>
  getRecord(input: GetRecordInput): Promise<NormalizedRecord>
  listSavedQueries(sourceId?: string): Promise<SavedQuery[]>
  saveQuery(input: SaveQueryInput): Promise<SavedQuery>
}
```

IPC 命名：

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

## MCP 工具设计

第一版工具全部只读：

```text
data_source.list_sources
data_source.list_collections
data_source.search
data_source.get_record
data_source.run_saved_query
```

权限分类：

| 工具 | 默认权限 | 说明 |
|------|----------|------|
| `data_source.list_sources` | auto/categorized 可自动 | 只返回连接名称和 metadata |
| `data_source.list_collections` | categorized 可自动 | 只读 metadata |
| `data_source.search` | 首次确认，之后可按 source 记住 | 可能读取用户数据 |
| `data_source.get_record` | 首次确认，之后可按 source 记住 | 读取单条数据 |
| `data_source.run_saved_query` | 首次确认，之后可按 query 记住 | 读取查询结果 |

工具返回必须限制大小：

- 默认最多 20 条记录。
- 每条记录默认返回归一化字段，`raw` 仅在明确请求时返回。
- 超过 token 或字节上限时返回摘要和分页 cursor。

## 里程碑计划

### M0：产品边界和文档定稿

目标：确认数据源是 CCLink Studio 资料入口，而不是数据库管理器。

方案：

- 更新架构文档，把 Data Sources 放入 Activity Bar 和主进程模块。
- 明确第一版只支持 Elasticsearch 只读。
- 明确凭证存储、安全边界和 Agent 权限。
- 明确查询结果可以作为 Tab 资源和 Agent context chip。

验收标准：

- 文档能回答“数据源属于 Activity Bar、Settings、Workbench Tab、Agent 的哪一层”。
- 文档明确不做写操作、不做数据库管理。
- 开发者可以根据本文档拆分任务，不需要再反复确认范围。

拷问：

如果团队还在讨论“要不要做 Kibana 功能”，说明边界没有定住。第一版只服务写作和资料检索。

### M1：主进程数据源核心

目标：主进程具备安全读取 ES 的最小能力。

方案：

- 新建 `src/main/data-source/`。
- 实现 `DataSourceService`：管理配置、测试连接、查询、记录读取。
- 实现 `DataSourceCredentialStore`：复用 safeStorage / Keychain 保存凭证。
- 实现 `ElasticsearchAdapter`：封装 ES 请求、超时、错误归一化。
- 实现 `DataSourceAuditLog`：记录查询 metadata。
- 新增单元测试覆盖配置读写、凭证引用、只读限制和错误归一化。

验收标准：

- 能创建一个 ES 连接并测试成功/失败。
- 明文凭证不出现在工作空间配置文件、settings.json 或日志中。
- 查询超时、认证失败、网络失败、index 不存在都有稳定错误码。
- 查询请求拒绝 `_bulk`、`_delete_by_query`、`PUT`、`POST` 写入类路径。
- `pnpm test -- --run` 通过。

拷问：

如果 Renderer 能拿到 token，或者日志里能搜到密码，这一阶段就是失败。安全边界比 UI 更优先。

### M2：IPC 与 Preload API

目标：Renderer 可以通过白名单 IPC 使用数据源能力。

方案：

- 新建 `src/main/data-source/data-source-ipc.ts`。
- 在 `src/main/index.ts` 注册 IPC。
- 在 `src/preload/index.ts` 暴露 `window.deepink.dataSource`。
- 在 `src/preload/index.d.ts` 补齐类型。
- 所有输入用 Zod schema 校验。

验收标准：

- Renderer 只能调用白名单方法，不能传任意 URL 或任意 fetch 参数绕过 adapter。
- 查询默认 `maxRows <= 100`，可配置但有全局上限。
- Preload 类型能被 renderer TypeScript 正确推导。
- IPC 测试覆盖非法参数、缺失凭证、超时和取消。

拷问：

如果 IPC 设计成“前端传完整 HTTP 请求，主进程代发”，那等于把安全边界打穿了。

### M3：Renderer 数据源侧栏与 Tab

目标：用户能在 CCLink Studio 中看到数据源、打开查询 Tab、查看结果。

方案：

- Activity Bar 增加 `data-sources` 类型和数据库图标。
- 新建 `data-source-store`：连接列表、collections、当前查询、结果快照、loading/error。
- 新建 `DataSourcesPanel`：连接树、index 列表、Saved Queries、最近查询。
- 新建 `DataSourceQueryTab`：查询编辑器、运行按钮、表格结果、JSON 详情。
- Tab 类型增加 `data-source-query` 和 `data-source-result`。
- 查询结果支持分页、复制 JSON、导出 JSON/CSV。

验收标准：

- Activity Bar 可以进入数据源侧栏。
- 用户能新增/选择 ES 连接，列出 index，打开查询 Tab。
- 执行查询后能查看表格和单条 JSON。
- 查询错误不会让 Tab 崩溃，错误信息可复制。
- 结果数量大时 UI 不冻结，列表使用分页或虚拟滚动。
- 深色/浅色主题下文字不重叠，宽度调整后仍可用。

拷问：

如果第一版 UI 做得像数据库控制台，就偏了。它应该像“资料浏览器”，查询是手段，不是产品核心。

### M4：Saved Queries 与工作空间持久化

目标：常用查询可以沉淀在工作空间里，并随工作现场恢复。

方案：

- 在工作空间下保存 `.deepink/data-sources.json` 或等价 workspace state。
- 保存 Saved Queries：名称、sourceId、index、query、fieldMapping、默认 maxRows。
- 保存最近查询和打开的 Data Source Tab 状态。
- 支持导入/导出非敏感数据源配置。
- 凭证缺失时提示重新输入，不阻断工作空间打开。

验收标准：

- 重启后数据源连接、Saved Queries、最近打开查询 Tab 可恢复。
- 导出的配置不含密码、token、apiKey。
- 复制工作空间到另一台机器后，能看到连接配置但需要重新授权凭证。
- Saved Query 可以一键运行并生成新的结果快照。

拷问：

如果换机器后配置文件直接能访问生产 ES，说明凭证模型错了。

### M5：Agent 资源挂载

目标：数据源结果成为 Agent 可见、可追溯、可控的资源。

方案：

- `@` 资源选择器支持搜索数据源、Saved Query、查询结果和记录。
- 会话顶部 context chips 展示数据源资源。
- 实现 `DataQuerySnapshot` 摘要注入：查询语句、执行时间、总数、样本记录。
- Agent 读取大结果时通过分页 cursor 或二次工具调用获取。
- 文章生成时保留 `sourceUrl`、`collectedAt`、`publishedAt` 等引用字段。

验收标准：

- 用户能把当前查询结果挂载给 Agent。
- Agent 能基于挂载结果总结、写文章、列引用。
- Agent 不会自动读取未挂载的数据源，除非用户授权工具调用。
- 大结果不会一次性注入导致上下文爆炸。
- 生成内容能追溯到查询快照和记录 id。

拷问：

如果 Agent 写出的文章没有来源、时间和记录 id，这个功能只是“看起来接了数据”，没有形成可信写作链路。

### M6：MCP 数据源工具

目标：Agent 可以在用户许可下主动搜索和读取远程数据。

方案：

- 新建 `src/main/mcp/modules/data-source/`。
- 注册只读工具：`list_sources`、`list_collections`、`search`、`get_record`、`run_saved_query`。
- 接入权限系统：按 source/query 维度记住授权。
- 工具返回归一化字段，默认不返回完整 raw。
- 工具调用写入审计日志，并在 Agent 面板显示查询摘要。

验收标准：

- Claude Code / CCLink Studio Agent 能看到数据源 MCP 工具。
- categorized 模式下，首次读取某数据源需要确认。
- strict 模式下，每次工具调用都需要确认。
- Agent 查询错误返回结构化错误，不把堆栈直接暴露给用户。
- 工具响应有大小限制和分页能力。

拷问：

如果 Agent 能静默扫描所有 index，这个功能就越权了。数据源对 Agent 必须默认最小授权。

### M7：查询质量与字段归一化

目标：把 ES 原始数据变成适合写作和分析的资料对象。

方案：

- 为每个 source/index 配置 `FieldMapping`。
- 支持 title/content/sourceUrl/time/tags 的候选字段自动探测。
- 查询结果表格默认展示归一化字段。
- 增加记录预览：正文、来源、时间、标签、raw JSON 切换。
- Saved Query 可以绑定字段映射。

验收标准：

- 常见采集数据不需要每次手动翻 raw JSON。
- Agent 拿到的是 `NormalizedRecord`，不是一坨不可读 ES hit。
- 字段缺失时显示清楚，不生成假的标题或时间。
- 字段映射错误可在 UI 中调整并保存。

拷问：

如果用户每次都要自己解释 `_source.xxx.yyy` 是正文，说明 CCLink Studio 没有真正降低使用成本。

### M8：扩展数据源类型

目标：在 ES 跑通后，按真实需求扩展更多只读数据源。

方案：

- 抽象 `DataSourceAdapter`：

```ts
interface DataSourceAdapter {
  type: string
  test(config: DataSourceConfig, secret: DataSourceSecret): Promise<ConnectionTestResult>
  listCollections(config: DataSourceConfig, secret: DataSourceSecret): Promise<DataCollection[]>
  query(input: AdapterQueryInput): Promise<DataQuerySnapshot>
  getRecord(input: AdapterGetRecordInput): Promise<NormalizedRecord>
}
```

- 优先级候选：PostgreSQL、MySQL、SQLite、HTTP JSON API。
- 所有 adapter 默认只读，写能力另开设计。

验收标准：

- 新增 adapter 不需要改 Renderer 主流程。
- 不同数据源都能返回统一 `NormalizedRecord`。
- 权限、审计、凭证、安全限制复用同一套机制。

拷问：

不要为了“支持很多数据库”牺牲第一版质量。真实写作链路跑通前，扩展类型都是次要的。

## 开发任务拆分

建议目录：

```text
src/main/data-source/
├── data-source-service.ts
├── data-source-ipc.ts
├── credential-store.ts
├── audit-log.ts
├── types.ts
├── adapters/
│   ├── adapter.ts
│   └── elasticsearch-adapter.ts
└── __tests__/

src/main/mcp/modules/data-source/
├── index.ts
└── tools.ts

src/renderer/src/stores/
└── data-source-store.ts

src/renderer/src/components/data-sources/
├── DataSourcesPanel.tsx
├── DataSourceQueryTab.tsx
├── DataSourceResultTable.tsx
├── DataSourceRecordDrawer.tsx
└── DataSourceConnectionForm.tsx
```

核心文件改动：

| 文件 | 改动 |
|------|------|
| `src/main/index.ts` | 注册 DataSourceService、IPC、MCP module |
| `src/preload/index.ts` | 暴露 `deepink.dataSource` |
| `src/preload/index.d.ts` | 补充 DataSource API 类型 |
| `src/renderer/src/types/index.ts` | 增加 Data Source Tab 类型 |
| `src/renderer/src/stores/ui-store.ts` | 增加 Activity Bar data-sources 状态 |
| `src/renderer/src/components/activity-bar/ActivityBar.tsx` | 增加数据库图标入口 |
| `src/renderer/src/components/sidebar/Sidebar.tsx` | 渲染 DataSourcesPanel |
| `src/renderer/src/components/workbench/Workbench.tsx` | 渲染数据源查询/结果 Tab |
| `src/main/mcp/tool-host.ts` | 注册数据源工具模块 |

## 失败路径与处理

| 失败 | 用户可见处理 | 工程处理 |
|------|--------------|----------|
| 网络不可达 | 显示连接失败和 endpoint | `DATA_SOURCE_NETWORK_ERROR` |
| 凭证错误 | 提示重新输入凭证 | 不记录 secret，清理缓存 |
| TLS 证书错误 | 提示证书不可信 | 默认拒绝，后续可做显式信任 |
| 查询超时 | 显示超时和建议缩小范围 | AbortController / timeout |
| index 不存在 | 提示 index 缺失 | `DATA_SOURCE_COLLECTION_NOT_FOUND` |
| 结果过大 | 提示已截断，可分页 | maxRows / byteLimit |
| 字段映射失败 | 显示 raw JSON 和配置入口 | fallback raw preview |
| Agent 越权 | 请求用户确认 | permission manager |

## 质量门槛

- 所有数据源访问必须有结构化错误。
- 所有凭证相关测试必须证明配置和日志不含 secret。
- 查询和工具调用必须有结果大小上限。
- Renderer 不能直接 import ES client 或发数据库请求。
- Agent 工具必须接入权限系统。
- 至少用一个真实 ES 测试连接、查询、挂载、Agent 总结全链路。

## 后续问题

- 是否需要支持 SSH tunnel / VPN 场景？
- ES 是公网、内网还是只允许远端机器访问？
- 是否存在只读副本，还是只能连接生产集群？
- 数据采集项目的 index 命名是否稳定？
- 写文章是否必须自动生成引用格式？
- 查询结果快照要不要保存到工作空间文件，还是只保存 metadata？
