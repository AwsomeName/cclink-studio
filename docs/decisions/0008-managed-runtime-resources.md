# ADR 0008：首批受管 Runtime 资源

- 状态：accepted
- 日期：2026-08-12
- 负责人：CCLink Studio

> 2026-08-15 复审：保留本 ADR 定义的固定版本安装、修复、卸载和领域回退；暂停远程版本目录和真实双版本更新。OCCT JS/WASM、scrcpy client/server 的配套兼容关系仍是不变量。

## 问题

Studio 已经随 App 携带 OCCT WASM、scrcpy server 和 agent-device Android Helper。
这些资源本身来自固定 npm 包或上游发布制品，但用户只能通过替换整个 App 获得它们。
同时，这些资源与 App 内的 TypeScript/原生客户端存在严格兼容关系，不能把任意 npm JavaScript
直接加载进 Electron 主进程。

## 决策

在现有 `RuntimeComponentManager` 下增加首批固定目录资源：

| 组件           | 允许来源                | 限定版本 | 本批激活方式                                                  |
| -------------- | ----------------------- | -------- | ------------------------------------------------------------- |
| OCCT Runtime   | `occt-import-js` npm 包 | `0.0.23` | App 内适配器加载受管 WASM；失败退回随 App WASM                |
| scrcpy server  | Genymobile 官方 Release | `2.3.1`  | `ScrcpyBridge` 使用受管 JAR；失败退回随 App JAR               |
| Android Helper | `agent-device` npm 包   | `0.17.2` | 下载、校验和兼容探针；当前 agent-device host 仍使用随 App APK |

安装器只接受编译期目录中的固定 URL、npm integrity、文件大小和 SHA-256。制品先进入临时目录，
逐文件校验后原子发布到 `userData/runtime-components`。App 替换安装不得删除该目录。

OCCT 只把 WASM 作为受管资源。`occt-import-js` JavaScript 适配器继续随完整 App 发布；不得执行
从 npm 下载的 JavaScript。scrcpy 的 TypeScript 客户端和 `@yume-chan/*` 继续随 App 发布。

Android Helper 当前不能标记为“已激活”：`agent-device@0.17.2` 在包内部解析 Helper 路径，公开
client contract 没有资源路径注入点。组件页可以显示“已下载，待宿主支持”，但不能显示为业务已使用。
后续只有在上游提供注入 contract，或 Studio 建立保持 ref/session 语义的受控 host adapter 后才激活。

## 用户端到端验收动作

1. 打开“设置 → 组件管理”，三行均显示限定版本和独立“安装”按钮。
2. 安装 OCCT 后，状态显示 `0.0.23` 且来源为 Studio 管理；打开真实 STEP/STP 文件仍能转换。
3. 安装 scrcpy server 后，状态显示 `2.3.1`；连接 Android 真机时日志显示使用受管 JAR。
4. 安装 Android Helper 后，状态显示 `0.17.2 · 已下载，待宿主支持`，不伪装成已激活。
5. 关闭 Studio，用新 App 覆盖旧 App 后重新打开，三个安装记录仍在且不重新下载。
6. 断网、下载中断、校验失败或受管文件损坏时，旧受管版本不被覆盖；OCCT 与 scrcpy 回退到随 App 资源。

## 不变量

- `UpdateService` 仍唯一拥有完整 App 更新；Runtime 资源不得修改 main、preload、renderer、IPC、
  权限或凭证核心。
- `RuntimeComponentManager` 只拥有制品目录、安装记录和安装进度；CAD、scrcpy、agent-device
  领域仍各自拥有业务状态和生命周期。
- renderer 只是主进程状态投影，不自行判断文件存在或激活版本。
- 只允许固定目录中的版本；没有任意包名、任意版本或任意 URL 输入。
- 下载的 JavaScript、原生模块和安装脚本一律不执行。

## 备选方案

- 继续全部随 App：风险最低，但没有独立安装和修复能力，拒绝作为长期方案。
- 对 npm 包直接执行 `npm install`：会运行不可控脚本并把下载代码引入主进程，拒绝。
- 一次性实现通用插件系统：范围过大，且会在没有真实闭环前扩大权限面，拒绝。
- 强行让 agent-device 使用用户目录 APK：当前没有稳定 contract，会破坏 session/ref 语义，暂缓。

## 风险与影响

- 固定版本提供的是“独立安装/修复/以后可升级的通道”，不是无限制追新。
- OCCT JS 与 WASM 必须同版本；升级目录时必须同时验证 App 适配器兼容性。
- scrcpy client 与 server 必须协议兼容；目录版本必须随 `AdbScrcpyOptions` 一起评审。
- Android Helper 在宿主注入能力完成前只有制品准备度，没有用户能力增量。

## 迁移计划

现有设置不迁移、不改写。未安装受管资源时继续使用 App 内现有资源。首次安装只复制到
`userData/runtime-components` 并写安装记录；激活由对应领域在下次操作时解析。删除或损坏
受管目录后自动回到 App 内资源。

## 回收或复审条件

- OCCT 需要独立更新 JavaScript 适配器时，必须先建立无 Node sandbox host 并另写 ADR。
- agent-device 提供稳定 Helper artifact 注入 contract 时，复审并把“待宿主支持”升级为可激活。
- 任一上游停止提供固定制品或许可证发生变化时，冻结目录并回退到 App 更新。

## 验证

- 目录、解包路径、大小、SHA-256、npm integrity 和路径穿越单元测试。
- 真实 npm 下载、真实 STEP 转换、真实官方 scrcpy JAR 校验 smoke。
- 同一 userData 下重建 manager 的 App 替换复用 smoke。
- 受管文件损坏、断网和发布中断回退测试。
- `pnpm verify` 与组件管理 UI smoke。
