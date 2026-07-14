# 内嵌 Android 模拟器 — 技术方案调研

## 概述

> 状态：2026-07-14 起封存为历史技术调研。
> 新决策：DeepInk 后续不再推进本地 Android 虚拟机 / Google AVD / QEMU 模拟器，也不再把模拟器作为近期产品支柱。Android 方向只保留“用户自有真实手机通过 USB 或 Wi-Fi 连接”的可能性。

本文档保留原有模拟器嵌入调研结论，供之后复盘 scrcpy / ADB 技术细节使用。它不再代表当前产品路线。

当前产品约束：

- 不再默认安装 Android SDK、下载系统镜像或创建 AVD。
- 不再由 Agent 自动启动本地模拟器。
- 现有模拟器生命周期代码应抽离、封存或降级为 legacy 能力。
- Android capability 默认不可用；只有用户明确连接自己的真实设备后才可启用。
- 真实设备方向可以继续复用 ADB、scrcpy 投屏和工具权限模型，但目标设备不是虚拟机。

DeepInk 已通过 `WebContentsView` 成功内嵌 Chromium 浏览器，用户操作零延迟，AI 通过 Playwright + CDP 操控。下一步目标是在同一 workbench 区域嵌入 Android 模拟器（Google AVD / QEMU），让用户在窗口内直接看到和操作 Android 应用，AI 通过 ADB 操控。

本文档记录方案调研结论：**跨进程 `NSWindow.addChildWindow` 不可行**；推荐 **scrcpy 式流式投屏 + WebCodecs 内嵌渲染**。

## 背景：为什么浏览器能嵌入，模拟器不能

`WebContentsView` 能原生嵌入，是因为 Electron 本身就是 Chromium，浏览器视图与主窗口在**同一进程**内，通过 `contentView.addChildView()` 即可。

Android 模拟器（Google AVD，基于 QEMU）是**独立进程**。macOS 的进程隔离模型不允许一个进程把另一个进程的 `NSView` 拿过来当自己的子视图，因此无法复用 WebContentsView 的模式。

## 核心结论

| 方案 | 结论 |
|------|------|
| **方案 A**：`desktopCapturer` 持续图传 | 方向正确，但实现方式需升级（见推荐方案） |
| **方案 C**：`NSWindow.addChildWindow` 窗口附着 | **不可行** — macOS 硬约束，非实现难度问题 |
| **推荐方案**：scrcpy 协议 + WebCodecs 内嵌 | 兼顾嵌入观感、低延迟、中文输入、流畅触控，且无需 macOS 特殊权限 |

---

## 方案 C 分析：`addChildWindow` 窗口附着

### 1. 跨进程可行性 → 不可行

`NSWindow.addChildWindow(_:ordered:)` **严格要求父子窗口同属一个进程**。

- `NSWindow` 是 AppKit 进程内对象，指针只在所属应用地址空间有效
- 模拟器（qemu / Android Studio Emulator）是独立进程，**无法取得其 `NSWindow*`**，无从调用 `addChildWindow`

跨进程能拿到的窗口「引用」只有：

| 类型 | 获取方式 | 能力 |
|------|----------|------|
| `CGWindowID` | `CGWindowListCopyWindowInfo` | 截图、枚举；**不能**建立 AppKit 父子关系 |
| `AXUIElementRef` | Accessibility API | 读写 `AXPosition` / `AXSize`，移动、缩放；**不能**绑定 child window 的跟随行为 |

私有 API（`SkyLight.framework` / `CGS*` SPI，yabai 等窗口管理器使用）理论上可做更底层跨进程排序，但：未文档化、随 macOS 版本易崩、过不了 App Store 审核，且仍**做不到真正的子视图裁剪**。

**结论：方案 C 的核心前提不成立。**

### 2. 窗口位置精确对齐 → 坐标可算，实时同步不可靠

坐标换算本身可行：

- macOS 屏幕坐标：左下角原点
- Electron `getContentBounds()`：左上角原点
- 翻转：`screenHeight - (y + height)`

问题在于**实时跟随**：

- 只能通过 AX API **异步**设置外部窗口 frame
- 拖动 DeepInk 窗口时，模拟器窗口靠「监听移动 → 重新 setPosition」追赶，主线程异步派发，**肉眼可见滞后、抖动**
- 真正的 child window 由 WindowServer 层一起搬运；跨进程方案是事后追赶，体验差距大
- 侧栏宽度调整、全屏切换均需重算重推

### 3. 模拟器窗口去标题栏 → 基本做不到

- Android Studio Emulator **无**「无边框启动」参数；`-no-window` 为无头模式（完全不显示）
- 无法对另一进程的 `NSWindow` 调用 `setStyleMask`；AX API 也不暴露 styleMask
- 唯一脏办法：用覆盖层盖住标题栏，与窗口对齐同样脆弱

### 4. 模拟器窗口像素大小 → 受限且有 Retina 陷阱

- AX 可设 `AXSize`，但模拟器窗口**宽高比锁定**于设备分辨率（如 1080×2400）
- 强行设为 workbench 任意尺寸：可能被拒绝，或出现 letterbox 黑边
- AX 坐标/尺寸单位为 **points**，设备为 **pixels**；Retina 下需处理 backing scale

### 5. z-order 稳定性 → 最致命的问题

无真正父子绑定时，模拟器窗口只是「恰好浮在上方」的独立窗口：

- 与 workbench 矩形对齐时不遮挡侧栏（空间上），但**焦点 / key window 会乱**：模拟器成为 key window 时，Electron 失去激活态，菜单栏、快捷键错乱
- 第三方窗口、通知、Spaces 切换可能插入 z 层，需不停 `orderFront` 抢焦点，产生闪烁

### 6. 全屏 / 最小化 → 不跟随

| 场景 | 行为 |
|------|------|
| **最小化** | Electron 最小化，模拟器窗口**不会**跟着消失，需手动 hide |
| **全屏** | macOS 全屏创建新 Space；真正 child window 会跟进，**跨进程非子窗口不会** — 全屏后模拟器直接消失，几乎无解 |

---

## 方案 A 分析：`desktopCapturer` 图传

### 缺点（原始方案）

- 持续图传消耗额外 CPU/GPU
- 约 100–250ms 总延迟
- 中文输入困难（`adb shell input text` 不支持中文）
- 滚动/拖拽不流畅（单次 ADB 命令，非连续触摸流）

### 评估

**投屏方向正确**，但不应使用 `desktopCapturer` 逐帧截图 + 单次 ADB 命令，而应升级为 scrcpy 协议（见推荐方案）。

若坚持「抓取模拟器 macOS 窗口」路线，可用 **ScreenCaptureKit**（macOS 12.3+）替代 `desktopCapturer`，延迟更低，但仍无法解决输入注入问题。

---

## 推荐方案：scrcpy 式流式嵌入

不与 macOS 窗口模型对抗。Android 嵌入的最优解是**流式投屏**，而非窗口附着。

### scrcpy 工作原理

1. 通过 ADB 推送 server 到设备/模拟器
2. 使用 Android 隐藏 API（`SurfaceFlinger`）抓屏，硬件编码为 **H.264 / H.265 / AV1** 裸流
3. 客户端解码、**不缓冲直接渲染**，本地延迟约 **35–70ms**（远优于 desktopCapturer 的 100–250ms）
4. 控制走**独立双向 socket**，通过隐藏方法 `InputManager.injectInputEvent()` 注入

### 与方案 A 缺点的对照

| 方案 A 缺点 | scrcpy 如何解决 |
|-------------|-----------------|
| 中文输入困难 | text control message + 剪贴板注入，支持 Unicode/中文 |
| 滚动/拖拽不流畅 | 连续触摸事件流（mouse motion / scroll / multitouch） |
| 持续图传 CPU/GPU 高 | 硬件 H.264 编码，画面静止时 0fps，仅在变化时产帧 |
| 100–250ms 延迟 | 无缓冲直渲，本地约 35ms 级 |

### 两种落地方式

#### 1. 在 DeepInk 内自研 scrcpy client（推荐）

- 复用 scrcpy server 协议
- 渲染进程用 **WebCodecs (`VideoDecoder`)** 解 H.264，绘制到 `<canvas>` / WebGL
- 控制消息经主进程 ADB 隧道发往 scrcpy control socket
- 画面为 React 布局内真正的 DOM 元素：**完美贴合 workbench、跟随拖拽/全屏/最小化、z-order 天然正确**
- AI 操控仍走 ADB（与现有 Agent 架构一致）

#### 2. 快速验证：直接启动 scrcpy 进程

```bash
brew install scrcpy
scrcpy  # 对着已启动的 AVD 验证延迟、中文输入、触控流畅度
```

验证满意后再决定是否自研内嵌 client。

### 架构示意

```
┌─────────────────────────────────────────────────────────┐
│ DeepInk Renderer (React)                                │
│  ┌───────────────────────────────────────────────────┐  │
│  │ workbench                                         │  │
│  │  ┌─────────────────────────────────────────────┐  │  │
│  │  │ <canvas> ← WebCodecs VideoDecoder (H.264)   │  │  │
│  │  │ 用户点击/滑动 → IPC → 主进程 → scrcpy ctrl  │  │  │
│  │  └─────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
         ▲ H.264 stream                          │
         │                                        ▼
┌────────┴────────┐                    ┌──────────────────┐
│ ADB tunnel      │◄───────────────────│ scrcpy server    │
│ (主进程管理)     │                    │ (AVD 内运行)      │
└─────────────────┘                    └──────────────────┘
```

---

## 权限需求

| 方案 | 所需 macOS 权限 |
|------|-----------------|
| 方案 C（AX 定位外部窗口） | **辅助功能**（系统设置 → 隐私与安全性 → 辅助功能），用户手动授权 |
| 方案 A（desktopCapturer / ScreenCaptureKit） | **屏幕录制** |
| **推荐方案（scrcpy 自研 client）** | **无需特殊权限** — 视频流与控制均走 ADB，模拟器为 DeepInk 启动的可控进程 |

---

## 其他 macOS 替代方案（均不推荐）

| 方案 | 问题 |
|------|------|
| Accessibility API 定位 + 覆盖 | 无真正嵌入，对齐/z-order/全屏均不可靠 |
| `CGWindowListCreateImage` 截图 | 同方案 A，延迟与输入问题 |
| 私有 CGS / SkyLight SPI | 未文档化、审核风险、仍无法真正裁剪嵌入 |

---

## 原决策与后续

以下是历史调研阶段的原决策，不再作为当前产品路线执行。

### 原已决策

1. **放弃方案 C** — `addChildWindow` 跨进程为死路；绕过后仍会在 z-order、全屏 Space、输入法、对齐抖动上持续踩坑
2. **采用 scrcpy 协议流式嵌入** — 在 workbench 内用 WebCodecs 渲染，而非操控外部窗口

### 原待实施

- [ ] 本地验证：`scrcpy` 对接 DeepInk 使用的 AVD，测量延迟与中文输入
- [ ] 主进程：ADB 管理、scrcpy server 推送与 socket 隧道
- [ ] 渲染进程：`VideoDecoder` + canvas 组件，坐标映射与触控事件转发
- [ ] Agent：ADB 工具模块（与现有 browser MCP 工具并列）
- [ ] 文档：与 `docs/features/browser-automation.md` 对齐的 IPC / 生命周期设计

### 当前后续

- [x] 梳理 `src/main/android/`、`src/main/mcp/modules/android/`、`src/renderer/src/components/workbench/Android*` 的调用边界。
- [x] 将模拟器安装、创建、启动、停止相关入口标记为 legacy 或隐藏。
- [ ] 保留真机 ADB 检测、连接、截图、UI dump、基础输入等可复用能力。
- [x] Android capability 文案改为“真实设备未连接”而不是“模拟器未启动”。
- [x] 只有用户主动选择 USB / Wi-Fi 设备后，Agent 才能调用 Android 工具。

### 2026-07-14 代码封存记录

本次封存目标是让开发机器可以释放 Android SDK / AVD 空间，同时保留未来真机连接复用空间。

已完成：

- 主进程 `android:setup` 不再下载 adb / emulator / system image，也不再创建默认 AVD。
- 主进程 `android:listAvds` 始终返回空列表，`android:launch` 始终拒绝启动模拟器，`android:getState` 固定返回 `stopped`。
- `android:connectPhysical` 不再先停止模拟器，避免任何 emulator 进程操作。
- `AndroidDisplay` 不再显示 SDK License、一键设置、AVD 选择或启动模拟器，只在连接真机后投屏。
- Tab 新建菜单和命令面板移除“新建 Android 页”；只有设置页连接真机成功后才打开 Android Tab。
- 设置页设备分组改为“模拟器 / SDK 已封存 + 物理真机扫描连接”。
- 运行时不再构造 `EmulatorManager`，Agent 后端不再依赖模拟器初始化。
- 历史模拟器 / SDK / AVD 实现已移动到 `legacy/android-emulator/`，主流程不再 import，也不参与构建。
- `coreAgent` 的 Android prompt 已从“模拟器”改为“用户主动连接的 Android 真机”。

可清理的本机空间：

- DeepInk 自管理 SDK：Electron `userData/android-sdk`，macOS 通常位于 `~/Library/Application Support/<DeepInk app name>/android-sdk`。
- DeepInk 默认 AVD：`~/.android/avd/DeepInk_Phone.avd` 和 `~/.android/avd/DeepInk_Phone.ini`。
- 如果你不再使用 Android Studio，可另行评估 `~/Library/Android/sdk/system-images`、`~/Library/Android/sdk/emulator` 等系统级 SDK 目录。

保留建议：

- 真机连接仍需要一个可用的 `adb`。可以保留轻量 `platform-tools`，或通过 Homebrew / Android Studio 提供 `adb`。

---

## 参考

- [scrcpy develop.md](https://github.com/Genymobile/scrcpy/blob/master/doc/develop.md) — 协议与 server/client 分工
- [内嵌浏览器视口规则](../../.cursor/rules/embedded-browser-viewport.mdc) — workbench 区域宽度与缩放（浏览器侧已有 fit 模式，模拟器侧需独立处理 letterbox/缩放）
- [browser-automation.md](./browser-automation.md) — 内嵌浏览器参考架构
