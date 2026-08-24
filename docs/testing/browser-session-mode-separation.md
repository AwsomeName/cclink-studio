# 统一 Browser 的三种登录环境

> 状态：工程修复与自动门禁已通过；真实第三方账号真人验收待执行
> 发现日期：2026-08-24
> 影响范围：本地工作空间内的 Browser Tab、网页新标签、书签/历史入口和未指定账号的 Agent 打开请求

产品只有一个内嵌 Browser。下文的“默认环境、已保存账号、新账号环境”只是同一种 Browser Tab
使用的不同 Session 归属，不是三套浏览器，也不是三个独立功能入口。

## 用户问题

用户在一个普通 Browser Tab 登录网站后，再打开同一网站的新标签，第二个标签却要求重新登录。
两个标签标题和 URL 看起来相同，界面没有说明它们实际使用了不同的登录环境。

## 用户可执行的端到端验收

1. 在本地工作空间点击“+”打开普通 Browser Tab，登录一个安全的测试网站。
2. 再点击“+”，在新标签打开同一网站；新标签应直接看到相同登录状态。
3. 在第一个普通网页中选择“在新标签打开”或触发安全测试 popup；新标签应继承来源登录状态。
4. 从书签、历史、Agent 消息或 Markdown 链接打开普通网页；未明确指定账号时应进入普通浏览环境，且普通标签之间共享登录状态。
5. 打开“网站与账号”，点击“添加网站与账号”；此时才创建“新账号”隔离环境，且不得复制普通浏览 Cookie。用户按提示重新登录并保存。
6. 分别打开两个已保存账号；各自复用自己的 Profile，同站账号互不串号。
7. 让 Agent 明确使用一个已保存账号；Agent 必须使用该账号 Profile。未指定账号的普通网页任务必须使用普通浏览环境。
8. 完全退出并重启 Studio；普通浏览、已保存账号的绑定和登录状态分别恢复，未保存账号草稿仍按既有清理规则处理。
9. 检查 Browser 工具栏；普通标签显示“默认环境”，草稿显示“新账号环境”，已保存账号显示具体账号，用户能区分同名网页所属环境。

真实第三方身份、二次认证和重启后的页面身份必须由真人确认。单元测试和 Cookie 元数据不能替代第 1–9 步。

## 根因

`openDefaultBrowserTab()` 曾在每次打开本地普通 Browser Tab 时无条件调用
`webResources.beginDraft()`。`beginDraft()` 在没有现有 Profile 时生成新的
`web-draft-<uuid>`，Tab 生命周期再把它交给 `BrowserManager` 创建独立 Electron partition。

结果是：

```text
普通新标签
  -> 被误判为“添加新账号”
  -> 创建新的 web-draft Profile
  -> 创建独立 Cookie/localStorage
  -> 相同网站再次要求登录
```

问题不在 Electron Session 持久化，而在产品入口把“普通浏览”和“添加账号”错误合并。此前
“所有本地 HTTP(S) Tab 必须绑定账号或草稿”的恢复与校验规则进一步固化了该错误。

## 修复后的三种模式

| 模式       | Tab 绑定                                           | Session 所有者与生命周期                                   |
| ---------- | -------------------------------------------------- | ---------------------------------------------------------- |
| 普通浏览   | 无 `browserProfile`、无账号/草稿引用               | `BrowserManager` 默认持久 Session；普通标签和重启之间共享  |
| 已保存账号 | 非空 `browserProfile` + 一个 `webResourceRef`      | 对应全局账号的持久 Profile；关闭 Tab 不删除账号或 Session  |
| 添加新账号 | 非空 `browserProfile` + 一个 `webResourceDraftRef` | 临时隔离 Profile；保存后原地转正，未保存关闭按既有规则清理 |

以下状态仍然非法：只带 Profile 没有账号/草稿引用、同时带账号和草稿引用、账号/草稿引用没有
Profile。普通浏览不是 Profile-only 状态；它明确使用默认 Session。

## 能力边界与失败降级

- 普通浏览不依赖 `WebResourceService`，账号服务故障不得阻断普通网页。
- 普通浏览中的现有登录不能自动无损转换为独立账号，因为切换 partition 不会复制 Cookie；用户
  必须从“添加网站与账号”进入隔离环境并重新登录。
- 已保存账号和账号草稿继续隔离，不能为了修复普通浏览而共享全部 Cookie。
- popup、复制页和网页“在新标签打开”继承来源模式；来源归属冲突时 fail-closed。
- Agent 明确 `accountId/profileId` 时继续走账号授权链；没有账号时只能使用普通浏览，不得猜测
  或复制账号 Profile。
- Cookie、Token、验证码和网页正文不进入 Tab 快照、日志或诊断。

## 实现与验证清单

- [x] 普通新建、书签、历史、普通 URL 和无账号 Agent 请求不再创建草稿。
- [x] “添加网站与账号”保留显式 `beginDraft()`。
- [x] Tab Store、WorkspaceState schema 和恢复允许普通模式，仍拒绝 Profile-only 状态。
- [x] Browser 新标签、popup 和复制页继承来源模式。
- [x] 工具栏显示环境标识，普通标签不显示“保存当前登录状态”的误导按钮。
- [x] 旧账号草稿和已保存账号恢复行为不变；旧普通标签可安全恢复为默认 Session。
- [x] 受影响单元测试、TypeScript、Lint 和真实 Electron smoke 通过。
- [ ] 按“用户可执行的端到端验收”完成真人验证。

自动证据：9 个受影响测试文件共 118 项通过；Web/Node TypeScript 与 ESLint 通过；
`node scripts/ui-smoke.mjs --global-web-resources-only` 3/3 通过。Electron smoke 已验证普通标签、
Agent 链接和 Markdown/历史使用默认 Session，显式账号草稿不复制普通 Cookie，保存后 Profile
不变，且重启 Studio 后普通登录状态仍可复用。真实百度身份和二次认证仍须真人确认。

## `/grilling`

- 是否只是删掉 `beginDraft()`，却仍被 Tab 恢复 schema 丢弃？
- 网页新标签是否真的继承来源 Session，还是只继承了 URL？
- Agent 未指定账号时是否错误复用当前已保存账号，造成权限扩张？
- 普通浏览能否跨重启恢复，而不把旧草稿错误转成普通 Session？
- UI 是否能让用户在两个同名网页之间看出“默认环境 / 新账号环境 / 已保存账号”？
- 修复普通浏览时，是否破坏了两个已保存账号互不串号的不变量？
