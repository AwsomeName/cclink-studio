# UI 入口迁移盘点

> 状态：入口清理、工作空间抽象、新建入口、会话 Tab 第一段已执行
> 目标：把日常入口从“能力面板堆叠”迁回“工作空间 + Tab + 设置”，先清入口，再补远程能力。
> 里程碑验收：见 `docs/features/product-milestones.md`

## 结论

第一批迁移重点不是新增能力，而是清理入口职责：

- Activity Bar 已基本干净，只保留 `工作空间 / 搜索 / 浏览器 / 设置`。
- 第一批已把 `SettingsPage` 和 `Sidebar` 的用户侧命名收敛为“远程连接”，并移除了设置页里的远程会话预览。
- 工作空间面板已经能展示本地/远程工作空间，远程引用已抽象出 `transport`，真实直连协议后置。
- Android 已基本变成 Tab 能力和设备设置，但仍要防止重新出现在 Activity Bar。
- 同步已经在 Settings 和 Status Bar 中，方向正确；Status Bar 只能保留轻量状态，不能变成第二个设置页。

## 当前代码状态

| 层级         | 当前状态                                                                        | 判断         |
| ------------ | ------------------------------------------------------------------------------- | ------------ |
| Activity Bar | `ActivityPanel = files/search/browser`，设置走底部按钮                          | 基本符合     |
| Sidebar      | 工作空间面板中展示本地/远程工作空间、远程文件、远程会话                         | 第一批已完成 |
| Settings     | `remote-connections` 分组承接远程连接设置，兼容旧 `remote-agent` 跳转           | 第一批已完成 |
| CCLink Panel | 承载身份、旧账号导入、实时链路、服务器同步、清缓存和错误诊断                    | 第一批已完成 |
| WorkspaceRef | `remote` 已增加 `transport` 字段，CCLink 默认 key 保持兼容                      | 第二批已完成 |
| Tab Type     | `+` 菜单支持 Markdown、浏览器、Android、会话；远程会话新入口已走 `conversation` | 第四批第一段 |
| Status Bar   | 展示同步状态和当前工作空间/系统状态                                             | 保留轻量状态 |

## 第一批：清理日常侧栏入口

目标：用户日常只在工作空间里看工作内容，不在侧栏里处理账号、配对、诊断。

执行记录：

- `SettingsPage` 已把“远程 Agent”入口改为“远程连接”，并保留 `remote-agent -> remote-connections` 兼容映射。
- `CclinkPanel` 已收敛为设置页能力：身份、旧账号导入、实时链路、服务器同步、缓存和错误诊断。
- 设置页不再展示远程会话消息预览；远程会话只在对应工作空间的 `会话` 分组和会话 Tab 中出现。
- 远程工作空间侧栏里的分组改为 `文件` 和 `会话`，低频跳转改为“远程连接设置”。
- Command Palette 增加“远程连接：打开远程连接设置”。

本批动作：

1. `SettingsPage` 将 `remote-agent` 改名为 `remote-connections` 或中文“远程连接”。
2. `RemoteAgentSettings` 改名为 `RemoteConnectionSettings`，标题不再叫“远程 Agent”。
3. 从 `CclinkPanel` 中拆出设置页专用内容：身份、旧账号导入、实时链路、服务器同步、缓存清理、错误诊断。
4. `Settings > 远程连接` 不再展示远程会话消息预览；会话只出现在工作空间的 `会话` 分组或会话 Tab。
5. 工作空间面板中的“远程 Agent 设置”入口改成“远程连接设置”，作为低频跳转，不作为内容分组。

验收：

- Activity Bar 没有 CCLink、远程 Agent、Android 管理、同步配置入口。
- Settings 左侧没有“远程 Agent”这个产品名，统一叫“远程连接”。
- 工作空间面板里远程工作空间只展示文件、会话和必要的连接状态。
- CCLink 账号问题只能在设置里处理，不再占据日常侧栏。

## 第二批：工作空间模型补抽象

目标：让远程不再等于 CCLink，为直连 Remote 留出位置。

执行记录：

- `RemoteWorkspaceRef` 已增加 `transport: 'cclink' | 'direct'`。
- `remoteWorkspaceRef()` 默认使用 `transport: 'cclink'`，保证现有 CCLink 工作空间 key 不变。
- `workspaceRefKey()` 已改为 `${transport}://endpointId/workspaceId`。
- `workspaceRefSourceLabel()` 已输出 `远程 · CCLink · 设备名` 或 `远程 · 直连 · 设备名`。
- 已新增直连 Remote workspace key 的单元测试；真实直连协议仍后置。

本批动作：

1. `WorkspaceRef.remote` 增加 `transport: 'cclink' | 'direct'`。
2. `workspaceRefKey` 从写死 `cclink://...` 改为 `${transport}://...`。
3. `workspaceRefSourceLabel` 输出 `[远程 · CCLink]`、`[远程 · 直连]` 等稳定来源标识。
4. `getRemoteWorkspaceItems` 先继续只吃 CCLink servers，但返回统一 remote workspace view model。
5. 远程文件树接口先支持 CCLink provider，后续再接 direct provider。

验收：

- 本地和远程工作空间仍平铺，不新增“远程服务器”一级目录。
- CCLink 只是 `transport`，不是 remote 的同义词。
- 未来加直连 Remote 时，不需要重写工作空间列表和 Tab 归属。

## 第三批：新建入口统一

目标：所有“新开一个工作现场”的动作走 Tab 或添加工作空间菜单。

执行记录：

- Tab 栏 `+` 已是“新建标签页”菜单，不再默认等于新建 Markdown。
- 菜单支持 Markdown 草稿、浏览器页、Android 页和 Agent 会话。
- 浏览器图标继续保留为高频快捷入口。
- Command Palette 已补齐 Markdown、浏览器、Android 和 Agent 会话入口。
- Word、PPT 仍显示为规划中，不创建假 Tab。

本批动作：

1. Tab 栏 `+` 改成“新建标签页”菜单。
2. 菜单第一批支持 Markdown 草稿、浏览器页、Android 页、会话。
3. Office、Terminal、直连 Remote 可先显示为禁用/规划中，不创建假 Tab。
4. 工作空间区的添加入口改成：

```text
添加工作空间
├─ 打开本地文件夹
├─ 添加远程工作空间
│  ├─ 直连服务器
│  └─ 通过 CCLink
└─ 新建临时草稿
```

验收：

- `+` 不再默认等于新建 Markdown。
- 浏览器图标可以保留高频快捷入口，但不是唯一入口。
- Android 是 Tab 能力，不是 Activity Bar 内容库。

## 第四批：会话和 Terminal

目标：本地/远程会话完全统一，Terminal 也进入工作空间归属。

执行记录：

- 已新增 `TabType = 'conversation'`，并加入通用会话引用 `conversation.surface/runtime/sessionId`。
- `conversation.runtime.transport` 复用工作空间 transport 类型，支持 `cclink` 和未来 `direct`，避免会话模型再次绑死 CCLink。
- 远程工作空间里的会话入口已从 `type: 'cclink'` 改为 `type: 'conversation'`。
- 渲染层仍复用现有 `CclinkConversation`，但只作为 CCLink transport 的实现细节。
- 旧 `cclink` Tab 和旧 `cclinkSessionId` 字段仍保留，保证历史工作台快照和本地缓存能恢复。
- 已补去重逻辑：同一个远程 CCLink session 不会因新旧 Tab 类型重复打开。
- 已补 transport 区分测试：同一个 sessionId 在 `cclink` 和 `direct` 下不会互相误去重。
- 会话产品形态已明确为两类 surface：右侧 `assistant-panel` 的即时助手会话，Workbench `workbench-tab` 的工作会话。
- 本地 Agent 会话已补默认 `surface/runtime` 元信息；行为仍保留在右侧 Agent 面板，不急着全部 Tab 化。
- 新打开的远程工作空间会话已写入 `conversation.surface/runtime/sessionId` 新结构；旧 `kind/transport/sessionId` 结构只用于快照兼容。
- Tab 菜单里的“工作会话”已创建本地 `workbench-tab` 会话，并在 Workbench 中提供轻量发送/中止闭环。
- Agent 流式事件监听已从 `AgentPanel` 迁到 App 启动层的全局 hook，避免“右侧面板隐藏/居中切换”影响会话消息链路。
- Preload 的 Agent 事件订阅已改为返回取消订阅函数，不再用 `removeAllListeners` 抢掉其它订阅者。
- 右侧即时助手会话已增加“打开为工作会话”入口：同一会话可在 Workbench 作为 `conversation` Tab 打开；第一版不从右侧列表移除。
- 本地工作空间侧栏的“当前工作”已改为展示当前工作空间绑定的工作会话，不再混入右侧即时助手最近会话。
- 本地工作会话 Tab 已补标题同步、绑定工作空间、运行位置、transport、backend 和状态展示。
- Terminal 仍未接真实 shell；先保留为下一段设计，避免绕过权限/审计模型。

要做：

1. 将更多工作会话入口逐步迁为 `conversation`，等历史数据窗口稳定后再考虑删除旧 `cclink`。
2. 会话 Tab 展示运行位置、transport、执行后端和状态。
3. 继续设计“打开为工作会话”之后的归属、归档、删除语义，而不是把所有右侧 Agent 会话强行 Tab 化。
4. 新增 `terminal` Tab 类型，但第一版只定义生命周期和权限，不急着接真实远程 shell。
5. 远程 Terminal 默认走权限确认和审计，不继承本机宽权限。

验收：

- 用户看到的是“会话”，不是“CCLink 会话”。
- 远程会话只因运行位置不同而有元信息差异，不成为单独入口。
- Terminal 不成为全局无归属入口。

## 不应该做

- 不新增“远程 Agent 面板”。
- 不在工作空间列表外再套“服务器”一级目录。
- 不把 Codex、Claude Code、CCLink Studio Agent 做成工作空间类型。
- 不把 CCLink 运维台塞回日常侧栏。
- 不为了直连 Remote 先大改所有远程协议；先把 UI 和数据模型留好口子。

## 拷问

1. 如果第一批不先清入口，后续每加一个能力都会继续往侧栏堆，产品会越来越像临时调试台。
2. 如果 `remote` 继续写死 CCLink，直连服务器会被迫复用 CCLink 语义，后续一定返工。
3. 如果 Settings 继续复用完整 `CclinkPanel`，设置页会同时像账号页、设备页、会话页和运维台，用户仍然会迷路。
4. 如果会话 Tab 继续叫 `cclink`，用户心智会被绑定到传输通道，而不是工作空间会话。
5. 如果 Terminal 在权限模型前先实现，远程执行会成为最大安全洞。
6. 如果流式事件继续挂在 `AgentPanel` 组件里，布局切换、隐藏右侧面板或双形态挂载都会变成消息链路风险；会话运行时必须独立于 UI 容器。
