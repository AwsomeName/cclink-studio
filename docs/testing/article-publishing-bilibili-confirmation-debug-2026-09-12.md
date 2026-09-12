# B站自动确认继续调试（2026-09-12）

用户现在仍不能用当前结果未知的旧任务自动续发；本轮修正了首次确认分支的观察器超时时序，并在隔离 Electron 中验证自动点击与请求回执衔接。真实账号公开发布尚未通过，不以 fixture 成功代替产品验收。

## 本轮改动

- `bilibili-publication.ts`：观察器显式记录 Promise 已结束状态。首次确认要求观察器已 arm、未释放、未结束且从未观察到创建请求。尤其是正文/图片复核耗时超过原回执期限时，不再允许确认发送。
- `article-publishing-browser-policy.ts`：首次确认前再次检查真实公开范围及即时发布入口，原有 UID、冻结正文、标题、逐图顺序与加载、Runtime 和取消检查继续保留。
- 新增观察器在复核期间超时/释放的行为测试；不能再只用“尚无请求”代表“仍可以发送”。
- `scripts/bilibili-confirmation-smoke.cjs` 直接载入本轮发布函数，在独立 userData 的 Electron WebContentsView 中测试真实 DOM、iframe、Playwright 点击和 request/response 对应。所有 HTTPS 请求均由测试路由本地完成或拒绝，不连接用户 Studio、不访问真实 B站服务、不使用账号 Cookie。不是完整 WebAffair 产品验收。

## 本轮验证

- publication 23 项、policy 70 项、Browser MCP 52 项，共 145 项通过。
- Node 类型检查、受影响 ESLint、diff whitespace 检查通过。
- Electron fixture 四场景通过：正常原生首次规范分支确认一次、对应回执取得；正文变化、取消、观察器释放均零发送。
- fixture 初次因空白 BrowserWindow 未加载而卡住，已结束该独立测试进程并补齐；第二次等待隐藏 iframe 的 heading 未设置 includeHidden 而失败，修正测试等待后四场景通过。没有因此重启当前 Studio。

证据：`artifacts/article-bilibili-agent-20260912/confirmation-electron-fixture.log`、`confirmation-typecheck.log`、`confirmation-lint.log`。

## 真实验收前提

原任务 G2 的 result-unknown 不变；缺少回执或可信未发送证明，不能重置为 not-started。当前 Studio 仍是旧 main，不能注入代码热补，也不能用 Codex 代点确认。

已向用户提出具体范围变更，尚待答复：允许重启加载修复、保留原未知任务；以艾瑞_B / UID 3546384070347419 发布一篇独立且明确标注为验证的图文测试稿及既有三图，而不是重发结果未知的原稿。只有获得该具体测试稿授权后才可创建验收任务。

拟议验收动作：Studio 建立单篇测试任务 → Agent 自动上传三图、写标题正文、main 回读 → 公开范围与即时发送核验 → 原生发布入口及必要首次确认 → WebAffair 保存创建回执 → 公开详情 UID、全文和三图逐项核验。最终分别报告计划变化与公开发布结果。

本轮未提交 Git、未发版、未修改旧任务持久化状态。
