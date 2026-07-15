# CCLink Studio 架构说明

> 当前事实源。最后更新：2026-07-15。

## 结论

CCLink Studio 是 CCLink 的开源桌面工作台端，不是 DeepInk 接入 CCLink，也不是一个包含官方账号、付费、TIM、远程中继和生产更新源的全量商业客户端。

开源仓库的目标是提供本地优先的桌面壳、浏览器/文档/Android/Terminal/Agent 工作台、MCP 工具和可扩展 IPC 边界。官方账号、云函数、配对、消息路由、额度、签名、公证、生产 API 注入和商业发布链路由闭源工作区与 CCLink 主项目承接。

## 项目边界

| 位置 | 角色 |
| --- | --- |
| `/Users/apple/Desktop/cclink-dev/cclink-studio` | 开源桌面壳。默认不内置官方生产 API 地址，不带登录/订阅/TIM/云同步/远程工作区商业实现。 |
| `/Users/apple/Desktop/cclink-dev` | 闭源总控/官方编译工作区。承接商业 overlay、签名、公证、生产 API 注入、多仓库集成脚本和 release 基线。 |
| `/Users/apple/Desktop/chat-cc/deploy` | CCLink 云函数与账号体系。历史目录名未改。 |
| `/Users/apple/Desktop/chat-cc/Agent` | CCLink Agent runtime。历史目录名未改。 |
| `private-serv` | 废弃历史项目，不再作为当前架构事实源。 |

不存在独立的 `cclink-cloud` 或 `cclink-agent` 项目。后续文档若出现这些名字，只能作为历史假设或待清理内容看待。

## 开源版能力

CCLink Studio 开源壳保留这些本地能力：

- Electron + React + TypeScript 桌面工作台。
- VSCode 风格布局：Activity Bar、Sidebar、Workbench、Agent Panel、Status Bar。
- 本地工作空间、标签页、浏览器、Markdown 编辑器、Android/设备视图、Terminal。
- 本地 Agent 会话、本地 Claude Code 后端、MCP 工具系统和权限确认。
- 本地设置、诊断、文件访问和工作台状态恢复。
- updater 的中性检查框架，但不开源默认生产更新源、签名、公证或 COS 上传链路。

这些能力不需要用户登录 CCLink，也不依赖官方云服务。

## 已移出开源壳的商业能力

以下能力已经从 Studio 默认路径移出，或必须通过 `cclink-dev` / `chat-cc` 侧 overlay 接入：

- CCLink account / device / message / runtime 网络。
- TIM UserSig、消息路由、配对、远程服务器注册。
- 登录、订阅、entitlement、quota、商业 feature gate。
- 云同步、远程文件树、远程文件查看、远程 session sidebar。
- 私有服务配置、生产 API 地址、官方更新源、COS 上传、签名和公证流程。

验收上，开源壳不应再 import 已搬走的商业模块，也不应默认暴露 `auth/subscription/sync/cclink/remote` preload API。

## 运行时分层

```text
renderer
  React UI, Zustand stores, workbench tabs, settings, local Agent panel

preload
  contextBridge exposes local-safe APIs only
  browser / agent / editor / fs / terminal / settings / updater / android ...

main
  Electron app lifecycle
  Browser WebContentsView
  Agent bridge and local Claude Code backend
  MCP tool host
  local filesystem, editor, terminal, diagnostics, updater shell

commercial overlay (outside OSS default path)
  account, entitlement, CCLink device/message/runtime network, official release
```

## 兼容性命名

这些名字暂时保留，不能机械替换：

- `window.deepink`
- `appId: com.deepink.app`
- Electron `userData` 目录 `DeepInk`
- `deepink-*` localStorage / storage key
- 旧 workspace snapshot、tab type、diagnostic fixture 中的历史值

迁移原则是先提供兼容层和数据迁移，再改对外标识。仅因为产品名变为 CCLink Studio 就替换这些 runtime key，会导致用户数据、窗口桥、旧状态和测试 fixture 断裂。

## 文档状态

当前事实源：

- `README.md`
- `AGENTS.md`
- `docs/README.md`
- `docs/architecture.md`
- `docs/development.md`
- `docs/cclink-studio-boundary-and-migration.md`

其他历史文档如果仍写 DeepInk、private-serv、Remote Program、云同步或订阅，不代表当前 OSS 边界。它们需要逐步拆分为：

- 保留在开源壳的本地能力规格。
- 搬到 `cclink-dev/commercial` 的商业规格。
- 搬到 `/Users/apple/Desktop/chat-cc` 的云函数或 Agent runtime 规格。
- 标记废弃的历史决策记录。

## 拷问

最容易出错的地方不是产品名没改干净，而是把“历史名称残留”和“商业能力残留”混为一谈。

- `DeepInk` 出现在兼容 key、旧数据迁移、fixture 里，可以合理保留。
- `DeepInk` 出现在用户可见产品文案、当前架构事实源里，应该改掉。
- `private-serv` 出现在历史说明里可以保留；出现在当前依赖、命令、发布路径里就是错误。
- `cclink-cloud` / `cclink-agent` 作为独立项目名不应继续出现。
