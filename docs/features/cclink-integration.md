# Historical: CCLink 功能融入 DeepInk 设计方案

> 当前状态：历史设计，不再作为 CCLink Studio 的产品/架构事实源。
>
> 本文的核心假设是“CCLink 功能融入 DeepInk”。当前决策已经反转：产品是 **CCLink Studio**，原 DeepInk 战略上并入 CCLink，成为 CCLink 的桌面工作台端。Studio 开源壳不默认内置账号、TIM、配对、远程工作区和商业发布链路。
>
> 真实边界见 `docs/architecture.md` 与 `docs/cclink-studio-boundary-and-migration.md`。本文下方内容只用于历史追溯和迁移排查。

# CCLink 功能融入 DeepInk 设计方案

> 状态：账户身份、TIM 实时链路、已配对 Agent 同步、远程文件请求链路、远程工作空间列表和远程只读文件预览已接入；下一步补远程会话实时发送与权限工具卡片闭环
> 来源参考：`/Users/apple/Desktop/chat-cc`
> 目标：把 CCLink 的远程 Agent、会话、文件、工具卡片和配对能力作为 DeepInk Remote 的一种连接通道融入 DeepInk，而不是迁移 Swift 客户端，也不是把 Remote 等同于 CCLink。
> 协议改造：`docs/features/chatcc-agent-structured-error-protocol.md`

## 产品定位

CCLink 在 DeepInk 中不是独立 App，也不是一个“聊天页”。它是 DeepInk Remote 的一种 transport，用于账号配对、设备发现、实时链路和中继；不是 DeepInk Remote 的唯一实现。

```text
DeepInk
  工作空间：本地 / 远程直连 / 远程 CCLink / 未归档
  Transport：local / direct / cclink
  执行后端：DeepInk Agent / Codex / Claude Code / 自定义后端
  Tab：Markdown / Browser / Android / Terminal / Remote File / Session
```

用户最终感受到的是：

- 可以在 DeepInk 里添加一台远程电脑或服务器。
- 可以把远程机器上的目录作为 DeepInk 工作空间打开，类似 VSCode Remote 的远程工作区。
- 可以通过 CCLink 连接，也可以在未来通过用户自己的 IP、域名、内网地址、VPN、SSH 或远端 Agent 地址直连。
- 可以查看远程机器上的工作区和会话。
- 可以像本机工作空间一样给该工作空间里的执行后端发任务。
- 可以看到远程工具调用、文件读取、diff、终端输出、权限确认。
- 可以从远程文件引用跳到 DeepInk 的主工作区查看文件或 diff。

## 与工作空间系统的关系

CCLink 不是“远程 Agent 面板”。它是远程工作空间来源之一，也是连接通道之一。Remote 不是 CCLink 的别名；直连 Remote 与 CCLink Remote 在工作空间列表中平级。

在工作空间系统中，远程目录和本地文件夹平级：

```text
工作空间
├─ [本地] DeepInk
├─ [远程 · 直连] Mac mini /Users/app/project-a
└─ [远程 · CCLink] supermicro /data/research
```

产品规则：

- 本地/远程只作为工作空间来源 badge，不新增“本地”“远程”一级分组。
- 直连、CCLink 等只作为连接通道标识，不新增“服务器”一级目录。
- 激活远程工作空间后，主工作区恢复该远程工作空间自己的 Tab 集合。
- 激活远程工作空间后，工作空间行下展开文件树和会话。
- 远程会话不单独成为产品入口；它显示在对应工作空间的 `会话` 分组里。
- 未归档仍固定在侧栏底部，承接没有工作空间归属的远程/本地会话。

工程边界：

- 本地工作空间当前由 `workspacePath` 表示。
- 远程工作空间需要统一 `WorkspaceRef`，例如 `{ kind: 'remote', transport: 'cclink', endpointId, workspaceId, path }`。
- 文件浏览应抽象为 provider：本地 provider 走 `fs` IPC，直连远程 provider 走 direct remote service，CCLink provider 走 CCLink file service。
- 会话列表应按工作空间归属过滤：本地和远程都展示为 `会话`，运行位置、连接通道和执行后端作为元信息展示。

## 核心约束：CCLink 路线只维护一个远程 Agent runtime

CCLink 路线的远程侧只维护 `/Users/apple/Desktop/chat-cc/agent` 这一套 `chatcc-agent`。

在 CCLink 这条路线里，DeepInk 不另起第二套远程 Agent daemon，不重新实现一个 `deepink-remote-agent`，也不把本机 `AgentBridge` 复制到远程机器上。DeepInk 桌面端只做三件事：

- 作为 CCLink 客户端：登录 TIM、配对、收发 `cc_type` 消息。
- 作为工作台 UI：把 CCLink 同步到的远程目录展示为工作空间，把远程协作过程展示为普通会话，把远程文件展示为工作空间文件。
- 作为本地状态缓存：保存历史服务器、历史会话和历史消息，支持离线查看。

因此架构边界是：

```text
DeepInk Desktop
  -> CCLink client/controller/workbench

chatcc-agent
  -> 唯一远程 Agent runtime
  -> 运行在用户远程 Mac/Linux/服务器
  -> 负责 Claude Code、文件系统、shell、权限请求、流式事件
```

后续如果要增强 CCLink 路线的远程能力，优先修改和发布 `chatcc-agent`，而不是在 DeepInk 仓库里新增另一套 CCLink 远程 daemon。直连 Remote 可以有独立的 direct remote service 设计，但不能反过来污染 CCLink 账号和配对逻辑。

## 账户打通原则

CCLink 不能作为另一套独立账户体系接入 DeepInk。用户体验上必须是：

```text
用户用同一个手机号登录 DeepInk
  -> 自动拥有同一个 CCLink 远程 Agent 身份
  -> 可生成 Setup Code
  -> 可登录 TIM
  -> 可绑定 chatcc-agent
```

但工程上“同一个手机号”只是入口，不是完整打通。必须保证 DeepInk 账户和 CCLink 账户最终映射到同一个远程 Agent owner：

```text
DeepInk User
  id / phone / subscription
  |
  | account bridge by normalized phone
  v
CCLink Identity
  account_user_id / im_user_id       // 例如 ccu_xxx
  client_im_user_id                  // 例如 ccu_xxx_dev_hash
  im_user_sig                        // TIM 登录凭证
  auth_token                         // generateSetupCode / 云函数鉴权
  sdk_app_id
```

因此 DeepInk 不应该让用户再单独登录一次 ChatCC，也不应该在本地手动填 TIM 凭证。DeepInk 登录成功后，主进程应通过后端获取或创建对应的 CCLink identity，并把该 identity 加密缓存到本机。

### 短期实现策略

为了最快接通现有 `chatcc-agent`，短期以 ChatCC 现有账号/IM 规则为 CCLink identity 真相源：

- DeepInk 仍保留自己的手机号登录入口。
- DeepInk 后端或兼容网关根据手机号获取/创建 ChatCC `users` 记录。
- 如果同手机号已有旧 ChatCC `users.im_user_id`，必须优先复用旧 `im_user_id`，否则历史 `paired_agents` 会断链。
- 返回 `account_user_id`、`client_im_user_id`、`im_user_sig`、`auth_token`、`sdk_app_id`。
- DeepInk 使用这些字段生成 Setup Code、登录 TIM、收发 `cc_type` 消息。
- 订阅/配额后续再做统一结算，但 CCLink 远程 Agent owner 必须先统一。

桌面端当前已实现的 bridge 调用：

```http
POST /auth/cclink/identity
Authorization: Bearer <DeepInk accessToken>
Content-Type: application/json

{
  "phone": "13800138000",
  "device_id": "deepink-desktop-uuid",
  "device_name": "MacBook DeepInk",
  "platform": "desktop",
  "os": "darwin 25.x"
}
```

期望响应：

```json
{
  "identity": {
    "account_user_id": "ccu_xxx",
    "im_user_id": "ccu_xxx",
    "client_im_user_id": "ccu_xxx_dev_hash",
    "im_user_sig": "TIM UserSig",
    "auth_token": "ChatCC auth token",
    "sdk_app_id": 1600142242,
    "expires_at": "2026-08-01T00:00:00Z"
  }
}
```

兼容响应：字段也可以平铺在顶层，桌面端会自动归一化。

当前桌面端状态：

- 已加 `CclinkIdentityStore`，使用 Electron `safeStorage` 加密保存 identity。
- 已加 `CclinkIdentityService`，通过 DeepInk access token 请求 `/auth/cclink/identity`。
- 已加 IPC：`cclink:getIdentity`、`cclink:ensureIdentity`、`cclink:clearIdentity`、`cclink:syncPairedAgents`。
- 历史远程 Agent 侧栏曾显示“账户身份未同步/已同步”，并提供“创建 DeepInk 身份”按钮；新产品方向中，这类账号状态迁入 `设置 > 远程连接`。
- “创建 DeepInk 身份”只创建或刷新 DeepInk 侧 CCLink/TIM 身份；它不会自动查旧 CCLink 数据库。
- 同步服务器时，桌面端会先查 DeepInk bridge；如果 bridge 没返回服务器，并且配置了 `CCLINK_LEGACY_API_URL`，会按旧 iOS 逻辑 fallback 到旧服务的 `getPairedAgents`。

如果后端尚未部署 `/auth/cclink/identity`、`/auth/cclink/legacy-bind` 或 `/auth/cclink/paired-agents`，点击“创建 DeepInk 身份 / 导入旧 CCLink 账号 / 同步服务器”会显示接口错误；这是预期状态，不代表桌面端链路坏了。该接口需要 CloudBase auth 函数配置 `CCLINK_IM_SECRET_KEY`（兼容 `IM_SECRET_KEY`）后才能生成 TIM UserSig。

如果看到旧 CCLink 返回 `USER_NOT_FOUND`，说明 DeepInk 当前缓存的是新生成的 `ccu_xxx`，不是旧 ChatCC 用户。不要在前端硬编码旧账号；需要重新设计一个不修改旧 CCLink 线上函数的迁移/导入路径。

当前采用的迁移/绑定路径：

- 不修改旧 `chat-cc` 云函数。
- DeepInk 侧提供“导入旧 CCLink 账号”。
- 用户点击“发送旧账号验证码”，桌面端调用旧 CCLink 已有 `sendSmsCode`。
- 如果本地已有 DeepInk 新建 CCLink 身份，点击“发送旧账号验证码”会先自动移除该本地身份，避免继续拿新 `ccu_xxx` 去旧 CCLink 查服务器。
- 用户输入旧 CCLink 短信验证码后，桌面端调用旧 CCLink 已有 `genUserSig`，取得旧 `account_user_id`、`client_im_user_id`、`im_user_sig`、`auth_token`。
- 桌面端再调用 DeepInk `/auth/cclink/legacy-bind`，把旧身份绑定到当前 DeepInk 登录用户。
- `/auth/cclink/legacy-bind` 会带上旧 CCLink 手机号，并要求当前 DeepInk 云端用户记录已绑定同一个手机号；如果当前 DeepInk 登录态是微信/无手机号，需要先退出并用该手机号登录 DeepInk。
- DeepInk 绑定前会用旧 `getPairedAgents` 校验旧 `auth_token`，确认该旧身份有效；校验通过后写入当前 DeepInk 用户的 `cclinkAccountUserId`、`cclinkSource = legacy-chatcc`。
- 绑定完成后，DeepInk `/auth/cclink/identity` 会稳定返回旧 `account_user_id` 对应的新桌面端身份，后续重启也不会重新生成错误的新 `ccu_xxx`。
- 后续“同步服务器”仍会保留旧 `getPairedAgents` fallback，因此即使 DeepInk 和旧 ChatCC 不在同一个数据库环境，也能拿到旧账号已配对服务器。

绑定接口：

```http
POST /auth/cclink/legacy-bind
Authorization: Bearer <DeepInk accessToken>
Content-Type: application/json

{
  "account_user_id": "ccu_old",
  "im_user_id": "ccu_old",
  "client_im_user_id": "ccu_old_dev_hash",
  "im_user_sig": "old TIM UserSig",
  "auth_token": "old ChatCC auth token",
  "sdk_app_id": 1600142242,
  "device_id": "deepink-desktop-uuid",
  "device_name": "MacBook DeepInk",
  "phone": "13800138000"
}
```

绑定边界：

- DeepInk 云端无法从旧 UserSig 反推出手机号；绑定校验的是“当前 DeepInk 用户手机号”和“旧 CCLink 登录手机号”必须一致，再用旧 `auth_token` 证明旧账号有效。
- 这符合账号迁移/绑定语义：必须先用同一个手机号登录 DeepInk，再用旧 CCLink 短信登录拿到旧 token，才能把旧 CCLink 账号绑定到当前 DeepInk 账号。
- 如果当前 DeepInk token 对应的是微信/无手机号账号，绑定接口会返回 `DEEPINK_PHONE_REQUIRED`，避免静默绑错账号。
- 如果绑定接口返回 404，说明线上 auth 云函数还没包含 `/auth/cclink/legacy-bind`，需要重新上传 `private-serv/cloud/auth-function.zip`。

如果未来真的必须修改旧 `chat-cc` 云函数，DeepInk 侧只产出可粘贴给 `chat-cc` 会话的需求文本，不直接修改旧仓库。

已配对 Agent 同步接口：

```http
GET /auth/cclink/paired-agents
Authorization: Bearer <DeepInk accessToken>
```

返回值只负责把旧 ChatCC 已配对服务器同步到 DeepInk 本地缓存：

```json
{
  "agents": [
    {
      "agent_id": "agent_xxx",
      "name": "Mac mini",
      "hostname": "mac-mini.local",
      "os": "darwin",
      "status": "online",
      "last_seen": 1783564800
    }
  ]
}
```

边界说明：

- `/auth/cclink/paired-agents` 只返回已配对 Agent 基本信息，不返回远程目录列表。
- DeepInk bridge 和旧 ChatCC 原始 CloudBase 可能不是同一个数据库环境，所以桌面端保留旧 `getPairedAgents` fallback。
- 如果曾经缓存过错误的新 `ccu_xxx`，需要先在侧栏点“移除”，再走“导入旧 CCLink 账号”。不要点“创建 DeepInk 身份”，否则会重新创建 DeepInk 新身份。
- 远程目录/工作空间由实时链路上的 `server_meta` 刷新；激活远程工作空间后，侧栏会通过 `file_tree_request` 展示远程文件树，点击文件以只读 `remote-file` Tab 打开。
- 如果同步后看到服务器但没有工作空间，说明账户配对已打通，但远程 Agent 尚未上报工作空间。
- 如果同步后仍没有服务器，优先检查 CloudBase 里同手机号旧 ChatCC 用户是否存在 `im_user_id` 和 `paired_agents`。

部署/更新 auth 云函数：

```bash
npm run private:cloud:build-auth
# 然后到 CloudBase 控制台上传 private-serv/cloud/auth-function.zip 到 auth 函数
```

线上版本探针：

```bash
curl -s "$DEEPINK_API_URL/auth/version"
```

期望返回：

```json
{
  "success": true,
  "service": "deepink-auth",
  "version": "2026.07.10-cclink-auth-alignment.1",
  "capabilities": {
    "cclinkIdentity": true,
    "cclinkLegacyBind": true,
    "cclinkPairedAgents": true,
    "cclinkStrictPhoneBinding": true
  }
}
```

如果本地已安装 CloudBase CLI：

```bash
TCB_ENV_ID=你的环境ID npm run private:cloud:deploy-auth
```

注意：只修改 `private-serv/cloud/functions/auth/index.js` 不会影响线上。桌面端默认请求线上 CloudBase 地址，必须重新上传 `private-serv/cloud/auth-function.zip` 或执行 `private:cloud:deploy-auth` 后，线上才会包含 `GET /auth/version`、`POST /auth/cclink/identity`、`POST /auth/cclink/legacy-bind` 等 route。

### 长期实现策略

长期应收敛成一个 DeepInk Account Authority：

- 手机号、用户资料、订阅、设备、Agent 配额都在 DeepInk 账户体系内。
- CCLink 后端的 `genUserSig/generateSetupCode/validateSetupCode` 变成 DeepInk 账户服务下的能力。
- ChatCC 原有 `users.im_user_id` 作为兼容字段保留，避免破坏现有 `chatcc-agent`。
- 已绑定 Agent 通过手机号或 `im_user_id` 做一次迁移映射。

### 关键边界

- 不能只靠“两个系统都用同一个手机号”来假装打通。
- Setup Code 必须绑定到当前 DeepInk 登录用户对应的 CCLink identity。
- TIM 登录必须使用同一个 `client_im_user_id`，否则 Agent 只认配对客户端时会拒绝消息。
- 登出 DeepInk 时，CCLink identity 和 TIM session 也要同步退出或失效。

## 不迁移的部分

以下内容只作为行为参考，不进入 DeepInk 代码主线：

- `iOS-SmartWebView` / `ios-print-backup` 的 SwiftUI 界面。
- SwiftData / Keychain / iOS navigation 结构。
- iOS 底部 Tab 形态。
- Android porting 文档中的 Compose 对照表。

## 需要迁入的部分

来自 `chat-cc` 的核心资产：

```text
proto/im-messages.md       -> cc_type 消息协议
proto/data-models.md       -> Server / Workspace / Session / Message / ToolInfo
proto/rest-api.md          -> Setup Code、UserSig、Quota 等云函数 API
agent/src/*                -> 远程 daemon 行为和 runtime 规则
deploy/handlers/*          -> 云函数业务能力
admin/*                    -> 后台能力，后续接入管理页
```

## DeepInk 侧模块边界

```text
src/shared/chatcc/
  models.ts                // Server / Workspace / Session / Message / File / Tool 类型
  protocol.ts              // cc_type 消息 union + 基础校验
  index.ts

src/main/cclink/
  cclink-store.ts          // server/session/message 本地持久化
  cclink-api-client.ts     // CloudBase API：genUserSig/generateSetupCode/checkQuota
  cclink-tim-transport.ts  // TIM SDK 登录、收发 C2C custom message
  cclink-router.ts         // cc_type 分发
  cclink-protocol-router.ts // server/session/message 协议入库
  cclink-request-router.ts // request_id 匹配、超时和错误响应处理
  cclink-realtime-bridge.ts // transport incoming 同时接入 request/protocol 路由
  cclink-session-service.ts
  cclink-file-service.ts

src/main/ipc/cclink-ipc.ts
  // window.deepink.cclink.*

src/renderer/src/stores/cclink-store.ts
src/renderer/src/components/cclink/
```

说明：上面不表示新增远程 Agent daemon，只表示 DeepInk 客户端侧的 CCLink 功能模块。

## 第一阶段：协议和本地状态

第一阶段不接 TIM SDK，不做网络，不碰 Swift。目标是把 CCLink 的数据模型稳定下来。

交付：

- `src/shared/chatcc/models.ts`
- `src/shared/chatcc/protocol.ts`
- `src/shared/chatcc/index.ts`
- `docs/features/cclink-integration.md`

完成后，主进程和渲染进程都可以引用同一套类型。

当前状态：已完成。

## 第二阶段：CCLink 本地 store

建立本地持久化，不依赖 TIM 在线状态也能展示已有服务器和历史会话。

```ts
interface ChatccEndpointRecord {
  id: string
  name: string
  status: 'online' | 'offline' | 'connecting'
  hostname: string
  os: string
  agentVersion: string
  claudeVersion: string
  lastSeen: number
}
```

持久化内容：

- server list
- workspace list
- session list
- messages by session
- pending approvals

当前状态：已完成 `CclinkStore`、IPC、preload API、renderer Zustand store。状态写入 Electron `userData/cclink-state.json`。

历史可测能力：

- 早期版本曾在 Activity Bar 出现“远程 Agent”入口。
- 侧栏显示 CCLink 远程设备、工作区、会话和最近消息。
- 可生成/清空本地示例数据。
- 点击远程会话会打开主工作区 `conversation` Tab，CCLink 只作为连接通道元信息。
- 会话 Tab 可展示消息流，并能发送一条本地测试消息。
- 本地测试消息会更新 session 的 `messageCount` 和 `updatedAt`。

当前产品方向：

- Activity Bar 不再放 CCLink / 远程 Agent 一级入口。
- CCLink 账号、旧账号导入、配对、服务器同步和诊断迁入 Settings。
- CCLink 同步到的远程目录进入工作空间列表，展示为 `[远程 · CCLink] 设备名 / 路径`。
- 远程工作空间激活后，在该工作空间行下展开文件树和会话。

测试步骤：

```text
pnpm dev
-> 登录或开发模式跳过登录
-> 进入 Settings > 远程连接，完成 CCLink 身份同步或配对
-> 回到工作空间面板，点击 `[远程 · CCLink]` 工作空间
-> 点击远程会话或远程文件
-> 中间主工作区打开远程会话 Tab
-> 输入消息，按 Cmd/Ctrl + Enter 或点击发送
-> 看到用户消息 + 系统提示消息追加
```

## 第三阶段：Setup Code 配对

DeepInk 作为客户端调用云函数：

```text
generateSetupCode
  -> 显示 CC-XXXXXXXXXXXXXXXX
  -> 用户在远程机器运行 chatcc pair/start
  -> 远程 agent validateSetupCode
  -> agent 上线后发 server_meta
```

DeepInk 需要提供：

- “添加远程工作空间”入口，并在连接方式中选择 CCLink。
- Setup Code 生成和倒计时。
- 配对成功后的 server meta 展示。
- 失败和过期状态。

## 第四阶段：TIM transport

主进程接入 TIM SDK，renderer 不直接持有 IM 凭证。

```text
Renderer
  -> window.deepink.cclink.*
  -> IPC
Main
  -> ChatccTimTransport
  -> Tencent IM
```

首批支持：

- 登录 / 登出
- C2C custom message 收发
- `server_meta`
- `session_sync_request`
- `session_create`
- `user_text`
- `stream_start/chunk/end`
- `error`

当前状态：

- 已新增 adapter-based `CclinkTimTransport`：先定义 TIM 登录、登出、C2C custom message 收发接口，不直接把业务层绑死到某个 SDK 形态。
- 已处理 `server_meta.agent_id` 与 TIM peerId 的映射：收到 `server_meta` 后，后续按工作空间里的 `serverId` 发送时会路由回真实 peer。
- 已新增 `CclinkRealtimeBridge`，用于把 transport incoming 同时接入 request router 和 protocol router。
- Runtime 已装配 `CclinkRequestRouter`、`CclinkProtocolRouter` 和 `CclinkFileService`；真实 transport 接入后只需 attach 到现有 router/bridge 生命周期。
- 已接入官方推荐的 `@tencentcloud/chat` 依赖，并新增 `CclinkTencentChatAdapter`，使用 C2C custom message 承载 CCLink 协议 JSON。
- 已新增 `CclinkRealtimeService` 和 IPC；产品入口后续迁入 `设置 > 远程连接`，用户同步身份后可以尝试连接/断开实时链路。
- 尚未完成真实账号环境验证；下一步需要用线上 `client_im_user_id` / `im_user_sig` 实测 Electron 主进程是否能稳定登录、收发 custom message。

## 第五阶段：远程会话 UI

把远程会话接入 DeepInk 的统一 conversation/thread 体系。产品上它仍然叫“会话”，只通过运行位置、连接通道和执行后端展示差异。

默认布局：

- 远程会话默认打开为主工作区 `conversation` Tab，归属对应远程工作空间；CCLink 只体现在 `transport` 元信息里。
- 右侧显示 Artifact Inspector。
- 用户可以停靠回右侧。

消息渲染：

- `user_text` -> 用户消息
- `stream_*` -> Agent 流式文本
- `agent_tool` -> 工具卡片
- `terminal_output` -> 终端输出卡片
- `user_question` -> Agent 提问卡片
- `permission_request` -> 权限卡片

## 第六阶段：远程文件和 Diff

支持：

- `file_tree_request/response`
- `file_read_request/response`
- `file_search_request/response`
- 文件引用点击打开远程文件 viewer
- Edit/Write 工具卡片打开 diff viewer

主工作区新增：

```text
remote-file-browser
remote-file-viewer
remote-diff-viewer
```

当前状态：

- 已新增 DeepInk 桌面端 `CclinkFileService`、IPC 和 preload API：`listFileTree` / `readFile`。
- 已新增 `CclinkRequestRouter`，负责 `request_id` 匹配、服务端隔离、超时和 `error` 响应处理。
- 已新增 `CclinkProtocolRouter`，先覆盖 `server_meta`、`session_sync_response`、`user_text`、`stream_*`、`agent_tool`、`terminal_output`、`error` 的入库逻辑。
- 当前不会伪造远程文件树；在 TIM transport 和 `chatcc-agent` 的 `file_tree` / `file_read` 响应未接入前，统一返回 `unavailable`。
- Renderer 远程工作空间侧栏会调用该接口，并展示真实不可用原因，避免把“未接入能力”伪装成“空目录”。

## 第七阶段：配额、通知、后台

接入：

- `checkQuota`
- `recordUsage`
- 订阅套餐映射到 DeepInk subscription
- Agent 离线/完成/需确认通知
- admin 运营后台后续作为独立管理入口

## Runtime 规则

CCLink 的 `chatcc-agent` 明确禁止 `claude -p`，统一使用：

```bash
claude --output-format stream-json --verbose --input-format stream-json
```

DeepInk 本地 Agent 后续也应逐步向这个 runtime contract 靠拢，减少本地 Agent 和 `chatcc-agent` 的事件差异。但这不意味着新增第二套 CCLink 远程 Agent；在 CCLink 路线里，远程 runtime 仍然只有 `chatcc-agent`。

## 风险

- TIM Web SDK 在 Electron 主进程可用性需要 spike；如果不适合主进程，改为隔离 preload worker 或专用 hidden BrowserWindow。
- CCLink 后端 API 与 DeepInk 现有 auth/subscription 有重叠，需要做账号映射，不要复制两套用户系统。
- 远程 shell 和文件写入必须默认确认，不能继承本机 Agent 的宽权限。
- 历史消息和流式分段要处理乱序、重复和缺失 `stream_end`。
