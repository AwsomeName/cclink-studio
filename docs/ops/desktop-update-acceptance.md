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

## 2026-10-08：自动安装源码与原生实验

### 用户功能进度

公开 v0.1.104 仍需要手工替换；本轮新代码尚未发版。源码接入安装确认、工作现场保护、
自动替换与重开。首次包含 Helper 的正式基线安装，以及之后两轮应用内升级/工作空间
恢复真人验收均为 PENDING，不能以本轮实验声明产品闭环。

### 工程准备度

- 已编译 arm64 原生 Helper；本地 ad-hoc App 打包后该 Resource 可执行、签封校验通过。
  正式 Developer ID 签名及整包公证仍须由下一次 release-oss.yml 验证，不在本机取凭证。
- 定向测试覆盖令牌、工作变化、保存失败、Helper 准备失败、缓存保留、安装布局、
  新版回执绑定及现有更新 UI；typecheck、production build、更新恢复真实 Electron smoke、
  Release/打包/凭证边界门禁通过。最新命令结果以本次交付记录为准。
- native 实验使用公开签名、公证 v0.1.103 与 v0.1.104 的隔离副本和独立 Profile；
  没有修改实际安装路径或真实用户工作数据。

命令：node scripts/update-helper-signed-smoke.mjs <隔离 fixture root>。

| 原生实验                                       | 结果                                               |
| ---------------------------------------------- | -------------------------------------------------- |
| 同卷交换 0.1.103 → 0.1.104，实际工作台核对版本 | PASS                                               |
| 候选签名损坏                                   | PASS，拒绝安装，旧窗口继续可用                     |
| 父进程不退出时取消安装                         | PASS，不强杀旧版、不交换目录                       |
| 安装目录不可写                                 | PASS，保留旧版并重新打开实际旧工作台               |
| worker 被中断                                  | PASS，监督进程交换回旧版并打开旧工作台             |
| 新版不给启动回执（120 秒超时）                 | PASS，停止本次启动的新版、交换回旧版并打开旧工作台 |

实验旧版没有新增内置回执：成功用例由测试程序在实际新版 UI 确认版本后写回执；
超时用例不写回执。因此这是安装程序技术闸门，不是正式版本应用内升级验收。
实验中发现 Cocoa 将 /private/tmp 规范化为 /tmp 导致误拒绝，已改为 POSIX realpath
核验，并用相同真实签名副本重跑全部实验通过；签名、身份与权限约束未降低。

### 真人验收动作（PENDING）

1. 手工安装一次包含本轮代码的正式 Developer ID、公证 arm64 基线。
2. 打开工作空间与已保存文档，运行 Agent、打开终端、修改另一文档；下载下一正式版本。
3. 点击“安装并重启”，核对阻塞列表，确认取消不保存/不退出/不中断任务。
4. 保存文档、结束任务并关闭终端及辅助窗口，再点击安装、确认。
5. 无 Finder 拖拽、无手动退出/启动即可看到新窗口；核对版本、工作空间、标签和文档内容。
6. 再发布下一版本重复第 2–5 步；补验保存失败与启动失败恢复。

残余边界：不提权；无替换权限时使用手工安装。旧 App 备份暂时保留，未实现自动轮换
清理；应用回滚不撤销数据迁移。整组进程被杀或断电时保留事务与备份，尚未验收自动恢复。

## 2026-08-14：v0.1.32 发布故障修复验收

### 用户功能结果

- `v0.1.32` 已作为公开稳定 Release 发布：
  `https://github.com/AwsomeName/cclink-studio/releases/tag/v0.1.32`。
- 使用公开 Release 的已签名、公证 `v0.1.29` 启动真实更新服务，成功发现、下载并打开
  `v0.1.32`；下载大小 142,851,867 字节，`openManualInstaller.ok=true`、`error=null`，未再出现
  `publisher_mismatch`。
- 关闭 `v0.1.29`、完整替换 `.app` 并启动 `v0.1.32` 后，模型配置、自定义服务地址、权限模式、
  API Key 配置状态、Claude Runtime `2.1.211`、OCCT `0.0.23`、scrcpy `2.3.1` 和
  agent-device Helper `0.17.2` 全部保留。

### 工程证据

- Release 源提交：`b442de8c29edb2a159f419ca6bc1761990411aef`。
- 公开 DMG 的 checksums 与 Manifest SHA-256 一致；`hdiutil verify`、App/DMG `codesign`、
  `stapler validate`、App/DMG `spctl` 全部通过。
- App 与 DMG 均为 `Developer ID Application: chang liu (H4NAWHF52C)`，Team ID
  `H4NAWHF52C`，Gatekeeper 来源为 `Notarized Developer ID`。
- App 内 `app.asar/out/build-provenance.json` 的 `gitHead` 与 Release 源提交一致，源码指纹
  `3ed8a119affbaaaafb8b483b9ae09bcd26a4d5f7595e91eb1ed19a61ea39a416`。
- v0.1.30 已标记为 prerelease 并写明未签名/未公证故障；v0.1.31 已标记为 prerelease 并写明
  缺少正式产物源码身份记录。两者均指向 v0.1.32 或更高版本。

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

| 日期       | 命令                          | 结果                                            |
| ---------- | ----------------------------- | ----------------------------------------------- |
| 2026-07-29 | Manifest/Provider 定向 Vitest | PASS，13/13                                     |
| 2026-07-29 | `pnpm verify:release`         | PASS，30/30                                     |
| 2026-07-29 | `pnpm typecheck`              | PASS                                            |
| 2026-07-29 | `pnpm lint`                   | PASS                                            |
| 2026-07-29 | `git diff --check`            | PASS                                            |
| 2026-07-29 | `pnpm verify`                 | PASS，184 files / 1068 tests / production build |

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

| 日期       | 场景                              | 结果                                            |
| ---------- | --------------------------------- | ----------------------------------------------- |
| 2026-07-29 | 下载、校验并进入 `readyToInstall` | PASS                                            |
| 2026-07-29 | 关闭服务并重新创建，启动恢复      | PASS                                            |
| 2026-07-29 | 修改缓存 DMG 后重启               | PASS，拒绝并删除                                |
| 2026-07-29 | 当前版本追平目标版本              | PASS，回到 idle 并删除                          |
| 2026-07-29 | 错误 SHA-256                      | PASS，不生成可安装文件                          |
| 2026-07-29 | 中途取消                          | PASS，删除 `.part` 并回到 available             |
| 2026-07-29 | 缓存目录不可用                    | PASS，Studio 启动降级为空闲状态                 |
| 2026-07-29 | 更新相关 Vitest                   | PASS，20/20                                     |
| 2026-07-29 | `pnpm verify`                     | PASS，184 files / 1068 tests / production build |
| 2026-07-29 | 隔离 Profile 真实 Electron 恢复   | PASS，状态栏和面板为 `readyToInstall`           |
| 2026-07-29 | renderer reload 后主进程快照对账  | PASS，仍显示“更新已下载”                        |

### 待完成

- [ ] 公开新版完成真实下载、退出、重开和状态恢复。
- [ ] 下载进行中销毁并重建 BrowserWindow，主进程下载不中断。

M1 关闭前，只能声明自动化行为成立，不能宣称真实安装包已完成恢复闭环。

## M2：可信 DMG 兜底

### 当前状态

`COMPLETE`。代码、真实 Electron 入口和公开签名、公证 DMG 的下载、可信校验与打开均已通过；
整包替换后的配置和 Runtime 复用也已用两个不同官方版本验证。

### 已完成

- [x] 打开前重新核对 verified record、Manifest digest、大小和 SHA-256。
- [x] 校验 DMG Developer ID、Team ID 和 Gatekeeper 公证结果。
- [x] 只读挂载，要求唯一 `.app`，并检查签名、公证、Bundle ID、版本和纯 arm64。
- [x] 预期 Team ID 来自当前正式应用，不由 renderer 或配置文件提供。
- [x] renderer 无参数调用；本地路径不跨 IPC。
- [x] 打开失败保留缓存；内容或发布者失败作废缓存。
- [x] 更新面板展示 Finder 替换指引和“打开安装包”按钮。

### 自动化证据

| 日期       | 场景                                      | 结果                                            |
| ---------- | ----------------------------------------- | ----------------------------------------------- |
| 2026-07-29 | M2 Verifier + Service 定向测试            | PASS，17/17                                     |
| 2026-07-29 | 错 Team ID、错版本、universal/x64、多应用 | PASS，全部拒绝                                  |
| 2026-07-29 | 打开前篡改 DMG                            | PASS，拒绝并删除缓存                            |
| 2026-07-29 | `shell.openPath` 失败后重试               | PASS，保留 ready 状态和缓存                     |
| 2026-07-29 | 隔离 Profile 真实 Electron UI             | PASS，显示“打开安装包”                          |
| 2026-07-29 | `pnpm typecheck` / `pnpm lint`            | PASS                                            |
| 2026-07-29 | `pnpm verify`                             | PASS，185 files / 1079 tests / production build |
| 2026-07-29 | `pnpm smoke:standalone`                   | PASS，10 + 6 + 14 + 4 + update recovery         |
| 2026-07-29 | 本地 arm64 ad-hoc package                 | PASS，Bundle ID/版本/arm64/深度签封正确         |

### 待完成

- [x] 从公开 Release 下载真实签名、公证 DMG。
- [x] 在正式旧版调用“打开安装包”，通过所有系统检查并由 macOS 成功打开。
- [x] 完整替换 `.app` 后启动新版，确认配置、凭证状态和已安装 Runtime 保留。

## M3：安装技术闸门

### 当前状态

`ENGINEERING GATE PASSED`（2026-10-08）。原生实验结果见本页最新记录；正式签名
Helper 基线与两轮用户升级仍待验收。选择最小事务型 Helper，拒绝第二更新状态所有者：

- Electron 内置 `autoUpdater` 会建立 Squirrel.Mac 的检查和自动下载状态。
- `electron-updater` 的公开 API 不能消费现有 verified handle。
- 最小 Helper 已使用两个公开签名、公证包的隔离副本完成交换与回滚实验。

决策见 ADR 0005 与 ADR 0021。源码不再使用占位安装接口；没有匹配正式签名 Helper 的
构建不开放自动安装。工程闸门通过不替代两轮用户验收。

## M4-M6

M4/M5 源码已接入，M6 两轮正式验收仍为 PENDING：

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
