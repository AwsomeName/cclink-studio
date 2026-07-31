# ADR 0005：macOS 自动安装器技术闸门

- 状态：accepted
- 日期：2026-07-29
- 负责人：CCLink Studio Maintainers

## 问题

`UpdateService` 已经拥有 Release 检查、用户确认下载、传输、哈希校验、缓存恢复和产品
状态。如果再直接接入 Electron 内置 `autoUpdater` 或 `electron-updater`，它们会重新
检查、下载并保存自己的更新状态。这样会产生第二状态所有者，也无法把 Studio 已验证的
内部资产句柄直接作为唯一安装输入。

自动替换还会写入应用目录、退出当前进程并启动新版。没有真实 Developer ID 签名、
Apple 公证、权限不足和中断回滚实验时，不能把 mock 通过当成可上线安装能力。

## 决策

1. 淘汰 Electron 内置 `autoUpdater`。macOS 实现基于 Squirrel.Mac，发现更新后自动
   下载，并只允许在其 `update-downloaded` 生命周期后调用 `quitAndInstall()`；这会
   重建一条检查和下载链。
2. 淘汰把 `electron-updater` 直接接入生产路径。即使关闭 `autoDownload` 和
   `autoInstallOnAppQuit`，其公开 API 仍以 Provider、更新元数据和自己的下载缓存为
   输入，不能消费 `UpdateService` 的已验证本地句柄。不得通过继承 protected 内部类
   绕过这一边界。
3. M3 只保留“最小、事务型外部 Helper”作为实验候选。Helper 不检查 Release、不访问
   网络、不解析 renderer 输入，只消费主进程签发的一次性安装事务和已验证 ZIP。
4. Helper 在两个真实签名、公证的 arm64 测试包上通过替换、启动确认、权限不足和中断
   回滚前，不进入生产代码，不暴露“安装并重启”按钮。
5. M3 未过闸门期间，产品停在 M2：允许用户打开再次验证后的可信 DMG 手工替换。

参考：

- [Electron autoUpdater](https://www.electronjs.org/docs/latest/api/auto-updater/)
- [electron-builder Auto Update](https://www.electron.build/docs/features/auto-update/)

## 不变量

1. `UpdateService` 始终是唯一产品状态所有者。
2. 安装器不检查更新、不访问公网、不接收 renderer 路径或 URL。
3. DMG 是人工兜底；自动替换只使用同一 Manifest 中的 arm64 ZIP。
4. 任何退出动作前必须完成工作现场检查和一次明确确认。
5. 当前应用未被安全备份、候选应用未重新验证时不得开始替换。
6. 权限不足、只读安装位置或任何不确定失败必须回到 M2，不请求关闭 Gatekeeper。

## 备选方案

- **Electron 内置 `autoUpdater`**：拒绝。Squirrel.Mac 将检查、下载和安装绑定为自己的
  生命周期，无法保持现有单状态所有者。
- **`electron-updater`**：拒绝直接接入。关闭自动行为不能让其公开 API 变成无状态
  本地安装器，依赖内部 protected 状态会形成脆弱耦合。
- **由 Studio 主进程直接覆盖自身**：拒绝。进程仍在运行时修改自身目录，无法可靠处理
  失败回滚和重启确认。
- **只支持 DMG**：作为 M3 失败时的稳定产品降级保留，但不冒充自动安装。

## 风险与影响

- 最小 Helper 增加安装事务、应用目录写入和进程交接的权限面，必须单独审计。
- 当前本机有 Developer ID Application 身份，但没有本轮可用的公证凭证和两个已公开
  测试 Release；因此 M3 真实闸门尚未通过。
- 在 M3 关闭前，M4 可以继续做纯只读的工作现场识别设计，但不得连接退出或替换动作；
  M5 不得开始生产接线。

## 迁移计划

1. 先完成 M2 可信 DMG 的代码、自动化和真实 Electron UI 验收。
2. 从不可变 Tag 生成两个签名、公证的 arm64 测试包。
3. 在隔离测试目录实现 Helper 原型和一次性事务文件，不接 renderer。
4. 注入无写权限、候选损坏、替换中断和新版启动超时。
5. 只有旧版均可恢复、目标版能写启动确认后，复审本 ADR并允许 M4/M5 接线。

## 回收或复审条件

- Electron 或 electron-builder 提供稳定、公开、可消费“已验证本地资产句柄”的无状态
  安装 API时重新评估。
- Helper 两轮实验无法证明回滚，永久维持 M2，不继续扩张自动安装。

## 验证

- 当前生产依赖不新增 `electron-updater`。
- `installAndRestart()` 继续返回 `install_blocked`。
- 更新面板只暴露“打开安装包”，不暴露自动安装。
- M3 验收必须记录两个签名包、安装前后版本、权限和中断恢复证据。
