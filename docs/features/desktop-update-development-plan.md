# Desktop Update Development Plan

> 状态：2026-08-05。M0 已完成；M1 已实现缓存恢复和启动复验；M2 已实现可信
> DMG 二次校验、发布者检查和打开入口。本地自动化与隔离 Profile 的真实 Electron
> 验收通过，公开新版验收待执行。M3 已完成候选分析，但缺少两个签名、公证测试包，
> 尚未通过真实安装闸门；安装准备和安装重启仍是占位。
> M7 稳定/测试订阅轨道已进入实现与自动化验收，真实 Pre-release 升级待执行。
> 产品与架构事实源：`docs/features/desktop-release-and-updates.md`。

## 1. 结论

本轮只完成一个产品结果：

```text
用户在旧版 CCLink Studio 中发现新版
  -> 明确确认下载
  -> 下载并验证可信安装资产
  -> 明确确认安装
  -> 保存工作现场
  -> 自动替换应用并重启
  -> 新版恢复原工作现场
```

只支持 Apple Silicon Mac。Intel/x64、Windows、Linux 和 Mac App Store 不在范围内。

预计剩余投入为 **9-13 个工程日，加两轮真实 arm64 发版验收**。Apple 公证、GitHub
Actions 和公开 Release 的外部等待时间不计入工程日。

## 2. 当前事实

### 2.1 用户现在能做什么

- 从状态栏打开更新面板。
- 选择稳定或测试更新通道；稳定通道只检查正式版，测试通道检查 Pre-release 和正式版。
- 发现新版后确认下载，查看进度、取消和重试。
- 下载写入 Studio 私有缓存，并检查空间、长度和 SHA-256。
- 下载完成后重启 Studio，已校验资产会重新核验并恢复“更新已下载”。
- 在正式签名构建中点击“打开安装包”；Studio 会再次核对文件完整性、Apple 公证、
  当前发布者 Team ID、Bundle ID、目标版本和纯 arm64 架构，再交给 macOS 打开。

### 2.2 用户现在还不能做什么

- 从尚未公开的新 Release 完成一次真实的可信 DMG 打开和人工替换。
- 在下载完成后自动替换并重启。
- 在安装前处理未保存 Markdown、运行中的 Agent 和 Terminal。
- 从当前公开旧版完成一次真实的端到端升级。

### 2.3 代码现状

- `UpdateService` 是检查和下载状态的唯一所有者。
- `prepareInstall()` 当前固定返回 `ok: false`。
- `installAndRestart()` 当前固定返回 `install_blocked`。
- Manifest v3、发布 Workflow、本地打包命令和更新运行时已收口为 arm64 DMG-only。
- `UpdateCache` 已负责 Manifest digest 隔离、原子记录、启动复验和失效清理。
- `MacDmgVerifier` 只在正式 `darwin + arm64` 构建启用；当前正式应用提供预期 Team
  ID，候选 DMG 和 `.app` 必须与其一致。
- `openManualInstaller()` 只消费主进程内部 verified handle，不接收 renderer 路径。
- 当前 `package.json` 为 `0.1.12`，该版本之前生成的安装包不包含刚合并的更新主链。

## 3. 范围边界

### 3.1 必须交付

- `arm64` 稳定版检查、下载、取消、重试和校验。
- 已校验资产在应用重启后的恢复和重新核验。
- SHA-256、Developer ID、Team ID、Bundle ID、版本和架构校验。
- 用户确认后的安装、工作现场保护、失败回滚和自动重启。
- 安装失败时打开可信 DMG 的人工兜底。
- 更新错误分类和可复制的脱敏诊断。
- 两轮连续的真实升级验收。

### 3.2 明确不做

- Intel/x64、Windows、Linux 和 Mac App Store。
- nightly、灰度和私有测试通道。
- 自动下载、静默安装、强制升级和退出时偷偷安装。
- 差分更新、断点续传、灰度发布和最低版本封锁。
- 独立更新中心、更新历史页面和营销弹窗。
- 第二套检查、下载或安装状态机。
- renderer 接触下载 URL、本地安装路径、Manifest 原文或发布凭证。

DMG 人工安装只作为自动替换失败时的安全兜底，不作为独立功能扩展。

## 4. 架构约束

1. 主进程 `UpdateService` 是唯一产品状态所有者。
2. Provider 只发现 Release；Transport 只下载；Verifier 只校验；
   `InstallerAdapter` 只执行已经批准的安装事务。
3. renderer store 只是快照投影，窗口重建后必须从主进程重新对账。
4. 稳定轨道忽略 prerelease，测试轨道允许 prerelease；两者都忽略 Draft。
5. 下载和安装分别要求一次明确用户确认。
6. 调用任何会关闭窗口的安装 API 前，必须完成工作现场检查、保存和持久化。
7. 安装失败必须保持旧版本可启动；不能留下新旧版本都不可用的中间状态。
8. 候选安装机制产生第二状态所有者或无法可靠回滚时，不进入生产路径。
9. 需要新增 Helper、系统目录写入或权限扩张时，先提交 ADR。
10. `pnpm verify`、相关 smoke 和真人验收未通过时，不得宣称里程碑完成。

目标边界：

```text
GitHubReleaseProvider
        |
        v
UpdateService -------------------- renderer snapshot
  |       |       |                         |
  |       |       +-> InstallReadiness      +-> UpdatePanel
  |       +----------> AssetVerifier
  +------------------> InstallerAdapter
```

## 5. 里程碑总览

| 里程碑          | 用户结果                                | 当前状态                                                    | 预计       |
| --------------- | --------------------------------------- | ----------------------------------------------------------- | ---------- |
| M0 单架构收口   | 发布链只产生 arm64 资产，不再承诺 Intel | 已完成                                                      | 0.5 天     |
| M1 下载恢复闭环 | 下载完成后重启仍可继续安装              | 代码与自动化完成，真人验收中                                | 1.5-2.5 天 |
| M2 可信安装兜底 | 自动安装不可用时能打开可信 DMG          | 代码与本地自动化完成，公开签名包真人验收待补                | 0.5-1 天   |
| M3 安装技术闸门 | 冻结唯一可维护的安装机制                | 候选分析完成；真实签名安装实验阻塞                          | 1-1.5 天   |
| M4 工作现场保护 | 安装前明确处理文档和运行任务            | 未开始                                                      | 2-2.5 天   |
| M5 自动安装重启 | 确认后替换应用并恢复工作现场            | 未开始                                                      | 2.5-3.5 天 |
| M6 两轮升级验收 | 旧正式版连续两次真实升级                | 未开始                                                      | 1-1.5 天   |
| M7 测试版订阅   | 测试用户可在应用内收到公开 Pre-release  | 代码、自动化和真实 UI 冒烟完成；公开 Pre-release 升级待验收 | 0.5-1 天   |

原始总估算：9-13 个工程日。剩余工作以 M1 真人验收和 M2-M6 为准，不用已完成的
M0 工程整理抬高用户功能进度。M7 不替代 M1-M6 的真实正式版升级验收。

## 6. M0：Apple Silicon 单架构收口

### 目标

删除更新和发布链中的 Intel/x64 产品承诺，避免继续维护无验收价值的分支。

### 方案

- `schemaVersion: 2` 曾定义 arm64 DMG/ZIP；DMG-only 发布改用 `schemaVersion: 3`，
  避免静默改变已冻结的 v2。
- 正式运行时只在 `darwin + arm64` 启用 GitHub Provider，其他架构使用 no-op。
- Release Workflow 只保留 Apple Silicon runner 和 arm64 DMG。
- 删除 `release:x64`、`package:x64`、Intel runner 和双架构汇总门禁。
- 更新 Manifest generator、verifier、fixture、测试、Runbook 和产品文档。
- 历史双架构 Release 证据保留为历史记录，不作为当前产品要求。

### 验收

1. 运行正式发布预检，只要求一组 arm64 DMG、ZIP、checksum 和 build record。
2. Manifest 缺少 arm64 任一资产时拒绝发布。
3. 仓库面向用户的命令和文档不再宣称支持 Intel。
4. `pnpm verify` 通过。

### 退出标准

代码、Workflow、Manifest、脚本和文档只有一套 arm64 事实，不保留可触发的 x64
发布入口。

### 当前证据

- Manifest v3、Provider、release workflow 和本地 package 命令已切为 arm64 DMG-only。
- Manifest/Provider 针对性测试 13 项通过。
- release workflow/Manifest 脚本测试 30 项通过。
- `pnpm typecheck` 与 `pnpm lint` 通过。
- 本轮 `pnpm verify` 已通过：184 个测试文件、1068 项测试和生产构建全部成功。

## 7. M1：可靠下载与恢复

### 目标

用户完成下载后，即使关闭并重新打开 Studio，仍能看到“更新已下载”，且缓存文件会被
重新校验，不依赖内存状态。

### 方案

- 抽出 `UpdateCache`，统一负责目录布局、原子状态文件、配额和清理。
- 缓存键包含版本、arm64 和 Manifest digest。
- `verified.json` 最后写入；启动时重新核对版本、架构、大小和 SHA-256。
- 当前版本已经达到目标、Manifest 变化、文件被篡改或资产过期时作废缓存。
- `.part` 启动时清理；MVP 失败后从头重下，不做断点续传。
- BrowserWindow 重建只重建 renderer 投影，不终止主进程下载任务。
- 诊断记录 operationId、阶段、耗时、字节数和错误码，不记录完整 URL 或绝对路径。

### 验收

1. 下载完成后退出并重开，状态恢复为 `readyToInstall`。
2. 修改缓存文件一个字节，再启动时必须拒绝并回到可重新下载状态。
3. 下载中重建窗口，下载继续且新窗口显示同一进度。
4. 取消、断网、超时、磁盘不足、错误长度和错误哈希均不会影响当前版本使用。
5. `pnpm verify`、更新 Service 测试和真实 Studio smoke 通过。

### 退出标准

只有启动时重新核验通过的资产才能进入安装阶段。

### 当前证据

- `UpdateCache` 缓存键包含版本、arm64 和 Manifest digest。
- `verified.json` 使用 schema v2 并在资产原子改名后写入。
- 启动恢复会重新检查版本、系统版本、Manifest digest、常规文件、大小和 SHA-256。
- 重启恢复、文件篡改拒绝、当前版本追平清理、取消、错误哈希和缓存故障降级共
  7 项 Service 测试通过。
- 全量 `pnpm verify` 已通过；隔离 Profile 的真实 Electron 恢复和 renderer reload
  对账通过。
- 公开新版真实下载仍待正式 Release，因此 M1 的外部发布验收尚未关闭。

## 8. M2：可信 DMG 兜底

### 目标

自动替换因权限或安装机制失败时，用户仍能安全地完成更新，而不是下载完成后无路可走。

### 方案

- 打开前再次校验 size、SHA-256、版本和 arm64。
- 使用系统能力检查公证、Developer ID、预期 Team ID 和 Bundle ID。
- renderer 只发送 operationId，不传本地路径。
- 主进程只允许打开当前 `readyToInstall` 对应的 DMG。
- 展示简短 Finder 替换指引；不要求关闭 Gatekeeper 或执行 `xattr`。

### 验收

1. 有效 DMG 可以打开并显示安装指引。
2. 被替换、损坏、错误发布者、错误 Bundle ID 或错误版本的 DMG 被拒绝。
3. `shell.openPath` 失败时保留可信缓存，允许重试。
4. 新版手工启动后清理已经完成的旧缓存。

### 退出标准

自动安装失败不会让用户卡死，也不会打开未经验证的文件。

### 当前证据

- 打开前重新读取 `verified.json`，并重新计算 DMG 大小和 SHA-256；篡改后删除缓存。
- DMG 通过 `codesign`、Gatekeeper `spctl --type open` 后才以只读方式挂载。
- 候选 `.app` 必须唯一，并通过 `codesign --deep --strict`、`spctl --type execute`、
  当前 Team ID、`com.cclink.studio`、目标版本和纯 arm64 检查。
- renderer 只调用无参数 IPC；绝对路径和 Team ID 不进入 renderer。
- `shell.openPath` 失败保留可信缓存和 `readyToInstall`，允许重试。
- 17 项定向测试、全量 `pnpm verify`（185 files / 1079 tests）和隔离 Profile 的
  真实 Electron UI smoke 已通过。
- 公开签名、公证 DMG 的真实打开与 Finder 替换仍待首个公开 Release，因此 M2 尚未
  完全关闭。

## 9. M3：安装技术闸门

### 目标

用真实签名 arm64 应用验证并冻结唯一安装方案，再开始生产实现。

### 候选方案与当前结论

1. `electron-updater` 作为无状态 `InstallerAdapter`。
2. Electron 内置 `autoUpdater`。
3. 受签名的最小 Helper。

分析结论记录在 `docs/decisions/0005-macos-update-installer-gate.md`：

- Electron 内置 `autoUpdater` 已淘汰；Squirrel.Mac 将检查和自动下载绑定在自己的
  生命周期中。
- `electron-updater` 已淘汰直接生产接入；公开 API 不能消费现有 verified handle，
  即使关闭自动下载和退出安装也会建立第二套 Provider/缓存状态。
- 最小事务型 Helper 是唯一实验候选，但必须先取得两个签名、公证测试包并通过回滚
  实验；目前没有公开 Release，M3 仍为 `BLOCKED`。

### 技术闸门

- 能消费统一 Manifest，或通过无状态 adapter 转换。
- 只在用户确认后下载和安装。
- 能验证预期 Team ID、Bundle ID、版本和 arm64。
- 当前用户对 `/Applications` 有写权限时能可靠替换。
- 权限不足时明确降级到 M2。
- 中断或失败时旧版本仍可启动。
- 成功后能启动目标版本并写入启动确认。

### 验收

用两个签名测试包完成：

```text
旧版启动 -> 准备更新 -> 退出 -> 替换 -> 新版启动 -> 确认版本
```

同时注入权限不足和替换中断，证明旧版仍可启动。结论、未选方案、权限和回滚写入 ADR。

### 止损

同一候选方案连续两次无法满足回滚或单状态所有者要求，停止继续修补，切换下一候选。
三种方案均不过闸门时，产品维持 M2，不上线半可靠自动安装。

## 10. M4：工作现场保护

### 目标

安装前让用户看到会受退出影响的内容，并能选择处理、稍后安装或取消。

### 方案

- 定义 `InstallReadinessContributor`，主进程统一汇总只读影响摘要。
- 编辑器贡献未保存 Markdown 和虚拟草稿。
- Agent 贡献运行中的任务及其中断影响。
- Terminal 贡献有前台进程的会话。
- Browser、workspace state 和其他长任务贡献 flush 状态。
- `prepareInstall()` 生成带过期时间的 confirmation token。
- 状态发生变化后旧 token 立即失效，必须重新确认。
- 用户确认后按固定顺序 flush；任一失败都不进入 shutdown。

### 验收

1. 未保存 Markdown 被逐项列出；保存、放弃、稍后和取消行为明确。
2. Agent 正在运行或 Terminal 有前台进程时准确提示。
3. 用户取消后不保存、不退出、不终止任何任务。
4. 状态变化后旧确认 token 无法触发退出。
5. flush 超时或失败时停留在当前版本并给出可重试信息。

### 退出标准

安装事务只能收到最新、明确且可审计的用户确认。

## 11. M5：自动安装与重启

### 目标

用户确认后，Studio 保存现场、退出、替换应用、启动新版并恢复现场。

### 方案

- 自动安装使用同一 Release 的 arm64 ZIP；DMG 只用于 M2 兜底。
- ZIP 下载复用 M1 Transport，并执行大小、SHA-256 和发布者校验。
- 固定事务顺序：

```text
prepare
  -> confirm
  -> flush contributors
  -> persist workspace
  -> stop accepting new work
  -> graceful runtime shutdown
  -> stage candidate
  -> replace application
  -> relaunch
  -> confirm target version
  -> clean cache
```

- Installer 只接受内部 verified asset handle，不接受 renderer 路径。
- 替换前保留可恢复旧版本；新应用移动成功并通过检查后才删除备份。
- 新版启动写入成功 marker；超时或启动失败保留诊断和回滚入口。
- 只读位置、权限不足和非 `/Applications` 场景降级到 M2。

### 验收

1. 空闲状态从旧版安装并自动重启到新版。
2. 有未保存 Markdown 时，取消不会退出；保存后可以继续。
3. Agent 或 Terminal 运行时，不确认不得终止。
4. 安装失败后旧版仍能启动。
5. 重启后工作区、浏览器 Profile、打开标签和可恢复会话保持一致。
6. 应用版本、Bundle ID、Team ID 和 arm64 全部符合预期。

### 退出标准

只有以上真人动作和失败注入全部通过后，产品文案才允许写“安装并重启”。

## 12. M6：两轮真实升级验收

### 为什么至少需要三个版本状态

当前已经生成的 `0.1.12` 安装包不包含新 updater，无法凭空升级。必须先发布一个包含
完整 updater 的基线版本，再连续发布两个更高目标版本，完成两轮升级。

版本号以发布时仓库状态为准；若没有其他版本占用，建议：

```text
0.1.13：包含完整 updater 的基线版
0.1.14：第一轮升级目标版
0.1.15：第二轮升级目标版
```

### 第一轮

1. 从不可变 Tag 构建、签名、公证并发布 arm64 基线版。
2. 在干净 Apple Silicon 环境安装并首次启动，不使用 `xattr`。
3. 发布第一轮目标版本。
4. 基线版发现第一轮目标版，完成下载、校验、安装和重启。

### 第二轮

从第一轮目标版继续升级到第二轮目标版，覆盖：

- 稍后安装后重启恢复。
- 下载取消和重新下载。
- 离线、GitHub 限流和 Release 资产撤回。
- 缓存损坏。
- 权限不足降级到可信 DMG。
- 安装失败后旧版本继续启动。

### 验收证据

- Tag、源提交、Actions Run 和公开 Release 地址。
- arm64 DMG、Manifest、checksum 和公证结果，且发布资产中不存在 ZIP。
- 安装前后版本截图和脱敏诊断。
- 失败注入及恢复结果。
- `pnpm verify`、standalone smoke 和真实升级记录。

## 12.1 M7：测试版订阅

### 用户结果

测试用户在“设置 → 更新”选择“测试版（包含预发布）”后，可以沿用同一更新面板接收
公开 GitHub Pre-release；稳定用户看不到该版本。Draft 对两类用户都不可见。

### 实现边界

- `SettingsService` 持久化 `updateTrack`，默认 `stable`。
- `UpdateService` 继续拥有唯一状态机；切换轨道时取消活动操作、清空候选和可信缓存。
- `GitHubReleaseProvider` 的 `beta` 轨道同时考虑正式版与 Pre-release，并选择最高合法版本。
- Manifest、签名、公证、哈希、架构、最低系统版本和人工下载确认门禁保持不变。
- 不新增私有源、测试账号名单、静默下载、nightly 或第二套更新状态机。

### 端到端验收

1. 先安装一个已经包含 `updateTrack` 能力的基线版。
2. 在设置中选择测试通道，重启后设置仍保持，更新面板明确显示“测试通道”。
3. 发布一个更高版本的公开 Pre-release；手动检查能发现并标记为“测试版”，完成下载、
   校验和可信 DMG 打开。
4. 同一基线切回稳定通道后检查，不能发现该 Pre-release。
5. 测试版下载完成后切回稳定通道，候选和缓存被清除，重启也不能恢复该测试包。
6. Draft、同版本、降级版本、无效 Manifest 和错误资产仍被拒绝。

旧客户端不具备测试轨道逻辑，不能凭空发现 Pre-release。首次测试必须通过一个正式基线
升级，或由测试用户人工安装一次测试能力基线；该引导未完成时不得声称“老用户可直接
收到测试版”。

## 13. 实施顺序

```text
M0 arm64 单架构收口
  -> M1 下载恢复
  -> M2 可信 DMG 兜底
  -> M3 安装方案技术闸门
  -> M4 工作现场保护
  -> M5 自动安装重启
  -> M6 两轮真实升级验收
```

不能越过的门禁：

- 当前 arm64 Manifest v3 DMG-only 契约不得回退或重新扩展为多架构、多格式。
- M1 未形成可恢复 verified asset，不进入安装。
- M2 兜底未通过，不把自动安装暴露给用户。
- M3 没有 ADR 和真实签名实验，不接生产 Installer。
- M4 未通过，不允许任何安装 API 关闭窗口。
- M5 失败回滚未通过，不发布基线版。
- M6 两轮升级未通过，不宣称自动更新完成。

## 14. 汇报与完成纪律

每次阶段汇报固定回答：

```text
用户现在能做什么、还不能做什么
本轮新增的用户可验收能力
当前里程碑和剩余任务
自动化结果
真实 Studio 验收结果
失败路径和残余风险
下一步最小闭环
```

下列内容不能单独算作产品完成：

- 代码合并。
- mock、单元测试或 CI 通过。
- Draft Release 创建成功。
- 本地未签名包能启动。
- 只验证成功路径。
- 只有开发模式截图。

## 15. 最终用户验收

自动更新只有在真实安装包中完成以下动作才算完成：

```text
旧版启动
  -> 发现新版
  -> 用户确认下载
  -> 显示进度
  -> 取消后可重新下载
  -> 下载完成后重启仍可安装
  -> 用户确认安装
  -> 未保存内容和运行任务得到处理
  -> 应用自动替换并重启
  -> 新版显示正确版本
  -> 原工作现场恢复
```

任何一步失败时，当前已安装版本仍必须能够启动和继续工作。
