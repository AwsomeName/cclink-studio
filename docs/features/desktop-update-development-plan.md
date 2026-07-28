# Desktop Update Development Plan

> 状态：计划已冻结；U0 本地实现和门禁已通过，远端 Release 验收待完成。
> 产品与架构事实源：`docs/features/desktop-release-and-updates.md`。
> 本文件只负责工程拆解、顺序、验收和交付证据；与产品事实源冲突时，以产品事实源
> 为准。

## 1. 计划结论

桌面更新按 U0-U5 六个里程碑交付，不以一个大 PR 同时完成。每个里程碑都必须关闭
自己的状态、生命周期、失败恢复和验收，才能进入下一阶段：

| 里程碑 | 交付结果                             | 估算工作量             | 可对外描述                   |
| ------ | ------------------------------------ | ---------------------- | ---------------------------- |
| R0     | 双架构签名、公证、Draft Release      | 已实现，真人验收待补   | 可下载安装包                 |
| U0     | Manifest、共享契约和发布元数据       | 3-4 人日               | 发布物具备更新所需可信元数据 |
| U1     | 检查服务、状态机和更新界面           | 5-7 人日               | 支持自动和手动检查更新       |
| U2     | 应用内可靠下载、校验和恢复           | 5-7 人日               | 支持受控下载和完整性校验     |
| U3     | 已校验 DMG 的辅助安装闭环            | 2-3 人日               | 支持打开可信安装包并引导替换 |
| U4     | 用户确认后的自动安装、工作保护和重启 | 8-12 人日              | 支持确认后自动安装并重启     |
| U5     | 两轮真实发布稳定化、诊断和运营门禁   | 3-5 人日加两个发布周期 | 更新能力达到长期维护基线     |

估算以一名熟悉 Electron、TypeScript 和 GitHub Actions 的工程师为口径，不包含 Apple
或 GitHub 外部服务等待时间，也不包含两个正式版本之间的自然观察周期。U0-U4 的纯工程
工作约 23-33 人日；U5 必须跨两个真实发布周期，不能靠集中加班压缩为一次测试。

## 2. 执行约束

### 2.1 开始条件

U0 可以立即开始，但公开新的正式 Release 前必须补齐 R0 的两项真人验收：

- 干净 Apple Silicon Mac 下载、安装、首次启动，不使用 `xattr` 绕过。
- 干净 Intel Mac 下载、安装、首次启动，不使用 `xattr` 绕过。

R0 真人验收未完成不会阻塞契约和代码开发，但会阻塞 U3、U4 的正式安装结论以及
Release 从 Draft 转为公开。

### 2.2 每个里程碑的 Definition of Done

一个里程碑只有同时满足以下条件才能标记完成：

1. 任务清单全部完成，没有临时第二状态所有者或兼容性旁路。
2. `pnpm verify` 通过，受影响的 smoke 和新增测试通过。
3. 自动化失败矩阵通过，真人验收项有脱敏证据。
4. 主进程、preload、renderer、workflow 和文档中的契约一致。
5. 失败不会阻断 Studio 启动，旧版本在更新失败后仍可启动。
6. 代码、测试、验收记录和文档形成独立提交或 PR。
7. 工作树干净，并记录最终提交 SHA、测试命令和 Release/Actions 地址。

“代码写完”“mock 测试通过”或“在开发模式能点”都不能单独作为完成依据。

### 2.3 PR 与所有权规则

- 一个里程碑原则上一个主 PR；超过 800 行有效逻辑时按任务组拆为多个串行 PR。
- `src/shared` 的更新契约由 U0 owner 维护；并行分支不得自行扩展 IPC 字段。
- `UpdateService` 是唯一状态所有者。Provider、DownloadTransport 和
  InstallerAdapter 只返回结果或事件，不能各自维护第二份产品状态机。
- renderer store 是可丢弃投影；窗口重建必须从主进程 snapshot 重新对账。
- 任何新增依赖、权限、Helper、系统目录写入或自动退出机制先通过 U4 技术闸门；
  需要偏离架构宪法时先提交 ADR。

## 3. 目标模块结构

目标目录不是强制逐字一致，但职责边界必须保持：

```text
src/shared/update/
  manifest-schema.ts        Release Manifest schema
  update-contract.ts        snapshot、command、event、error schema
  update-types.ts           中性类型

src/main/update/
  update-service.ts         唯一状态机和生命周期
  update-provider.ts        Provider interface
  github-release-provider.ts
  noop-update-provider.ts
  update-cache.ts           私有缓存和恢复摘要
  download-task.ts          单一下载任务
  asset-verifier.ts         大小、SHA、签名和 Team ID 检查
  installer-adapter.ts      U4 才进入生产路径
  install-readiness.ts      安装前工作保护协调器
  update-diagnostics.ts
  update-ipc.ts

src/renderer/src/features/update/
  update-store.ts           snapshot 投影
  UpdatePanel.tsx
  UpdateStatus.tsx
  UpdateSettings.tsx

scripts/release/
  generate-update-manifest.mjs
  verify-update-manifest.mjs

docs/ops/
  desktop-update-acceptance.md
```

现有 `src/main/updater/update-checker.ts`、`update-utils.ts`、
`src/main/ipc/updater-ipc.ts` 和旧 renderer `update-store.ts` 只作为迁移输入，不是
长期共存模块。U1 退出前必须删除旧 `latest-mac.yml` 路径和 IPC 全局
`latestResult`。

## 4. 共享测试与证据矩阵

### 4.1 自动化层级

| 层级     | 覆盖内容                                                     |
| -------- | ------------------------------------------------------------ |
| Unit     | schema、版本比较、状态迁移、资产选择、哈希、错误归类         |
| Contract | IPC 输入输出、preload 白名单、Provider、Manifest fixture     |
| Service  | 假时钟、假网络、临时缓存、取消、恢复、Runtime start/stop     |
| UI       | snapshot 投影、按钮可用性、进度、错误和人工确认              |
| Workflow | 双架构资产汇总、Manifest 生成、校验、Draft 创建前失败        |
| Smoke    | 正式安装包启动、检查、下载、DMG 打开、自动安装与重启         |
| Human    | arm64/Intel、真实 GitHub Release、Gatekeeper、权限和工作恢复 |

### 4.2 固定平台矩阵

| 平台                      | U0     | U1      | U2        | U3  | U4          | U5          |
| ------------------------- | ------ | ------- | --------- | --- | ----------- | ----------- |
| macOS arm64 开发机        | 是     | 是      | 是        | 是  | 是          | 是          |
| macOS Intel GitHub runner | 是     | 是      | 是        | 否  | 否          | 是          |
| 干净 Apple Silicon Mac    | 否     | 否      | 是        | 是  | 是          | 是          |
| 干净 Intel Mac            | 否     | 否      | 是        | 是  | 是          | 是          |
| 单元测试中的 Linux/CI     | schema | service | transport | 否  | coordinator | diagnostics |

Intel runner 只能证明构建与确定性测试，不能代替 Intel 真机 Finder、Gatekeeper 和安装
重启验收。

### 4.3 验收证据格式

每个里程碑在 `docs/ops/desktop-update-acceptance.md` 追加：

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

证据不得包含 Token、Cookie、Apple 私钥、P12、用户目录完整路径或下载 URL 查询参数。

## 5. U0：更新契约与发布元数据

### 5.1 目标和退出状态

U0 结束时，Release 能提供一份机器可验证的双架构 Manifest，代码库拥有冻结的中性
更新契约。此时不实现网络检查 UI，也不下载文件。

状态退出条件：

- `update-manifest.json` schemaVersion 固定为 `1`。
- Provider、snapshot、command、event 和 error code 全部通过 Zod 运行时校验。
- Draft job 只有在两种架构资产和构建记录一致时才能创建 Draft。
- 开源版、商业版和 no-op Provider 只有接口共享，不共享仓库地址、状态或凭证。

### 5.2 任务拆解

| ID    | 工作项             | 主要产出与代码落点                                                 | 完成检查                    |
| ----- | ------------------ | ------------------------------------------------------------------ | --------------------------- |
| U0-01 | Manifest schema    | `src/shared/update/manifest-schema.ts`；字段边界、版本和资产名规则 | 正反 fixture 全通过         |
| U0-02 | Runtime contract   | `update-contract.ts`；snapshot、command、event、error schema       | renderer 不含 URL/路径/凭证 |
| U0-03 | Provider interface | `update-provider.ts`；`check()` 的输入、取消和标准化结果           | GitHub/商业/no-op 可替换    |
| U0-04 | Manifest generator | `generate-update-manifest.mjs`；从真实资产和 checksums 生成        | 输出确定、可重跑            |
| U0-05 | Manifest verifier  | `verify-update-manifest.mjs`；反向核对文件、Tag、版本、SHA         | 任一篡改返回非零            |
| U0-06 | Workflow 汇总      | `release-oss.yml` 汇总 arm64/x64 artifact 后生成 Manifest          | 缺一个架构即失败            |
| U0-07 | 发布预检接入       | 扩展 release preflight 和 build record                             | sourceSha 全链一致          |
| U0-08 | Fixture 与契约测试 | valid、缺架构、错版本、错 SHA、非法名、prerelease                  | 测试不访问公网              |
| U0-09 | 验收记录初始化     | 新建 desktop update acceptance 文档                                | 包含证据模板                |

### 5.3 关键设计决定

- Manifest 保存资产名，不保存任意 URL；Provider 只允许从同一 Release 资产解析 URL。
- `sourceSha`、Tag、版本和两份 build record 的强一致由 workflow 强制；客户端只做
  防御性复核。
- `minimumSystemVersion` 在 Manifest 顶层统一声明；需要架构差异时必须升级 schema，
  不能临时增加未校验字段。
- 未识别的 `schemaVersion` 返回 `manifest_invalid`，不能尝试宽松解析。
- Manifest 生成器输入必须是 workflow 下载的真实产物，不读取手写文件名列表。

### 5.4 测试与失败注入

- 对 Manifest 任意删除 arm64/x64、DMG/ZIP、size、sha256 都必须失败。
- Tag 为 `v0.1.3` 而 package/Manifest 为 `0.1.2` 必须失败。
- SHA 合法格式但与真实文件不一致必须失败。
- 资产名包含路径穿越、URL、控制字符或不支持扩展名必须失败。
- 同样输入重复生成的 Manifest 除时间无关字段外必须逐字节一致；Manifest 不设置
  当前时间字段。

### 5.5 人工验收

1. 从一个真实测试 Tag 运行工作流。
2. 确认 arm64、x64 package job 成功后才启动汇总 job。
3. 下载 Draft 中的 Manifest、checksums 和 build record。
4. 在本地运行 verifier，结果通过。
5. 修改任一下载文件后重跑 verifier，结果失败。

### 5.6 U0 退出证据

- U0 PR 和最终提交 SHA。
- 一次成功的 Draft Actions Run。
- 一次“缺架构或错哈希”预期失败 Run。
- Manifest、build record 和 verifier 输出的脱敏摘要。
- `pnpm verify` 结果。

## 6. U1：统一检查服务与更新界面

### 6.1 目标和退出状态

U1 结束时，正式包可以自动或手动检查公开稳定 Release，所有检查状态由主进程
`UpdateService` 持有。发现更新后只展示信息，不产生下载和磁盘副作用。

### 6.2 任务拆解

| ID    | 工作项               | 主要产出与代码落点                                   | 完成检查                     |
| ----- | -------------------- | ---------------------------------------------------- | ---------------------------- |
| U1-01 | GitHub Provider      | 公开 Releases API、稳定版过滤、Manifest 获取与标准化 | 不需要 Token                 |
| U1-02 | No-op 与注入点       | 开发/no-provider 降级；商业 Provider 接口注入        | OSS 不读取商业配置           |
| U1-03 | UpdateService 状态机 | `idle/checking/available/failed`、operationId、去重  | 唯一状态所有者               |
| U1-04 | Runtime 生命周期     | start/stop、60 秒延迟、6 小时 timer、AbortController | 重建不重复 timer             |
| U1-05 | 可信 IPC             | getSnapshot/check/defer/ignore/onSnapshotChanged     | 全部 schema 校验             |
| U1-06 | preload 白名单       | 只暴露 typed commands 和 unsubscribe                 | 无通用 IPC 透传              |
| U1-07 | renderer 投影        | Zustand snapshot store、窗口恢复时重新对账           | store 可完全丢弃             |
| U1-08 | 更新面板与状态栏     | 版本、说明、大小、稍后、忽略；状态栏只做轻提示       | 不在状态栏塞完整流程         |
| U1-09 | 设置与手动命令       | 自动检查开关、检查更新入口、上次结果                 | beta/自动下载不出现          |
| U1-10 | 删除旧实现           | 删除 latest-mac parser、旧 updater IPC、旧全局缓存   | `rg latest-mac` 无运行时命中 |
| U1-11 | 诊断与错误映射       | 阶段、耗时、HTTP 分类、限流但不记录敏感正文          | 诊断包可脱敏                 |

### 6.3 状态转换要求

```text
disabled --enable--> idle
idle --auto/manual check--> checking
checking --no update--> idle
checking --new update--> available
checking --recoverable error--> failed --ack/retry--> idle/checking
available --defer/ignore--> idle
```

- 自动检查失败不得弹 modal；仅在更新入口留下非阻断状态。
- 手动检查必须返回明确的最新版、发现更新或检查失败结果。
- 手动检查与自动检查同时发生时共享一个 in-flight Promise，不发两次网络请求。
- 关闭自动检查只取消未来 timer，不中断用户主动发起的手动检查。
- 发现更高版本后再次检查到同一版本，只更新时间，不创建新 operation。

### 6.4 Provider 安全边界

- 固定 HTTPS 和允许的 GitHub API/下载域；限制重定向次数。
- 拒绝 Draft、稳定通道 prerelease、非 `vX.Y.Z` Tag 和非预期仓库 Release。
- 请求使用明确 User-Agent、连接超时、总超时和 AbortSignal。
- 处理 GitHub 403 限流并记录可重试时间，不循环重试。
- Release body 作为不可信 Markdown 处理，不允许脚本、任意 HTML 或外部资源自动加载。

### 6.5 自动化验收

- 假时钟验证 60 秒首次延迟、6 小时冷却和持续运行周期。
- 并发调用十次 `check()` 只产生一个 Provider 请求。
- 窗口销毁重建不会重复注册 listener；Runtime stop 后没有 timer 和未决请求。
- fixture 覆盖无 Release、同版本、高版本、低版本、prerelease、非法 Manifest、
  404、403 限流、离线、超时和 no-op。
- arm64/x64 只选择本架构资产；不允许跨架构回退。
- Renderer 测试确认自动检查失败不弹 modal，手动检查有明确反馈。

### 6.6 人工验收

1. 安装低于公开 Release 的正式包，启动后等待延迟检查。
2. 确认 Studio 其他模块先可用，检查不阻塞启动。
3. 确认更新入口显示版本、说明、大小和架构。
4. 断网后手动检查，确认错误可理解且项目、Agent、浏览器、Terminal 继续工作。
5. 重建窗口或切换项目，确认更新状态不丢失也不重复提示。

### 6.7 U1 退出证据

- 状态机与 Runtime 生命周期测试结果。
- `rg` 证明旧 latest-mac 运行时路径已删除。
- 自动检查、手动检查、离线降级的脱敏截图。
- 主进程 snapshot 与 renderer 展示对账记录。

## 7. U2：可靠下载、校验与恢复

### 7.1 目标和退出状态

U2 结束时，用户确认后可以在 Studio 内下载当前架构资产，看到进度并取消或重试。
只有大小和 SHA-256 全部通过的文件才能进入 `readyToInstall`。U2 不替换应用。

### 7.2 任务拆解

| ID    | 工作项             | 主要产出与代码落点                                 | 完成检查            |
| ----- | ------------------ | -------------------------------------------------- | ------------------- |
| U2-01 | 私有缓存布局       | version/arch/manifest digest 隔离、配额预留、权限  | 不写 Downloads      |
| U2-02 | DownloadTask       | 单 operationId、stream、进度、速度、取消和清理     | 只允许一个活动下载  |
| U2-03 | 网络约束           | HTTPS、域名/跳转、超时、最大尺寸、Content-Length   | 非法响应下载前失败  |
| U2-04 | 磁盘空间与原子文件 | 预检、`.part`、fsync/close、原子 rename            | 半文件不可安装      |
| U2-05 | AssetVerifier      | 最终大小、SHA-256、Manifest 摘要                   | 篡改必失败          |
| U2-06 | 恢复摘要           | 版本、架构、size、sha、manifest digest；原子持久化 | 重启可对账          |
| U2-07 | 启动清理           | 过期 part、孤儿、错误架构、旧 Manifest 清理        | 不删有效 ready 资产 |
| U2-08 | IPC 与 UI          | start/cancel/retry、进度、字节、速度、错误         | renderer 不见路径   |
| U2-09 | 测试 HTTP 服务     | 慢速、断流、错误长度、重定向、超时和损坏 fixture   | CI 不依赖公网       |
| U2-10 | 诊断               | operationId、阶段、耗时、字节和错误码              | 不记录 URL 参数     |

### 7.3 缓存和恢复规则

```text
<userData>/updates/
  state.json
  <version>-<arch>-<manifestDigest>/
    asset.dmg.part
    asset.dmg
    verified.json
```

- 下载先写 `.part`；只有 stream 正常关闭并完成校验后才原子改名。
- `verified.json` 必须最后写入，且不能作为跳过重新核对文件大小和摘要的唯一依据。
- 启动恢复时同时核对目标版本仍高于当前版本、架构、Manifest digest、文件大小和哈希。
- 当前版本已经等于或高于缓存版本时清理缓存。
- 清理失败只记录诊断，不阻塞启动；下载前必须重新确认有足够空间。

### 7.4 失败恢复要求

| 失败场景 | 期望状态                  | 文件处理                     |
| -------- | ------------------------- | ---------------------------- |
| 用户取消 | `available`               | 停止请求并删除 `.part`       |
| 网络断开 | `failed`，允许重试        | 删除或隔离不可信 `.part`     |
| 超时     | `failed`，允许重试        | 关闭 stream，删除 `.part`    |
| 磁盘不足 | `available` + 明确错误    | 不创建或删除 `.part`         |
| 长度不符 | `failed`                  | 隔离后清理                   |
| SHA 不符 | `failed/download_corrupt` | 隔离后清理，不进入 ready     |
| 应用退出 | 下次启动回到 available    | `.part` 不自动续传           |
| 窗口重建 | 下载继续                  | 主进程任务不受 renderer 影响 |

MVP 不做 HTTP Range 断点续传。所谓“恢复”是恢复已经完整校验的待安装资产，不是继续半截
下载；这避免第一版引入服务端 Range、ETag 和分段哈希的额外一致性状态。

### 7.5 自动化验收

- 正常、慢速、取消、断流、离线、连接超时、总超时、磁盘不足、错误长度、超大响应、
  重定向环、SHA 错误全部有确定性测试。
- 对校验后文件改一个字节，恢复时必须降级为 `available` 并删除 ready 记录。
- 下载过程中重建 BrowserWindow，下载继续且新窗口读取同一进度。
- Runtime stop 能终止网络和 stream，进程无悬挂 handle。
- 日志和 IPC snapshot 中不存在本地绝对路径和完整下载 URL。

### 7.6 真人验收

在 arm64 和 Intel 各执行一次：

1. 正常下载并确认进度、取消和重新下载。
2. 下载中断网，确认当前版本可继续使用。
3. 下载完成后重启 Studio，确认 `readyToInstall` 能恢复。
4. 手工篡改缓存文件后重启，确认文件被拒绝。

### 7.7 U2 退出证据

- 下载失败矩阵测试报告。
- 两种架构的下载、取消、恢复和篡改拒绝记录。
- 更新缓存目录脱敏结构和清理前后对比。
- 进程关闭后无悬挂任务的测试结果。

## 8. U3：DMG 辅助安装闭环

### 8.1 目标和退出状态

U3 提供可靠兜底：Studio 打开已经由 U2 校验的 DMG，由用户在 Finder 中拖入
Applications。此阶段不模拟拖拽、不输入密码、不修改 Gatekeeper 设置，也不宣称
自动安装。

### 8.2 任务拆解

| ID    | 工作项         | 主要产出与代码落点                          | 完成检查        |
| ----- | -------------- | ------------------------------------------- | --------------- |
| U3-01 | DMG 二次校验   | 打开前重算 size/SHA、版本和架构             | 过期/篡改拒绝   |
| U3-02 | Publisher 预检 | 挂载或系统工具验证 Developer ID、Team ID    | 发布者不符拒绝  |
| U3-03 | 系统打开适配   | 仅主进程 `shell.openPath` 已验证本地 DMG    | renderer 无路径 |
| U3-04 | 安装指引       | 简短步骤、当前/目标版本、关闭提示和稍后选项 | 不要求绕过安全  |
| U3-05 | 新版本启动清理 | 当前版本达到目标后清理旧 ready 状态和缓存   | 幂等            |
| U3-06 | 真人安装矩阵   | arm64、Intel 从旧版下载、打开、替换、启动   | 两端通过        |

### 8.3 安全与失败路径

- 打开动作必须来自 `readyToInstall` snapshot 对应的 operationId，不能接受 renderer
  传入任意路径。
- 文件在 U2 校验后被替换、Manifest 被撤回或当前版本已变化时，回到 `available`。
- `shell.openPath` 返回错误时保留 ready 资产，允许重试，不循环弹 Finder。
- Team ID 校验无法完成时不打开 DMG，并给出 `publisher_mismatch` 或明确的校验失败。
- 安装后第一次启动只清理旧缓存，不删除比当前版本更高且仍有效的新下载。

### 8.4 自动化与真人验收

- 自动化覆盖有效、被替换、过期、错误架构和 publisher mismatch。
- arm64/Intel 真人验收都必须从“旧正式安装包”开始，不能用 `pnpm dev` 代替。
- 下载和安装全程不打开系统浏览器，不要求执行 `xattr`、关闭 Gatekeeper 或安装证书。
- 新版启动后显示当前版本，更新状态回到 `idle`，旧缓存被清理。

### 8.5 U3 退出证据

- 两种架构安装前后版本截图。
- `codesign`、`spctl` 和 Team ID 脱敏输出。
- 被篡改 DMG 拒绝打开的记录。
- 产品文案审查：只写“检查、下载、辅助安装”，不写“自动安装”。

## 9. U4：用户确认后的自动安装与重启

### 9.1 目标和强制技术闸门

U4 的目标不是“调用一个 updater API”，而是证明确认、工作保护、可信替换、失败回滚
和自动重启形成闭环。生产实现前先完成 U4-A 技术验证；任何候选方案不满足全部闸门，
就维持 U3，不上线半可靠自动安装。

U4-A 必须比较 Electron 原生 `autoUpdater`、`electron-updater` 适配和受签名 Helper
方案，至少验证：

1. 能消费本项目统一 Manifest 或通过无状态 adapter 转换，不产生第二检查状态机。
2. `autoDownload=false`、`autoInstallOnAppQuit=false`，下载和安装都由用户命令触发。
3. 能验证 Developer ID 和预期 Team ID。
4. `/Applications` 中应用由当前用户拥有时可替换；权限不足时明确降级。
5. 替换中断不会让旧版本和新版本同时不可启动。
6. 成功后能自动拉起目标版本并回传启动确认。
7. arm64 和 Intel 都可维护，不引入只在单一架构有效的 Helper。

选型结论、依赖、权限、回滚和未选方案写入 ADR。没有通过 U4-A，不开始 U4-C 的生产
安装适配。

### 9.2 任务拆解

| ID    | 工作项                | 主要产出与代码落点                                      | 完成检查                |
| ----- | --------------------- | ------------------------------------------------------- | ----------------------- |
| U4-01 | 候选方案 Spike        | 三方案最小样例、真实签名 ZIP、替换和重启记录            | 双架构数据              |
| U4-02 | ADR 与接口冻结        | `InstallerAdapter`、选择理由、权限和回滚                | 架构评审通过            |
| U4-03 | ZIP 下载与可信校验    | U2 transport 支持安装 ZIP；SHA、codesign、Team ID       | DMG/ZIP 同源同版本      |
| U4-04 | 安装准备贡献接口      | `InstallReadinessContributor` 只读摘要和 flush          | 不直接读 renderer store |
| U4-05 | 编辑器贡献者          | 未保存文档列表、保存/放弃/取消                          | 用户逐项可见            |
| U4-06 | Agent/Terminal 贡献者 | 运行任务、会话恢复能力和退出影响                        | 不误报空闲              |
| U4-07 | 其他 Runtime 贡献者   | 浏览器 Profile、工作区状态和长任务 flush                | 有超时和错误            |
| U4-08 | 确认界面              | 当前/目标版本、受影响工作、立即/稍后/取消               | 无默认强制确认          |
| U4-09 | Shutdown transaction  | prepare -> flush -> runtime stop -> install -> relaunch | 顺序单一可审计          |
| U4-10 | InstallerAdapter      | 只接受 verified asset handle，不接受 renderer 路径      | 失败回 U3               |
| U4-11 | 启动确认与清理        | 新版本确认 marker、清缓存；超时保留诊断                 | 幂等                    |
| U4-12 | 权限与回滚矩阵        | Applications、只读位置、权限不足、中断、拉起失败        | 旧版仍可启动            |

### 9.3 安装准备协议

```text
readyToInstall
  -> collectReadiness
  -> showImpact
  -> userConfirm
  -> flushContributors
  -> persistWorkspaceSnapshot
  -> gracefulRuntimeShutdown
  -> installerStage
  -> quitAndReplace
  -> relaunch
  -> confirmNewVersion
```

- `collectReadiness` 使用稳定 `installAttemptId`；确认后若工作状态变化，必须重新收集。
- 每个 contributor 返回 `safe`、`needsAttention` 或 `blocked`，以及用户可理解摘要。
- `flushContributors` 有总超时和逐项结果；任一失败立即停止，不进入 shutdown。
- 用户选择取消时不执行 flush 或退出，状态保持 `readyToInstall`。
- shutdown 开始后不再接受新的 Agent、Terminal 或编辑任务；UI 显示正在准备重启。
- installer staging 失败时允许 Runtime 恢复或提示用户重新启动 Studio，并提供 U3。

### 9.4 自动化验收

- 状态变化后旧确认 token 失效，不能用陈旧确认退出应用。
- 任一 contributor 返回 blocked、超时或 flush 失败，都不调用 installer。
- Installer 失败保持当前安装可启动，ready 资产按错误类型保留或隔离。
- 同版本、降级、错误架构、错误 Team ID 和旧 Manifest 全部拒绝。
- Runtime shutdown 每个服务最多调用一次，顺序和超时有测试。
- 新版本启动 marker 能区分安装成功、拉起失败和用户手动取消。

### 9.5 真人验收矩阵

arm64 和 Intel 各执行：

1. 空闲状态 `X.Y.Z -> X.Y.(Z+1)` 自动安装并重启。
2. 有未保存 Markdown 时列出影响；取消后不退出，保存后可继续。
3. Agent 正在运行时列出影响；不确认不得终止。
4. Terminal 有前台进程时列出影响；不确认不得终止。
5. 安装在 `/Applications` 且当前用户有权限时成功替换。
6. 从只读位置或权限不足位置启动时明确降级到 U3。
7. 安装阶段注入失败后旧版本仍能启动。
8. 重启后工作区、浏览器 Profile 和可恢复会话状态与安装前一致。

### 9.6 U4 退出证据

- U4-A ADR、候选验证结果和最终依赖清单。
- 两种架构八项真人验收记录。
- 工作保护确认界面和取消路径截图。
- 安装失败后旧版启动、新版成功重启的诊断记录。
- 产品文案评审通过后，才允许写“确认后自动安装并重启”。

## 10. U5：稳定化与发布运营

### 10.1 目标和退出状态

U5 不再扩大功能面，专门处理真实发布中的兼容性、诊断、缓存和运营门禁。完成条件是
连续两个版本都通过 arm64/x64 的旧版升级闭环，不是再跑一次 mock。

### 10.2 任务拆解

| ID    | 工作项           | 主要产出与代码落点                                    | 完成检查          |
| ----- | ---------------- | ----------------------------------------------------- | ----------------- |
| U5-01 | Staging Provider | 仅测试构建读取 Draft；生产 bundle 永不包含 Draft 凭证 | 构建门禁证明隔离  |
| U5-02 | 更新诊断         | snapshot 摘要、最近 operation、错误码、耗时和恢复建议 | 脱敏              |
| U5-03 | 缓存治理         | 配额、TTL、旧版本、孤儿和低磁盘清理                   | 不删 active/ready |
| U5-04 | Provider 降级    | 限流、Release 删除、资产撤回、schema 升级             | 启动不受阻        |
| U5-05 | 发布前升级 smoke | 旧稳定版 -> staging Draft 的双架构验收                | 不污染生产设置    |
| U5-06 | 第一轮正式升级   | N -> N+1，公开 Release                                | arm64/x64 通过    |
| U5-07 | 第二轮正式升级   | N+1 -> N+2，覆盖缓存恢复和稍后安装                    | arm64/x64 通过    |
| U5-08 | 运维 Runbook     | 失败回滚、撤回资产、停止提示、诊断收集                | 维护者可独立执行  |
| U5-09 | 文案与设置收口   | 稳定通道默认；评估但不默认开启自动下载                | 无强制更新        |

### 10.3 Staging 隔离要求

- 正式安装包只访问公开 Release，不携带 PAT、Draft Token 或 staging 地址。
- Staging Provider 通过测试构建 profile 注入，构建日志必须证明正式 profile tree-shake
  或打包排除该实现。
- Staging 状态、缓存目录和忽略版本记录与正式 Provider 隔离。
- Draft 验收完成后删除临时凭证或维持在受保护 CI Environment，不下发给测试人员。

### 10.4 运营失败策略

| 事件                 | 处理                                                      |
| -------------------- | --------------------------------------------------------- |
| GitHub API 限流      | 保持当前版本，按 reset 时间后再查，手动检查说明原因       |
| Release 被删除       | 已下载但未安装资产作废；已安装版本不受影响                |
| 单个资产撤回         | Manifest 无法完整解析，拒绝更新并记录 `release_invalid`   |
| Manifest schema 升级 | 老客户端忽略未知 schema 并保持可用；新客户端兼容旧 schema |
| 新版严重故障         | 不覆盖 Tag；撤回 Release 并发布更高修复版本，不自动降级   |
| 自动安装故障         | 配置/远端 kill switch 仅禁用安装适配，保留检查和 U3 兜底  |
| 缓存损坏             | 删除该版本缓存并重新下载，不影响当前安装                  |

若引入远端 kill switch，必须是公开、签名或随 Manifest 验证的有限能力字段，只能关闭某项
更新能力，不能执行任意命令、强制升级或改变官方账号功能。

### 10.5 U5 退出证据

- 两个连续公开 Release 的 Actions、Manifest 和双架构升级记录。
- 至少一次离线、限流、资产撤回和缓存损坏演练。
- 诊断日志安全审查，确认没有凭证、绝对路径或私有响应正文。
- 更新服务关闭时 Studio 核心模块启动和使用不受影响。
- Runbook 由未参与实现的维护者按文档独立执行一次。

## 11. 实施顺序与并行安排

### 11.1 关键路径

```text
R0 真人安装验收 ───────────────────────────────┐
                                                 v
U0 contract + Manifest
  ├─> U1-A Provider/UpdateService ─┐
  └─> U1-B renderer UI fixtures ───┴─> U1 集成
                                      v
U2-A Download/Cache ─────┬─> U2 集成
U2-B Progress UI ────────┘     v
                              U3 DMG 兜底
                                   v
                              U4-A 技术闸门
                                   v
                              U4 工作保护/安装
                                   v
                              U5 两轮稳定化
```

### 11.2 可以并行的工作

- U0 contract 冻结后，GitHub Provider、UpdateService 骨架和 renderer fixture UI。
- U2 中 DownloadTask/Cache 与 renderer 进度界面，但双方只依赖冻结 snapshot。
- U4-A 通过后，InstallReadiness contributors 与 InstallerAdapter。
- 文档、诊断 schema 和自动化 fixture 可随对应任务同步推进。

### 11.3 不能并行越过的闸门

- U0 未冻结前不能各自扩展 preload/renderer contract。
- U1 未删除旧 updater 前不能开始生产下载路径，否则会出现双状态所有者。
- U2 未形成可信 ready asset 前不能进入安装。
- U3 兜底未通过前不能把 U4 自动安装暴露给正式用户。
- U4-A 未通过前不能将 updater 库或 Helper 接入生产默认路径。
- U4 双架构未通过前不能开始 U5 的正式版本统计。

## 12. 进度计算与汇报

整体工程进度按里程碑退出权重计算，不按提交数量或代码行数计算：

| 项目 | 权重 |
| ---- | ---- |
| R0   | 10%  |
| U0   | 15%  |
| U1   | 20%  |
| U2   | 20%  |
| U3   | 10%  |
| U4   | 20%  |
| U5   | 5%   |

里程碑内部只有 `0% / 25% / 50% / 75% / 100%` 五档：

- `0%`：未开始。
- `25%`：契约和测试用例已冻结。
- `50%`：主路径实现并通过单元测试。
- `75%`：失败矩阵和跨模块集成通过。
- `100%`：自动化、真人验收、证据和干净复验全部通过。

当前状态：

- R0 自动化完成，但双架构干净机器真人验收未完成，按 `75%` 计。
- U0 contract、Manifest 工具、workflow 汇总、失败矩阵、全量门禁和独立启动 smoke
  已通过，远端 branch CI 也已通过；真实测试 Tag、成功 Draft、下载后独立复核和
  预期失败 Run 待完成，按 `75%` 计。
- U1-U5 未开始，均按 `0%` 计。
- 按权重计算的当前整体进度为 `18.75%`。U0 仍是 `IN PROGRESS`，不能因本地门禁
  已通过就宣称更新功能或 U0 已完成。

每次阶段汇报固定包含：

```text
当前里程碑与内部档位
本轮完成的任务 ID
自动化结果
真人验收结果
当前阻塞
残余风险
下一批任务 ID
整体加权进度
```

## 13. 第一轮开工清单

当前只收口 U0，不同时实现 UI、下载或安装：

1. [x] 建立 `src/shared/update` contract 和测试 fixture。
2. [x] 实现 Manifest generator/verifier。
3. [x] 扩展 OSS workflow 汇总 job。
4. [x] 创建 desktop update acceptance 记录。
5. [ ] 用测试 Tag 验证成功和预期失败两条路径。
6. [ ] 下载 Draft 全部资产并执行独立 verifier。
7. [x] 通过 `pnpm verify`、独立启动 smoke 和文档复审。
8. [ ] 回填提交 SHA、Actions/Draft 证据并关闭 U0。

第一轮明确不做：

- 不引入 `electron-updater`。
- 不新增自动下载设置。
- 不修改 Agent、Terminal、编辑器或浏览器生命周期。
- 不保留旧 updater 与新 UpdateService 并行运行。
- 不把 Draft 凭证放进应用或本地开发默认配置。

## 14. 里程碑拷问清单

每次申请关闭里程碑前必须回答：

- 当前状态的唯一所有者是谁？窗口重建后如何恢复？
- Provider、Transport 或 Installer 是否偷偷拥有第二份状态？
- 网络、磁盘、签名、权限和退出任一步失败时，当前版本是否仍可启动？
- 用户是否在下载和安装两个副作用点分别明确确认？
- Renderer 是否接触了 URL、本地路径、Manifest 原文或发布凭证？
- 测试是否覆盖了失败和取消，而不只是成功路径？
- Intel 结果来自真人安装还是仅来自 runner？
- 是否留下旧 updater、临时 feature flag 或无法诊断的兼容代码？
- 现在对外文案是否超出了已通过的里程碑？
- 下一里程碑是否真的依赖本里程碑的产物，而不是重新复制一套实现？
