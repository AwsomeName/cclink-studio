# 内嵌浏览器 HTTP Basic Auth 登录被取消：缺陷记录与修复方案

状态：**Implemented · P1 · 等待真实 FRP 人工验收后关闭**

发现时间：2026-08-21  
影响版本：至少 `0.1.54`  
影响范围：Studio 内嵌 Browser `WebContentsView` 打开使用 HTTP Basic Auth 的站点；首次证据来自
一个 FRP 管理面板，本文不记录真实公网地址、用户名或密码。

## 用户现在能做什么、还不能做什么

代码修复后，用户在 Studio Browser Tab 打开受保护地址时会看到独立的用户名/密码窗口；正确提交
后原 Tab 继续加载。公网明文 HTTP 必须先勾选风险确认，凭证只用于当前挑战，不保存。

受控的真实 Electron `WebContentsView` 已验证“错误密码再次挑战 → 正确密码进入受保护页面”。
用户真实 FRP 地址尚未在本次开发中输入真实凭证，因此在完成本文第 9 项前仍不能把缺陷标为 Closed。

这不是 CCLink 远程账号登录失败，也不是 FRP 跳过了登录；FRP 使用浏览器原生认证挑战，
不是 HTML 登录表单。

## 修复后的用户验收动作

只有以下真实应用链路全部通过，才能关闭本缺陷：

1. 用户在主窗口 Browser Tab 打开一个受控的 HTTPS Basic Auth 地址，Studio 显示包含规范化
   `scheme://host:port` 和 `realm` 的认证对话框，网页内容不能覆盖或伪装该对话框。
2. 用户输入错误凭证后，当前 Tab 不跳走，Studio 明确显示“凭证被拒绝”并允许重新输入；不得
   自动无限重试旧密码。
3. 用户输入正确凭证后，同一 Tab 加载受保护页面，前进、后退、刷新和页面标题同步继续可用。
4. 用户取消或关闭对话框后，本次 challenge 被明确取消，Tab、其他 Browser Tab、Agent、Terminal
   和本地工作空间继续可用，不出现悬挂回调或无法关闭的窗口。
5. 同一 Tab 被移入辅助窗口后再次触发认证，对话框属于当前 owner window；认证期间关闭窗口、
   移动 Tab 或销毁 WebContents 时，旧 challenge 必须取消，不能把凭证提交给已经失效的页面。
6. 打开公网明文 `http://` Basic Auth 地址时，Studio 必须在输入前显示高风险警告，并默认聚焦
   “取消”；只有用户明确选择一次性继续后才允许提交。`localhost`/loopback 测试地址可显示较轻提示。
7. 重启 Studio 后不会从工作区状态、账号资源、日志、诊断或系统钥匙串恢复用户名和密码；首版
   不提供“记住密码”。
8. 复制框架诊断时能看到 challenge 的时间、Tab、owner、规范化 origin、scheme、realm、尝试次数
   和取消/提交/拒绝结果，但不能包含用户名、密码、Authorization header 或可反推凭证的值。
9. 在用户真实 FRP 面板上完成一次正确登录；如果仍使用公网 HTTP，验收者必须先看到并确认明文
   凭证风险。推荐先为 FRP 配置 HTTPS 或通过 VPN/SSH 隧道访问。

Mock、单元测试、`curl` 或普通网页通过，只能证明工程门禁，不能代替以上真实 Electron
`WebContentsView` 验收。

## 事故证据

2026-08-21 的 Studio `0.1.54` 框架诊断显示：

- 当前 Browser Tab 已导航到脱敏后的 `http://<frp-host>:7500/`；
- 页面标题退化为地址本身；
- Browser Profile 为默认 Profile；
- `claimPageForView` 报告 `context.pages()=0`，因此页面 Console 和 Network 诊断不可用。

对同一地址进行不带凭证的只读请求，服务端响应为：

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Basic realm="Restricted"
```

因此服务端认证门禁仍然存在；缺失的是 Studio 对认证 challenge 的交互处理。

## 根因

Electron 在 `WebContents` 请求 Basic Auth 时发出 `login` 事件。Electron 的默认行为是取消所有
认证；应用必须同步 `preventDefault()`，随后以一次性的 callback 提交用户名/密码或明确取消。
官方语义见 [Electron `app` login event](https://www.electronjs.org/docs/latest/api/app#event-login)
和 [Electron `webContents` login event](https://www.electronjs.org/docs/latest/api/web-contents#event-login)。

当前链路为：

```text
FRP 返回 401 + WWW-Authenticate: Basic
  -> WebContents 发出 login challenge
  -> BrowserManager 没有 login listener
  -> Electron 执行默认取消
  -> 用户看不到凭证输入入口
```

代码事实：

- `BrowserManager.installViewListeners()` 已处理导航、popup、加载、标题、缩放和原生菜单，但没有
  注册 `webContents.on('login')`；
- 当前 `BrowserAuthProcessService`/`browser-auth-contract.ts` 是 V2EX 跳转 Google 登录的专用
  Cookie 回写通道，只接受 `profileId === 'v2ex'` 和 `accounts.google.com`；它不是通用 HTTP
  challenge owner，默认 Profile 的 FRP 地址也不会进入该通道；
- Playwright claim 失败只影响自动化寻址和 Console/Network 诊断，不会阻止 Electron 主进程处理
  Basic Auth，因此它是并存的诊断缺口，不是本故障根因；
- 同一日志中的腾讯 IM 重连错误发生在更早时段，与 FRP 的 HTTP 401 无关。

## 能力边界

首个最小纵向闭环只处理用户主动导航产生的、非代理的 HTTP `Basic` challenge：

| 项目                                | 首版结论                                       |
| ----------------------------------- | ---------------------------------------------- |
| 顶层 HTTPS Basic Auth               | 支持                                           |
| 顶层公网 HTTP Basic Auth            | 风险警告后一次性支持，默认取消                 |
| loopback HTTP Basic Auth            | 支持并提示未加密                               |
| iframe、图片等子资源 challenge      | 默认拒绝，避免页面用子资源伪造登录请求         |
| 代理 `407` / `authInfo.isProxy`     | 不支持并明确取消                               |
| Digest、NTLM、Negotiate、客户端证书 | 不在本缺陷首版范围                             |
| 保存/自动填充密码                   | 不支持；如未来需要，另做产品确认和凭证边界设计 |
| Agent 自动提供或读取凭证            | 禁止；必须由真人在隔离对话框输入               |

Basic Auth 只用 Base64 编码凭证，不提供传输加密。RFC 7617 明确要求敏感场景结合 TLS；参见
[RFC 7617](https://www.rfc-editor.org/rfc/rfc7617.html#section-4)。Studio 的风险提示不能把公网
HTTP 变安全，也不能替代服务器 HTTPS 配置。

## 选定解决方案

### 1. 状态所有权

| 状态                                      | 唯一所有者                               | 生命周期                           |
| ----------------------------------------- | ---------------------------------------- | ---------------------------------- |
| Browser View、Session、URL、owner window  | `BrowserManager`                         | 跟随 Browser Tab/WebContents       |
| 一次性 challenge callback、尝试次数、超时 | `BrowserAuthProcessService` 的 HTTP 模式 | 单次 challenge；关闭/失效/超时取消 |
| 凭证输入草稿                              | 隔离认证子进程的页面局部状态             | 窗口关闭即销毁                     |
| Cookie/Chromium 进程内认证缓存            | Electron Session                         | 不复制到资源或工作区状态           |
| 安全诊断摘要                              | `BrowserManager` 诊断投影                | 有界数量、完全脱敏                 |

复用现有 V2EX 登录所用的 `BrowserAuthProcessService` 和独立 Electron 子进程基础设施，但不复用
V2EX 的站点判断、Google 跳转或 Cookie 回写契约。新增的 `http-basic` 子模式只持有一次性 challenge
callback；它不会成为第二个 Browser/Profile/Session owner。

### 2. 主进程 challenge 路由

`BrowserManager.installViewListeners()` 为每个受管 `WebContents` 注册局部 `login` listener，而不是
使用全局 `app.on('login')`：

1. 事件到达后立即 `event.preventDefault()`，先阻止 Electron 默认取消；
2. 复用 `did-start-navigation(..., isMainFrame)` 建立的当前顶层导航代次，校验 `ViewEntry`、`tabId`、
   `runtimeGeneration`、owner window 和 challenge URL 仍一致；
3. 拒绝代理、非 `basic`、没有活动顶层导航代次，以及 challenge host/port 与目标 origin 不一致的请求；
4. 生成随机 `requestId`，把 callback 交给 `BrowserAuthProcessService`，不把 callback 或凭证交给
   renderer Store；
5. 服务沿用 V2EX 登录的独立子进程模式，打开一个应用自有认证窗口；提交时再次验证窗口 sender、
   request ID、Tab generation 和 origin；
6. 校验通过后只调用一次 `callback(username, password)`；取消、超时、Tab 移动、导航代次变化、
   WebContents/owner window 销毁时调用无参数 callback 并释放；
7. 相同 Tab generation + origin + realm 再次 challenge 视为上次凭证被拒绝。不得自动重放密码；
   重新显示错误状态并让用户决定是否再次输入。

同一 Tab 同时只保留一个 Basic Auth challenge；新的 challenge 会先取消旧 callback。不同 Tab 的
事务以 `tabId + runtimeGeneration` 隔离，不能互相提交凭证。

### 3. 隔离认证对话框

使用与 V2EX 登录相同的独立 Electron 子进程，再由该进程创建只加载本地 `data:` 页面的
`BrowserWindow`。这样认证页面崩溃或退出不会污染主工作台进程。窗口满足：

- `sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`；
- 使用单独的最小 preload，只允许当前页面提交或取消一个有 schema 的 challenge；
- 不暴露工作区、文件、Terminal、Agent、Cookie、Browser 自动化或通用 dialog API；
- 主进程按精确的 prompt `WebContents`、main frame URL 和 `challengeId` 校验 IPC sender；
- 页面只显示规范化 origin、realm、是否明文 HTTP 和尝试失败状态；realm 去除控制字符、限制长度并
  按纯文本渲染；
- 用户名和密码只保存在组件局部内存，不进入 Zustand、localStorage、表单自动完成、剪贴板、
  错误对象、遥测或日志；密码输入框默认禁止显示明文；
- 使用临时 `userData` 目录和非持久 Session；窗口/子进程退出后清理，网页 `WebContentsView` 不能
  覆盖该顶层窗口。

实现使用独立 preload 构建入口，没有复用拥有完整桌面 API 的 `src/preload/index.ts`。

### 4. 失败降级与生命周期

- 对话框创建失败：取消本次 challenge并记录脱敏原因；其他能力不受影响。
- 120 秒无响应：取消 challenge 并销毁对话框；不得无限持有 Electron callback。
- 用户连续失败：每次都清空密码，最多连续显示三次；之后取消并要求用户刷新后重新发起，避免认证循环。
- Tab/WebContents 销毁：立即取消 callback 并终止对应认证子进程；运行时代次或导航 origin 已变化时，
  即使旧窗口后来提交，凭证也不会转发给失效页面。
- App/Browser capability shutdown：先取消全部 callback，再移除 listener、IPC 和 prompt window，保证启动/停止对称。
- Playwright 未连接或 claim 失败：人工 Basic Auth 仍应工作；认证不能依赖 CDP/Page。

### 5. 诊断

Browser 诊断增加了 `httpAuth` 摘要，只记录：

```ts
type BrowserHttpAuthDiagnostic = {
  timestamp: number
  tabId: string
  runtimeGeneration: number
  origin: string
  realm: string
  transport: 'https' | 'loopback-http' | 'insecure-http'
  attempt: number
  outcome: 'prompted' | 'submitted' | 'cancelled' | 'rejected' | 'authenticated'
  reason?: string
}
```

`realm` 和 `reason` 必须去除控制字符并做长度上限。禁止记录 username、password、URL userinfo、
Authorization/Proxy-Authorization header、callback 参数、Cookie 值或对输入做哈希。诊断报告还应
区分“HTTP auth challenge 已取消”和“Playwright Page claim 失败”，避免再次把两个问题混为一谈。

## 已实现的代码落点

- `src/shared/ipc/browser-http-auth.ts`：安全 challenge 投影和 submit/cancel contract/schema；
- `src/main/browser/browser-auth-process-service.ts`：复用既有 V2EX 认证子进程协调器，增加独立的
  HTTP Basic callback、超时、三次重试和清理；
- `src/main/browser/browser-http-auth-child.ts`：不加载远程网页的最小凭证窗口；
- `src/main/browser/browser-manager.ts`：局部 `login` listener、Tab/owner/generation 校验和安全诊断；
- `src/preload/browser-http-auth.ts`：认证窗口的最小 IPC 提交入口；
- `electron.vite.config.ts`：新增隔离 preload entry；
- `src/main/runtime/window-runtime.ts` / `src/main/index.ts`：依赖注入、子进程入口和对称销毁；
- Browser IPC/诊断 contract：只增加脱敏状态，不暴露凭证；
- 对应 contract、service、BrowserManager 和真实 Electron smoke 测试。

这条链路不需要修改 CCLink 远程域、`WebResourceService`、`CredentialService`、Playwright 工具或
Agent runtime。

## 已完成的工程验证

- Contract 与 `BrowserManager` 受影响测试：33 项通过；
- `pnpm build` 通过，独立 `out/preload/browserHttpAuth.js` 已生成；
- `pnpm smoke:browser-http-auth` 通过真实 Electron `WebContentsView`：第一次错误密码触发第二次
  challenge，第二次正确密码进入受保护页面，且 `did-start-navigation` 发生在 `login` 前；
- 定向 ESLint 与 `git diff --check` 通过。

这些结果证明实现链路可运行，但不能代替用户真实 FRP 地址的最终验收。

## 被否决的方案

| 方案                                    | 否决原因                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------- |
| 把 `username:password@host` 写入 URL    | 会进入地址栏、历史、错误或日志，现代 Chromium 兼容性也不可靠                    |
| 用 Playwright 处理登录框                | Basic Auth 在 DOM/Page 之前发生；当前 Page claim 失败时更不能依赖自动化         |
| 全局 `app.on('login')` 自动填固定凭证   | 会扩大到代理、UtilityProcess 和非 Browser 内容，无法证明作用域正确              |
| 直接把 Basic Auth 塞进 V2EX Cookie 契约 | 两者结束条件不同；本实现只复用进程/窗口基础设施，使用独立 child mode 和消息契约 |
| 默认保存到 CredentialService            | 超出最小闭环，引入 host/realm/profile 绑定、轮换、删除和跨工作空间授权问题      |
| 对公网 HTTP 静默提交                    | Basic Auth 不加密密码，违背最小权限与明确风险确认原则                           |

## 关闭条件

- 本文“修复后的用户验收动作”全部通过并记录真实结果；
- 受影响单元/契约测试、`pnpm typecheck` 和真实 Electron smoke 通过；
- 诊断样本经人工确认不包含任何凭证；
- 当前 main/aux owner、关闭、移动、超时和错误密码路径都没有悬挂 callback 或 orphan prompt；
- 更新本文状态和 `docs/features/browser-automation.md`，不得只凭代码或 mock 将缺陷标为关闭。
