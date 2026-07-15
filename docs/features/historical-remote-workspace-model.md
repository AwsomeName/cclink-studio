# Historical: Remote 工作空间模型

> 当前状态：历史/商业能力材料，不属于 CCLink Studio OSS 当前事实源。
>
> 本文封存旧 `project-system.md` 中的 Remote/CCLink 工作空间方向。当前开源 Studio 默认不包含远程工作空间、CCLink transport、远程文件 provider、远程 Terminal、账号、订阅、entitlement 或配对。官方远程能力如需继续推进，应在 `/Users/apple/Desktop/cclink-dev`、`/Users/apple/Desktop/chat-cc/deploy` 和 `/Users/apple/Desktop/chat-cc/Agent` 中分别维护。

## 历史方案摘要

旧方案希望把本地工作空间扩展为统一 `WorkspaceRef`：

```ts
type WorkspaceRef =
  | { kind: 'local'; path: string }
  | {
      kind: 'remote'
      transport: 'direct' | 'cclink'
      endpointId: string
      workspaceId: string
      path: string
      label?: string
    }
  | { kind: 'global' }
```

对应产品设想：

- 本地工作空间和远程工作空间在列表中平级展示。
- Remote 是“工作空间可以在远端机器上”的能力。
- CCLink 只是 Remote 的一种 transport。
- 远程文件、远程 Terminal、远程会话都归属到远程工作空间。
- 账号、配对、entitlement、token 和诊断由商业控制面提供。

## 为什么封存

这条路线涉及已迁出或商业侧能力：

- `src/main/remote`
- `src/shared/remote-*`
- `src/shared/ipc/remote.ts`
- `src/main/ipc/remote-ipc.ts`
- CCLink/TIM transport
- 远程文件树和远程文件查看 UI
- 远程 Terminal adapter
- entitlement gate
- 官方账号、配对、token、quota、诊断后台

这些能力不属于 `cclink-studio` OSS 默认边界。当前 OSS 工作空间模型应只承诺本地文件夹、未归档、Tab、草稿、会话和本地 Terminal。

## 后续若恢复

如果官方版本恢复远程工作空间，必须满足：

- 由 `cclink-dev` 注入商业 overlay，不污染 OSS 默认路径。
- 云函数/account/entitlement/pairing/token 在 `/Users/apple/Desktop/chat-cc/deploy`。
- Agent runtime 在 `/Users/apple/Desktop/chat-cc/Agent`。
- OSS 侧只保留明确的扩展点或空实现。
- 所有 remote contracts 必须重新对齐当前代码，而不是从历史文档反向恢复。

## 拷问

不要因为历史方案写得完整，就把它当成仍然成立。

Remote 最大风险不是协议难，而是边界污染：一旦把账号、配对、entitlement、远程文件和远程执行重新塞回 OSS 壳，`cclink-studio` 就不再是可独立开源的本地工作台。
