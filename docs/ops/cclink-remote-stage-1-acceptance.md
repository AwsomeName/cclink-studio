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

## 工程验证

- `pnpm verify`：通过（228 个测试文件，1324 通过，2 跳过）。
- `pnpm build`：通过。
- `CCLINK_API_URL=off pnpm smoke:local`：11/11 通过。
- `CCLINK_API_URL=off pnpm smoke:ui`：12/12 通过。
- `CCLINK_API_URL=off pnpm smoke:workflow`：14/14 通过。
- 默认配置 `pnpm smoke:ui`：12/12 通过，远程入口显示局部登录界面。
- `pnpm verify:credential-boundary`：通过；本次未执行 Developer ID 签名或 Apple 公证。

## overlay 结论

暂时不能停止旧 commercial overlay 出包。关闭条件是上述写入、远程 Agent 和远程 PTY 在同一 Studio 真实在线 Agent 上通过，并确认统一 Studio 发布路径可回滚。
