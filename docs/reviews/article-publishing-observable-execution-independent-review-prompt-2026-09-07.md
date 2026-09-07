# 新会话独立评审指令：文章发布逐步可观测执行协议

把下面整段原样交给一个新的 Codex 会话。新会话只做独立评审，不修改代码和文档。

---

请对 CCLink Studio“文章发布逐步可观测执行协议及修复方案”做一次完全独立、以当前源码为准的施工前
评审。

仓库：`/Users/apple/Desktop/cclink-dev/cclink-studio`

## 工作边界

1. 只分析、验证和评审；不修改代码、不修改文档、不提交、不发布。
2. 不接受历史会话的“已经修好”“工程闭环”或本文预设结论。
3. 先运行只读命令确认当前分支、HEAD、版本、工作区差异和最近相关提交。
4. 当前工作区可能包含未提交文档或其他用户修改；不得丢弃、覆盖或误认为已发布。
5. 单元测试通过不能替代生命周期、状态机和真实 CSDN 判断。

## 必须完整阅读

- `/Users/apple/Desktop/cclink-dev/cclink-studio/AGENTS.md`
- `/Users/apple/Desktop/cclink-dev/cclink-studio/docs/architecture.md`
- `/Users/apple/Desktop/cclink-dev/cclink-studio/docs/features/article-publishing-observable-execution-protocol.md`
- `/Users/apple/Desktop/cclink-dev/cclink-studio/docs/features/article-publishing-observable-execution-development-plan.md`
- `/Users/apple/Desktop/cclink-dev/cclink-studio/docs/features/article-platform-publishing.md`
- `/Users/apple/Desktop/cclink-dev/cclink-studio/docs/features/article-publishing-restart-recovery.md`
- `/Users/apple/Desktop/cclink-dev/cclink-studio/docs/features/article-publishing-restart-recovery-development-plan.md`
- `/Users/apple/Desktop/cclink-dev/cclink-studio/docs/testing/article-publishing-runtime-convergence.md`
- `/Users/apple/Desktop/cclink-dev/cclink-studio/docs/reviews/article-publishing-system-closure-review-prompt-2026-09-01.md`

如果以下真实故障日志和截图仍可访问，也必须完整读取/查看：

- `/Users/apple/.codex/attachments/b9fc188d-1a64-4e5a-88f3-4c98387a0aed/pasted-text.txt`
- `/var/folders/4z/030bqrj52qn9vpf4w6hydk_c0000gn/T/codex-clipboard-3f7d3d6b-24ba-4886-be55-3ed3c00daecf.png`
- `/var/folders/4z/030bqrj52qn9vpf4w6hydk_c0000gn/T/codex-clipboard-d4a253e9-89d3-4b42-916e-c2f6d89546d7.png`

## 必须检查的当前实现

完整检查下列目录/文件及其直接测试、schema、IPC 和 preload，不得只审方案文档：

- `src/main/article-publishing/`
- `src/main/web-affairs/web-affair-service.ts`
- `src/main/web-affairs/web-affair-store.ts`
- `src/shared/article-publishing/`
- `src/shared/web-affairs/`
- `src/main/agent/agent-bridge.ts`
- `src/main/agent/message-context.ts`
- `src/main/agent-core/runtime/`
- `src/main/agent-core/backends/` 中当前文章发布实际使用的 backend
- `src/main/agent-core/tools/types.ts`
- `src/main/agent-core/tools/tool-host.ts`
- `src/main/browser/browser-task-runtime.ts`
- `src/main/browser/browser-task-types.ts`
- `src/main/browser/browser-manager.ts`
- `src/main/playwright/playwright-bridge.ts`
- `src/main/mcp/modules/browser/`
- `src/main/mcp/modules/web-affairs/`
- `src/preload/article-publishing-api.ts`
- `src/renderer/src/features/article-publishing/`
- `src/renderer/src/components/agent-panel/AgentPanel.tsx`

## 用户需求

当前存在两个黑盒：Studio 只显示粗状态，Agent 在一个长执行中自行完成多步。目标是让每个小步骤都明确：

- 起点状态；
- 本步执行者和唯一动作；
- 允许和禁止的工具；
- 终点状态；
- 成功证据；
- Runtime 身份；
- 失败位置和责任归属；
- 是否可重试、必须对账或需要人工。

用户不能反复登录配合调试。Studio 内部 Runtime、状态机和绑定错误不得伪装成登录、验证码或人工问题。

## 不可违反的产品边界

- `WebAffairService` 是唯一发布进度状态所有者。
- 不重新引入内容哈希、正文哈希、图片哈希、证据哈希或 `actionFingerprint`。
- 不迁移旧文章发布数据；新 schema 启用时旧文章发布事务直接删除，其他 WebAffair 保留。
- 不依赖旧网页 URL 恢复。
- 有 draftId 时必须从草稿管理页找回原草稿。
- 恢复必须核验真实账号、准确 draftId、标题和保存状态。
- 图片 URL 改变但图片仍存在时不得失败。
- 图片不确定时用户只能选择“网页里有”或“网页里没有，重新上传”，不能填写图片 URL。
- 发布请求已经派发但结果未知时禁止再次发布，只能核验。
- 不能为了继续运行降低串稿、错账号或重复发布保护。

## 必须重点裁决的问题

### 1. 是否应该引入 operation ledger

请判断方案中的 `executionProtocol.currentOperationRunId + operationRuns` 是否是合理的 WebAffair 子状态，
还是会与 checkpoint、Attempt、runtime binding、asset 和 sideEffect 形成第二套状态机。

必须给出：

- operation 与 checkpoint 的严格关系；
- checkpoint 应持久派生还是读取时计算；
- 哪些组合状态必须由一个 reducer 同时维护；
- 历史上限、重启恢复和旧文章数据删除方式；
- 是否存在更小而同样可观测的结构。

### 2. 一个长 Agent Run，还是每 operation 一个短 Run

方案暂定同一个 Agent Run 反复 claim/report operation。请结合当前真实代码裁决：

- `ToolExecutionContext.articlePublishingPolicy` 在 Run 启动时固定，动态 operation identity 如何可信注入？
- 如果 operationRunId 由模型参数携带，如何证明模型不能冒充旧/新 operation？
- BrowserTask 当前固定关联 `agentRunId`，一个 Run 跨多个 operation 是否符合生命周期？
- Agent complete/error、模型停止调用工具、人工等待、取消、CDP 重连和 App 重启时，当前 operation 如何收敛？
- 一个短 Run 一个 operation 是否更简单；若采用短 Run，BrowserTask、账号租约和 Page binding 是否会频繁
  重建并制造更多竞态？
- 是否有第三种更小方案，例如一个 Run、动态从 WebAffair 读取当前 operation、所有动作由 main 强制门禁？

必须明确推荐一种，不得把选择留给实现者。

### 3. recovery lease、BrowserTask correlation 和 WebAffair binding 的交接顺序

当前事实线索：

- `BrowserTaskRuntime.updateCorrelation()` 遇到现存 recovery lease 会拒绝；
- `transferAccountRecoveryLeaseToTask()` 才能在 BrowserTaskRuntime 内同步更新 correlation 和账号 owner；
- WebAffair 持久提交与 BrowserTaskRuntime 内存更新不可能组成一个数据库事务；
- Agent 只能在 `onRunPrepared` 完成后获得 MCP 工具。

请给出唯一推荐 handshake，逐步说明：

1. recovery verify/permit 何时写入；
2. BrowserTask 何时创建；
3. Page identity 在创建前后何时读取；
4. Page 改代后何时重新核验原草稿；
5. correlation、lease owner、WebAffair runtime binding 和 write permit 的更新顺序；
6. activeRuntimes 何时登记；
7. 登记前到达的 `onPageRuntimeBound` 如何缓存和重放；
8. Agent 第一次 inspect 何时开放。

对每两个步骤之间分别模拟 Studio 崩溃，写出重启后的权威状态和补偿动作。不能把跨 owner 连续调用称为
“原子”而不解释崩溃窗口。

### 4. operation 是否应该覆盖 Studio 内部步骤

请判断 `runtime.page.capture-before`、`runtime.page.capture-after`、`runtime.binding.commit` 等内部动作应该：

- 成为用户可见的持久 operation；
- 只成为当前 operation 内的结构化 transition/event；
- 或只记录诊断。

目标是在足够细和状态爆炸之间取得明确边界。必须给出拆分原则和恢复链的最终步骤表。

### 5. 新旧推进入口如何切断

检查当前：

- `article_publishing_report_checkpoint`
- `article_publishing_report_asset`
- `web_affair_finish_attempt`
- ArticlePublishingBrowserPolicy 的可信 evidence 入口
- Agent terminal/BrowserTask terminal 的统一 reconcile

给出上线 operation 协议后的删除或收窄顺序。证明不存在 Agent 自报 checkpoint 完成、旧 MCP 入口、
新 reducer 三条路径同时推进状态。

### 6. 真实 CSDN adapter 是否足以支撑单步终点

逐步核查 adapter 是否能可靠、结构化地验证：

- 登录账号；
- 管理页和草稿列表；
- 数字 draftId；
- 标题和保存状态；
- 正文编辑器；
- 每张图片存在性；
- title/summary/tags/category/cover；
- 保存结果；
- 发布结果和公开文章账号。

不能把动作守卫、Agent 文本、URL 猜测或 selector 猜测当 adapter 证据。尤其回答新任务何时取得数字
draftId；若取得 draftId 需要首次平台写入，必须定义副作用、防重放和崩溃恢复。

### 7. P0 是否过大

评估能否先做一个最小纵向切片，仅覆盖：

```text
恢复找到草稿
→ Page binding 改代
→ BrowserTask 创建
→ Agent 第一次 inspect
```

请明确该切片是否必须同时引入完整 claim/report MCP、完整 operation ledger 和 UI，还是可以用更小的共享
contract 先获得真实用户可见增量。不能用临时双写或一次性 debug 状态制造新的技术债。

## 必须推演的失败时序

至少逐项推演：

1. Page binding 在 recovery verify 后、BrowserTask 创建前改代。
2. BrowserTask 创建时改代，事件在 activeRuntimes 登记前到达。
3. WebAffair binding 已写但 recovery lease 尚未转交时崩溃。
4. lease 已转交但持久 binding 写入失败。
5. Agent 在 rebind 完成前发起第一次 inspect。
6. rebind 后旧 permit/旧 operation/旧 Agent 调用迟到。
7. Agent 完成一个 operation 后直接结束 Run。
8. Agent 在 operation running 时无事件、退出或被取消。
9. 人工接管后原 Agent 仍发送工具调用。
10. Studio 恢复期间再次重启。
11. CSDN SPA 导航、iframe、popup、新 Page 和 WebContents 重建。
12. 上传、保存、发布 dispatch 前后分别崩溃。
13. 草稿 URL 改变但 draftId 不变。
14. 当前 Tab 正确但 visible View 缺失。
15. execution、Attempt、BrowserTask 和 operation 状态互相矛盾。

## 测试方案评审

重点判断现有方案要求的测试是否真的驱动事件顺序，而不是 mock 最终状态。必须给出可重复测试设计，至少
覆盖：

```text
恢复找到草稿
→ recovery verify 使用 Page generation 31
→ BrowserTask 创建触发 generation 32
→ onPageRuntimeBound 在 activeRuntimes 登记前到达
→ 最新 Page 重新核验原账号、draftId、标题和 saved
→ BrowserTask/WebAffair/permit 收敛到 generation 32
→ Agent 第一次 article_publishing_inspect_page 成功
```

请区分：纯 reducer 单测、跨 service 集成测试、真实 Electron WebContentsView 测试、真实 CSDN 真人验收分别
能证明什么和不能证明什么。

## 输出格式

第一行只能是以下三种之一：

- `可直接开发`
- `修改方案后开发`
- `驳回，重新设计`

随后用简单人话给出：

1. 方案解决了什么，仍没解决什么。
2. 已被当前源码证明的事实。
3. 方案中的错误假设和证据不足部分。
4. P0/P1/P2 问题；每项包含触发条件、结果、代码根因、精确文件和行号。
5. 对上述 7 个裁决问题逐一给出唯一结论。
6. 修订后的最小数据结构、状态所有者、handshake 和执行顺序。
7. 修订后的最小施工批次；每批写明用户可见增量和退出门禁。
8. 可重复自动化测试和真实 CSDN 验收步骤。
9. 明确回答：是否可开始开发；若不可，必须先改哪几段方案。

不要只建议“增加日志、增加测试或多重试”。必须审查真实生命周期、状态推进权和副作用安全。
