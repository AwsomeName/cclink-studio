# 可分离 Browser Tab M1 统一验收记录

- 日期：2026-08-20
- 平台：macOS arm64，Electron 43.1.1
- 范围：Browser-only M1；右键/命令入口，不含拖出手势、其他 Tab 类型和辅助窗口恢复
- 自动化结论：真实 Studio App smoke 12/12 通过，`pnpm verify` 通过
- 产品结论：工程实现完成；物理双屏与用户自有真实账号真人验收尚未执行，最终用户交付仍为 Conditional Go

## 用户现在能做什么

用户可以在 Browser Tab 的统一上下文操作或命令面板执行“移至新窗口”，把既有
`WebContentsView` 移入最小辅助窗口；原 Tab 不在主窗口重复显示。辅助窗口支持地址导航、前进、
后退、刷新、页面查找、popup、原生网页右键菜单、BrowserTask/下载状态提示和“送回主窗口”。关闭
辅助窗口也会送回，而不会销毁 Browser runtime。

主窗口切换工作空间时，辅助窗口继续属于原工作空间。迁移复用同一个 View、WebContents、Session、
Playwright Page、runtime generation 和 `tabId`，不通过 URL 重建页面。renderer 只消费主进程投影；
Tab/Browser 持久化仍由主进程单一 writer 完成。

用户目前还不能通过拖动 Tab 直接创建窗口，也不能分离 Editor、Terminal、Conversation 等其他 Tab。
M1 不恢复上次退出时的辅助窗口位置。

## 真实 App 自动验收

命令：

```bash
pnpm smoke:detachable-tabs-m1
```

结果：12/12 通过。

1. 在隔离 Studio App 中创建真实 Browser View，建立 HttpOnly 登录 Session、未提交表单、滚动位置、
   `history.pushState` 历史、手动缩放、易失 JavaScript 状态和 BrowserTask。
2. 在真实 Browser Tab 右键菜单点击“移至新窗口”，打开最小辅助 renderer；主窗口投影隐藏原 Tab。
3. Browser 分离后刷新主 renderer；placement 在 Browser reconcile 前由主进程快照恢复，主窗口不
   重复显示或重建已分离 Tab，原 Browser Page 与表单保持。
4. Browser 分离期间在主窗口创建真实 Editor Tab，并在 Tiptap 中输入文本；Browser Page 不受影响。
5. 迁移前后 Playwright Page 对象与 runtime identity 完全相同；Session、历史、表单、滚动、缩放和
   JavaScript 状态均保持。
6. 分离后继续通过真实 MCP `browser_click`/`browser_wait_for_download` 操作同一 Page；下载由
   Electron Session 落盘并完成，且与 BrowserTask 关联。BrowserTask、下载、原生右键菜单、查找结果
   均只路由到当前辅助窗口 owner；popup 依 M1 单 Tab 策略接纳到主窗口。
7. 通过生产工作空间 transition 切到另一个真实临时工作空间后，辅助 Browser 与原页面状态继续
   存活，且不进入新工作空间投影。
8. 主窗口仍处于新工作空间时点击“送回主窗口”，辅助窗口释放；切回原工作空间后同一 Tab 恢复，
   Page/runtime identity 保持。
9. 通过真实命令面板执行“移至新窗口”，再触发原生辅助窗口关闭；Tab 自动补偿送回主窗口，runtime
   不销毁或重建；主进程实际 active View、renderer 高亮 Tab 与显示页面一致。
10. Tab 分离时执行真实 App restart；逻辑 `tabId` 在主窗口恢复，M1 不错误恢复辅助 placement。
11. 显式关闭恢复后的 Browser Tab；View/runtime 被移除，Playwright Page 关闭，BrowserTask 以
    `tab_closed` 取消，不残留第二运行事实。
12. 再次分离一个真实 Browser Tab，通过可信主 renderer 请求与原生关闭按钮相同的
    `BrowserWindow.close()`；主窗口关闭后辅助窗口不拦截 App quit，优雅退出完成且 Electron CDP
    端点消失。

系统原生菜单由真实右键事件创建；仅在隔离 smoke 环境中，确认菜单打开事件后自动关闭，以免
Playwright 的页面级 Escape 无法关闭 macOS 系统菜单并阻塞后续关窗检查。

## P0 与故障门禁

`pnpm smoke:detachable-tabs-p0` 证明同一 View/WebContents/Session/CDP target/Playwright Page 在
source、target、Recovery Host 间迁移、回滚和释放；证据见
`docs/ops/detachable-workbench-tabs-p0-acceptance.md`。

相关自动测试覆盖：

- WindowService create/ready/transfer/commit/return/rollback/recovery、generation 与工作空间同步；
- target ready 超时回滚并发布可重试 generation；
- source 与 target 同时失效后进入每 View 独立 Recovery Host，再恢复到合法窗口；
- 已提交迁移后辅助窗口突然失效，也会先把 native View 收拢到 Recovery Host，再以更高 generation
  恢复逻辑 placement，不允许旧事件反向覆盖；
- BrowserManager 多 host attach 失败回滚、owner 路由、popup、find 和显式释放；
- BrowserTask 与下载事件按当前 Tab owner 路由；
- renderer 不能绕过主进程 TabModel/BrowserModel 成为第二持久化 writer；
- 主 renderer reload 先水合 placement 快照再启动 Browser 生命周期，返回事件按实际 active View
  同步 Tab 高亮；
- 旧版书签首次迁移写入失败时，WorkspaceState 仍保留 `browserTabs.bookmarks`，后续读取重试迁移；
- 主窗口关闭会先销毁辅助窗口控制器，再请求 App quit，辅助窗口不能以“关闭送回”拦截退出；
- auxiliary preload 独立构建，无共享 preload chunk，可信 renderer 权限按角色收窄。

## 工程门禁

本轮最终门禁必须同时满足：

```bash
pnpm smoke:detachable-tabs-p0
pnpm smoke:detachable-tabs-m1
pnpm verify
```

`pnpm verify` 包含架构边界检查、格式、lint、全量 Vitest、TypeScript 和生产构建。生产构建应生成
独立的 `out/preload/index.js` 与 `out/preload/auxiliary.js`。

## 尚未通过的真人门禁

当前开发机由 `system_profiler SPDisplaysDataType` 只检测到一个内置显示器，没有物理副屏；仓库也
没有用户第三方网站账号。因此以下动作不能由本轮自动化伪装为已完成：

1. 连接副屏，在真实 Studio 中登录用户自有网站并保留未提交表单、滚动和历史。
2. 从 Tab 右键或命令面板移至新窗口，把窗口拖到副屏，持续浏览并确认登录状态、缩放、popup、
   下载、查找、原生右键菜单和 Playwright/BrowserTask 均正常。
3. 主窗口切换工作空间后关闭辅助窗口；回到原工作空间，确认 Tab 存在、没有串入新工作空间，
   再显式关闭 Tab 并确认 runtime 释放。
4. 点击辅助窗口与网页输入框，确认 macOS native window focus、键盘输入和窗口切换符合预期；P0
   自动化只把文档/输入框焦点作为稳定门禁，native focus snapshot 仅用于诊断。

执行者应把日期、macOS 版本、显示器拓扑、测试站点类型和每一步结果追加到本文。以上四步通过前，
可以声明“Browser M1 工程实现和真实 App 自动门禁通过”，不能声明“副屏用户闭环最终交付”。

## 最终判断

- P0a/P0b：Go。
- ADR 0017：accepted。
- Browser M1 生产实现：完成。
- Browser M1 自动化真实 App 门禁：Go（12/12）。
- 物理双屏/真实账号真人签收：Pending。
- Browser M1 最终用户交付：Conditional Go。
- 拖出手势、其他 Tab 类型、placement 恢复：仍为 No-Go，必须另行授权。
