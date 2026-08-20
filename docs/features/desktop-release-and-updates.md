# Desktop Release And Updates

> 状态：2026-08-16。开源版只支持 Apple Silicon `arm64`；稳定/测试订阅轨道的代码、
> 自动化门禁和真实 Electron UI 冒烟已通过。已有候选版本的显式重新检查、更高版本
> 替换与刷新失败保留候选已通过代码及自动化门禁，真实公开 Release 时序验收待执行。
> 公开 Pre-release 端到端升级待执行。
> M0 单架构收口已完成；M1 已实现下载缓存恢复与启动复验；M2 已实现可信 DMG
> 二次校验和打开入口。本地门禁与隔离 Profile 的真实 Electron 验收已通过，公开
> 签名版本验收待执行。自动安装与重启仍未接入。

## 结论

CCLink Studio 开源版采用 Developer ID 直接分发。本仓库从不可变 Git Tag 构建
Apple Silicon 安装包，完成签名和 Apple 公证后，将安装包与更新元数据发布到本仓库
GitHub Releases。

产品闭环固定为：

```text
自动或手动检查
  -> 展示版本和发布说明
  -> 用户确认下载
  -> 后台下载、进度、取消、重试
  -> 缓存恢复、哈希与发布者校验
  -> 用户确认安装
  -> 检查并保存工作现场
  -> 退出、替换应用、自动重启
```

不得静默下载、静默退出、强制安装或要求用户关闭 Gatekeeper。

## 当前能力

用户现在可以：

- 从设置中选择稳定版或测试版更新通道，再从状态栏打开更新面板手动检查。
- 稳定通道只接收公开正式 Release；测试通道同时接收公开 Pre-release 和正式 Release。
- 看到“已是最新”“发现新版”或结构化失败状态。
- 已发现候选版本后不必重启应用，可以在更新面板重新检查并切换到更高版本；刷新失败时
  保留原候选及下载入口。
- 确认后台下载后立即继续使用工作台；状态栏持续显示进度，可重新打开面板取消并重试。
- 将 DMG 下载到 Studio 私有缓存，并校验空间、长度和 SHA-256。
- 下载完成后重新启动 Studio；主进程重新核验缓存，通过后恢复
  `readyToInstall`。
- 在正式签名构建中打开再次通过哈希、Apple 公证、发布者、Bundle ID、版本和 arm64
  校验的 DMG，并按 Finder 指引手工替换。

用户现在还不能：

- 在 Studio 内确认安装、保存工作现场、替换应用并自动重启。
- 从公开旧版本完成一次真实端到端升级。

因此当前不得宣称“自动更新已完成”。可准确表述为“已支持检查、受控下载、重启恢复，
以及正式签名构建中的可信 DMG 人工安装兜底”。

## 产品范围

本阶段必须交付：

- Apple Silicon `arm64` 稳定版检查、下载、取消、重试和校验。
- 已校验资产在重启后的恢复与重新核验。
- SHA-256、Developer ID、Team ID、Bundle ID、版本和架构校验。
- 自动安装不可用时打开可信 DMG 的人工兜底。
- 安装前保护未保存 Markdown、运行中的 Agent、Terminal 和长任务。
- 用户确认后的安装、失败回滚、自动重启和工作现场恢复。
- 更新错误分类和可复制的脱敏诊断。
- 两轮连续的真实 arm64 升级验收。

明确不做：

- Intel/x64、Windows、Linux 和 Mac App Store。
- nightly、灰度和私有测试通道。
- 自动下载、静默安装、强制升级和退出时自动安装。
- 差分更新、断点续传、灰度发布和最低版本封锁。
- 独立更新中心、更新历史页面或营销弹窗。
- 第二套检查、下载或安装状态机。
- renderer 接触下载 URL、本地安装路径、Manifest 原文或发布凭证。

固定 Runtime 组件不属于 App 替换资产；已暂停的双版本更新和能力插件边界见
`runtime-components-and-capability-plugins.md`。它们可以复用有界下载、校验和缓存原语，但不能
复制或接管 `UpdateService` 的应用版本、安装和重启状态，也不能通过组件包修改 Electron、
main、preload、IPC 或主 renderer。暂停的扩展不改变本阶段“差分更新不做”和“完整
App 更新只有一个状态所有者”的范围。

## 架构原则

1. 主进程 `UpdateService` 是检查、下载和安装状态的唯一产品所有者。
2. `GitHubReleaseProvider` 只发现 Release；`UpdateCache` 只管理可信缓存；
   后续 Verifier 和 Installer 只接受主进程内部句柄。
3. renderer store 是可丢弃投影，窗口重建后必须从主进程重新对账。
4. 稳定轨道忽略 prerelease；测试轨道允许 prerelease。两者都忽略 Draft、同版本和降级版本。
5. 下载和安装分别要求一次明确用户确认。
6. 安装前必须完成工作现场检查、保存和持久化。
7. 安装失败必须保持旧版本可启动。
8. 候选安装机制若产生第二状态所有者或无法可靠回滚，不进入生产路径。
9. 新增 Helper、系统目录写入或权限扩张前必须提交 ADR。
10. `pnpm verify`、受影响 smoke 和真人验收未通过时，不得宣称里程碑完成。

## 边界与所有权

| 能力                                                    | 所有者                  |
| ------------------------------------------------------- | ----------------------- |
| Manifest、Provider、UpdateService、UpdateCache、更新 UI | `cclink-studio`         |
| 开源版签名、公证和 Release 上传                         | 本仓库 GitHub Actions   |
| 开源版公开更新元数据和资产                              | 本仓库 GitHub Releases  |
| 商业版集成与发布                                        | `cclink-dev` 自有工作流 |
| 发布授权、下载确认、安装确认                            | 人类                    |

开源版安装包不保存 GitHub Token。公开 Release 的检查与下载不需要用户凭证。签名和
公证凭证只存在于本仓库受保护的 `studio-release` GitHub Environment：

```text
MACOS_CERTIFICATE_P12_BASE64
MACOS_CERTIFICATE_PASSWORD
MACOS_DEVELOPER_IDENTITY
APPLE_API_KEY_BASE64
APPLE_API_KEY_ID
APPLE_API_ISSUER
```

开源版不得 checkout `cclink-dev`、读取商业版更新源或共享商业版发布状态。

## Manifest v3

开源版使用 GitHub Releases API 查找订阅轨道内最新的公开 Release，不依赖
`latest-mac.yml`。发布工作流只构建一个 arm64 DMG，并在公开 Release 前生成和
反向校验唯一的 `update-manifest.json`：

```json
{
  "schemaVersion": 3,
  "channel": "stable",
  "tag": "v0.1.13",
  "version": "0.1.13",
  "sourceSha": "40-character-tag-commit-sha",
  "minimumSystemVersion": "13.0",
  "assets": {
    "arm64": {
      "dmg": {
        "name": "cclink-studio-0.1.13-arm64.dmg",
        "size": 123,
        "sha256": "64-character-lowercase-sha256"
      }
    }
  }
}
```

Manifest 保存资产 basename，不保存下载 URL。Provider 从同一 Release 的资产列表
解析 HTTPS 地址，主进程限制 GitHub 下载跳转域。renderer 不接收 Manifest 原文、
下载 URL、本地路径或发布凭证。

检查通过必须同时满足：

1. Release 已公开且不是 Draft；稳定轨道还要求不是 prerelease。
2. Release Tag、Manifest Tag、Manifest version 一致。
3. 目标版本严格高于当前版本。
4. Manifest 只包含合法 arm64 DMG；构建目录和 Release 不得包含 ZIP。
5. 资产名称、大小和 SHA-256 与 Release 一致。
6. 当前 macOS 满足 `minimumSystemVersion`。

## 检查策略

- 更新轨道是本地持久化设置，默认 `stable`，可选 `beta`。
- `stable` 只考虑正式 Release；`beta` 同时考虑 Pre-release 和正式 Release，并选择
  版本号最高的合法候选。
- 切换轨道会取消正在进行的检查或下载，清空候选、忽略版本和已验证缓存，再要求重新
  检查。启动恢复也会拒绝与当前轨道不兼容的 Pre-release 缓存。
- Draft 永远不参与应用内更新；测试包必须由维护者公开为 GitHub Pre-release。
- Manifest 的 `channel: stable` 继续表示当前不可变资产格式，不等同于用户订阅轨道，
  因而同一组已签名资产可先作为 Pre-release 验收，再原样提升为正式 Release。

- 正式安装包在主窗口可交互后延迟 60 秒首次检查。
- 应用运行期间每 6 小时检查一次。
- 自动检查只检查，不自动下载；失败不弹阻断对话框。
- 手动检查绕过周期冷却，但复用同一个 in-flight Promise。
- `available` 状态必须提供显式“重新检查”入口。检查期间继续展示原候选；成功时以订阅
  轨道内最新合法候选替换原候选，失败时保留原候选、下载入口和上次成功检查时间，并展示
  本次结构化错误。不得要求用户先忽略、延后或重启才能发现更高版本。
- 同一时间只允许一个检查或一个下载操作。
- 已恢复为 `readyToInstall` 时保持当前可信资产，不被后台检查覆盖。

### 已有候选时的刷新验收

1. 从低版本 Studio 检查更新，面板显示公开候选 vA 和上次成功检查时间。
2. 保持同一 App 进程和同一更新轨道，在公开源提供合法的更高版本 vB。
3. 用户点击“重新检查”；检查期间仍能看到 vA，不能出现候选短暂消失或误报“已是最新”。
4. 检查成功后面板切换为 vB，发布说明、资产大小和检查时间同步更新，后续下载绑定 vB。
5. 再次检查时模拟断网或更新源失败；面板提示结构化刷新错误，同时继续显示并允许下载 vB。
6. 恢复网络后再次检查成功，刷新错误消失；整个过程不重启 Studio、不切换轨道，也不产生
   第二份候选状态。

## 下载与缓存

下载只在用户点击“下载更新”后发生：

- 私有目录为 `<userData>/updates`，不会写入 `~/Downloads`。
- 目录键为 `版本-arm64-ManifestDigest`，避免同版本资产替换后误复用。
- 文件先写 `.part`，校验大小和 SHA-256 后原子改名。
- `verified.json` 最后原子写入，包含 Manifest、摘要、发布说明和资产元数据，
  不包含下载 URL。
- 启动时删除遗留 `.part`，重新计算 DMG SHA-256。
- 版本已追平、架构不符、系统版本不符、Manifest 摘要变化、文件大小变化、符号链接
  或哈希错误都会让缓存失效并被删除。
- 多个有效候选只保留最高稳定版本。
- MVP 不做断点续传；中断后从头下载。

本地绝对路径只存在于主进程内部，不进入 IPC 快照、renderer、日志或诊断包。

## 可信 DMG

用户点击“打开安装包”后，主进程按固定顺序执行：

1. 从内部 verified handle 重新读取记录并核对 size、SHA-256 和 Manifest digest。
2. 核验 DMG 的 Developer ID 签名和 Gatekeeper 公证结果。
3. 以只读、无 Finder 自动弹窗方式挂载 DMG，并要求其中只有一个 `.app`。
4. 核验应用签名、公证、当前正式应用的 Team ID、`com.cclink.studio`、目标版本和
   单一 arm64 可执行文件。
5. 卸载检查用映像后，才调用 `shell.openPath` 交给 macOS 打开。

哈希或身份失败会删除缓存；仅 macOS 打开动作失败时保留可信缓存供重试。本地 ad-hoc
构建没有可作为信任根的 Team ID，因此不能从应用内打开正式更新包。

## 状态机

```text
disabled
  -> idle
       -> checking -> idle
              |----> available
              |----> failed -> idle

available
  -> checking (保留原候选) -> available (替换为最新候选)
              | failure       -> available (保留原候选和刷新错误)
  -> downloading -> verifying -> readyToInstall -> installing
          |              |              |
          | cancel       | failed       | defer
          v              v              v
      available        failed      readyToInstall
```

结构化错误至少区分：

```text
provider_unavailable
network_offline
network_timeout
release_invalid
manifest_invalid
unsupported_arch
unsupported_system
disk_space_insufficient
download_cancelled
download_corrupt
publisher_mismatch
install_blocked
install_failed
```

## 发布流程

开源版正式发布入口：

```bash
pnpm release -- --patch
pnpm release -- --version 0.1.13
```

固定流程：

1. 复用当前 `main` 精确 SHA 的普通 CI；CI 正在运行时有界等待，失败、超时或源码漂移时停止。
2. 写入目标版本；只有显式要求本地产物时才生成同版本 ad-hoc arm64 DMG。
3. 创建版本提交和 annotated Tag。
4. 原子推送 `main` 与 Tag。
5. 触发 `release-oss.yml`，在 `macos-15` 重新构建 arm64 正式候选包。
6. 签名、公证、staple，并执行 `codesign`、`spctl` 和 Manifest 校验。
7. 全部门禁通过后直接创建公开稳定 Release。
8. 在真实用户安装与应用内更新中继续发布后测试；问题通过更高版本修复，不覆盖已有资产。

本地 `pnpm package:local` 只生成当前 Apple Silicon Mac 的未签名测试包，不修改
版本、不推送，也不是正式发布入口。`pnpm release` 默认不重复生成本地验收包；远程从
不可变 Tag 独立构建签名公证包并在门禁通过后公开。详细操作见
`docs/ops/oss-release-runbook.md`。

普通 CI 中 `verify` 与六组隔离 smoke 并发启动；smoke 之间不共享 userData、端口或进程。
正式 Release 仍串行执行签名、App 公证、DMG 公证和 Gatekeeper/Manifest 门禁。

## 开发里程碑

当前执行计划和验收标准以
`docs/features/desktop-update-development-plan.md` 为唯一事实源：

```text
M0 arm64 单架构收口
  -> M1 下载恢复闭环
  -> M2 可信 DMG 兜底
  -> M3 安装技术闸门
  -> M4 工作现场保护
  -> M5 自动安装重启
  -> M6 两轮真实升级验收
```

M0 是工程准备度，不计入用户功能进度。M1 的本地实现已经通过，但只有公开新版真实
下载验收后才能完全关闭；M5 和 M6 都通过后，产品文案才可写“支持用户确认后的
自动安装”。

## Mac App Store

Mac App Store 需要独立沙箱、权限、签名和审核策略，不在本阶段范围。启动该工作前
必须单独提交 ADR，不能通过条件分支污染 Developer ID 直接分发路径。
