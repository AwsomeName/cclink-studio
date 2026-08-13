# 首批受管 Runtime 资源开发计划

> 状态：R1/R4 已完成，固定版本检查/修复/卸载已完成，R2 待真机验收，R3 已完成制品准备但尚不能激活；最后更新：2026-08-13。
> 架构决策：[`0008-managed-runtime-resources.md`](../decisions/0008-managed-runtime-resources.md)。

## 用户现在能做什么

- 在组件管理页逐行安装 OCCT `0.0.23`、scrcpy server `2.3.1` 和 agent-device Android
  Helper `0.17.2`。
- 看见随 App 版本、Studio 管理版本、限定版本、可用版本、下载进度和失败原因。
- OCCT 安装完成后直接用于新的 STEP/STP 转换；scrcpy 安装完成后用于下一次投屏连接。
- 关闭并覆盖安装 App 后继续复用这些资源，不需要重装；资源损坏时回到随 App 版本。
- 逐行检查完整性、重新下载修复或卸载管理版本；卸载不删除随 App 回退资源。
- OCCT 转换和 scrcpy JAR 推送期间阻止对应资源被修复或卸载；业务校验失败会记录当前原因。
- 清楚看见 Android Helper 只是“已下载，待宿主支持”，不会误以为已经切换。

## 里程碑

| 里程碑          | 类型     | 用户验收                                   | 当前结果                          |
| --------------- | -------- | ------------------------------------------ | --------------------------------- |
| R1 OCCT 闭环    | 用户功能 | UI 安装后，真实 STEP 转换显示 managed 来源 | 已通过                            |
| R2 scrcpy 闭环  | 用户功能 | UI 安装后，下次真机投屏使用 managed JAR    | 路径/回退已通过；缺真机人工验收   |
| R3 Helper 准备  | 工程准备 | UI 下载校验并如实显示待宿主支持            | 已通过                            |
| R4 App 替换复用 | 用户功能 | 同一 userData 重启后版本仍在且不下载       | 已通过                            |
| R5 真实更新     | 用户功能 | 两个兼容版本之间更新、坏版本回滚           | 未开始；没有第二兼容版本/签名目录 |

## 已实施边界

- Runtime 管理器只负责固定目录、下载、校验、原子发布、恢复和进度。
- CAD、scrcpy 和 agent-device 仍是各自业务状态与生命周期的唯一 owner。
- npm 包只提取目录中列明的 WASM、APK、manifest 和许可证；不执行下载 JavaScript或
  lifecycle script。
- OCCT/scrcpy 受管解析失败时使用随 App 资源。Android Helper 不做不稳定的路径劫持。

## 2026-08-12 验收记录

### 用户功能进度

- 空白隔离 userData 首次启动自动打开组件管理页：通过。
- 三个安装按钮经 preload/IPC 下载真实公网制品并显示正确版本：通过。
- 1440×920 且右侧 Agent 面板展开时，组件清单自动切换为卡片布局，无横向裁切：通过。
- 退出 App、用同一构建完整替换 `.app` 后再次启动，三项安装记录逐字节不变且 UI 不要求
  重装：通过；跨构建升级需另传两个源码指纹不同的 App 验收。
- 真实 `occt-import-js` 测试 STEP 样例使用受管 WASM 转换为 STL：通过。
- 卸载受管 OCCT 后，再次用随 App WASM 完成同一 STEP 转换：通过。
- 卸载受管 scrcpy 后确认随 App JAR 仍在，且回退选择单元测试通过；真实推送仍待真机。
- scrcpy 真机连接：未执行，本机没有可用 adb/Android 真机。
- Android Helper 激活：未执行，`agent-device@0.17.2` 没有受管资源注入 contract。

### 工程准备度

- OCCT 与 agent-device npm SHA-512 integrity、逐文件大小/SHA-256：通过。
- Genymobile 官方 scrcpy `v2.3.1` Release JAR 大小/SHA-256 与现有随 App 文件完全一致：通过。
- 临时目录、路径穿越限制、只提取允许文件、原子发布、损坏拒绝和 App 替换复用测试：通过。
- 通用远程签名目录、旧版本垃圾回收、真实双版本回滚：未实现；当前固定版本卸载已实现。
- arm64 本地 DMG 与 packaged 同构建 `.app` 覆盖替换 smoke：通过；产物源码指纹门禁已接入。
