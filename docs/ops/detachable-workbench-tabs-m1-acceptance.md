# 可分离 Browser Tab M1 统一验收记录

- 日期：2026-08-20
- 平台：macOS arm64，Electron 43.1.1
- 范围：Browser-only；右键、命令和拖出入口，不含其他 Tab 类型和辅助窗口恢复
- 自动化结论：历史结论已失效；当前修复候选的受影响单测 29/29、TypeScript 和增加可见尺寸
  断言后的真实 Studio App smoke 12/12 通过，surface 实测 `1100 × 676`；比例修复新增相关测试
  25/25 通过，更新后的 smoke 继续 12/12 通过
- 产品结论：用户已确认 Tab 能移入辅助窗口；首轮真人截图发现独立 visual scale 仍停在 30%，修复
  后的第二张真人截图已显示正常比例网页。当前用户单屏移动与比例签收通过；物理双屏拖出仍待验收，
  最终用户交付仍为 No-Go

## 用户现在能做什么、还不能做什么

主进程已经能够把既有 `WebContentsView` 移入辅助 host，并保持相同 WebContents、Session、
Playwright Page、runtime generation 和 `tabId`；关闭/崩溃补偿与 Recovery Host 事务仍可保留。

当前修复候选已在隔离真实 App 中通过右键生产入口显示完整网页区域；用户仍不能把它视为已完成：
当前用户已确认 Tab 能移动，且修复后的第二张真人截图显示页面比例正常；物理双屏拖出仍没有有效
证据。Editor、Terminal、Conversation 等其他 Tab 和辅助窗口位置恢复仍不支持。

## 2026-08-20 当前用户比例异常与修复

用户截图证明辅助窗口及网页 surface 已真实可见，但博客园登录页约以 30% 显示。主进程同一时刻
记录 `pane=1100`、`View=1100×676`、`raw=0.29997`、`applied=1`、
`WebContents.getZoomFactor()=1`；直接读取页面却得到 `visualViewport.scale=0.3`。这证明旧诊断遗漏了
Chromium visual/pinch zoom，不能再用 `getZoomFactor()` 单值宣称实际比例为 100%。

BrowserManager 现会在每次应用缩放时串行执行 `Emulation.setPageScaleFactor(1)`，并记录
`visualScaleBeforeReset` 与 `actualVisualScale`。迁移仍保留同一 WebContentsView，不通过重载掩盖
比例问题。真实开发版已验证 `0.3 → 1`；更新后的 M1 smoke 在迁移前故意建立 30% visual scale，
迁移后断言同一 Page/runtime、表单、滚动、Session 保持且 visual scale 为 1，12/12 通过。

同一轮用户复验还发现：辅助窗口导航到百度时页面已经成功显示，但旧 `loadURL()` Promise 因导航
被替代而以 `ERR_ABORTED (-3)` 结束，renderer 将原始 IPC 异常显示成红条。BrowserManager 只在
WebContents 已实际到达请求目标时把该导航取消视为非致命；仍停在旧页的 abort 以及 DNS、网络等
真实失败继续抛出。相关测试同时覆盖“成功后的取消不报错”和“未到目标/真实失败仍报错”。

## 2026-08-20 正式包失败证据

只读审查使用 v0.1.51 正式 DMG、隔离 profile 和真实用户状态副本完成，未修改仓库代码或真实
`userData`：

1. 真实右键菜单“移至新窗口”成功进入主进程 transaction，主窗口 Tab 消失，辅助 renderer
   ready，placement 与 native owner 均指向同一个辅助窗口。
2. 同一 Browser WebContents、URL、标题和 `tabId` 保持，说明核心迁移没有失败。
3. `.auxiliary-browser-window` 为 `1100 × 760`，Grid 计算行为 `42px 42px 0px 676px`，但空
   `.auxiliary-browser-notices` 因 `display:none` 被移出 Grid 后，browser surface 自动占据第三行，
   实际尺寸为 `1100 × 0`。
4. 只在运行时注入 `.auxiliary-browser-surface { grid-row: 4; }` 后，surface 立即变为
   `1100 × 676`，原 WebContents 获得有效视口，没有 reload 或 Page 重建。
5. 历史 smoke 只等待 `.auxiliary-browser-window` 出现、projection 改变和 Page 身份存活，没有断言
   surface 宽高，因此构成右键/命令路径假阳性；Playwright over CDP mouse 也不能移动 macOS 系统
   光标，不能证明真人拖出。

修复验收要求：显式 Grid 行归属；smoke 断言 surface 宽高大于 0；主进程用系统 cursor 与真实
window bounds 裁决；真人完成单屏窗口外松手、物理双屏跨屏松手、Escape 取消和同栏排序。

## 2026-08-20 修复候选结果

- titlebar、toolbar、notices 和 browser surface 显式固定到 Grid 第 1–4 行；空 notices 不再改变
  surface 行归属。
- renderer 只判断 Browser 类型、同栏 drop 和 Escape 取消，不再读取 `screenX/clientX` 或 renderer
  window bounds；可信 main IPC 请求由主进程读取 Electron 系统 cursor 和 source BrowserWindow
  bounds 后返回窗口外 DIP 点。
- `tab-detach-cursor`、controller IPC、renderer drag eligibility 与 shared contract 相关测试共
  29/29 通过；`pnpm typecheck` 通过。
- `pnpm smoke:detachable-tabs-m1` 12/12 通过。第一条迁移路径改为生产右键菜单，并强制断言
  `.auxiliary-browser-surface` 宽高大于 0；本次实测 `1100 × 676`。
- 未运行 Playwright mouse 拖出，也不把自动化描述为真人拖出。下一步由用户在当前开发版执行本文
  真人门禁。

## 真实 App 自动验收

命令：

```bash
pnpm smoke:detachable-tabs-m1
```

结果：12/12 通过。

1. 在隔离 Studio App 中创建真实 Browser View，建立 HttpOnly 登录 Session、未提交表单、滚动位置、
   `history.pushState` 历史、手动缩放、易失 JavaScript 状态和 BrowserTask。
2. 通过生产 Tab 右键菜单执行“移至新窗口”，断言辅助 renderer 与 browser surface 均可见且
   surface 宽高大于 0；不使用 Playwright mouse 模拟真人拖出。
3. Browser 分离后刷新主 renderer；placement 在 Browser reconcile 前由主进程快照恢复，主窗口不
   重复显示或重建已分离 Tab，原 Browser Page 与表单保持。
4. Browser 分离期间在主窗口创建真实 Editor Tab，并在 Tiptap 中输入文本；Browser Page 不受影响。
5. 迁移前后 Playwright Page 对象与 runtime identity 完全相同；Session、历史、表单、滚动、page
   zoom 和 JavaScript 状态均保持；自动化还会在迁移前注入 30% visual scale，并断言迁移激活后由
   BrowserManager 复位到 1，避免 toolbar 显示 100% 而页面实际仍是 30%。
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
- `commitTransfer` 已改变状态后才抛错，以及后续 `show`、placement publish、projection/send 抛错时，
  原 transaction 不再 rollback；系统创建更高 generation 的反向补偿 transaction，并验证 native
  owner 与逻辑 placement 一致；
- Recovery Host 送回发生逻辑 commit 故障时，native View 会补偿回 Recovery Host；两边保持
  `recovering`，不会形成 View 已在 main、placement 仍在 recovery 的分裂状态；
- BrowserManager 多 host attach 失败回滚、owner 路由、popup、find 和显式释放；
- BrowserTask 与下载事件按当前 Tab owner 路由；
- renderer 不能绕过主进程 TabModel/BrowserModel 成为第二持久化 writer；
- 主 renderer reload 先水合 placement 快照再启动 Browser 生命周期，返回事件按实际 active View
  同步 Tab 高亮；
- 旧版书签首次迁移写入失败时，WorkspaceState 仍保留 `browserTabs.bookmarks`，后续读取重试迁移；
  新 section 成功后原子清理 legacy 副本，清理失败独立重试且不覆盖并发 Browser Tab 写入；
- 终态 transfer 与不再拥有 placement 的已关闭辅助窗口会从内存账本释放；
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
- Browser M1 核心迁移事务：保留。
- Browser M1 用户可见辅助窗口：当前用户单屏移动、可见 surface 与正常比例真人签收 Go；物理双屏
  Pending。
- Browser M1 受影响自动化真实 App 门禁：Go（12/12，包含非零 surface 与 visual scale 复位断言）。
- 物理双屏/真实账号真人签收：Pending。
- Browser M1 最终用户交付：No-Go。
- Browser 拖出手势：主进程裁决工程候选已完成，真人验收 Pending；其他 Tab 类型、跨窗口拖入和
  placement 恢复仍为 No-Go。
