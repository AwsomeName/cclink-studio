# 本地优先身份与未登录工作台

> 状态：开工前规格
> 最后更新：2026-07-14
> 关联文档：`docs/features/product-milestones.md`、`docs/architecture.md`

## 结论

DeepInk 必须支持**不登录即可进入本地工作台**。

登录不应该是打开 App 的门槛，而应该是解锁云能力、订阅、CCLink/TIM、跨设备同步和远程配对的能力开关。用户第一次打开 DeepInk 时，系统应自动生成一个稳定的本地身份 ID，并用这个身份保存和恢复本机工作现场。

拷问：如果用户只是想写一篇 Markdown、打开一个本地项目、用本地 Terminal 或恢复昨天的标签页，却被手机号登录挡住，DeepInk 就不像桌面工作台，更像云 SaaS 壳。这会伤害最基础的可用性。

## 要解决的问题

当前实际状态：

- `App.tsx` 使用登录守卫；未登录只显示 `LoginPage`，不会挂载 `MainLayout`。
- `useWorkspaceBootstrap()` 只在 `MainLayout` 内执行；未登录时不会恢复 workspace state。
- `WorkspaceStateService` 已把工作台状态保存到 Electron `userData/workspace-state.json`，但没有正式本地身份概念。
- `auth-store.skipLogin()` 只提供开发态 `dev-user-001`，不是产品级匿名本地身份。

因此：

- 不登录不能进入主工作台。
- 不登录不能恢复工作现场。
- 本地状态没有清晰 owner，后续登录、登出、切换账号和合并会变复杂。

## 产品原则

1. **本地优先**：打开 App 默认进入本地工作台。
2. **登录增量解锁**：登录解锁云端身份相关能力，不影响本地工作台基础能力。
3. **本地身份稳定**：同一台设备上，未清除数据前，本地身份 ID 必须稳定。
4. **登出不清工作现场**：登出只清云 token、CCLink identity、云能力会话；不删除本地 workspace state、草稿、Tab、浏览器本地状态。
5. **合并可解释**：本地身份登录云账号后，必须明确本地工作现场如何绑定或迁移，不能静默丢弃。

## 身份模型

DeepInk 需要区分两类身份：

```text
LocalIdentity
├─ localId: local_xxx
├─ deviceId
├─ deviceName
├─ createdAt
├─ updatedAt
└─ boundCloudUserId?

CloudIdentity
├─ userId
├─ phone
├─ nickname
├─ avatarUrl
├─ loginMethod
└─ lastLoginAt
```

运行时有效身份：

```text
EffectiveIdentity
├─ localIdentity: 始终存在
└─ cloudIdentity: 登录后存在
```

用户侧显示：

- 未登录：`本机用户`
- 已登录：显示云账号昵称/手机号，同时保留本机设备身份

不要把本地身份叫“游客”。游客暗示临时、可丢；DeepInk 的本地身份应该是长期本机身份。

## 状态归属

第一阶段不做云同步，只做本机恢复。

工作台状态归属建议：

```text
ownerKey = local:${localId}
workspaceKey = null | localPath | cclink://... | direct://...
```

状态文件可以先继续使用 `workspace-state.json`，但 snapshot 需要逐步补充：

```ts
interface WorkspaceStateSnapshot {
  version: number
  ownerKey?: string
  workspaceId: string
  workspaceKey: string | null
  updatedAt: number
  sections: Record<string, unknown>
}
```

兼容策略：

- 旧 `workspace-state.json` 没有 `ownerKey` 时，首次启动迁移到当前 `local:${localId}`。
- 迁移只补 owner，不删除旧 sections。
- 后续如果支持多本机用户或账号切换，再按 ownerKey 隔离。

## 登录后的行为

登录成功后：

- 不重置工作台。
- 不自动清空未登录时的 tabs、drafts、agent conversations。
- `CloudIdentity` 只成为云能力凭证。
- 本地 workspace state 继续归属于 `local:${localId}`。
- 后续做云同步时，再提供“上传/绑定当前本机工作现场”的显式动作。

登出后：

- 保留本地工作台。
- 清除 accessToken、refreshToken、云用户缓存。
- 清除或失效 CCLink identity / TIM session。
- 订阅状态回到未登录/未知。
- 右上角或设置页显示“未登录，本机工作台可用”。

## 功能门控

未登录可用：

- 工作空间列表与本地文件夹打开。
- Markdown 草稿与本地文件读写。
- 浏览器 Tab、浏览历史、下载记录、站点登录态。
- 本地 Terminal。
- 本地 Agent/BYOK 后端，前提是用户已有本地配置。
- 工作台状态恢复。

未登录不可用或需提示登录：

- CCLink identity 创建、TIM 实时连接、远程配对。
- 订阅、支付、Pro 权益。
- DeepInk 云同步/云存储。
- 跨设备同步。
- 需要后端账号的推送、IM 和好友协作。

## 里程碑

### L0：规格与文档

目标：明确本地身份不是开发跳过登录，而是产品底座。

验收：

- 本文档存在并被 `product-milestones.md` 引用。
- `architecture.md` 明确登录不是工作台入口门槛。
- 功能门控清楚写明哪些能力需要云身份。

### L1：本地身份服务（已实现，待人工验收）

目标：主进程启动时确保存在稳定本地身份。

方案：

- 新增 `src/main/identity/local-identity-service.ts`。
- 写入 `userData/local-identity.json`。
- 暴露 IPC：`identity:getLocalIdentity`。
- preload 暴露 `window.deepink.identity.getLocalIdentity()`。

验收：

- 首次启动生成 `localId`。
- 重启后 `localId` 不变。
- 删除 `local-identity.json` 后会重新生成。
- 有单元测试覆盖生成、加载、损坏文件恢复。
- 代码入口：`src/main/identity/local-identity-service.ts`、`src/main/identity/identity-ipc.ts`。

### L2：认证状态改为本地可用（已实现，待人工验收）

目标：未登录也进入 `MainLayout`。

方案：

- `auth-store` 从单一 `loggedIn` 改为本地身份 + 可选云 session。
- `App.tsx` 不再用 `!loggedIn` 阻断主工作台。
- 登录页改为 Settings/Account 或启动提示中的可选入口。
- `useAppSession()` 完成后，即使云 session 不存在，也设置本地身份 ready。

验收：

- 无 token / 无网络 / 未配置 `DEEPINK_API_URL` 时仍进入主工作台。
- 登录入口仍可访问。
- 云功能入口提示登录，不崩溃。
- 开发用 `skipLogin()` 不再作为产品路径。
- 当前实现：`App.tsx` 不再用 `loggedIn` 阻断 `MainLayout`；设置页账户区提供云账号登录入口。

### L3：工作台状态按本地身份恢复（已实现，待人工验收）

目标：未登录用户重启后恢复工作现场。

方案：

- Workspace state snapshot 增加可选 `ownerKey`。
- 启动恢复时使用 `local:${localId}`。
- 旧无 owner 的 snapshot 自动迁移到当前 local identity。
- workspace 切换、tabs、browserTabs、editorDrafts、agentConversations 继续按 workspaceKey 分区。

验收：

- 未登录打开几个 Tab、草稿、浏览器页，重启后恢复。
- 切换本地工作空间后各自恢复。
- 旧状态文件不丢失。
- 登录/登出不清空本地工作现场。
- 当前实现：`WorkspaceStateSnapshot.ownerKey` 使用 `local:${localId}`，首次读取 owner 空间时兼容旧无 owner 快照。

### L4：云能力门控与登出语义（已实现，待人工验收）

目标：登录只影响云能力，不影响本地工作台。

方案：

- Settings 中账号区显示本机身份与云账号状态。
- CCLink/同步/订阅入口统一检查 cloud session。
- 登出只清云 session 和远程连接身份，不清工作台状态。

验收：

- 未登录点击 CCLink 同步会提示登录。
- 登录后可继续使用原本本地工作台。
- 登出后 tabs/drafts/workspace 仍保留。
- 相关提示文案不把本地用户称为“游客”。
- 当前实现：账户区区分“本机身份”和“DeepInk 账号”；CCLink 未登录态提示登录并禁用云身份操作。

### 当前实现验证

- `pnpm test -- --run`：55 个测试文件、345 个测试通过。
- `pnpm build`：TypeScript typecheck、main/preload/renderer build 通过。
- `git diff --check`：通过。

## 开工顺序

1. L1：先做主进程本地身份服务和 IPC。
2. L2：改 App 登录守卫，让未登录进入主工作台。
3. L3：把 workspace state 恢复接到 local identity。
4. L4：补云能力门控和登出语义。

拷问：

- 如果先改 UI 绕过登录，但没有本地身份，后面状态归属会继续混乱。
- 如果先做 ownerKey 隔离，但不迁移旧数据，会制造“升级后工作现场丢了”的事故。
- 如果登录后自动覆盖本地状态，会把最宝贵的未登录工作现场丢掉。
- 如果登出清本地状态，用户会把 DeepInk 当成不可信的本地工具。
