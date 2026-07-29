# Desktop Release And Updates

> 状态：R0 发布自动化门禁已通过，等待干净 Apple Silicon 和 Intel Mac 的真人安装
> 启动验收；客户端自动更新 U0 的 contract、Manifest、发布聚合、真实 Draft、
> 下载后独立验证和预期失败 Run 均已通过并关闭，U1-U5 尚未开始。Mac App Store
> 不在本阶段范围。

## 结论

CCLink Studio 开源版采用 Developer ID 直接分发：本仓库的开源发布工作流从不可变
Git Tag 构建，完成签名和 Apple 公证后，将安装包及更新元数据发布到本仓库 GitHub
Releases。Studio 默认自动检查自身公开的稳定版 Release；发现新版本后提示用户，
由用户确认下载，完成哈希和 Developer ID 信任校验后，再由用户确认安装并重启。
不得静默下载、静默退出或强制安装。

产品闭环固定为：

```text
自动或手动检查
  -> 展示版本和发布说明
  -> 用户确认下载
  -> 后台下载、进度、取消、重试
  -> 哈希与发布者校验
  -> 用户确认安装
  -> 检查并保存工作现场
  -> 退出、替换应用、自动重启
```

当前旧 updater 只能读取外部 `latest-mac.yml`、下载一个 DMG 并打开，不能视为
正式自动更新能力。新的更新链路必须以本文件定义的 Manifest、`UpdateService` 和状态机
为唯一事实源，旧路径在 U1 完成时移除。

`cclink-dev` 保留独立的商业版发布工作流，不编排、不触发也不拥有开源版 Release。
两个项目可以使用同一 Developer ID 发布者，但凭证、Tag、制品和发布状态按仓库隔离。
具体边界见 `docs/decisions/0004-independent-edition-release-pipelines.md`。

## 架构原则

1. **不可变版本**：`package.json` 版本、`vX.Y.Z` Tag 和 Release 版本必须一致。
   已发布 Tag、安装包和更新元数据不得覆盖；修复必须发布更高版本。
2. **单一状态所有者**：主进程 `UpdateService` 是检查、下载和安装状态的唯一
   所有者。renderer 只消费快照并发出用户命令。
3. **发布权限隔离**：开源版签名证书和 Apple 公证凭证只存在于本仓库受保护的
   `studio-release` Environment Secrets；同仓库 Release 使用短期
   `GITHUB_TOKEN`。凭证不能进入源码、安装包、renderer、preload、日志或诊断包。
4. **检查与安装分离**：稳定安装包默认启用自动检查，但自动检查不得自动下载；
   开发模式、无 provider、网络失败和元数据损坏不得阻塞 Studio 启动。
5. **双重信任**：文件哈希用于检测传输损坏，Developer ID 代码签名用于确认
   发布者身份。只依赖 HTTPS 或同源 URL 不足以自动安装。
6. **人工发布与安装确认**：GitHub Release 先生成 Draft，经人工批准后公开；
   客户端退出和安装前必须由用户确认。
7. **工作保护**：存在未保存编辑、运行中的 Agent 或 Terminal 时，不得直接退出
   安装；必须先展示影响并完成可恢复状态写入。
8. **架构精确匹配**：Apple Silicon 只能选择 `arm64` 资产，Intel 只能选择 `x64`
   资产；缺少当前架构资产时必须报告不可用，不能猜测或跨架构回退。
9. **不可恢复失败不破坏旧版本**：检查、下载、校验和安装失败都必须保留当前已安装
   版本可启动；下载只能写临时文件，校验通过后才能进入待安装状态。
10. **版本与渠道单调前进**：稳定通道忽略 Draft 和 prerelease，只接受高于当前版本
    的稳定语义版本；不得覆盖安装同版本或隐式降级。

## 产品范围

本阶段必须交付：

- 启动延迟检查、运行期间周期检查和手动检查。
- 稳定版 Release 发现、版本比较、发布说明展示和“稍后提醒”。
- 当前 CPU 架构的安装资产选择。
- 下载进度、取消、重试、临时文件、磁盘空间检查和 SHA-256 校验。
- 用户确认后的 DMG 辅助安装，以及最终的确认后自动替换和重启。
- 未保存编辑、运行中 Agent、Terminal 和其他长任务的安装前保护。
- 更新状态、错误分类和脱敏诊断。

本阶段不做：

- 静默下载、静默退出、强制安装或后台强制重启。
- 增量补丁、差分更新、灰度百分比投放或强制最低版本。
- Windows、Linux、Mac App Store 或跨渠道降级。
- 在安装包内保存 GitHub Token、Apple 凭证或其他发布密钥。
- 让商业版消费开源版 Release，或让开源版读取商业版更新源。

`beta` 保留为 Provider 能力，但稳定版 MVP 只开放 `stable`；没有明确测试用户和回滚
流程前，不在设置页暴露 beta 开关。

## 边界与所有权

| 能力                                                 | 所有者                          |
| ---------------------------------------------------- | ------------------------------- |
| 中性更新契约、no-op provider、UpdateService、更新 UI | `cclink-studio`                 |
| 开源版签名、公证和 Release 上传                      | `cclink-studio` GitHub Actions  |
| 商业版集成与商业版发布                               | `cclink-dev` 自有工作流         |
| 开源二进制与公开更新元数据托管                       | `cclink-studio` GitHub Releases |
| 发布批准、安装确认                                   | 人类                            |

Studio 安装包不保存 GitHub Token。开源发布使用 GitHub Actions 自动提供的短期
`GITHUB_TOKEN`；公开 Release 的检查和下载不需要用户凭证。

开源版 `GitHubReleaseProvider` 只读取 `AwsomeName/cclink-studio` 的公开 Release。
商业版由 `cclink-dev` 注入自己的 Provider、仓库和产品标识。两者共享中性 contract
和 `UpdateService`，但不得共享 Release、Tag、Manifest、下载缓存或发布状态。

开源发布环境固定为 `studio-release`，只包含以下 Secrets：

```text
MACOS_CERTIFICATE_P12_BASE64
MACOS_CERTIFICATE_PASSWORD
MACOS_DEVELOPER_IDENTITY
APPLE_API_KEY_BASE64
APPLE_API_KEY_ID
APPLE_API_ISSUER
```

不创建长期 GitHub PAT。发布工作流的 `contents: write` 只授予创建 Draft Release
的 job，验证和打包 job 保持 `contents: read`。

## 维护者发布命令

开源版正式发布只有一个本地入口：

```bash
pnpm release:oss -- --patch
pnpm release:oss -- --version 0.1.3
```

命令要求：

- 当前仓库是 `AwsomeName/cclink-studio`，处于干净且与 `origin/main` 一致的
  `main`。
- 目标版本高于 `package.json` 当前稳定版本，且本地和远端都不存在同名 Tag。
- 本机 Git 凭证可以推送 main、Tag 并触发 GitHub Actions。
- 操作者输入 `release vX.Y.Z` 进行最终确认；CI 或受控自动化必须显式传入
  `--yes`。

确认后，命令执行以下固定流程：

1. `pnpm install --frozen-lockfile`、`pnpm verify` 和 `pnpm smoke:standalone`。
2. 只修改 `package.json` 版本，创建版本提交和 annotated Tag。
3. 运行 OSS 发布预检，再原子推送 main 与 Tag，避免只推成功其中一项。
4. 触发 `release-oss.yml` 并等待 arm64、x64 签名、公证和 Draft Release 完成。
5. 输出 Draft Release 地址和资产清单，不执行公开发布。

若远端 main 与 Tag 已存在，但触发 GitHub Actions 时网络中断，使用恢复入口：

```bash
pnpm release:oss -- --dispatch-only v0.1.3
```

`--no-wait` 只跳过本地等待，不改变远端构建和 Draft 策略。命令失败后不自动删除
本地提交或 Tag，维护者应先判断失败发生在推送前还是推送后，再决定修复或使用
`--dispatch-only`；不得覆盖或重写已推送 Tag。

`scripts/package.sh` 只用于当前机器上的未签名测试打包，不是正式发布入口。
维护者执行发布时以 `docs/ops/oss-release-runbook.md` 为操作事实源。

## 检查策略与用户体验

### 自动检查

- 正式安装包默认开启自动检查。
- 应用主窗口可交互后延迟 60 秒执行首次检查，避免与启动恢复、Agent、浏览器和
  Terminal 初始化争用。
- 最近一次自动检查距今不足 6 小时时不重复请求；应用持续运行时每 6 小时检查一次。
- 自动检查失败只更新诊断和“上次检查”状态，不弹阻断对话框。
- 同一时间只允许一个检查操作；周期检查与手动检查复用同一个 in-flight Promise。

### 手动检查

- “检查更新”命令绕过 6 小时冷却，但不能绕过正在进行的检查。
- 手动检查必须明确返回“已是最新版”“发现新版本”“当前无法检查”之一。
- 手动检查不得直接开始下载。

### 发现新版本

- 更新入口展示版本号、发布时间、发布说明、下载大小和目标架构。
- 用户可选择“下载更新”“稍后提醒”或“忽略此版本”。
- “忽略此版本”只影响自动提示；手动检查仍显示该版本，并允许恢复提示。
- 新版本到达后，旧的忽略记录自动失效。

### 下载与安装

- 点击“下载更新”后才产生网络和磁盘副作用。
- 下载在 Studio 内显示进度、已下载字节、总大小、速度和取消入口，不打开系统浏览器。
- 校验成功后展示“安装并重启”和“稍后安装”。“稍后安装”在下次启动后仍可识别已
  校验资产，但 Manifest、版本或文件哈希变化时必须作废并重新下载。
- “安装并重启”必须再次由用户确认，并列出未保存编辑、运行中 Agent、Terminal 和
  其他会受退出影响的任务。
- 用户处理或明确确认后，Studio 原子写入可恢复状态、正常关闭运行时、安装并重新启动。

默认设置：

| 设置                     | 默认值 | 说明                         |
| ------------------------ | ------ | ---------------------------- |
| 自动检查更新             | 开启   | 只检查，不自动下载           |
| 自动下载更新             | 关闭   | U5 前不提供开启入口          |
| 更新通道                 | stable | U5 前不在普通设置中暴露 beta |
| 退出后自动安装已下载更新 | 关闭   | 每次安装都要求显式确认       |

## Release 发现与更新 Manifest

开源版使用 GitHub Releases API 查找最新公开稳定 Release，不依赖可变的外部
`latest-mac.yml`。Provider 必须拒绝 Draft、稳定通道上的 prerelease、非法 Tag、
版本不一致和缺失 Manifest 的 Release。

发布工作流在 arm64 和 x64 资产汇总后生成一个统一的 `update-manifest.json`，并与
DMG、ZIP、checksums 和 build record 一起进入 Draft Release。Manifest 至少包含：

```json
{
  "schemaVersion": 1,
  "channel": "stable",
  "tag": "v0.1.3",
  "version": "0.1.3",
  "sourceSha": "immutable-tag-commit",
  "minimumSystemVersion": "13.0",
  "assets": {
    "arm64": {
      "dmg": {
        "name": "CCLink-Studio-0.1.3-arm64.dmg",
        "size": 0,
        "sha256": "..."
      },
      "zip": {
        "name": "CCLink-Studio-0.1.3-arm64-mac.zip",
        "size": 0,
        "sha256": "..."
      }
    },
    "x64": {
      "dmg": {
        "name": "CCLink-Studio-0.1.3-x64.dmg",
        "size": 0,
        "sha256": "..."
      },
      "zip": {
        "name": "CCLink-Studio-0.1.3-x64-mac.zip",
        "size": 0,
        "sha256": "..."
      }
    }
  }
}
```

Manifest 中保存资产名而不是任意下载 URL。Provider 根据同一 Release 的资产列表解析
真实下载地址，主进程限制 HTTPS、仓库和允许的 GitHub 下载跳转域。renderer 不接收
Manifest 原文、下载 URL、本地下载路径或发布凭证。

检查通过必须同时满足：

1. Release 已公开，稳定通道不是 prerelease。
2. Release Tag、Manifest Tag、Manifest version 和语义版本一致。
3. 目标版本严格高于当前版本。
4. `sourceSha` 与同一 Release 的两份构建记录一致；发布工作流负责强制验证，客户端
   只做防御性复核。
5. 当前架构的 DMG 和 ZIP 均存在，名称、大小和 SHA-256 合法。
6. 当前 macOS 版本满足 `minimumSystemVersion`。

## 运行时架构

```text
GitHubReleaseProvider / CommercialReleaseProvider / NoopProvider
                              |
                              v
                     main UpdateService
                check / download / verify / install
                              |
                 shared schema + trusted IPC
                              |
                              v
                  renderer update projection
              status bar / update panel / settings
```

`UpdateService` 进入主进程统一 Runtime Registry，拥有 timer、in-flight 请求、下载
任务、临时文件和安装准备状态。`start()`、窗口重建和 `stop()` 必须对称；关闭服务时
取消 timer 和网络请求，但不得删除已经校验并明确选择“稍后安装”的资产。

共享 IPC 契约先于实现，至少提供：

```text
updater.getSnapshot
updater.check
updater.startDownload
updater.cancelDownload
updater.defer
updater.ignoreVersion
updater.prepareInstall
updater.installAndRestart
updater.onSnapshotChanged
```

所有 command 使用运行时 schema 校验。`prepareInstall` 返回短期确认令牌和安装影响
摘要；`installAndRestart` 必须携带该令牌，工作状态变化后旧令牌立即失效。renderer
的 Zustand store 只是可丢弃投影，窗口重建后必须调用 `getSnapshot` 与主进程重新
对账。

## 更新状态机

```text
disabled
  -> idle
       -> checking -> idle
              |----> available
              |----> failed -> idle

available
  -> downloading -> verifying -> readyToInstall -> installing
          |              |              |
          | cancel       | failed       | defer
          v              v              v
      available        failed      readyToInstall
```

`UpdateSnapshot` 至少包含 `phase`、稳定 `operationId`、当前版本、可用版本、架构、
通道、进度、字节数、上次检查时间和结构化错误。下载 URL、本地绝对路径、Manifest
原文和可信校验细节只存在于主进程。

取消下载从 `downloading` 回到 `available` 并删除 `.part`；校验失败进入 `failed`
并隔离损坏文件；“稍后安装”保持 `readyToInstall`。应用重启后只有版本、Manifest
摘要、文件大小和哈希全部匹配，才能恢复 `readyToInstall`。

## 下载、校验与失败恢复

- 下载目录位于应用私有更新缓存，不直接写入 `~/Downloads`。
- 下载先写唯一 `operationId` 对应的 `.part` 文件，成功关闭并校验后原子改名。
- 开始前检查 `Content-Length`、可用磁盘空间、架构和预期大小。
- 重定向次数、连接超时、总超时和最大文件大小必须有上限。
- 网络中断、取消、进程退出和校验失败都不能留下可安装的半文件。
- SHA-256 通过后，还必须在安装阶段验证 Developer ID 发布者和预期 Team ID。
- 自动安装机制无法证明发布者身份、原子替换或失败回滚时，必须降级到经过验证的
  DMG 辅助安装，不得绕过验证继续。

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

诊断记录 `operationId`、阶段、版本、架构、耗时、字节数和错误码；不记录 URL 查询
参数、Token、Cookie、用户目录全路径或 Manifest 外的远端响应正文。

## 开发里程碑

每个里程碑必须形成独立提交或 PR，并通过 `pnpm verify` 与本里程碑新增测试。后一
里程碑不得以复制状态、IPC 或 Provider 的方式绕过前一里程碑未完成的 contract。

R0 和 U0 是发布与契约的工程前置条件，不是用户可见的自动更新里程碑，也不计入
“用户功能进度”。用户功能从 U1 的“在 Studio 内检查并看到明确结果”开始。任何
阶段汇报必须先说明用户当前能否检查、下载、安装和重启，再报告工程准备度。

本节定义产品级里程碑和退出标准。任务编号、预计工作量、代码落点、测试矩阵、
人工验收、交付证据、并行边界和进度算法以
`docs/features/desktop-update-development-plan.md` 为执行事实源。开发过程按其中的
`U0-01`、`U1-01` 等任务编号汇报，不以代码行数代替完成度。

### R0：可重复发布

目标：

- 从指定 Studio Tag 构建 arm64/x64 安装包。
- arm64 固定使用 Apple Silicon runner，x64 固定使用 Intel runner；不得依赖
  `macos-latest` 的可变架构。
- 在应用构建前真实导入 P12，验证导出密码和 Developer ID identity。
- 执行确定性门禁，记录源码 SHA、发布 workflow SHA、架构和哈希。
- Developer ID 签名、Apple 公证并 staple。
- 创建 GitHub Draft Release；人工批准后公开。

验收：

- 版本、Tag 和 Release 一致。
- 缺少任一发布凭证时在构建前失败，不生成“正式版”。
- `codesign --verify --deep --strict`、`spctl --assess` 和 `stapler validate` 通过。
- 两种架构在干净 Mac 上安装启动，不要求 `xattr` 绕过。
- Release 资产包含 DMG、ZIP、校验和及构建记录。跨架构更新元数据由 U0
  在全部架构汇总后统一生成。
- 开源 workflow 不 checkout `cclink-dev`，商业 workflow 也不参与开源 Release。

实施记录（2026-07-27）：

- [`release-oss` #5](https://github.com/AwsomeName/cclink-studio/actions/runs/30239299035)
  暴露了首轮门禁缺口：内部 `.app` 是有效的 `Notarized Developer ID`，DMG
  哈希和文件结构也有效，但 DMG 外层没有可用签名，Gatekeeper 以“已损坏”拒绝打开。
- [`release-oss` #9](https://github.com/AwsomeName/cclink-studio/actions/runs/30249565536)
  使用 GitHub Runner 官方临时钥匙串流程，arm64、x64 和 Draft job 全部通过。DMG
  在上传前依次完成 Developer ID 签名、公证、staple、`codesign` 和 Gatekeeper
  `spctl --type open` 检查。
- 从 Draft Release 重新下载 arm64 DMG 后进行独立复验：SHA-256 与发布清单一致，
  `hdiutil verify`、`codesign --verify`、`stapler validate` 均通过，Gatekeeper
  返回 `accepted`，来源为 `Notarized Developer ID`。
- 修复通过后仍需分别在干净 Apple Silicon 和 Intel Mac 上安装并启动，不使用
  `xattr` 绕过；确认后方可公开 Draft Release。

### U0：更新契约与发布元数据

目标：

- 冻结 `update-manifest.json` schema、Provider 接口、`UpdateSnapshot`、command、
  事件和错误码。
- 在 Release workflow 的汇总 job 生成跨架构 Manifest。
- 用构建产物真实名称、大小和 SHA-256 填充 Manifest，并在创建 Draft 前自检。
- 明确开源、商业和 no-op Provider 的注入边界。

方案：

- 新增 shared Zod schema 和 Manifest 生成/校验脚本。
- workflow 在两个 package job 完成后下载并汇总资产，再生成 Manifest。
- 发布预检验证 Tag、版本、source SHA、两种架构资产和 checksums 一致。
- 为有效、缺架构、错版本、错哈希、非法资产名和 prerelease fixture 建测试。

验收：

- Draft Release 包含唯一的 `update-manifest.json`。
- Manifest 能从 Release 资产独立重建并通过 schema 校验。
- 任一架构资产缺失或校验和不一致时 Draft job 在上传前失败。
- contract 不向 renderer 暴露可信 URL、本地路径或发布凭证。

### U1：统一检查服务与更新界面

目标：

- `UpdateService` 成为检查状态唯一所有者并进入 Runtime Registry。
- 开源正式包使用 `GitHubReleaseProvider`，商业版和开发模式分别注入自己的 Provider
  或 no-op Provider。
- 自动检查、周期检查和手动检查共用一个状态机。
- 状态栏只做轻提示；详情、发布说明和用户命令进入统一更新面板。

方案：

- 移除旧 `latest-mac.yml` 解析和 IPC 层全局 `latestResult`。
- 实现 Provider mock、GitHub Release fixture 和可控时钟测试。
- 设置中加入“自动检查更新”，默认开启；beta 和自动下载暂不开放。
- 窗口重建通过 `getSnapshot` 恢复投影，不重复注册 timer。

验收：

- 启动延迟、6 小时冷却、周期检查和手动检查行为可用假时钟确定性验证。
- 无更新、发现更新、离线、超时、404、限流、非法 Release 和 no-op 均有明确状态。
- 自动检查失败不弹阻断对话框，手动检查显示可理解结果。
- arm64 和 x64 fixture 只选择对应架构，不允许隐式降级或同版本安装。
- renderer 无下载 URL 的权威副本，不接触发布凭证。
- Runtime 重建和关闭后没有重复 timer、监听器或请求。

### U2：可靠下载与校验

目标：

- 在 Studio 内下载当前架构资产，支持进度、取消和重试。
- 使用私有缓存、`.part`、原子改名、SHA-256 和恢复摘要。
- 下载失败或文件损坏时保留当前版本，不进入待安装状态。

方案：

- 主进程实现单一 `DownloadTask`，以 `operationId` 归因。
- 校验 Content-Length、磁盘空间、重定向、超时、最终大小和 SHA-256。
- renderer 仅通过 snapshot 展示进度，不持有 stream 或文件路径。
- 启动时清理过期 `.part`，保留仍与当前 Manifest 匹配的已校验资产。

验收：

- 正常、慢速、断网、超时、取消、磁盘不足、大小错误和哈希错误有自动化覆盖。
- 修改下载文件任意字节后必须拒绝进入 `readyToInstall`。
- 取消后网络请求停止、`.part` 删除、状态回到 `available`。
- 窗口重建不终止主进程下载，重新打开后进度能对账。

### U3：DMG 辅助安装闭环

目标：

- 提供一个不依赖自动替换机制的可靠兜底路径。
- 校验完成后由用户确认打开 DMG，并给出简洁安装指引。
- 安装后新版本能识别并清理旧缓存。

方案：

- 从私有缓存打开已经校验的当前架构 DMG，不重新从 URL 下载。
- 打开前再次核对文件摘要和当前可用版本。
- Studio 不模拟 Finder 拖拽，不请求管理员权限，不修改系统安全设置。

验收：

- arm64 和 Intel Mac 均可从旧版本发现、下载并打开正确 DMG。
- 损坏、被替换或过期的 DMG 不能打开为安装资产。
- 用户手动替换后启动新版本，更新状态回到 `idle`，旧缓存被安全清理。
- U3 完成后即可对外宣称“支持自动检查和受控下载”，不能宣称“自动安装”。

### U4：用户确认后的自动安装与重启

目标：

- 先以签名 ZIP 做最小技术验证，再接入成熟且可维护的 Electron 更新实现。
- 用户确认后保存工作区并重启安装。
- 支持“立即重启”和“稍后”，不做强制静默更新。

方案：

- 技术验证必须证明 `/Applications` 中的旧版本可被当前用户更新、Developer ID 和
  Team ID 可验证、替换失败不会破坏旧版本、成功后能自动拉起新版本。
- 新增安装准备协调器，以只读贡献收集编辑器、Agent、Terminal 和其他长任务状态；
  UpdateService 不直接读取各 renderer store。
- 用户确认后先串行 flush 可恢复状态，再走统一 Runtime shutdown，最后执行安装。
- 任一准备步骤失败时停留在 `readyToInstall`，允许重试或回退到 U3 DMG 安装。

验收：

- `X.Y.Z` 能发现并安装更高版本，不能覆盖安装同版本或隐式降级。
- 未保存编辑、运行中 Agent、Terminal 和长任务会被完整列出，未经确认不能退出。
- 确认后工作区、浏览器 Profile、Agent 会话和 Terminal 可恢复状态先完成持久化。
- 在 `/Applications`、只读位置、权限不足、安装中断和重启失败场景下行为可预测。
- 安装失败保留旧版本可用，并提供脱敏诊断。
- Apple Silicon 和 Intel 各完成一次 `旧版本 -> 新版本 -> 自动重启` 真人验收。

### U5：稳定化与发布运营

目标：

- 把 U0-U4 从功能可用收口为可长期维护的发布能力。
- 建立更新兼容矩阵、诊断、缓存治理和发布前升级验收。
- 在有真实需求后再评估 beta 通道和可选自动下载。

方案：

- 使用不会进入正式安装包的受控 staging Provider，对 Draft 资产执行“旧稳定版检查并
  升级到当前 Draft”验收；正式客户端仍然只能读取公开 Release，也不携带 Draft 凭证。
- 诊断日志加入更新状态、最近操作和错误码，继续保持脱敏。
- 增加缓存配额、过期清理、忽略版本和“稍后安装”恢复测试。
- 对 GitHub API 限流、Release 删除、资产撤回和 Manifest schema 升级定义降级行为。

验收：

- 连续两个正式版本完成 arm64/x64 升级闭环，没有依赖系统浏览器或手工改安全设置。
- 失败矩阵、真人证据和恢复结果写入独立更新验收记录。
- 更新服务故障不会阻断 Studio 启动、项目切换、Agent、浏览器、编辑器或 Terminal。
- 只有 U4 和 U5 均通过后，产品文案才可写“支持用户确认后的自动安装”。

## 实施顺序与并行边界

```text
R0 发布基线
  -> U0 Manifest + contract
       -> U1 检查服务与 UI
       -> U2 下载与校验
       -> U3 DMG 兜底闭环
       -> U4 自动安装与工作保护
       -> U5 稳定化
```

U0 完成后，Release Manifest 生成器、主进程 Provider 和 renderer 更新面板可以在不同
分支并行开发，但 shared contract 只能由 U0 owner 修改。U2 依赖 U1 状态机；U4
依赖 U2 的可信资产和 U3 的降级路径，不能提前并行接入生产默认路径。

每轮完成判断都必须回答：

- 状态所有者是否仍只有主进程 `UpdateService`？
- 失败是否只降级更新模块，而不阻断 Studio？
- renderer 是否拿到了不应拥有的 URL、路径、凭证或可信判断？
- 用户是否在下载和安装两个副作用点得到明确选择？
- 当前版本是否在任何失败路径下仍可启动？
- 是否真的在 arm64 和 Intel 安装包上验证，而不只是用 mock 报绿？

## Mac App Store

Mac App Store 需要独立的沙箱、权限、签名和审核策略。它可以作为未来的第二分发
渠道，但不得通过条件分支污染 Developer ID 直接分发的默认运行时。启动该工作前
必须单独提交 ADR。
