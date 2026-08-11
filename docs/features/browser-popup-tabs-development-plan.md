# 浏览器新窗口接管为工作台 Tab：产品与开发方案

> 状态：工程实现完成，待微信公众号真人验收。创建时间：2026-08-11。

## 结论

CCLink Studio 的普通网页新浏览上下文必须在主窗口内作为 Browser Tab 展示，不再由
Electron 默认创建独立 `BrowserWindow`。实现采用 `webContents.setWindowOpenHandler()` 的
`createWindow` 回调直接创建或接管 `WebContentsView`，保留原始 popup 的 WebContents、
Profile、Session、POST、referrer、`window.opener` 与 Playwright Page 语义。

仅把 URL 拦截后重新 `loadURL()` 不能作为正式方案，因为它会丢失 POST、referrer、
`about:blank + document.write` 和 opener 关系。

## 用户端到端验收

以微信公众号平台为首个真实验收场景：

1. 用户在已经登录的公众号首页点击“文章”。
2. CCLink Studio 原生主窗口数量不增加。
3. 文章页面在当前工作空间的新 Browser Tab 中打开。
4. 新 Tab 继承来源页面的 Browser Profile 和登录状态。
5. 用户可以切回原页面；原页面的地址、页面状态和历史不丢失。
6. 用户关闭新 Tab 后，对应 WebContents、Playwright Page 和 Browser runtime 全部释放。
7. 已被工作台接纳的 Tab 进入正常工作空间快照，并可按普通 Browser Tab 恢复。

只有真实应用完成上述动作，才可以声明首个产品闭环完成。单元测试、mock 或 `pnpm verify`
通过只代表工程门禁通过。

## 范围

本能力处理：

- `window.open()`；
- `<a target="_blank">`；
- `<form target="_blank">`；
- Chromium 的 foreground/background/new-window disposition；
- popup 自行调用 `window.close()`。

本能力不处理：

- `alert`、`confirm` 和 `prompt`；
- 文件选择器、下载保存窗口和系统权限提示；
- 由 `BrowserAuthProcessService` 管理的独立认证子进程；
- 主 renderer 自身的 `window.open`（主窗口继续全部拒绝）。

## 架构边界

### 状态所有者

| 状态                                | 唯一所有者                          | 说明                                                    |
| ----------------------------------- | ----------------------------------- | ------------------------------------------------------- |
| popup WebContents / WebContentsView | `BrowserManager`                    | 创建、接纳等待、激活与销毁                              |
| 可见工作台 Tab                      | renderer `tab-store`                | Browser runtime 的可丢弃投影和工作空间持久化            |
| Profile / Session                   | `BrowserManager` + Electron session | 必须继承来源 View，不接受网页或 renderer 自报           |
| Playwright Page 映射                | `PlaywrightBridge`                  | 使用 BrowserManager 分配的稳定 tabId，不另建可见 Tab ID |

不得新增第二个 popup Store。popup 的 `pending/adopted` 状态属于 `BrowserManager` 的 ViewEntry；
renderer 只通过受校验 contract 接纳或拒绝投影。

### 权限面

- 只允许 `http:`、`https:` 和受控 `about:blank`。
- `file:` 与其他协议继续拒绝。
- popup 强制保持 `sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`。
- workspaceKey 和 profileId 只能从来源 ViewEntry 继承。
- 认证 URL 继续由现有 `routeBrowserAuth` 路由，不转成普通自动化 Tab。
- 网页不获得 preload、Node.js、IPC 或工作空间文件权限。

## 生命周期

```text
page requests popup
  -> BrowserManager validates source and URL
  -> BrowserManager allocates stable tabId
  -> createWindow returns an adopted WebContentsView.webContents
  -> ViewEntry enters pending
  -> main emits popupCreated
  -> renderer adds a Browser Tab using the exact tabId
  -> renderer accepts popup
  -> ViewEntry enters adopted and normal reconcile owns it
```

失败与清理：

- renderer 拒绝、工作空间已切换或接纳超时：主进程关闭 pending View。
- WebContents 在网页侧自行关闭：主进程删除 runtime，并通知 renderer 删除 Tab 投影。
- renderer 主动关闭 Tab：沿用 `destroyView`，同时清理 Playwright 与 Agent 绑定。
- `reconcileViews` 在接纳握手期间不得把 pending View 当作孤儿销毁。
- 主窗口销毁时仍由 `BrowserManager.destroy()` 对称释放全部 View 和 timer。

## 契约

新增有界共享契约：

- `BrowserPopupCreatedPayload`：`tabId`、`url`、`workspaceKey`、`profileId`、
  `disposition`、`activate`。
- `browser:popupCreated`：main -> renderer。
- `browser:acceptPopup(tabId)`：renderer -> main。
- `browser:rejectPopup(tabId)`：renderer -> main。
- `browser:runtimeTabClosed`：main -> renderer，处理网页侧 `window.close()`。

所有入站 IPC 使用 shared Zod schema 校验；renderer 只能接纳当前工作空间、ID 未冲突且
Profile 一致的 popup。

## 实施批次

### M1：首个用户纵向闭环

- `createWindow` 接管普通 GET popup；
- runtime 生成稳定 tabId，renderer 以该 ID 创建 Tab；
- Profile、前后台 disposition、切换和关闭闭环；
- 微信公众号“文章”真人验收。

### M2：完整新浏览上下文语义

- POST、referrer、background-tab 和 `about:blank`；
- `window.close()` 双向同步；
- pending 超时、renderer 重建和工作空间竞态；
- `browser_wait_for_popup` 返回稳定可见 tabId；
- 诊断与回归 smoke。

M1 未通过真人验收前不得把功能标记为完成；M2 未完成前不得宣称“所有 popup 均支持”。

## 测试矩阵

| 场景                                     | 期望                                          |
| ---------------------------------------- | --------------------------------------------- |
| `<a target="_blank">`                    | 新工作台 Tab，主窗口数不变                    |
| `window.open(url)`                       | 保留 opener，使用稳定 tabId                   |
| `window.open('about:blank')` 后写入/跳转 | 内容和后续导航保留                            |
| POST form target blank                   | 请求体、Content-Type、referrer 保留           |
| background disposition                   | 新建但不抢占当前 Tab                          |
| popup `window.close()`                   | runtime 和 UI Tab 同时消失                    |
| 来源 Tab 关闭                            | 子页面按 Chromium opener 生命周期关闭或被对账 |
| 工作空间切换竞态                         | 不跨工作空间展示；pending 最终释放            |
| 非法协议 / `file:`                       | 拒绝，不创建 View                             |
| 认证 URL                                 | 继续进入独立认证流程                          |
| 同 Profile / 不同 Profile                | 登录态继承 / 隔离正确                         |
| Playwright popup                         | MCP 返回 ID 与可见 Tab ID 一致                |

## 诊断要求

框架诊断增加脱敏 popup 状态：

- tabId、workspaceKey 是否匹配；
- Profile ID（不含 Cookie 值）；
- disposition；
- `pending/adopted`；
- 创建、接纳、拒绝、超时和自关闭原因；
- Playwright claim 是否成功。

不得记录 URL 查询参数、Cookie、POST 正文、token 或页面正文。

## 拷问与退出条件

- 如果只对微信 GET 链接有效，不能宣称通用新窗口能力完成。
- 如果 Playwright 继续生成另一套随机 popup ID，违反单一状态所有者，不能合入。
- 如果 pending View 没有超时和窗口销毁清理，违反生命周期对称，不能合入。
- 如果 popup 能获得 preload、Node.js 或跨 Profile Session，属于安全回归，不能合入。
- `pnpm verify`、受影响测试和真人验收任一未通过，只能报告对应工程进度，不能报告产品完成。
