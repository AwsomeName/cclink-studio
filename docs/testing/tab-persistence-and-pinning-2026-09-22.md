# 项目网页恢复与标签固定（2026-09-22）

## 用户验收动作

1. 打开本地项目 A，新建网页，访问网址并导航到第二页，不点击保存账号。
2. 切到项目 B，再点项目条回到 A：网页标签、网址和同一 Profile 应保留。
3. 右键网页或编辑器标签，选择“固定标签”：标签靠前、显示固定标记、隐藏关闭按钮。
4. 新建一个未固定标签，执行“关闭其他 Tab”：固定标签保留。
5. 正常关闭应用并重新打开：项目标签、固定状态、网页最新网址恢复。
6. 右键“解除固定”，再切走回到项目：标签保留且维持未固定状态。

## 用户功能进度

以上流程已在独立 Electron 开发实例中通过自动化操作验证。新建网页使用真实草稿 Profile，
测试站点在本机 HTTP 服务运行；网页导航发生于真实 WebContentsView，固定与解除固定通过
实际右键菜单触发，回切通过项目条触发。正常关闭/启动后验证了页面真实 Cookie，
不是仅检查 renderer 标签描述。用户原项目和目标网站的真人复核仍待用户操作。

固定适用于各类 Workbench Tab；设置等全局临时页沿用既有生命周期，不新增重启恢复。
固定不改变项目归属，不自动创建正式网站账号。单独右键关闭与当前标签关闭快捷键仍可用。

## 工程准备度与证据

- `node scripts/tab-persistence-pin-smoke.mjs`：4 组实际 Electron 检查通过。
- 105 项相关单元测试通过（Tab store、上下文命令、草稿生命周期、IPC descriptor、工作空间
  runtime 和 transition；首次新增测试的 helper 作用域错误已修正并重跑对应 11 项）。
- `pnpm typecheck`、`pnpm verify:context-actions`、改动 TypeScript 的 ESLint、格式化及
  `git diff --check` 通过。未执行全库 verify；本轮受影响 smoke 已通过。未提交或打包发布。
- 成功运行目录：`/tmp/cclink-tab-pin-smoke-1790047359437`。
- renderer 截图 `tab-pin-acceptance.png` 仅用于标签栏视觉检查；CDP renderer 截图不包含
  原生 WebContentsView。网页恢复另由真实页面 URL 和 Cookie 断言验证。

## 原因、状态边界与失败路径

新建本地网页默认调用 beginDraft 分配 Profile，而 Tab 保存与恢复过滤掉了所有
webResourceDraftRef，导致回切丢页；启动 reconcileDrafts 又无条件清理草稿 Profile。
现在仅移除草稿引用过滤，仍验证合法 Browser binding。Tab descriptor / WorkspaceState
继续拥有标签与固定状态，WebResourceService 拥有草稿事实，BrowserManager 拥有 Session。
没有新建 IPC 通道、权限面、状态存储或生命周期注册入口。

启动保留 open 草稿，未完成保存且无正式账号的 saving 草稿恢复为 open；已有账号的草稿
仍归并到正式记录，cleanup-pending 仍重试清理。用户关闭最后一个同草稿标签继续清理 Profile。
未恢复正式账号之外的新资源；保存失败仍可重试。菜单沿用统一命令与目标失效检查。

## 残余限制与测试事故

- 旧版本已删除的网页标签不自动重建。恢复只针对仍存在的工作空间快照。
- 强杀进程测试曾出现新写 Cookie 尚未落盘；正常关闭路径通过。本轮不承诺强杀后的 Cookie
  持久性，也未通过关闭保护条件绕过此限制。
- 无可恢复标签引用的历史 open 草稿可能仍占用既有 200 条草稿额度；本轮没有增加无引用
  自动清理，避免误删仍在其他项目使用的登录环境。
- 初次复用旧 smoke 控制器时，控制器按仓库识别已有实例，清理中断了另一任务使用的默认
  开发应用。已与该任务协调，由其恢复现场。本脚本随后改为独立 userData、专用端口与
  独立进程组，只管理自己的子进程，禁止再调用按仓库清理的 restart.sh。
