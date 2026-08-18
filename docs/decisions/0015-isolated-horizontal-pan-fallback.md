# ADR 0015：隔离世界中的网页横向滑动兜底

- 状态：accepted
- 日期：2026-08-18
- 负责人：CCLink Studio Maintainers
- 复审：架构宪法第 10 条中 Browser 不得扩张为通用网页注入平台的约束

## 问题

内嵌浏览器工作区可能窄于桌面网站的固定内容宽度。适应宽度缩放能显示全页，但文字和控件会过小；
切换手动缩放后，部分网站又通过 `overflow-x: hidden` 隐藏仍然存在的横向滚动范围，导致触控板横滑
和 Shift + 滚轮无法查看右侧内容，用户只能反复缩放。

`WebContentsView` 不位于 renderer DOM 中，不能由工作台外层 CSS 提供横向滚动。扩大 View bounds
并移动原生 View 会改变网页视口、覆盖工作台相邻区域，并让页面纵向滚动条随 View 移出可见区。

## 用户验收目标

1. 在内嵌浏览器打开宽于当前工作区、且隐藏根节点横向滚动的网页；
2. 保持 100% 或其他手动缩放，不必缩小到适应宽度；
3. 在页面上用触控板左右滑动，或按住 Shift 使用鼠标滚轮，可以查看左右两侧内容；
4. 普通横向滚动容器、纵向滚动、捏合缩放和页面点击不受影响；
5. 增强安装失败时页面仍按 Chromium 原行为加载和使用。

## 决策

1. 允许 `BrowserManager` 在网页主 frame 加载完成后，向独立 isolated world 安装一个无权限、
   无通信通道的横向滚动监听器。
2. Chromium 能原生横向滚动的 `auto` / `scroll` 容器保持原行为；监听器不阻止事件。
3. 仅当横向输入存在、候选容器确有剩余横向范围且其 `overflow-x` 为 `hidden` 时，监听器在边界内
   更新该容器的 `scrollLeft`。
4. 触控板使用 `deltaX`；Shift + 滚轮将 `deltaY` 映射为横向距离；Ctrl/Meta 修饰的捏合缩放事件
   一律跳过。
5. 安装失败只记录脱敏分类并降级为 Chromium 原始行为，不阻塞页面加载、缩放或其他 Studio 能力。

## 不变量

1. 网页仍无 preload、Node.js、IPC、工作空间文件或 Studio API 权限。
2. isolated world 不读取或回传 DOM 正文、Cookie、Token、表单值或用户输入，也不改写 DOM/CSS。
3. 不使用 Playwright/CDP，不新增 renderer 状态、IPC 契约或第二个 Browser 生命周期所有者。
4. 正常滚动容器和网页自有横向行为优先；兜底只处理 Chromium 因 `hidden` 不会滚动的范围。
5. Browser runtime、Tab、Profile、Session、缩放和设备模式的状态所有权不变。

## 备选方案

- **继续只用适应宽度缩放**：拒绝，窄工作区会让网页文字和控件过小。
- **强制注入 `overflow-x: auto !important` CSS**：拒绝，会持续改写站点布局并可能破坏弹层和锁滚动逻辑。
- **扩大并平移 `WebContentsView`**：拒绝，会改变响应式视口、原生滚动条位置和相邻 View 隔离。
- **通过 preload/IPC 回传滚动事件**：拒绝，会扩大不可信网页权限面和跨进程契约。
- **依赖 Playwright/CDP**：拒绝，用户基础浏览行为不能依赖自动化模块。

## 风险与影响

- 某些网站使用 `overflow-x: hidden` 实现自定义轮播；兜底可能允许用户直接滚动其隐藏范围。实现只在
  横向输入且容器确实可沿该方向移动时生效，并优先保留 `auto` / `scroll` 原生容器。
- `overflow-x: clip` 明确禁止程序化滚动，首版不覆盖。
- iframe 由各自 frame 管理，主 frame 的增强不保证覆盖跨域 iframe。

## 迁移计划

不迁移用户数据，不改变已保存缩放模式。每个 Browser main frame 加载完成后幂等安装，frame 销毁时
由 Chromium 自动释放。

## 回收或复审条件

- Electron 提供无需页面脚本、可直接作用于 `WebContentsView` 的原生横向平移 API；
- 发现监听器影响正常站点交互、读取或泄露页面内容；
- 需求扩张到触摸拖拽、iframe 或通用页面样式修复。

## 验证

- 单元测试覆盖隐藏横向范围、原生滚动容器、Shift + 滚轮和捏合缩放跳过；
- BrowserManager 测试覆盖 isolated world 安装入口和失败降级；
- 真实 App 使用固定宽度且 `overflow-x: hidden` 的页面验收左右滑动；
- `pnpm verify` 或受影响测试与 smoke 通过后，只声明相应工程门禁。
