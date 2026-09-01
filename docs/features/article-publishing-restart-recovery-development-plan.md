# 文章发布中断与重启恢复开发方案

> 状态：P0 最小安全切片已在当前工作区实现并通过自动化门禁；尚未提交，尚未做真实 CSDN 验收，
> 不代表产品闭环完成。
> 代码基线：`2cc9479cd8964446e62e047b3ba88382bbb112a6`。
> 产品事实源：`docs/features/article-publishing-restart-recovery.md`。
> 架构约束：`docs/architecture.md`、`docs/features/article-platform-publishing.md`。
> 范围：只补齐 CSDN 单篇文章“旧入口失效后从草稿箱找回、核验并继续”的纵向闭环；不增加平台、
> 不修改云端或 Agent runtime 项目、不引入隐藏接口。

## 1. 评审结论与本次最小实现

独立评审的核心驳回合理：旧代码只有旧 URL 恢复，没有从当前账号草稿箱找回原草稿；本地
`accountId/profileId` 也不能证明网页当前登录账号；恢复过程没有跨重启持久化且不可绕过的写入许可；
图片下载失败或平台转码可能被误当成“图片不存在”；旧代次保存结果未知时仍可能继续写；同标题公开
链接不足以证明本次发布成功。

本次只实现一个保守的 P0 纵向切片：

1. 恢复新代次先持久化 `recovery.operationId + executionGeneration`；
2. 在创建/激活账号 Tab 和找稿前，由 `BrowserTaskRuntime` 取得 main-owned 账号 recovery lease；普通
   Agent 通过 Tab 的 main-owned `accountId` 竞争同一租约，找稿期间不能抢占；
3. 在启动 Agent 前打开 CSDN 文章管理/草稿入口，只接受当前可见草稿列表中唯一的原 `draftId`；
4. 从草稿箱和编辑器提取唯一真实 CSDN 主页账号标识，不能再用草稿 ID 列表哈希冒充账号；
5. 打开候选后生成账号、`draftId`、标题、正文结构、全部图片字节哈希和 `saved` 状态的完整快照；
6. 核验成功后在 main 同一个同步操作中把账号租约从 recovery 原子转交给精确 BrowserTask，并签发
   同时绑定精确 Page Runtime 与完整快照哈希的恢复写入许可；每次写前重验，写后
   形成新已保存快照才续签；
7. Runtime 绑定、Browser Policy 和副作用预留三层都校验许可，Page owner 或快照改变即使许可失效；
8. 历史任务缺完整快照、旧代次保存未知、旧图片身份无法强证明、列表不支持或草稿不唯一时，停止
   且不启动 Agent；手动打开草稿也不能绕过；
9. 发布结果未知时先在管理页按原草稿 ID 找同 ID 公开文章，再核验账号、ID、标题并进入只读 Agent
   收敛；仍不接受同标题链接。

本次没有实现模糊候选和用户选稿 UI，也没有证明真实 CSDN 当前 DOM、分页、虚拟列表和图片 CDN 行为。
因此当前能力是“能安全尝试按稳定 ID 自动恢复；不能证明时停下”，不是完整恢复产品闭环。

任何阶段都不得以新增 Schema、Mock 测试或 Agent prompt 作为用户功能完成。每个阶段必须在真实
Studio 可见页面中增加一项用户可以执行和观察的能力。

## 2. 当前代码事实

### 2.1 已有基础

| 能力               | 当前实现                                                           | 本方案复用方式                                    |
| ------------------ | ------------------------------------------------------------------ | ------------------------------------------------- |
| 发布业务状态 owner | `src/main/web-affairs/web-affair-service.ts`                       | 继续唯一持有草稿、恢复、图片和副作用事实          |
| 草稿锚点           | `src/shared/article-publishing/csdn-draft-anchor.ts`               | 迁移为平台草稿身份的一种 URL 提取方式             |
| 恢复启动           | `src/main/article-publishing/article-publishing-service.ts`        | 在启动 Agent 前插入只读 Draft Recovery 阶段       |
| CSDN 页面 probe    | `src/main/article-publishing/csdn-publishing-adapter.ts`           | 扩展管理页、候选草稿和草稿快照能力                |
| 页面证据授权       | `src/main/article-publishing/article-publishing-browser-policy.ts` | 继续签发当前页面 attestation，禁止 Agent 自报成功 |
| 图片状态           | `ArticlePublishingAsset` 的本地哈希、平台 URL、状态和尝试          | 增加平台侧图片指纹和恢复对账结果                  |
| 跨代次图片恢复     | `result-unknown → reconciling`，允许受信页面证据验证旧副作用       | 保留并改由 Recovery Coordinator 主动驱动          |
| 发布防重放         | publication 与 publish side effect 的 `result-unknown`             | 恢复后只读核验，不重新授权发布动作                |
| 原子发布租约       | WebAffair 单一 mutation queue 内的发布租约                         | 找稿和核验期间继续占有，避免另一 Affair 介入      |
| 账号运行时租约     | `BrowserTaskRuntime` 单一 account owner map                        | recovery 与 BrowserTask 共用 owner 并原子转交     |

当前新增和受影响的定向测试覆盖草稿 ID 路由、草稿列表编排、恢复许可、旧保存阻断、图片未知和发布
证据；自动化通过只能证明局部不变式，不证明草稿箱恢复闭环。

### 2.2 本次修复后的剩余差距

#### 已补：草稿身份和恢复代次

`ArticlePublishingState.draft` 现在持久化 `platformDraftId`、真实平台账号、正文结构哈希、全部平台
图片字节哈希、保存状态、完整快照、恢复 operation 和绑定快照/Page Runtime 的写入许可；schema
升到 6。URL 解析同时兼容路径型和查询参数型编辑入口，但历史数据不会被伪造为完整快照。

#### 已补：启动 Agent 前按精确 ID 查草稿列表

恢复代次现在先进入文章管理页，必要时进入草稿区，只从当前可见列表选择唯一相同 `draftId`，再打开
编辑器核验；失败时不会创建 Agent，也不会打开新建文章入口。

#### 已补：恢复阶段账号互斥与原子转交

恢复代次在 `waitForAccountView()`、导航和快照核验之前取得账号 recovery lease。普通 Agent 启动
BrowserTask 时会从 `BrowserManager` 读取当前 Tab 的登记账号并取得同一个租约，因此不能在恢复阶段
修改同账号页面。核验成功后，`BrowserTaskRuntime` 同步校验账号、Profile、Affair、Attempt、execution
generation 和 launch operation，随后一次性把 correlation 与 lease owner 改为新 BrowserTask。失败或
超时释放未转交租约；过期 release 不会删除已经转交的 task owner。进程重启时内存租约自然消失，
但没有 Runtime 可继续写；WebAffair 的持久 recovery generation 重新驱动恢复，不把租约复制为第二份
业务状态。

#### 剩余：草稿列表枚举能力有限

Adapter 已能读取可见语义草稿入口和最多 500 个可见链接中的稳定 ID，但尚未处理真实 CSDN 的分页、
虚拟列表、非链接卡片或页面改版。当前策略对此 fail-closed，不能保证自动找回。

#### 已补安全门禁，仍需真实规范化验证

正文使用结构序列化哈希，只统一换行编码，不折叠段落、普通换行或代码缩进。恢复时缺哈希、哈希
不一致或无法读取都会停止。真实 CSDN Markdown/富文本 DOM 的稳定性仍需真人验证。

#### 已补防误传门禁，尚未完成自动否定

首次确认图片时会保存平台实际下载字节的哈希；恢复时可以用原平台 URL 或平台哈希证明图片仍存在。
下载失败、枚举不完整或旧上传结果未知时，不能签发“图片不存在”证据，也不会自动重传。平台再次
转码导致 URL 和字节都变化时仍需人工处理。当前快照整体哈希还包含图片 URL，因此即使字节哈希相同、
只有 URL 被 CSDN 改写，也会 fail-closed 停止；“内容相同即可续签”的比较规则尚未实现。

#### 剩余：发布结果身份映射未被真实平台证明

当前只读核验暂按“公开文章 ID 等于原草稿 ID”查找，再核验真实账号和标题。该映射没有真实 CSDN
证据，不能单独作为发布成功证明；真实站点确认映射前只能保持 `result-unknown`，不得放宽成标题匹配。

#### 剩余：缺少用户选稿命令和恢复投影

renderer 目前能显示草稿锚点和发布状态，没有候选草稿、选择命令、恢复步骤或“核验完成前不得启动
Agent”的用户反馈。

## 3. 目标调用链

```text
ArticlePublishingTab: 用户点击“从中断处继续”
  → articlePublishing IPC: resume command
  → WebAffairService: 原子进入 recovering，保留发布租约
  → ArticlePublishingService
      → BrowserTaskRuntime: 账号级取得 recovery lease
      → BrowserManager: 恢复/创建同账号可见 Tab
      → CsdnDraftRecoveryCoordinator（无持久状态）
          → 旧入口只读探测
          → CsdnPublishingAdapter: 发现草稿管理入口
          → CsdnPublishingAdapter: 列出候选
          → 精确 ID 自动选择，或持久化 awaiting-selection
          → 打开候选并 readDraftSnapshot
          → WebAffairService: 持久化 recovered / waiting-human
      → 只有 recovered 后才创建 BrowserTask，并原子接管 recovery lease
      → Runtime 持久绑定完成后才 dispatch Agent Run
  → Agent 从最早一个未确认完成的检查点继续
```

`CsdnDraftRecoveryCoordinator` 只编排 Browser 和 Adapter，不保存业务真相。它的每个结果都必须交给
WebAffairService 持久化，不能成为新的生命周期 owner。

## 4. 数据模型与迁移

以下是完整闭环目标模型。当前最小切片只落地了
`platformDraftId / platformSnapshot / bodyStructureHash / recovery / writePermit / platformContentHash`，没有为了
未来 UI 预先加入候选数组或第二套状态。

### 4.1 草稿身份

建议将现有 `draft` 扩展为：

```ts
interface ArticlePublishingDraftIdentity {
  platformDraftId?: string
  lastKnownEditorUrl?: string
  adapterVersion: number
  boundAt?: string
  lastVerifiedAt?: string
  snapshot?: {
    normalizedTitle: string
    platformBodyHash: string
    imageCount: number
    saveState: 'saved' | 'saving' | 'unknown'
    observedAt: string
    evidenceHash: string
  }
  recovery?: {
    status:
      | 'idle'
      | 'locating'
      | 'awaiting-selection'
      | 'verifying'
      | 'recovered'
      | 'not-found'
      | 'unsupported'
    candidateIds: string[]
    reasonCode?: string
    updatedAt: string
  }
}
```

账号仍引用现有 `accountId/profileId`，不得复制进 `draft`。正文只保存规范化哈希和必要摘要，不保存
第二份全文。

### 4.2 平台图片身份

扩展每张本地图片：

```ts
interface ArticlePublishingPlatformAssetEvidence {
  platformUrl: string
  normalizedPlatformRef?: string
  platformContentHash?: string
  observedAt: string
  evidenceHash: string
}
```

保留现有本地 `contentHash`。本地哈希证明输入文件；`platformContentHash` 证明平台实际存储的图片。

### 4.3 WebAffair schema 迁移

当前 WebAffair snapshot schema 为 5，实施时升级到下一版本并提供真实旧 fixture：

- 能从旧 `draft.url` 解析数字 ID：迁移到 `platformDraftId + lastKnownEditorUrl`；
- 有平台写入但没有稳定 ID：迁移为 `awaiting-selection/waiting-human`；
- 旧图片只有 `platformUrl`：保留为第一匹配线索，首次恢复后补平台哈希；
- 旧图片为 `result-unknown`：迁移为 `reconciling`，不得自动重传；
- 旧 `published` 历史保持可见，不用新规则粗暴降级；再次操作前重新读回核验。

## 5. Adapter 设计

### 5.1 新增类型化只读能力

```ts
interface CsdnDraftCandidate {
  candidateId: string
  platformDraftId?: string
  title: string
  updatedAtText?: string
  editorUrl?: string
}

interface CsdnDraftListProbe {
  pageSupported: boolean
  enumerationComplete: boolean
  candidates: CsdnDraftCandidate[]
}

interface CsdnDraftSnapshot {
  platformDraftId?: string
  title: string
  normalizedBodyHash: string
  images: Array<{
    src: string
    normalizedPlatformRef?: string
    platformContentHash?: string
    alt: string
  }>
  imageEnumerationComplete: boolean
  saveState: 'saved' | 'saving' | 'unknown'
  evidenceHash: string
  observedAt: string
}
```

Adapter 增加：

- `discoverDraftManagementEntry(page)`：从当前可见账号页识别内容管理/草稿箱入口；
- `probeDraftList(page)`：有界读取当前草稿列表，报告是否完整；
- `openDraftCandidate(page, candidate)`：只允许打开 Adapter 本次 probe 签发的候选；
- `readDraftSnapshot(page)`：读取草稿 ID、正文哈希、图片和保存状态；
- `readPublishedResult(page, identity)`：发布结果未知时只读查找。

所有 selector 必须来自当前 Adapter probe，继续由 Browser Policy 校验。Adapter 失配时转人工，不允许
Agent 枚举 selector。

### 5.2 入口变化策略

恢复不能只换成另一条硬编码草稿箱 URL。顺序应为：

1. 当前可见账号页上的语义入口；
2. Adapter 版本内维护的有界已知入口；
3. 已进入管理页时直接 probe；
4. 都失败则 `unsupported/waiting-human`。

如果 CSDN 页面实际不暴露稳定入口或 draftId，应立即触发止损，不继续扩大 selector 猜测。

### 5.3 候选选择规则

- `accountId + platformDraftId` 精确匹配：允许自动打开；
- ID 匹配但打开后正文证据冲突：停止，不继续写；
- 无 ID：可按标题筛选并只读打开最多 5 个候选计算快照，但必须由用户最终选择；
- 多个 ID 相同、分页不完整或候选条目不稳定：转人工；
- 标题、更新时间、图片数量和 DOM 顺序永远不能单独授权自动绑定。

## 6. WebAffair 状态转换

新增恢复命令必须沿用当前 mutation queue，并与发布租约同事务：

```text
interrupted / result-unknown / waiting-human
  → recovering.locating
  → recovering.awaiting-selection
  → recovering.verifying
  → preparing（草稿核验成功，允许启动新 generation）
  ├→ waiting-human（未找到、冲突、页面不支持）
  └→ result-unknown（存在无法核验的旧副作用）
```

约束：

- `recovering` 期间 Attempt 不得是 `running-ai`；
- recovery binding 不等于 runtime binding；Agent Run 和 BrowserTask 只能在 `recovered` 后创建；
- 用户选择候选必须携带 Affair/Attempt/recovery generation/candidateId，旧 UI 选择不得应用；
- 新 URL 只更新 `lastKnownEditorUrl`，不得改变已经存在的 `platformDraftId`；
- 没有稳定 ID 的历史任务只有用户确认后才能一次性补绑定；
- 找稿失败保持可再次恢复，不能把原 Attempt 结束后另建一个新发布任务。

## 7. 图片与正文对账实现

### 7.1 正文

- Adapter 对可见编辑器正文做稳定规范化：统一空白、保留段落/代码块边界、排除运行时占位元素；
- 保存草稿后持久化 `platformBodyHash`；
- 恢复时同 ID、同 hash 才跳过正文步骤；
- 同 ID、hash 不同进入人工处理，首版不自动覆盖网页人工修改；
- 只有 `bodyTextLength > 0` 不得继续作为正文完成证据。

### 7.2 图片

匹配优先级：

1. 编辑器仍引用完全相同的 `platformUrl`；
2. URL 归一化后平台资源身份一致；
3. 当前平台图片哈希等于上次保存的 `platformContentHash`；
4. 当前平台图片字节恰好等于本地原图哈希。

alt、顺序和附近正文只用于展示候选。只有 `imageEnumerationComplete=true` 且以上强匹配全部失败时，
才能证明图片不存在并允许重新上传。下载失败、跨域阻断、数量超上限或列表不完整都必须保持未知。

## 8. IPC 与 UI

建议新增有界命令：

- `resumeTask`：开始只读恢复，不直接启动 Agent；
- `selectDraftCandidate`：用户确认候选；
- `cancelRecovery`：停止本次恢复，不改变已有平台副作用；
- `retryRecovery`：修复登录/页面后重新探测。

`ArticlePublishingTab` 展示：

- 恢复阶段与最近一次可信证据；
- 原草稿 ID、最近入口和当前找到的入口；
- 候选列表与“为什么不能自动确认”；
- 正文是否一致、每张图片是已存在/不存在/未知；
- 恢复成功后将从哪个检查点继续。

renderer 只发送命令和投影 snapshot，不缓存第二份 candidate owner，不直接修改 draft binding。

## 9. 最小纵向实施顺序

当前进度：R1 的 main 侧精确 ID 恢复、账号 recovery lease 原子转交和不可绕过写许可已实现，R1 的可见恢复进度 UI 与真实平台验收
未完成；R2 只完成正文哈希、平台图片哈希和“不确定不重传”的安全门禁；R3、R4 的完整用户闭环及 R5
均未完成。

### R1：旧 URL 失效后找回原草稿

用户能力：关闭原 Tab、使旧入口失效并重启后，Studio 自动进入草稿管理页，按原 draftId 打开同一
草稿；恢复期间没有 Agent 写入。

实现范围：

- 数据模型和 schema 迁移；
- management entry、draft list、exact-ID candidate probe；
- Draft Recovery Coordinator；
- BrowserTaskRuntime 账号 recovery lease 与原子 BrowserTask handoff；
- `launchRuntime()` 前置恢复门禁；
- UI 恢复进度。

当前结果：前三项和 Agent 启动前门禁已实现；UI 与真实 CSDN 验收待做。

### R2：正文与三图不重复

用户能力：第一张图片完成后退出；重启后正文和第一张图片读回一致，从第二张继续。

实现范围：

- `readDraftSnapshot()`；
- 正文平台哈希；
- 平台图片 URL/平台哈希；
- `reconciling → verified/rejected/unknown`；
- 三图恢复 UI。

### R3：候选歧义与人工选择

用户能力：同标题多草稿、无稳定 ID或人工修改时，Studio 展示候选并等待用户确认，不串稿。

实现范围：

- 有界候选探测；
- `awaiting-selection` 状态；
- `selectDraftCandidate` 命令和过期选择防护；
- 人工确认后重新核验。

### R4：保存与发布结果未知恢复

用户能力：保存或发布动作后断线，Studio 重启后先核验草稿/公开结果；不会重复保存造成覆盖，也不会
重复点击发布。

实现范围：

- save snapshot 与 side-effect 关联；
- published result 只读探测；
- 旧 generation 副作用归并；
- `result-unknown` UI 和人工边界。

### R5：真实交付门禁

用户能力：在真实 CSDN 完成事实源文档第 2 节全部验收动作。

只有 R5 通过后才更新产品事实源状态并声明恢复闭环完成。构建、Schema、Mock、单元测试和代码提交
只能计入工程准备度。

## 10. 文件级改动计划

| 文件/区域                                                               | 计划改动                                                 |
| ----------------------------------------------------------------------- | -------------------------------------------------------- |
| `src/shared/article-publishing/article-publishing-types.ts`             | 草稿身份、恢复状态、平台图片证据、候选投影               |
| `src/shared/article-publishing/article-publishing-schema.ts`            | 新字段校验与旧数据兼容                                   |
| `src/shared/article-publishing/csdn-draft-anchor.ts`                    | 从固定 URL 解析器降级为兼容 helper，不再承担完整身份协议 |
| `src/main/web-affairs/web-affair-service.ts`                            | 恢复状态转换、候选选择、草稿快照、旧副作用归并           |
| `src/main/web-affairs/web-affair-store.ts`                              | 下一 schema 版本迁移及恢复日志兼容                       |
| `src/main/article-publishing/csdn-publishing-adapter.ts`                | 草稿管理、候选、快照、平台图片和发布结果只读能力         |
| `src/main/article-publishing/article-publishing-browser-policy.ts`      | 候选/快照 attestation 和恢复期禁止写入                   |
| `src/main/article-publishing/article-publishing-service.ts`             | Agent 启动前调用 Draft Recovery Coordinator              |
| `src/main/article-publishing/csdn-draft-recovery-coordinator.ts`        | 新增无持久状态编排器                                     |
| `src/main/browser/browser-task-runtime.ts`                              | 账号 recovery/task 单一 owner 与原子转交                 |
| `src/main/browser/browser-manager.ts`、`src/main/agent/agent-bridge.ts`  | 普通 Agent 从 main-owned Tab 绑定取得账号租约             |
| `src/main/article-publishing/article-publishing-ipc.ts`                 | 恢复、选择、取消和重试命令                               |
| `src/preload/article-publishing-api.ts` 与共享 contract                 | 有界 API 与 Zod schema                                   |
| `src/renderer/src/features/article-publishing/ArticlePublishingTab.tsx` | 恢复进度、候选选择、正文与图片对账结果                   |
| `docs/testing/article-publishing-runtime-convergence.md`                | 增加草稿箱恢复与真实三图重启矩阵                         |

不得把 selector、草稿候选或恢复生命周期分散到 `AgentPanel`、通用 Browser Tab 或 renderer store。

## 11. 测试计划

### 11.1 纯函数与状态机

- URL 形态迁移和平台 draftId 比较；
- schema 旧 fixture 迁移；
- recovery 状态转换与旧命令拒绝；
- exact ID、无 ID、多候选和分页不完整决策；
- 正文规范化 hash；
- 平台图片 URL、平台 hash、本地 hash 匹配优先级；
- 未完整枚举时永远不能判定图片不存在；
- publish `result-unknown` 永远不能转回可点击发布。

### 11.2 主进程集成

新增至少：

- `csdn-publishing-adapter.test.ts`：真实 DOM fixture 的管理页、草稿列表、编辑器和公开页；
- `article-publishing-draft-recovery.test.ts`：旧 URL 失败后草稿箱恢复；
- WebAffair 测试：用户选稿、过期 selection、跨 generation 副作用核验；
- Service 测试：recovery 未完成时 AgentBridge 不被调用；
- Runtime 测试：恢复期普通 Agent 抢占失败、原子转交后旧 release 无效、过期/错代租约不能转交；
- 存储失败：候选选择或 recovered 状态未持久化时禁止启动 Agent。

### 11.3 Electron/CDP

- 真实 `WebContentsView` 中关闭原 Tab并恢复；
- 模拟编辑入口重定向或 404 后进入草稿箱；
- 同账号普通 Tab 不被误认领；
- 快速切换 Tab 时恢复投影不串 Agent；
- renderer reload 和 App 重启时 recovery 状态可继续；
- 页面 generation 改变后旧 attestation 无效。

### 11.4 真实 CSDN

- 三图中断与重启；
- 同标题双草稿；
- 草稿内容被人工修改；
- 图片经平台转码或 CDN URL 变化；
- 登录失效、验证码和页面版本不支持；
- 保存后断线；
- 发布点击后断线，只读验证公开结果。

## 12. 诊断要求

每次恢复至少记录：

- Affair/Attempt/generation/launch；
- 账号引用、Profile 和 Browser Tab/CDP owner；
- 恢复策略：旧 Tab、旧 URL、语义入口或已知入口；
- 草稿箱 probe 版本、候选数量、是否完整；
- 自动匹配或要求人工的原因码；
- 持久 draftId 与页面 draftId 是否一致；
- 正文 hash、图片匹配方法和未知原因；
- 新 Agent 是否因 recovery 未完成而被阻止；
- 每个旧副作用被 verified、rejected 或保持 unknown 的依据。

诊断不得包含 Cookie、Token、完整正文或图片二进制。

## 13. 风险、止损与 ADR 判断

### 必须主动验证的假设

1. 当前真实 CSDN 草稿管理页是否暴露稳定 draftId；
2. 草稿列表是否分页或虚拟滚动，以及何时能证明枚举完整；
3. CSDN 图片是否会转码、改 URL 或阻止页面上下文下载；
4. 当前编辑器能否稳定取得规范化正文；
5. 发布结果能否从可见管理页或公开页面唯一核验。

### 止损条件

- 同一页面结构连续两次现场失败，不再继续增加 selector；收集截图和 DOM 证据后升级 Adapter 版本；
- 草稿列表不暴露稳定 ID时，不尝试用标题自动绑定，交付人工候选选择；
- 图片无法获得强身份时，不重复上传，保留未知并交付人工确认；
- 任一前置工作超过 60 分钟仍没有新增用户可验收能力，暂停横向基础设施并回到 R1 最小闭环；
- 真实 CSDN 未通过前，不把 Mock 或状态机测试描述为恢复完成。

### ADR

本方案不需要新 ADR：它保持 WebAffair 单一 owner、可见 Browser、主进程有界 IPC 和薄 Adapter。
如果计划改为调用隐藏 CSDN API、保存 Cookie/Token、使用隐藏浏览器、让 Adapter 持有第二份状态或
允许 Agent 在 Adapter 失败后自行猜 selector，则必须先提交 ADR，且可能直接违反现有架构边界。
