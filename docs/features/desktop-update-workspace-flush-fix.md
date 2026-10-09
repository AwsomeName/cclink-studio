# Desktop Update Workspace Flush Fix

> 状态：`IMPLEMENTED / AFFECTED GATES PASS / RELEASE PENDING`，2026-10-09。
> 本文固定 v0.1.105 → v0.1.106 真实失败的最小修复；代码与受影响门禁已完成，但尚未提交、
> 发布或完成真实应用连续升级，不能据此宣称自动更新闭环已恢复。产品事实源仍为
> `desktop-release-and-updates.md`，安装事务决策仍为 ADR 0021。

## 结论

v0.1.105 已能下载并校验 v0.1.106，但在点击“安装并重启”后，安装前工作现场保存失败，
所以 Studio 按设计没有退出，也没有替换当前应用。真实错误不是 `/Applications` 无写权限，
而是 `agentConversations` 快照超过 32 MiB IPC 上限；更新 UI 又把这个错误掩盖成了通用的
“可能没有替换权限”。

独立评审已于 2026-10-09 同意按以下四处最小改动实现：

1. 在现有 `WorkspaceStateService` / `agentConversations` 所有权内，写入一个无损的持久化投影，
   只省略可按 `text + thinking` block 顺序恢复的重复 `rawText`；不删除会话、消息或可见正文。
2. 让现有历史保护识别新投影，避免因新消息对象更小而回填旧版重复 `rawText`。
3. 把安装顺序改为“冻结新工作 → 预先保存 → 创建安装暂存 → 最终保存 → 提交并退出”，
   既避免保存注定失败时先创建候选，也覆盖暂存耗时期间发生的状态变化。
4. 让 renderer flush 只回传有界错误码，主进程据此展示真实原因；不把任意错误文本跨 IPC
   传播。

本轮不新建会话分片存储、不新增状态所有者、不提高 32 MiB 上限、不静默裁剪历史，也不借机
重做更新器。若无损投影仍不能让本次失败级别的样本低于上限，本候选即判定不成立，必须带着
字段级字节证据重新评审；实现者不得在同一改动中自行扩张为分片存储或有损摘要。

## 用户端到端验收动作

### 本次修复完成标准

1. 准备与真实故障同级的工作空间样本：至少 23 个会话、2,044 条消息，并包含导致旧版
   快照达到 30,229,308 个序列化字符的 `rawText`、thinking 与中文正文结构。
2. 在修复版打开该工作空间，继续发送一条消息，关闭并重开 Studio；会话数量、顺序、活动
   会话、消息数量、用户/Agent 可见正文和工具活动均可恢复。
3. 在修复版下载下一个正式签名、公证版本，点击“安装并重启”；不手工关闭 Studio、不拖动
   `.app`、不手工启动新版，即可看到新版窗口。
4. 核对版本号、工作空间、标签、文档和上述会话历史；再用下一个正式版本重复一次第 3–4 步。
5. 用不可无损缩减到上限以内的故障样本重试：当前版本不退出，应用目录不产生安装候选残留，
   UI 明确提示“Agent 会话历史无法保存”，并保留“打开安装包”兜底。

只有第 1–5 步均有真实应用证据，才能声明自动更新闭环恢复。单测、构建成功、Helper 实验或
一次手工安装不能替代这组验收。

### 旧版修复引导边界

v0.1.105 本身不包含修复代码，因此受影响用户仍需手工安装一次首个修复版。之后的两轮升级
才验证应用内自动替换。旧版失败后，磁盘上最后一次成功快照仍受保护，但失败后只存在于当前
renderer 内存的新会话内容不能靠新版本事后恢复；若旧版仍开着且这些内容重要，关闭前必须先
执行单独的数据救援，不能把“安装修复版”描述成会自动找回未落盘内容。

## 已确认事实

### 真实失败证据

- 当前版本：v0.1.105；候选版本：v0.1.106；arm64 稳定通道。
- 2026-10-09 13:00（Asia/Shanghai）Framework 日志记录：
  `shutdown-flush-failed`，原因是“保存 agentConversations 失败：Agent 会话状态 JSON
  超过大小限制”。2026-10-09 01:26、01:29 还出现过同类失败。
- 失败时的脱敏统计：23 个会话、2,044 条消息、`textCharacterCount=2,347,050`、
  `serializedCharacterCount=30,229,308`。字符数不是 UTF-8 字节数；现有契约按
  `Buffer.byteLength(JSON.stringify(value), 'utf8')` 执行 32 MiB 上限。
- `/Applications` 对当前用户可写；当前 App 和安装 Helper 的签名检查通过。不能再把本次
  故障归因为替换权限。
- 失败后当前 App 保持运行，说明 fail-closed 生效；但安装器已在保存之前执行 `stage()`，
  留下未完成的事务/候选目录，说明执行顺序和取消清理仍需修正。

### 代码根因

- `buildAgentConversationWorkspaceSnapshot()` 保存该工作空间的全部会话和全部消息，只清理
  输入框、待发图片和流式运行状态。
- 每条消息同时保存结构化 `content` 与可按 text/thinking block 顺序推导的 `rawText`；
  本次真实样本去掉这份重复数据后，预计比 32 MiB 上限低约 2.9 MiB。
- `workspaceStateConversationValueSchema` 对完整 `agentConversations` 分区设置 32 MiB 上限。
- `UpdateService` 当前顺序是 `stage → acquire → inspect → flush → arm → commit → quit`，
  因而持久化失败发生在创建安装暂存之后。
- renderer acknowledgement 只有 `success: boolean`；主进程拿不到保存失败分类，于是落入
  通用 `install_failed` 文案。

## 最小实现边界

### A. 无损持久化投影

在现有会话快照构建/恢复边界增加版本化的持久化投影，仍通过同一个
`agentConversations` section、同一个 IPC 和同一个 `WorkspaceStateService` 写入：

- 所有会话 ID、顺序、活动会话、会话配置、session/runtime 引用、消息 ID、角色、时间、
  用户可见正文、thinking、工具名称、工具输入和工具结果都必须保持语义等价。
- `rawText` 与按 block 原顺序拼接的 `text + thinking` 完全一致时只持久化 `content`，恢复时
  重建 `rawText`；不一致时保留两者，防止旧数据被误判为重复。
- `_rawInputJson`、其他消息字段和运行状态不在本轮投影范围内。
- 不改变“普通快照不得缩短会话历史”的保护。新旧投影必须双向兼容，现有快照可读；写入新
  投影后重启再写不能被误报为历史回退，也不能从旧快照回填已省略的重复 `rawText`。

投影完成后的硬门禁是：真实故障同级样本小于 32 MiB，并且关闭/重开后语义恢复。若仍超限，
UI 返回明确错误而不是删除历史。此时停止实现并重新评审是否需要由同一
`WorkspaceStateService` 内部做分片；分片不是本轮预授权范围。

### B. 安装顺序

`UpdateService` 的目标顺序固定为：

```text
inspect
  -> revalidate downloaded asset
  -> acquire existing Agent/scheduler guard
  -> inspect again
  -> preflight flush renderer and main stores
  -> inspect again
  -> stage verified candidate
  -> final flush renderer and main stores
  -> arm helper
  -> final inspect
  -> commit
  -> quit
```

UI 在 `installing` 期间继续冻结交互，现有 guard 继续阻止新 Agent/定时任务进入。任何
inspect、flush 或 stage 失败都释放 guard、保留旧版运行，并回到可重试/手工安装状态。
`stage()` 的取消路径还必须删除本次 nonce 对应的事务和候选目录；不得清理其他更新事务，
不得扩大到通用缓存重构。

### C. 有界错误回传

扩展现有 flush acknowledgement，只增加两个枚举错误码：

```text
agent_conversations_too_large
workspace_flush_failed
```

renderer 不回传底层异常文本。主进程将这些代码映射为 `install_blocked` 的安全文案；其中
`agent_conversations_too_large` 必须明确指出“工作现场未保存，当前版本没有退出”，并保留
重试和打开安装包入口。flush 超时由主进程现有协调器自行识别并归入普通保存失败，不要求
renderer 回传第三个错误码。诊断继续使用现有脱敏统计，不能把会话内容放进日志。

## 明确不做

- 不把 32 MiB 改成 64/128 MiB 来延后再次失败。
- 不按“最近 20 个”、时间或归档状态自动删除会话或消息。
- 不把工具结果静默改成摘要、截断文本或丢掉旧消息。
- 不借本轮继续压缩 `_rawInputJson`、省略 `false/null` 或新增字段级运行时统计。
- 不新增第二个会话数据库、第二个更新状态机、第二套安装 Helper 或新的 IPC 入口。
- 不降低保存失败时禁止退出的保护，也不跳过签名、公证、版本或架构校验。
- 不把 Finder 手工拖动包装成自动更新完成。
- 不顺带处理旧备份轮换、断电恢复、差分更新或其他既有残余边界。

## 工程任务与证据

| 改动 | 必须提供的证据 |
| --- | --- |
| 版本化无损投影 | 新旧快照兼容测试；`text + thinking` 顺序恢复测试；不等价 `rawText` 保留测试；23/2,044 故障级样本低于 32 MiB 上限约 2.9 MiB；恢复后语义等价测试 |
| 历史保护 | 普通保存不能减少会话/消息；用户显式清空/删除仍只作用于目标会话；新投影不会触发 regression 回填旧冗余字段 |
| 双 flush | 顺序测试证明预先 flush 失败时 `stage` 未调用，最终 flush 失败时 `arm/commit/quit` 未调用且 staged transaction 已取消；guard 已释放；旧版保持运行 |
| stage 清理 | stage、arm、commit 各故障点只清理本次 nonce 目录；无残留候选；旧 App 路径始终存在 |
| 错误回传 | IPC schema 拒绝未知/超长错误；UI 显示会话保存原因而非权限猜测；日志不含正文 |
| 正式升级 | 两轮签名、公证 Release 的真人“安装并重启”与工作现场恢复记录 |

实现改到发布脚本、签名、公证、Manifest 或 workflow 时，按发版纪律升级为额外发布验证；
否则只运行受影响测试与 `pnpm verify`，正式发布仍统一使用 `pnpm release -- --patch --yes`。

## 拷问结论与停止条件

- **关键证据**：评审对真实样本复算后，正确省略可由 `text + thinking` 恢复的 `rawText`
  可使快照低于 32 MiB 上限约 2.9 MiB；本轮不再扩张到其他字段压缩。
- **最容易伪完成的地方**：只改错误文案或把 stage 后移，会让失败更干净，但不会让用户自动
  更新；只提高上限则会把同一故障推迟到更大的历史。
- **最危险的扩张**：为一次容量事故直接引入分片存储，会同时扩大迁移、原子写、备份恢复和
  历史保护范围。没有无损投影失败证据前不得做。
- **当前用户仍不能做什么**：受影响的 v0.1.105 现在仍不能完成自动替换；首个修复版发布前，
  只能保留旧版运行或在确认数据已保存/救援后手工安装。
- **工程结果**：版本化投影、历史保护兼容、stage 前后双 flush 和两类错误码已经实现；
  32 MiB 跨界无损投影测试、相关 162 项测试、typecheck、lint 和 production build 通过。
- **剩余门禁**：全仓 `pnpm verify` 被其他并行开发中 3 个未格式化的 company-accounts 文件
  阻塞，本次文件的 Prettier 检查已通过。修复仍需提交、发布及两轮真实应用内升级验收。
