# 工作空间级布局记忆：验证与验收

> 2026-10-14：实现及工程门禁通过；本地真人签收、在线远程验收与事故页真人复验待完成。

当前开发代码支持 A、B 分别保存并恢复左右栏宽度、可见性和 Agent 模式，中央区域弹性填充。
完整本地打开流程不会再强制展开恢复为收起状态的文件侧栏。

## 工程结果

- 主线首次实现的 `pnpm verify` 通过：408 个测试文件，3318 项通过、10 项跳过；边界检查、格式、lint、
  Web/Node typecheck 与生产构建全部通过。跳过项沿用现有测试条件，不计入通过项。
- 布局集成、UI 默认/非法值、拖拽事件生命周期与完整 picker 打开收尾均有自动化覆盖。
  local/remote/global 使用现有 WorkspaceRef key 隔离；该测试未连接真实远程 Agent。
- `node scripts/workspace-layout-smoke.mjs`：10/10 通过，使用完整 Studio、独立 userData、本机临时工作空间
  及真实 Electron 43.1.1 / Chromium 150.0.7871.114 WebContentsView。

真实 Electron 测试覆盖：默认布局，A→B→A 及各自持久值，栏宽变动后的 View bounds，真实窗口
缩小/放大，拖拽中切换，page zoom 30% 恢复，visual scale 30% 的适宽及工作空间激活恢复，页内导航、
普通导航与后退，以及应用重启恢复。

测试工作空间已清理，原始结果与诊断保留在本机：

- [10 项结果](/var/folders/4z/030bqrj52qn9vpf4w6hydk_c0000gn/T/cclink-workspace-layout-oD4oGm/results.json)
- [visual scale 适宽证据](/var/folders/4z/030bqrj52qn9vpf4w6hydk_c0000gn/T/cclink-workspace-layout-oD4oGm/visual-scale-restored.json)
- [工作空间激活证据](/var/folders/4z/030bqrj52qn9vpf4w6hydk_c0000gn/T/cclink-workspace-layout-oD4oGm/visual-activation-restored.json)
- [重启证据](/var/folders/4z/030bqrj52qn9vpf4w6hydk_c0000gn/T/cclink-workspace-layout-oD4oGm/restart-a.json)

## P2：同工作空间重开竞态补修

同工作空间重开时，`prepare` 原先不等待出站保存，`apply` 却会恢复已读取的磁盘 layout。延迟测试复现了
“内存 300px → 重开恢复磁盘 200px → 300px 写入成功 → 收起侧栏重新保存 200px”的覆盖路径。

最小修复采用保留当前布局：最终 generation 检查通过后、renderer 身份提交前判断目标是否为当前
workspace；同 workspace 只跳过 layout hydrate，不改变其他分区的恢复语义。它同时保留等待 main 提交
期间发生的新调整，不需要新增队列、CAS 或跨域事务。

- 两条新测试先在修复前失败（宽度回退为 200px），修复后通过：完整目录选择器重开时布局写入待完成，
  以及等待 main 提交时新增宽度调整。随后执行收起侧栏并 drain 写队列，均断言 UI 与持久宽度仍为 300px。
- 本次受影响的 10 个测试文件、146 项测试通过；Web/Node 类型检查、受影响文件 lint 通过。
- 补修后重新运行真实 Electron 回归：10/10 通过，两条 visual scale 均实测 `0.3000000119 → 1`。
  [补修后原始结果](/var/folders/4z/030bqrj52qn9vpf4w6hydk_c0000gn/T/cclink-workspace-layout-nRqWF0/results.json)

这两条延迟竞态由自动化注入 IPC 延迟验证；真实 Electron 10 项回归继续覆盖主线布局及 Browser，
没有宣称已执行真人的目录选择器验收。

## Browser 实测读数

| 场景              | pane / native View / 页面 viewport 宽度 | raw / applied / page zoom | visual scale     |
| ----------------- | --------------------------------------- | ------------------------- | ---------------- |
| A 新 Tab          | 1100 / 1100 / 1100                      | 0.30873 / 1 / 1           | 1                |
| 左右栏变宽        | 336 / 336 / 336                         | 0.09430 / 1 / 1           | 1                |
| 注入 30% 后适宽   | 1100 / 1100 / 1100                      | 0.1 / 1 / 1               | 0.3000000119 → 1 |
| 注入 30% 后 A→B→A | 1100 / 1100 / 1100                      | manual 1 / 1              | 0.3000000119 → 1 |
| 重启恢复          | 1100 / 1100 / 1100                      | 0.30873 / 1 / 1           | 1                |

以上场景没有侵入 Tab 栏或工具栏。诊断包含 trigger、文档 generation、三次样本、raw/applied factor、
实际 page zoom 及 visual scale；适宽注入场景记录 `visualScaleBeforeReset=0.3000000119`、
`actualVisualScale=1`，原页面输入保留，未通过 reload 复位。

生产 View 的 `setVisualZoomLevelLimits(1, 3)` 会阻止普通 CDP 注入建立 30% 前置条件。测试通过
Playwright Electron 主进程接口，仅对隔离测试 View 临时把下限设为 `0.1`，再用 CDP 注入并实测 `0.3`。
注入会话一直保留到产品恢复为 `1` 被实测确认，随后释放并恢复下限；测试释放不会冒充产品复位。
实际恢复仍由现有 BrowserManager 适宽/激活链路完成，生产 Browser 代码、IPC 和权限没有修改。

窗口测试直接调用测试进程的 BrowserWindow 调整真实 content size：1440→900→1440。
Agent 目标 `700px` 在小窗口显示被 clamp，UI store 与 WorkspaceState 保存值保持 `700px`，放大后恢复。

Browser 页面使用本机可重复的外溢 fixture，未操作第三方账号。上述真实 Electron 自动化是工程门禁，
不能代替 `browser-fit-width-30-percent.md` 中事故页的真人复验。

## 真人验收动作（待签收）

1. 启动当前开发版，打开 A，将左右栏设为约 180/260px，右栏保持可见；再收起左栏。
2. 打开 B，将左右栏设为约 420/600px，再收起 Agent。通过项目条执行 A→B→A，确认布局各自恢复。
3. 修改 A 栏宽后立即用系统目录选择器重新打开 A，等待打开和目录恢复全部结束；再收起/展开侧栏，确认
   最新宽度保持。原先收起的侧栏也不能被打开收尾强制展开。
4. 关闭并重新启动 Studio，再打开 A、B，确认分别恢复；新工作空间 C 应获得完整默认布局。
5. 在大窗口把 A 的 Agent 拉宽到约 700px，缩小再放大，确认目标宽度恢复。
6. 在 A 拖拽栏宽时切换到 B，继续移动并松开，确认 B 未被旧拖拽修改。
7. 在 A、B 打开 Browser，检查不同栏宽、收起/展开、导航、适宽和重启时原生网页区域与中央面板匹配。
8. 已登录、已配对真实远程 Agent 时，重复工作空间布局往返与重启验收。

## 残余边界

本次修复限定在 layout 恢复、捕获保存、legacy 迁移、拖拽及本地打开收尾。独立既有的 main/renderer
工作空间事务、fs 异步尾处理、Editor 草稿归属、Agent pending update 和文件移动崩溃窗口没有被本次修改
修复，也不能用全量测试通过来宣称关闭。
