# CCLink 远程第一阶段验收记录

> 日期：2026-08-13。状态：部分通过，用户远程闭环尚未完成。

## 用户验收目标

> 用户启动 Studio，不登录也能打开本地项目；点击 CCLink 远程入口后登录，选择在线设备和远程目录，打开并读取一个文件。

## 已实测

- 默认服务配置下启动真实 Electron App，首屏为本地工作台，没有全局登录页。
- 点击“CCLink 远程”后才出现手机号登录界面，本地顶栏和工作台仍存在。
- 以 `CCLINK_API_URL=off` 启动真实 App，远程入口显示“远程服务未配置”，本地工作台继续可用。
- 缺配置模式下，真实 App 已打开临时本地项目，完成 Markdown 读取/保存/重命名、Browser Tab 和 Terminal cwd 执行。

## 尚未实测

当前环境没有可用的手机号/短信验证码和已配对在线 Agent，因此未能在真实 App 中完成以下最后链路：

1. 手机号登录并恢复 Session；
2. 列出已配对在线设备；
3. 选择远程目录并打开为工作空间；
4. 从远程文件树打开并读取一个文件。

所以第一阶段不能标记为产品验收完成，不得继续远程写入、远程 Agent 会话、远程 PTY 和 overlay 淘汰。

## 工程验证

- `pnpm verify`：通过。
- `pnpm build`：通过。
- `CCLINK_API_URL=off pnpm smoke:local`：11/11 通过。
- `CCLINK_API_URL=off pnpm smoke:ui`：12/12 通过。
- `CCLINK_API_URL=off pnpm smoke:workflow`：14/14 通过。
- 默认配置 `pnpm smoke:ui`：12/12 通过，远程入口显示局部登录界面。
- `pnpm verify:credential-boundary`：通过；本次未执行 Developer ID 签名或 Apple 公证。

## overlay 结论

暂时不能停止旧 commercial overlay 出包。关闭条件是上述真实登录、在线设备、远程目录和文件读取链路通过，并确认统一 Studio 发布路径可回滚。
