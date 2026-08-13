# ADR 0009：单一 Studio App 与 CCLink 远程服务边界

- 状态：accepted
- 日期：2026-08-13
- 负责人：CCLink Studio Maintainers
- 取代：ADR 0004 中长期维护独立开源/商业桌面制品的产品前提

## 用户验收目标

第一阶段只有一个产品里程碑：

> 用户启动 Studio，无需登录即可打开本地项目；点击 CCLink 远程入口后完成手机号登录，选择在线设备和远程目录，把目录作为远程项目打开，并读取一个文件。缺少配置、未登录或远程故障时，本地能力不受影响。

在真实 App 完成这条路径前，远程写入、远程 Agent 会话、远程 PTY、状态迁移和旧 overlay 淘汰都不得冒充第一阶段完成。

## 问题

旧架构把 CCLink 账号、消息网络和远程工作区排除在 Studio 默认源码之外，并通过 `cclink-dev/commercial` 覆盖整棵桌面源码生成第二个 App。覆盖层已经复制 Workspace、Tab、Terminal、App、preload 和样式等基础状态，形成双事实源、双生命周期和长期同步成本，也使商业 App 的全局登录页错误地阻断本地免费能力。

## 决策

1. 只保留一个由 `cclink-studio` 构建的 CCLink Studio 桌面 App，桌面源码以 GPL-3.0-only 发布。
2. 本地工作区、Agent、浏览器、编辑器、Terminal、数据源和 Android 免费且免登录。
3. 手机号登录、Session 文件、token 刷新、CCLink 身份与设备状态、腾讯 IM transport、请求路由、实时连接和 CCLink RemoteProvider 作为可选功能域直接进入 Studio。
4. 登录只由用户点击 CCLink 远程入口触发。App 根组件不得出现全局 LoginPage 守卫。
5. `RemoteWorkspaceRef`、Workspace/Tab/Workbench/项目条/WorkspaceState、RemoteProvider 契约、Terminal execution adapter 接入点、受信 IPC/schema/生命周期/诊断由 Studio 基础层唯一拥有。
6. CCLink 功能域只拥有账号、设备连接、远程请求和远程会话事实，不复制本地或工作台状态。
7. 远程服务授权和收费必须由云服务在身份、设备路由或每次远程请求入口强制执行。客户端 entitlement 只用于提示；开发模式和网络错误都不能形成可绕过的授权结论。
8. Agent runtime 继续使用现有 NPM 包发布，CCLink 云服务继续独立部署；本 ADR 不迁移或修改这两个项目。

## 失败降级与生命周期

- CCLink 配置缺失：远程入口显示“未配置”，不注册可用远程 provider；本地启动继续。
- 未登录或 Session 失效：只要求远程入口登录；本地工作台继续。
- refresh、身份、TIM 或远程 Agent 失败：保留非敏感远程工作区引用并显示可重试状态；不得清空或阻断本地工作区。
- 服务端明确返回 token 无效/过期/注销时才清理 Session；普通网络错误不得伪装成登出或授权通过。
- 服务和 IPC 由 Studio runtime 注册表统一启动、回滚和释放；窗口重建不得重复注册。

## 权限与凭证

- 所有 renderer IPC 使用可信主 frame 校验和有界 schema。
- renderer 不得到 access token、refresh token、IM UserSig 或完整远程身份。
- refresh token 只存于 `userData` 下权限为 0600 的 Session 文件；access token、IM UserSig 和完整远程身份只驻留内存。
- 严格遵守 `NO_SYSTEM_KEYCHAIN`：禁止 safeStorage、keytar、系统钥匙串 API、`security` 命令及历史钥匙串/旧密文迁移。旧密文只隔离并要求重新登录。

## 明确不迁移

WebDAV sync、桌面支付、PricingPage、PaymentModal、ProBadge、套餐比较、本地能力 Pro 门控、重复 updater、重复本地 Terminal、通用 orchestrator、整文件 App/Settings/Sidebar/preload/main.css 快照、AI 员工、商业模板、通用插件 SDK 和新打包基础设施。

## 与 ADR 0004 的关系

ADR 0004 对不可变 Tag、凭证不入库和发布可审计性的安全要求继续有效；“开源版与商业版长期各自出一个桌面制品”不再是目标。旧 commercial overlay 仅作为迁移期只读参考，在第一阶段真实 App 验收及统一构建路径通过前不得提前停止；通过后应停止出包并进入删除计划。

## 服务端收费门禁审查

桌面代码不能证明服务端已经强制授权。验收必须记录云服务对未授权身份/请求的实际拒绝证据。若未发现服务端门禁，只能声明桌面远程链路完成，不能声明收费闭环完成，也不得越权修改云服务。
当前只读审计见 `docs/ops/cclink-remote-entitlement-audit.md`：身份和配对受保护，但付费门禁尚未形成服务端闭环。

## 验证

- 未登录启动并打开本地项目；
- 缺少 CCLink 配置时启动成功且远程入口明确降级；
- 登录后真实选择在线设备与目录并读取文件；
- 恶意/非主 renderer 调用远程 IPC 被拒绝，超长或越界输入被 schema 拒绝；
- 运行受影响测试、typecheck、lint、`pnpm verify` 和无钥匙串检查；
- 不执行 Developer ID 签名或 Apple 公证。

## 实施记录（2026-08-13）

- Studio 基础层已统一远程 Workspace/Tab 切换、RemoteProvider 写入契约、Terminal execution adapter 路由与受信 IPC/schema。
- CCLink 域已接入远程会话创建/同步/流式事件、文件创建/修改/重命名/删除（包含大于 2 KiB 的分片传输）和持久远程 PTY（包含 keepalive、attach 与序列续接）。
- 远程消息禁止经本地 `agent:sendMessage` 执行，防止远程路径意外落到本地 Agent。
- 自动化工程门禁已通过；真实在线 Agent 上的写入、会话和 PTY 产品验收仍是 overlay 停止出包的前置条件。
