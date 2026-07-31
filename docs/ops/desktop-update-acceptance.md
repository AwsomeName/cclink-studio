# Desktop Update Acceptance

> 目的：记录当前 arm64 M0-M6 的自动化、真人验收和脱敏证据。
> 产品事实源：`docs/features/desktop-release-and-updates.md`。
> 执行计划：`docs/features/desktop-update-development-plan.md`。

## 规则

- 每个里程碑记录源提交、自动化命令、真人步骤、失败注入和残余风险。
- Actions、Draft 和公开 Release 使用 URL；本地只记录必要摘要。
- 不记录 Token、Cookie、P12/P8、密码、用户目录完整路径或下载 URL 查询参数。
- 真人或远端验收未完成时保持 `PENDING`，不能用 mock、CI 或文档替代。
- M0 是工程准备度，不计入用户功能进度。

## M0：arm64 单架构收口

### 当前状态

`COMPLETE`。本地代码、当前文档、全量门禁和 arm64 发布契约均已收口。下一次真实
Draft 的签名与安装证据属于发布验收，不会重新引入 x64 路径。

### 已完成

- [x] Manifest 升级为 schema v2，且只允许 `assets.arm64`。
- [x] 正式运行时只在 `darwin + arm64` 启用 GitHub Provider。
- [x] `release-oss.yml` 只使用 `macos-15` 构建 arm64。
- [x] Draft 只消费一个 arm64 artifact。
- [x] 本地 package/release 命令删除 x64 和 universal 入口。
- [x] Runbook、产品规范和开发计划改为 arm64 当前事实。
- [x] 故障注入改为 `omit-arm64-build-record`。

### 自动化证据

| 日期 | 命令 | 结果 |
| --- | --- | --- |
| 2026-07-29 | Manifest/Provider 定向 Vitest | PASS，13/13 |
| 2026-07-29 | `pnpm verify:release` | PASS，30/30 |
| 2026-07-29 | `pnpm typecheck` | PASS |
| 2026-07-29 | `pnpm lint` | PASS |
| 2026-07-29 | `git diff --check` | PASS |
| 2026-07-29 | `pnpm verify` | PASS，184 files / 1068 tests / production build |

### 待完成

- [ ] 下一次 arm64 Draft 从真实 Tag 构建并通过签名、公证、Gatekeeper 和 Manifest v2。
- [ ] 干净 Apple Silicon Mac 安装启动。

## M1：下载恢复闭环

### 当前状态

`IN PROGRESS`。代码、自动化和隔离 Profile 的真实 Electron 恢复通过；公开新版真实
下载和下载中的窗口重建验收尚未关闭。

### 已完成

- [x] `UpdateCache` 是缓存目录、原子记录和启动复验的唯一所有者。
- [x] 缓存键包含版本、arm64 和 Manifest digest。
- [x] `verified.json` 使用 schema v2，不保存 URL。
- [x] 启动清理 `.part` 并重新核验版本、系统版本、Manifest、常规文件、大小和 SHA。
- [x] 有效缓存恢复 `readyToInstall`。
- [x] 篡改、版本追平和元数据不一致使缓存失效。
- [x] 多个有效候选只保留最高稳定版本。

### 自动化证据

| 日期 | 场景 | 结果 |
| --- | --- | --- |
| 2026-07-29 | 下载、校验并进入 `readyToInstall` | PASS |
| 2026-07-29 | 关闭服务并重新创建，启动恢复 | PASS |
| 2026-07-29 | 修改缓存 DMG 后重启 | PASS，拒绝并删除 |
| 2026-07-29 | 当前版本追平目标版本 | PASS，回到 idle 并删除 |
| 2026-07-29 | 错误 SHA-256 | PASS，不生成可安装文件 |
| 2026-07-29 | 中途取消 | PASS，删除 `.part` 并回到 available |
| 2026-07-29 | 缓存目录不可用 | PASS，Studio 启动降级为空闲状态 |
| 2026-07-29 | 更新相关 Vitest | PASS，20/20 |
| 2026-07-29 | `pnpm verify` | PASS，184 files / 1068 tests / production build |
| 2026-07-29 | 隔离 Profile 真实 Electron 恢复 | PASS，状态栏和面板为 `readyToInstall` |
| 2026-07-29 | renderer reload 后主进程快照对账 | PASS，仍显示“更新已下载” |

### 待完成

- [ ] 公开新版完成真实下载、退出、重开和状态恢复。
- [ ] 下载进行中销毁并重建 BrowserWindow，主进程下载不中断。

M1 关闭前，只能声明自动化行为成立，不能宣称真实安装包已完成恢复闭环。

## M2：可信 DMG 兜底

### 当前状态

`IN PROGRESS`。代码、定向测试和真实 Electron UI 入口通过；公开仓库当前没有
Release，真实签名、公证 DMG 的打开与 Finder 替换待首个公开版本验收。

### 已完成

- [x] 打开前重新核对 verified record、Manifest digest、大小和 SHA-256。
- [x] 校验 DMG Developer ID、Team ID 和 Gatekeeper 公证结果。
- [x] 只读挂载，要求唯一 `.app`，并检查签名、公证、Bundle ID、版本和纯 arm64。
- [x] 预期 Team ID 来自当前正式应用，不由 renderer 或配置文件提供。
- [x] renderer 无参数调用；本地路径不跨 IPC。
- [x] 打开失败保留缓存；内容或发布者失败作废缓存。
- [x] 更新面板展示 Finder 替换指引和“打开安装包”按钮。

### 自动化证据

| 日期 | 场景 | 结果 |
| --- | --- | --- |
| 2026-07-29 | M2 Verifier + Service 定向测试 | PASS，17/17 |
| 2026-07-29 | 错 Team ID、错版本、universal/x64、多应用 | PASS，全部拒绝 |
| 2026-07-29 | 打开前篡改 DMG | PASS，拒绝并删除缓存 |
| 2026-07-29 | `shell.openPath` 失败后重试 | PASS，保留 ready 状态和缓存 |
| 2026-07-29 | 隔离 Profile 真实 Electron UI | PASS，显示“打开安装包” |
| 2026-07-29 | `pnpm typecheck` / `pnpm lint` | PASS |
| 2026-07-29 | `pnpm verify` | PASS，185 files / 1079 tests / production build |
| 2026-07-29 | `pnpm smoke:standalone` | PASS，10 + 6 + 14 + 4 + update recovery |
| 2026-07-29 | 本地 arm64 ad-hoc package | PASS，Bundle ID/版本/arm64/深度签封正确 |

### 待完成

- [ ] 从公开 Release 下载真实签名、公证 DMG。
- [ ] 在正式旧版点击“打开安装包”，通过所有系统检查并显示 Finder。
- [ ] 手工替换后启动新版，确认旧缓存清理。

## M3：安装技术闸门

### 当前状态

`BLOCKED`。分析已经结束，未向生产接入不可靠安装器：

- Electron 内置 `autoUpdater` 会建立 Squirrel.Mac 的检查和自动下载状态。
- `electron-updater` 的公开 API 不能消费现有 verified handle。
- 最小 Helper 需要两个签名、公证测试包完成替换和回滚实验。
- 当前公开仓库没有 Release，本机没有本轮公证凭证，不能伪造真人安装证据。

决策见 `docs/decisions/0005-macos-update-installer-gate.md`。在闸门关闭前，
`installAndRestart()` 保持 `install_blocked`，M5 不进入生产路径。

## M4-M6

尚未进入生产实现：

```text
M4 工作现场保护
M5 自动安装重启
M6 两轮真实升级验收
```

每个里程碑使用以下记录模板：

```text
里程碑 / 日期 / 操作者
源提交 SHA / 安装前版本 / 目标版本 / CPU 架构 / macOS 版本
自动化命令与结果
真人步骤与结果
失败注入与恢复结果
Actions Run / Draft 或 Release URL
脱敏截图或诊断编号
残余风险与是否允许进入下一里程碑
```

## 历史证据

2026-07-28 的 Manifest v1 双架构 Runs 和 Draft 只作为历史研发证据保留在 GitHub，
不再是当前产品契约、发布门禁或验收要求。当前发布必须使用 Manifest v2 和 arm64
单架构流程，不能复用历史 Draft 作为 M0/M1 完成证据。
