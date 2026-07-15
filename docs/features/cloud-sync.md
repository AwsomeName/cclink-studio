# Historical: 云文件同步方案

> 当前状态：历史/商业能力材料，不属于 CCLink Studio OSS 默认能力。
>
> 开源 Studio 当前不内置 WebDAV 云同步、官方云存储、账号绑定或同步凭证管理。若后续恢复云同步，应通过 `cclink-dev/commercial` 或明确的插件/overlay 注入，不应把依赖和默认入口重新放回 OSS 壳。

# 云文件同步方案

> 状态：📋 方案设计中
> 最后更新：2026-06-04

## 一、目标

让 DeepInk 用户可以**将自己的文件同步到云端**，实现：

1. **云端保存**：编辑的文档自动/手动保存到用户自己的云盘
2. **工作区同步**：选择云盘文件夹作为工作区，拉取到本地，编辑后同步回去
3. **多端访问**：在其他设备上通过同一云盘账号访问文件

**核心原则：零运维、零基础设施成本** — DeepInk 不自建存储，用户接入自己的云盘。

---

## 二、调研结论

### 2.1 国内云盘 WebDAV 支持现状

| 云盘 | 原生 WebDAV | REST API | 备注 |
|------|:-----------:|:--------:|------|
| **坚果云** | ✅ | ❌ | 国内唯一原生 WebDAV 的公共云盘，但有坑（见下） |
| 阿里云盘 | ❌ | ⚠️ 内测 | API 仍在内测，第三方下载限速 ~500kbps |
| 百度网盘 | ❌ | ✅ | 不考虑 |
| 夸克网盘 | ❌ | ❌ | 无公开 API |
| 天翼云盘 | ❌ | ❌ | 无公开 API |
| 中国移动云盘 | ❌ | ❌ | 无公开 API |
| 腾讯微云 | ❌ | ❌ | 无公开 API |

**结论：国内公共云盘中，只有坚果云原生支持 WebDAV。**

其他云盘（阿里、夸克、天翼等）需要通过 AList 等中间件转接 WebDAV，增加了一层复杂度。

### 2.2 坚果云 WebDAV 深度评估

#### ✅ 优势

- 国内唯一原生 WebDAV 公共云盘，速度好，不限速
- 应用专用密码机制安全，不需要暴露账户密码
- OAuth 流程都不需要，接入极其简单
- 生态验证：Zotero、Obsidian、Joplin、Koodo Reader 等均支持

#### ⚠️ 限制与坑（重要）

| 问题 | 影响 | 严重程度 |
|------|------|:--------:|
| **PROPFIND 单次最多返回 750 个文件** | 大目录必须分页，否则**静默丢失文件** | 🔴 严重 |
| **OPTIONS 请求返回 501** | 无法用标准方式检测服务器能力 | 🟡 中等 |
| **不支持 LOCK/UNLOCK** | 无法通过 WebDAV 协议做文件锁 | 🟡 中等 |
| **PROPPATCH 支持受限** | 无法修改文件自定义属性 | 🟢 轻微 |
| 免费版 1GB 上传 / 3GB 下载 / 月 | 文档编辑够用，带附件可能不够 | 🟡 中等 |
| API 限流 600 次/30 分钟（免费版） | 首次全量同步容易触发 | 🟡 中等 |
| 限流后可能被封禁长达 6 小时 | 影响用户体验 | 🟡 中等 |
| 认证路径格式曾变更 | 需要兼容多种路径格式 | 🟢 轻微 |

> **真实案例**：思源笔记（SiYuan）和 Zotero **明确屏蔽了坚果云**，因为其 WebDAV 实现不兼容标准。引用思源笔记 issue #7657："坚果云接口存在限制"。

#### 付费版对比

| | 免费版 | 专业版 ¥199.9/年 | 高级版 ¥399.9/年 |
|--|--------|-------------------|-------------------|
| 上传/月 | 1 GB | 无限 | 无限 |
| 下载/月 | 3 GB | 无限 | 无限 |
| API 频率 | 600 次/30min | 1500 次/30min | 1500 次/30min |
| 存储 | 累积式 | 30GB + 1GB/月 | 72GB + 2GB/月 |
| 版本历史 | 有限 | 完整 | 完整 |

### 2.3 其他支持 WebDAV 的方案

这些不是"云盘"，但支持 WebDAV，技术用户可以使用：

| 方案 | 类型 | WebDAV 完整度 | 说明 |
|------|------|:-------------:|------|
| **群晖 NAS** | 私有 NAS | ⭐⭐⭐ | 完整 RFC 支持，中国大量用户 |
| **威联通 NAS** | 私有 NAS | ⭐⭐⭐ | 完整支持 |
| **Nextcloud** | 自托管 | ⭐⭐⭐ | 完整支持，功能最强 |
| **Cloudreve** | 自托管 | ⭐⭐⭐ | 国人开发，Go 语言，22.6K Stars |
| **Kodbox（可道云）** | 自托管 | ⭐⭐ | 中文，有群晖插件 |
| **AList** | 网关 | ⭐⭐ | 聚合 35+ 云盘为 WebDAV，但不稳定 |

### 2.4 `webdav` npm 包评估

| 维度 | 结论 |
|------|------|
| 包名 | `webdav` |
| 版本 | v5.10.0（2026-05-03 更新） |
| 周下载量 | ~122,000 |
| Stars | 804 |
| TypeScript | ✅ 类型完整 |
| 协议 | MIT |
| ESM | 是（仅 ESM） |
| Node.js 兼容 | ✅ >= 14（Electron 主进程完全兼容） |
| 流式传输 | ✅ createReadStream / createWriteStream |
| ETag 支持 | ✅ stat() 返回 etag + lastmod |
| 认证 | Basic / Digest / Token(OAuth) |
| 锁定 | ✅ lock() / unlock() |
| 替代品 | 无（唯一维护的 Node.js WebDAV 客户端） |

**结论：`webdav` 是唯一选择，且足够好用。**

### 2.5 现有 App 的 WebDAV 同步方案研究

| App | 同步方向 | 变更检测 | 冲突处理 | 离线 |
|-----|----------|----------|----------|------|
| **Obsidian WebDAV 插件** | 双向 | 3-way 对比（本地 vs 远程 vs 上次记录）| 13 种场景决策矩阵，5 种策略 | ✅ |
| **Joplin** | 双向 | ETag（PROPFIND）| 创建副本到"冲突"笔记本，手动解决 | ✅ |
| **Zotero** | 双向（文件） | ETag（.prop 文件缓存）| 后上传覆盖先上传 | ✅ |
| **Koodo Reader** | 双向 | 不明（黑盒比对算法）| 合并策略，不创建副本 | ✅ |

**最佳实践（来自 Obsidian WebDAV Sync 插件）：**
- **三路对比（Three-way comparison）**：记录"上次同步状态"，与当前本地和远程对比，精确判断谁改了什么
- **13 种场景决策矩阵**：覆盖"本地新增/远程删除/双方修改"等所有组合
- **Fast Mode**：缓存远程状态用于频繁小同步，定期全量同步刷新缓存

---

## 三、技术选型

```
┌─────────────────────────────────────────────────┐
│                   DeepInk                       │
│                                                 │
│  渲染进程                    主进程              │
│  ┌─────────────┐            ┌────────────────┐  │
│  │ 同步设置 UI  │── IPC ───►│  同步引擎       │  │
│  │ 同步状态显示  │           │                │  │
│  │ 冲突解决 UI  │◄── IPC ───│  WebDAV 适配器  │──┼──► 用户的 WebDAV 服务器
│  │             │            │  状态管理       │  │    (坚果云/群晖/...)
│  └─────────────┘            └────────────────┘  │
└─────────────────────────────────────────────────┘
```

| 层级 | 技术 | 说明 |
|------|------|------|
| WebDAV 客户端 | `webdav` npm 包 | 唯一维护的 Node.js WebDAV 客户端 |
| 同步引擎 | 自研 | 三路对比 + 增量同步 |
| 状态持久化 | 本地 SQLite / JSON 文件 | 存储同步状态（上次同步时的文件快照） |
| 凭据存储 | Electron safeStorage | 加密存储用户的 WebDAV 密码 |
| IPC | Electron ipcMain/ipcRenderer | 渲染进程 ↔ 主进程通信 |

---

## 四、架构设计

### 4.1 模块划分

```
src/main/sync/
├── index.ts                    # 模块入口，注册 IPC handlers
├── webdav-client.ts            # WebDAV 操作封装（基于 webdav 包）
├── sync-engine.ts              # 同步引擎核心（三路对比、决策矩阵）
├── sync-state.ts               # 同步状态持久化（本地快照）
├── conflict-resolver.ts        # 冲突检测与解决
├── credential-store.ts         # 凭据加密存储
├── providers/                  # 云盘适配器（预留扩展）
│   ├── webdav-provider.ts      # 通用 WebDAV 适配器
│   ├── jianguoyun-provider.ts  # 坚果云特化（处理分页、限流等）
│   └── types.ts                # Provider 接口定义
└── utils/
    ├── file-hash.ts            # 文件哈希计算（SHA-256）
    ├── rate-limiter.ts         # 客户端限流器
    └── path-utils.ts           # 路径处理工具
```

### 4.2 Provider 接口

```typescript
interface CloudProvider {
  // 连接
  connect(config: ConnectionConfig): Promise<void>
  testConnection(): Promise<boolean>

  // 文件操作
  readFile(path: string): Promise<Buffer>
  writeFile(path: string, content: Buffer | Stream): Promise<void>
  deleteFile(path: string): Promise<void>

  // 目录操作
  listDir(path: string): Promise<FileInfo[]>
  createDir(path: string): Promise<void>

  // 元数据
  stat(path: string): Promise<FileStat>  // 包含 etag, lastmod, size

  // 能力
  capabilities(): ProviderCapabilities  // 是否支持 lock、分页等
}

interface FileStat {
  path: string
  name: string
  type: 'file' | 'directory'
  size: number
  lastModified: Date
  etag?: string
}

interface ProviderCapabilities {
  supportsLock: boolean
  supportsPagination: boolean  // 坚果云需要分页
  maxItemsPerPage?: number     // 坚果云 = 750
  supportsOptions: boolean
  rateLimit?: { max: number; windowMs: number }
}
```

### 4.3 同步引擎设计

#### 核心算法：三路对比（Three-way Comparison）

```
             上次同步状态（Base）
              /          \
             /            \
     本地当前状态        远程当前状态
      (Local)            (Remote)
```

对于每个文件，引擎对比三个状态：

| 本地状态 | 远程状态 | 决策 |
|----------|----------|------|
| 未变 | 未变 | ⏭️ 跳过 |
| **已变** | 未变 | ⬆️ 上传本地到远程 |
| 未变 | **已变** | ⬇️ 下载远程到本地 |
| **已变** | **已变** | ⚠️ 冲突 → 触发冲突解决 |
| **新增** | 不存在 | ⬆️ 上传新文件 |
| 不存在 | **新增** | ⬇️ 下载新文件 |
| 已删除 | 未变 | 🗑️ 远程也删除 |
| 未变 | 已删除 | 🗑️ 本地也删除 |
| **已变** | 已删除 | ⚠️ 冲突（本地改了但远程被删） |
| 已删除 | **已变** | ⚠️ 冲突（本地删了但远程改了） |
| 已删除 | 已删除 | ⏭️ 跳过（两边都删了） |
| **新增** | **新增** | ⚠️ 冲突（同路径不同内容） |

#### 变更检测方法

```
远程变更检测：
  1. 优先用 ETag（stat() 返回的 etag 字段）
  2. ETag 不可用时，用 lastModified + size
  3. 都不可用时，用文件内容 SHA-256 Hash

本地变更检测：
  1. lastModified 时间戳对比
  2. 不确定时，用文件内容 SHA-256 Hash
```

#### 同步状态存储

每次同步完成后，保存一份"快照"到本地：

```typescript
interface SyncState {
  version: 1
  lastSyncTime: number              // ISO timestamp
  remoteBase: Map<string, FileSnap> // 远程文件快照 { path → { etag, hash, lastmod, size } }
  localBase: Map<string, FileSnap>  // 本地文件快照 { path → { hash, lastmod, size } }
}

interface FileSnap {
  etag?: string
  hash: string          // SHA-256
  lastModified: number  // timestamp ms
  size: number
}
```

### 4.4 冲突处理策略

参考 Obsidian WebDAV Sync 和 Joplin 的经验，采用**分级策略**：

```
冲突发生
  │
  ├─ 文本文件（.md, .txt, .docx 等）
  │   ├─ 自动合并（diff-match-patch）→ 成功 → 合并后上传
  │   └─ 自动合并失败 → 降级到下面的通用策略
  │
  └─ 通用策略（所有文件类型的默认行为）
      ├─ 保留两份：
      │   远程版本保持不动
      │   本地版本重命名为 "文件名 (冲突 - 2026-06-04).md"
      │   下载远程版本到本地
      │   → 用户自行对比、手动解决
      │
      └─ （可选）用户可设置偏好：
          · 总是保留本地
          · 总是保留远程
          · 总是保留两份
          · 每次询问
```

**关键原则：绝不静默丢数据。** 任何冲突都必须让用户知道。

### 4.5 坚果云特化处理

坚果云的 WebDAV 实现有多处不兼容标准，必须做适配：

```typescript
class JianguoyunProvider extends WebDAVProvider {
  capabilities = {
    supportsLock: false,           // 坚果云不支持 LOCK
    supportsPagination: true,      // 必须分页
    maxItemsPerPage: 750,          // 单次 PROPFIND 上限
    supportsOptions: false,        // OPTIONS 返回 501
    rateLimit: { max: 600, windowMs: 30 * 60 * 1000 }  // 600 次/30min
  }

  // 1. 分页列出目录
  async listDir(path: string): Promise<FileInfo[]> {
    let allFiles: FileInfo[] = []
    let offset = 0
    do {
      const batch = await this.client.getDirectoryContents(path, {
        headers: { Range: `items=${offset}-${offset + 749}` }
      })
      allFiles = allFiles.concat(batch)
      offset += batch.length
    } while (batch.length === 750)  // 拿满 750 说明还有更多
    return allFiles
  }

  // 2. 客户端限流
  private limiter = new RateLimiter(600, 30 * 60 * 1000)

  // 3. 跳过 OPTIONS 检测
  async testConnection(): Promise<boolean> {
    // 不调用 OPTIONS，直接尝试 PROPFIND 根目录
    try {
      await this.client.getDirectoryContents('/')
      return true
    } catch { return false }
  }
}
```

### 4.6 同步触发时机

| 触发方式 | 说明 | 优先级 |
|----------|------|:------:|
| 手动触发 | 用户点击"立即同步"按钮 | P0 — MVP 必须 |
| 定时同步 | 每 N 分钟自动同步（用户可配置间隔） | P1 |
| 文件保存后 | 本地文件保存后自动上传 | P2 |
| 启动时 | 应用启动时自动拉取远程变更 | P2 |

---

## 五、用户流程

### 5.1 首次配置

```
┌──────────────────────────────────────────────────────┐
│                  云存储设置                            │
│                                                      │
│  选择云存储服务：                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │  ☁️ 坚果云（推荐 — 最简单）                     │  │
│  │     国内最快上手，应用专用密码即可连接             │  │
│  │                                                │  │
│  │  🌐 自定义 WebDAV                               │  │
│  │     支持 Nextcloud、群晖 NAS、Cloudreve 等       │  │
│  │                                                │  │
│  │  📦 AList 网关（高级）                           │  │
│  │     通过 AList 连接阿里云盘、夸克等更多网盘       │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  ──── 坚果云连接 ────                                │
│                                                      │
│  邮箱：[________________]                             │
│  应用密码：[________________]                         │
│                                                      │
│  💡 不知道应用密码？                                   │
│    坚果云 → 账户信息 → 安全选项 →                      │
│    第三方应用管理 → 添加应用密码                        │
│                                                      │
│           [测试连接]     [保存并连接]                   │
└──────────────────────────────────────────────────────┘
```

### 5.2 选择同步文件夹

```
连接成功后：
┌──────────────────────────────────────────────────────┐
│  选择云端工作区文件夹：                                 │
│                                                      │
│  ☁️ /                                                 │
│  ├── 📁 DeepInk/                        ← 推荐       │
│  ├── 📁 我的文档/                                     │
│  ├── 📁 工作/                                         │
│  └── 📁 ...                                           │
│                                                      │
│  [新建文件夹: DeepInk]                                 │
│                                                      │
│  本地存储位置：                                        │
│  /Users/apple/DeepInk-sync/                           │
│                                         [选择文件夹]   │
│                                                      │
│              [开始同步]                                │
└──────────────────────────────────────────────────────┘
```

### 5.3 日常使用

```
┌──┬──────────┬─────────────────────┬──────────────────┐
│  │          │  我的文档.md    ✕   │  ☁️ 已同步 10:32  │
│  │          │  工作报告.docx  ✕   │                  │
│  │          │  ...                │                  │
│  │          │                     │                  │
│  │          │                     │                  │
└──┴──────────┴─────────────────────┴──────────────────┘
                                ↑ 状态栏显示同步状态

同步状态图标：
  ☁️ 已同步    — 本地与云端一致
  ⬆️ 上传中    — 正在上传到云端
  ⬇️ 下载中    — 正在从云端下载
  ⚠️ 冲突      — 需要手动解决
  ❌ 同步失败  — 网络错误或认证过期
  🔌 离线      — 无网络连接
```

---

## 六、实现计划

### Phase 1：MVP（预计 5-7 天）

> 目标：坚果云 + 通用 WebDAV 基础同步

| 天数 | 任务 | 产出 |
|:----:|------|------|
| 1 | 搭建模块结构 + WebDAV 客户端封装 | `webdav-client.ts` + Provider 接口 |
| 2 | 坚果云 Provider（分页、限流）| `jianguoyun-provider.ts` |
| 3 | 凭据存储 + IPC handlers | `credential-store.ts` + `index.ts` |
| 4 | 同步引擎核心（三路对比）| `sync-engine.ts` + `sync-state.ts` |
| 5 | 冲突处理（保留两份策略）| `conflict-resolver.ts` |
| 6 | 设置 UI + 状态栏集成 | 渲染进程组件 |
| 7 | 联调测试 + Bug 修复 | 可用版本 |

### Phase 2：体验优化（预计 3-5 天）

- 定时自动同步
- 文件保存后自动上传
- 同步进度条和速度显示
- 大文件分块传输（Streaming）
- 同步历史记录

### Phase 3：扩展（后续迭代）

- AList 网关支持（阿里云盘、夸克等）
- 直接集成阿里云盘 API（等 API 开放）
- 文本文件 diff 自动合并
- 多云盘同时连接

---

## 七、风险评估

### 7.1 技术风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|:----:|:----:|----------|
| 坚果云 WebDAV 兼容性问题 | 高 | 中 | 坚果云特化 Provider + 充分测试 |
| 大目录首次同步触发限流 | 高 | 中 | 客户端限流器 + 分批同步 + 断点续传 |
| 坚果云认证格式变更 | 中 | 中 | 监控社区反馈，快速适配 |
| 同步冲突导致数据丢失 | 低 | **高** | 保留两份策略 + 完善测试 |
| `webdav` 包 ESM 兼容问题 | 低 | 低 | electron-vite 处理 ESM transpilation |

### 7.2 产品风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|:----:|:----:|----------|
| 坚果云免费额度太小（1GB/月）| 确定 | 中 | 明确提示用户额度；推荐付费版或自建 WebDAV |
| 配置门槛高（应用密码、WebDAV 地址）| 中 | 中 | 坚果云做引导教程；通用 WebDAV 做预设模板 |
| 用户不理解同步概念 | 中 | 低 | 简化 UI，"选择文件夹 → 自动同步"，隐藏技术细节 |

---

## 八、关键决策待定

1. **本地同步状态用什么存储？**
   - 选项 A：JSON 文件（简单，但文件多了性能差）
   - 选项 B：SQLite（better-sqlite3）（性能好，但引入原生依赖）
   - 选项 C：Electron 的 IndexedDB（主进程不直接支持）
   - **建议**：先用 JSON 文件，文件数量超过 1000 时迁移 SQLite

2. **坚果云免费版的 1GB/月限制怎么处理？**
   - 方案 A：不管，用户自行负责
   - 方案 B：监控流量使用，接近上限时警告
   - 方案 C：在设置页面展示本月已用/总量
   - **建议**：方案 C

3. **是否在 Electron 内嵌 AList？**
   - 优势：用户可以连接阿里云盘等更多网盘
   - 劣势：增加包体积、资源占用、AGPL 许可证风险
   - **建议**：Phase 3 再考虑，先不内嵌

---

## 九、参考资源

- [坚果云 WebDAV 帮助](https://help.jianguoyun.com/?p=2064)
- [坚果云文件名限制](https://help.jianguoyun.com/?p=1904)
- [webdav npm 包](https://www.npmjs.com/package/webdav)
- [Obsidian WebDAV Sync 插件](https://github.com/hesprs/obsidian-webdav-sync)（最佳同步算法参考）
- [Joplin WebDAV 同步](https://github.com/laurent22/joplin)（冲突处理参考）
- [RFC 4918 - WebDAV](https://datatracker.ietf.org/doc/html/rfc4918)
- [RFC 6578 - WebDAV Sync](https://datatracker.ietf.org/doc/html/rfc6578)（增量同步标准，坚果云不支持）
