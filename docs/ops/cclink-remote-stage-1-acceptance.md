# CCLink 远程第一阶段验收记录

> 日期：2026-08-13。状态：用户已在 0.1.29 真实 App 中登录并打开远程项目；当前开发 App 因无可用 Session 停在短信登录，新增能力尚待在线 Agent 回归。

## 用户验收目标

> 用户启动 Studio，不登录也能打开本地项目；点击 CCLink 远程入口后登录，选择在线设备和远程目录，打开并读取一个文件。

## 已实测

- 默认服务配置下启动真实 Electron App，首屏为本地工作台，没有全局登录页。
- 点击“CCLink 远程”后才出现手机号登录界面，本地顶栏和工作台仍存在。
- 以 `CCLINK_API_URL=off` 启动真实 App，远程入口显示“远程服务未配置”，本地工作台继续可用。
- 缺配置模式下，真实 App 已打开临时本地项目，完成 Markdown 读取/保存/重命名、Browser Tab 和 Terminal cwd 执行。
- 用户提供的 0.1.29 真实 App 截图与诊断日志证明：已登录、选择在线设备 `supermicro` 及远程项目 `gl-bp`，工作区键为 `cclink://agent_4a639cb888a15d75/5c76b916a5b6c0de322e3239`。该记录同时暴露了工作区 Tab 没有切换和远程消息误走本地 `agent:sendMessage` 的问题。
- 本次修复后重启真实开发 App，再次确认未登录时本地项目、本地 Agent 和浏览器可用；点击远程入口后登录只出现在远程侧栏。
- 以 `CCLINK_API_URL=off` 重启真实开发 App，确认显示“远程服务未配置”，本地项目、本地 Agent 和浏览器继续可用。

## 已接入但尚未实机闭环

当前开发 App 没有可用的 Session；根据 `NO_SYSTEM_KEYCHAIN`，不能读取旧钥匙串或旧密文，必须由用户重新完成短信登录。因此以下新增链路只能标记为“工程实现完成，产品验收待执行”：

1. 在远程文件树新建测试文件，修改保存，重命名后删除；
2. 新建远程 Agent 会话，发送消息并收到流式回复/工具事件；
3. 打开远程 Terminal，执行 `pwd`，断网恢复后确认 PTY attach 和输出续接。

## 桌面端补齐记录

- 远程文件编辑已接入 `Cmd/Ctrl+S`、未保存关闭确认、部分读取禁止覆盖，以及文件/目录重命名和删除后的 Tab、脏草稿联动。
- 远程会话已接收入站 `user_text`、`agent_status`、错误状态、搜索、归档和本地恢复。会话与消息使用权限为 `0600` 的独立状态文件；access token、refresh token、IM UserSig 和完整远程身份不进入该文件。
- 首次启动且当前状态文件不存在时，只读导入旧商业桌面目录 `cclink-state.json` 中会话和消息的白名单字段；不读取或迁移旧 Session、身份文件、密文或系统钥匙串，源文件不修改。
- 腾讯 IM SDK 的真实掉线/恢复事件已进入统一实时生命周期。远程 PTY 在恢复后执行 attach/序列续接；关闭运行中的远程 Terminal 时由用户选择终止、保留或取消。
- `RemoteProvider` 现在实时请求 `capability_probe`，远程 Agent 和 PTY 入口不再把“设备在线”当成功能可用；文件树提供连接、协议、文件、Agent 和 PTY 诊断。
- 以上是桌面代码和自动化门禁完成，不替代在线设备真人验收。

## 工程验证

- `pnpm verify`：通过（233 个测试文件，1346 通过，2 跳过），包含 typecheck、lint、完整测试和 build。
- `pnpm build`：通过。
- `CCLINK_API_URL=off pnpm smoke:local`：11/11 通过。
- `CCLINK_API_URL=off pnpm smoke:ui`：12/12 通过。
- `CCLINK_API_URL=off pnpm smoke:workflow`：14/14 通过。
- 默认配置 `pnpm smoke:ui`：12/12 通过，远程入口显示局部登录界面。
- `pnpm verify:credential-boundary`：通过；本次未执行 Developer ID 签名或 Apple 公证。

## overlay 结论

暂时不能停止旧 commercial overlay 出包。桌面端已没有已知的计划内迁移功能缺口；关闭条件仍是上述写入、远程 Agent、远程 PTY 及断线恢复在同一 Studio 真实在线 Agent 上通过，并确认统一 Studio 发布路径可回滚。云服务付费门禁尚未闭环也是独立的商业风险，不能用客户端结果替代。
