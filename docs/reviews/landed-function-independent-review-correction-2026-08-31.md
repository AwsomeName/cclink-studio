# 已落地功能独立审查修订与正式整改顺序

> 状态：整改施工中；P0-1 外部 MCP fail-closed 已完成工程实现，真实 SDK/App 验收待最终统一执行。
> 日期：2026-08-31。
> 原始审查基线：`main@0db9cf4d`。
> 复核基线：`main@c81a5126`。`57deba8e` 至 `c81a5126` 的 Browser View、UI smoke 与版本准备提交
> 未关闭本文安全问题。
> 初版记录：`docs/reviews/landed-function-code-audit-and-remediation-plan-2026-08-31.md`。
> 本文取代初版第 1、3、5、6 节的优先级和施工顺序。初版的 P1/P2 证据与详细真人验收动作继续有效，
> 但不得绕过本文新增的两项 P0 和一项按 P0 顺序立即止血的 P1。

## 1. 修订结论

独立审查是有效纠偏。初版方案识别了文件范围、危险操作、MCP 凭证和一组功能性问题，但遗漏了
两个比 MCP 凭证迁移更直接的模型权限/秘密泄漏入口，以及一个本机高权限 HTTP 服务认证缺口：

1. 外部 MCP 工具被 Claude Agent SDK `allowedTools` 通配符自动放行，不经过 Studio 的
   `McpToolHost`、`PermissionManager` 或计划中的内部工具授权层；
2. 普通 Browser Agent 可以调用 `browser_get_cookies`，返回完整 Cookie 值，包括 HttpOnly Cookie；
3. 本机 MCP 配置通常携带 session token，但 HTTP 服务对缺失或错误 token 仍返回空上下文并继续
   接受 `initialize`、`tools/list` 和 `tools/call`，token 不是强制认证边界。

初版还把定时任务列入危险操作绕过的重点。复核确认当前定时任务同时受到 SDK `allowedTools`、关闭
builtin tools、MCP `allowedTools` 和 `readRoots` 真实路径校验，只开放 `editor_read/editor_list`。
因此本轮不改造定时任务授权 schema；保留现有回归即可。未来扩大定时任务能力时再单独评审。

MCP env/header 的普通配置明文、renderer 全量返回和保存假成功仍成立，但在本地明文凭证产品模型
下调整为 P1。它需要系统迁移，却不是当前最短的远程代码执行或登录态泄漏路径。

## 2. 修订后的问题清单

| ID    | 优先级       | 状态                                                     | 问题                                                 | 当前保护                                                                                                   | 实际缺口                                                                                                                        |
| ----- | ------------ | -------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| IR-01 | P0           | 工程实现完成；最终验收待执行                             | 外部 MCP SDK 通配符自动放行                          | SDK 配置与 Backend 投影均只保留内部 `cclink_studio`；外部配置继续保存                                      | 真实打包 App 中的 SDK 进程级复核留到统一验收                                                                                    |
| IR-02 | P0           | 工程实现及真实 Context smoke 完成                        | Browser Cookie 完整返回模型                          | 通用 Agent 工具表移除 Cookie 读写；旧读取只返回聚合计数                                                    | 最终统一 App/Agent 事件与诊断复核待执行                                                                                         |
| IR-03 | P1，立即止血 | 工程实现及本机 HTTP 集成验证完成                         | 本机 MCP HTTP token 未强制                           | 所有 `/mcp` 请求在读 body 前强制有效 Run token；失效状态统一 401                                           | Authorization header 迁移仍为独立 P1-H；最终 SDK/App 重连验证待执行                                                             |
| RF-01 | P0           | 核心工程实现完成；真实 App 验收与 TOCTOU residual 待结论 | 文件权限边界不统一                                   | `FileService` 已收敛到主进程 active/trusted workspace；Browser、Android、Editor 与 renderer 复用同一 owner | Node 无可移植 `openat`，递归 mkdir/rename/copy 的父目录瞬时替换仍需按 residual threat 管理；真实文件选择器与 App 回归待统一验收 |
| RF-02 | P0           | 核心工程实现完成；真实设备副作用验收待执行               | `auto` 和 Always 可绕过危险操作确认                  | 单一 broker 已覆盖内部 ToolHost 与 SDK PreToolUse/canUseTool；登记账号专用有界授权和定时任务只读链保留     | Android shell 从工具表移除并 fail-closed；uninstall、清 Cookie 和 SDK Bash 均强制逐次确认；真实 Android 设备验收待执行          |
| RF-03 | P1           | 核心工程关闭；真实用户旧配置迁移不做破坏性代测           | 外部 MCP env/header 绕过统一 CredentialService       | 版本化 CredentialService revision、原子非敏感配置、脱敏 DTO                                                | 隔离 userData 迁移与真实 Electron IPC 已通过；未读取真实用户配置                                                                |
| RF-04 | P1           | 核心工程关闭                                             | Runtime 组件初始化失败可阻断 App                     | 同一 manager 降级、组件操作重试初始化                                                                      | 损坏 runtime-components 路径下真实 App 11/11 local smoke 通过                                                                   |
| RF-05 | P1           | 关闭                                                     | OpenAI Compatible 设置不可用                         | 单一支持常量限制 UI、IPC、持久化迁移、连接测试和 AgentBridge                                               | 未实现选项不再展示或可保存；真实设置页 smoke 通过                                                                               |
| RF-06 | P1           | Closed (automated)                                       | 搜索跨工作空间残留和迟到覆盖                         | 主进程 FileService 有界搜索，绑定 workspace/generation/requestId；renderer 丢弃迟到响应                    | 深层、忽略目录、符号链接、截断和切换竞态已覆盖；真实 Electron 搜索验收并入最终门禁                                              |
| RF-07 | P2           | Closed                                                   | `uiFontSize` 无生产效果                              | 删除未消费的 schema、默认值与 UI，保留有效的应用缩放设置                                                   | 旧配置中的冗余键加载时被忽略                                                                                                    |
| RF-08 | P2           | Closed (automated)                                       | 文件移动崩溃窗口                                     | 主进程原子持久 journal 覆盖 prepared、disk-committed、projection ack；启动按磁盘事实重放路径投影           | 提交点重启、未提交清理和冲突保留已覆盖；最终真实 App 重启恢复仍作为统一验收项                                                   |
| RF-09 | Product gate | Pending                                                  | 远程 Agent、PTY、真实网站登录缺真人验收              | 自动化门禁已覆盖部分代码路径                                                                               | 真实身份、在线设备、断线续接和账号隔离没有同一环境证据                                                                          |
| IR-04 | P1           | 工程实现及本机 HTTP 集成验证完成                         | 本机 MCP HTTP 请求体无大小上限且解析错误包含正文片段 | 8 MiB 流式/声明长度上限、100 请求 batch 上限、稳定脱敏解析错误                                             | 最终统一压力与 App 生命周期回归待执行                                                                                           |
| IR-05 | P1           | Open                                                     | 工具确认卡把原始参数返回 renderer                    | renderer 需要展示操作摘要                                                                                  | 参数中的 token、正文或敏感路径被无差别字符串化；重新开放外部 MCP 前必须修复                                                     |
| IR-06 | P1           | Open                                                     | 外部 MCP 名称允许原型特殊键                          | 名称只限制字符集合                                                                                         | `__proto__` 等键可进入普通对象映射，造成原型行为或配置投影异常                                                                  |
| IR-07 | P1           | 工程实现及真实 Context smoke 完成                        | 按名称清 Cookie 使用模糊且未转义的正则               | 按 name/domain/path 精确枚举并删除 Cookie identity                                                         | 最终统一 Browser 回归待执行                                                                                                     |

## 3. 新增 P0 的代码证据

### IR-01：外部 MCP 不经过 Studio 权限宿主

生产调用链：

```text
McpClientManager.composeMcpConfig()
  -> 把全部 enabled external server 交给 Claude Agent SDK
  -> LocalClaudeCodeBackend 在 all scope 枚举每个 server
  -> allowedTools += mcp__<server>__*
  -> SDK 将匹配工具视为无需提示自动执行
  -> SDK 直连 stdio/http/sse external MCP
  -> 不进入 Studio McpToolHost.handleToolCall()
  -> 不触发 PermissionManager / ToolExecutionPolicy
```

证据：

- `src/main/mcp/client-manager.ts:73-108` 把内部和外部 server 合成同一 SDK MCP 配置；
- `src/main/agent-core/backends/local-claude-code-backend.ts:485-518` 在 all scope 对每个 server 生成
  `mcp__<server>__*` 并传给 SDK `allowedTools`；
- 当前 SDK 类型声明明确 `allowedTools` 是“auto-allowed without prompting for permission”；
- `src/main/agent-core/backends/local-claude-code-backend.test.ts:857-865` 还把自动允许外部知识库作为
  预期行为固定；
- Studio `McpToolHost` 只处理 `cclink_studio` 本机 server 的 HTTP 请求，外部 server 不注册为
  `ToolModule`，因此计划只修改内部宿主无法覆盖外部工具。

风险：用户添加的外部 MCP 可以包含写文件、网络发送、数据库更新、shell 或任意自定义副作用。启用
server 后，模型在 all scope 可以直接执行这些工具，Studio 无法展示自己的确认卡、限制 Always、
绑定工作空间或记录统一授权事实。

### IR-02：Browser Cookie 值进入模型上下文

生产调用链：

```text
browser_get_cookies
  -> BrowserToolModule.execute()
  -> executePlaywrightAction('getCookies')
  -> browserContext.cookies()
  -> return { cookies }
  -> McpToolHost JSON.stringify(result)
  -> 完整结果返回 Agent/模型
```

证据：

- `src/main/mcp/modules/browser/index.ts:374-388` 把 `browser_get_cookies` 定义成普通只读工具；
- `src/main/playwright/playwright-actions.ts:209-214` 原样返回 Playwright Cookie 数组，没有删除 value
  或 HttpOnly 项；
- `src/main/mcp/modules/browser/index.ts:26-46,908-978` 只对绑定已登记账号的 BrowserTask 禁止 Cookie；
  普通浏览器任务不进入该保护；
- `McpToolHost` 会把结果完整 JSON 序列化给 Agent。

风险：HttpOnly 的目的就是禁止页面 JavaScript 读取，但主进程 Playwright Context 可以读取。把值交给
模型会把网页登录态扩散到模型输入、会话历史、供应商日志或后续工具参数中。诊断脱敏不能挽回已经
发送给模型的秘密。

### IR-03：本机 MCP token 支持但未强制

生产调用链：

```text
LocalClaudeCodeBackend.createToolSession()
  -> composeMcpConfig(port, token)
  -> 正常 SDK URL 带 ?session=<token>

任意本机进程
  -> POST http://127.0.0.1:<ephemeral-port>/mcp
  -> 不带 token 或携带错误 token
  -> resolveRequestContext() 返回 {}
  -> tools/list / tools/call 继续执行
```

证据：

- `src/main/agent-core/tools/tool-host.ts:141-146` 每轮生成 token；
- `src/main/mcp/client-manager.ts:73-87` 在调用方提供 token 时把它放进 URL；
- `src/main/agent-core/tools/tool-host.ts:255-260` 对缺失 token 和未知 token 返回空 context，而不是
  `null`；
- `src/main/agent-core/tools/tool-host.ts:174-205,267-327` 只要 context 非 null 就继续处理全部 MCP
  方法；空 context 仍可列出和调用全部工具。

风险：监听地址虽然是 loopback、端口是临时的，但同一用户下的其他本机进程一旦发现端口，就能绕过
会话工作空间、Run 归属和取消状态调用 Studio 高权限工具。配合 `auto` 权限和 FileService home 范围，
影响会进一步扩大。

IR-03 单独看需要同用户本机进程发现临时端口，攻击门槛高于 IR-01、IR-02、RF-01 和 RF-02，因此严重度
调整为 P1；但补丁很小且能封闭所有本机工具的旁路入口，仍排在整改顺序第三位立即止血。

### IR-04 至 IR-06：入口大小、确认参数和原型键

- `src/main/agent-core/tools/tool-host.ts:449-466` 无限制累积请求 chunks，JSON 解析失败还把正文前
  100 字符拼进 Error；需要流式计数、上限、提前中止和不含正文的稳定错误。
- `src/renderer/src/components/agent-panel/AgentPanel.tsx:821-834` 对 `request.params` 逐项
  `String(value)`；确认模型应由主进程生成经过 schema 和敏感键规则处理的摘要，renderer 不应取得
  原始高权限工具参数。
- `src/main/mcp/client-manager.ts:180-183` 的名称正则允许 `__proto__`、`prototype`、`constructor`；
  `composeMcpConfig()` 又把名称写入普通对象。名称 schema 应拒绝原型特殊键，所有外部名称映射同时改用
  `Object.create(null)`，两道边界不能互相替代。

### IR-07：Cookie 名称清理不是精确匹配

`src/main/playwright/playwright-actions.ts:234-244` 在单名称时直接使用未锚定正则，在多名称时把未经转义的
名称拼进 `^(${names.join('|')})$`。例如删除 `sid` 可能命中 `sid_backup`，名称中的 `.`、`+`、`(` 等还
会改变正则语义。Cookie 是登录态资源，清理必须按精确名称执行；如果同时指定 domain/path，应按完整
identity 缩小，不能用模型生成的模糊正则扩大删除范围。

## 4. 对初版问题的纠正

### 4.1 RF-01 仍是 P0，但攻击面要准确描述

普通 Claude Agent 的 Editor 和部分内置文件工具已经经过
`LocalClaudeCodeBackend.createStudioPreToolUseHook()`，会把相对路径投影到工作空间并拒绝符号链接
越界。因此不能再笼统写“普通 Editor Agent 可以直接读取整个 home”。

RF-01 仍为 P0 的原因是底层边界不统一：

- renderer 通用 FS 仍直接依赖允许整个 home 的 `FileService.validatePath()`；
- Browser 的工作空间文件检查位于“登记账号任务”分支，普通 BrowserTask 的 `uploadFile` 在该分支
  提前返回后不检查；
- Android install/push 直接读取工具参数给出的主机路径；
- IR-03 允许无有效会话 context 的本机调用绕过 Agent 上游 workspace hook。

修复应收敛到现有 `FileService`/主进程文件访问边界，并让 Browser、Android、Editor 和 renderer
入口复用；不必为了复刻已有 workspace 状态再建立第二 owner。

### 4.2 RF-02 不再包含定时任务

当前定时任务发送时：

- SDK 只允许 `mcp__cclink_studio__editor_read`、`editor_list`；
- builtin tools 被关闭；
- MCP context 再次只广播 `editor_read/editor_list`；
- 每次调用校验 task correlation、绝对路径、`readRoots` 和 `realpath`。

证据位于 `src/main/agent/agent-bridge.ts:394-425` 和
`src/main/agent-core/tools/tool-host.ts:438-443,480-511`。因此危险操作整改只处理普通交互 Run、内部
MCP 工具和 IR-01 的外部 MCP broker，不迁移现有 scheduled task schema。

### 4.3 RF-03 调整为 P1

迁移到现有 `CredentialService` 方向正确，但必须先解决：

- 当前最大记录数、字段数、单字段和总文件 1 MiB 上限是否满足合理 MCP server 数量；
- server rename/copy/delete 与稳定 `serverId`/`credentialRef` 生命周期；
- 凭证文件与非敏感 server 配置无法组成单一原子提交时的幂等迁移；
- 写凭证成功但配置失败、配置存在但引用缺失、删除一半等恢复矩阵；
- renderer 编辑时只允许整组替换还是显式单字段 reveal。

这些问题需要完整迁移设计，但不能排在 IR-01 至 IR-03 之前。

## 5. 正式整改顺序

### P0-1：立即禁止外部 MCP 自动放行（IR-01）

最小止血：

1. 在统一 broker 完成前，`LocalClaudeCodeBackend` 传给 SDK 的 `mcpServers` 只包含内部
   `cclink_studio`；外部 stdio/http/sse server 配置继续保存，但不传入 SDK、不启动子进程、不发现
   工具。这是首版选择的不可绕过 fail-closed 手段。
2. 同时停止生成外部 `mcp__<server>__*` 的 `allowedTools`。这只是 defense-in-depth，不能代替第一条。
3. UI 明确显示“已配置，等待受控授权支持”，不得显示为本轮 Agent 可用，也不得静默删除配置。
4. 回归测试必须提供一个启动或调用即写入临时 canary 文件的外部 MCP，并证明 server 未启动、工具未
   发现、canary 不存在；只断言“不在 auto-allowed 列表”不构成退出证据。

正式闭环：

1. 建立宿主拥有的 `AgentToolAuthorizationBroker`，内部 `McpToolHost` 与 SDK `canUseTool`/PreToolUse
   共同调用同一策略 owner；
2. 未登记分类和目标摘要规则的外部工具首版默认拒绝；只有 Studio 已登记可信分类，或用户显式建立了
   限定 server、tool、工作空间、资源范围和有效期的策略时才允许进入确认/执行；
3. 不采用“未知工具每次确认即可执行”，因为宿主无法可靠描述未知副作用。未来若要放宽，必须先提交
   ADR，决定第三方 annotation 的信任、策略持久化、撤销和审计模型；
4. 确认卡只显示主进程生成的脱敏摘要、server、tool、已知影响和当前工作空间；IR-05 未关闭前不得
   重新开放外部 MCP；
5. 调用结果和拒绝进入统一 Agent Run 审计，但不得记录秘密参数或完整输出；
6. scope 只决定工具是否可见，不能作为副作用授权。

验收：添加一个会写临时测试文件的外部 MCP；`auto` 模式下未经 Studio 确认不得执行，拒绝后文件不
存在，确认一次后只执行一次，切换 workspace 不继承授权。

### P0-2：禁止 Cookie 值进入 Agent（IR-02）

1. 从 Agent/MCP 工具表删除 `browser_get_cookies`；`browser_set_cookie` 同时停止向通用 Agent 暴露，
   避免模型注入或复制登录态。
2. 如果产品需要会话诊断，新增只返回主进程计算的非秘密投影，例如 host、cookieCount、是否存在
   持久 Cookie；不得返回 value、完整 Cookie header 或把启发式结果声称为已登录身份。
3. 在 `executePlaywrightAction` 或 Agent 返回边界增加 defense-in-depth：即使旧客户端残留调用，也
   不能把 Cookie value 序列化给模型。
4. Cookie 清理保留为受控副作用，进入 P0-5 的危险操作授权；清全部与按域/名称采用不同影响摘要。
5. 按名称清理改用 Playwright 的精确字符串过滤，或先读取非出站的主进程 Cookie 集合后按精确
   name/domain/path 逐项删除；禁止把用户或模型提供的名称直接拼接为正则。
6. 回归同时创建 `sid`、`sid_backup`、`sid.test` 和 `sid+test`，删除一个名称时其他 Cookie 必须保留；
   按域清理不得影响相邻域。
7. 增加 canary 测试，Cookie 测试值不得出现在 MCP response、Agent event、日志和诊断中。

验收：普通 Profile 和包含 HttpOnly Cookie 的测试 Profile 分别调用旧工具名，均不得返回值；新的
会话状态工具只返回非秘密元数据，真实页面登录态仍由可见页面验证。

### P0 顺序-3a：立即强制现有 query token（IR-03，严重度 P1）

1. `resolveRequestContext()` 对缺失、未知、已释放或已取消 token 返回拒绝，不再构造空 context；
2. `initialize`、`tools/list`、`tools/call`、notification 和 ping 全部在解析请求体前认证；
3. 首个补丁继续使用当前 SDK 已验证可用的 `?session=<token>`，不等待 transport header 兼容研究；
4. 缺失、错误、已释放和已取消 token 统一返回 `401` 和同一通用错误，不区分 token 状态，不返回
   工具名、会话或 workspace；
5. token 与单轮 Run 生命周期绑定，release/cancel 后立即失效；并发的已认证在途调用继续遵守取消
   和 active-call 收敛规则；
6. 不提供“没有 token 的兼容模式”。

验收：正确 token 可以初始化和调用；缺失、错误、释放后 token 均在工具路由前被拒绝，业务模块执行
计数保持 0。并发创建 Run A、Run B 后，token A 只能恢复 A 的 conversation/workspace/run context，
token B 只能恢复 B；有效的 token B 不应被全局拒绝，但任何请求参数都不能让 token A 切换成 B。

### P1-H：验证后迁移 Authorization header（IR-03 hardening）

1. 用当前打包版本的 Claude Agent SDK 在真实开发 App 验证 HTTP MCP 自定义 header 在 initialize、
   list、call、重连和错误重试中都保留；
2. 验证通过后把 token 迁移到 `Authorization: Bearer <token>`，避免 query URL进入错误或诊断；
3. 迁移期不接受 query/header 二选一的无限兼容。完成同一版本切换后只保留 header；
4. SDK 不支持时保留已强制校验的 query token，并把 URL 脱敏加入日志门禁；不能回退无 token。

### P0-4：把文件范围收敛进现有 FileService（RF-01）

1. 让主进程文件入口显式接收宿主可信 workspace identity，不再把 home 当授权；
2. `FileService` 统一处理已有目标、未创建目标最近父目录、符号链接、源/目标双路径和排他创建；
3. 检查与使用不能再次按字符串路径分离：已有文件应使用带 `O_NOFOLLOW` 或平台等价语义打开的 fd，
   open 后通过 `fstat`、inode/device 或等价能力复核，并在后续读写中继续使用同一 fd；
4. 新建/重命名必须防止检查后父目录被替换成符号链接。优先使用受校验目录 fd + `openat`/平台等价
   原语；若 Node/Electron 当前能力无法证明这一点，方案必须记录 residual threat 并在该入口 fail
   closed，不能仅凭第二次 `realpath` 宣称 TOCTOU 已关闭；
5. 普通 Editor 的 SDK hook 保留为第一道防线，主进程 FileService 作为不可绕过的第二道边界；
6. Browser 上传/下载、Android install/push、renderer FS 和 Agent Editor 复用同一实现；
7. 工作空间外单文件只接受主进程文件选择器产生的精确、短期授权，不扩大到父目录。

验收继续采用初版 A1，但补充普通 Browser 上传、Android install/push 和无有效 MCP token 三条反例。

### P0-5：统一危险操作授权（RF-02）

1. 建立 P0-1 的共享 broker；内部工具和外部 MCP 都先经过宿主 authorization floor；
2. `auto`/Always 只能减少低风险确认，不能绕过 destructive、human-exclusive 或 unknown-external；
3. `android_shell` 是无法可靠判断后果的任意命令能力，首版从普通 Agent 工具表移除并默认拒绝；用户
   需要时转到可见 Terminal/ADB 人工接管。不能采用“弹一次确认后由 Agent 自动执行任意命令”；
4. 未来如需恢复 Android shell，只能先定义结构化命令 allowlist、设备、参数、影响范围和超时，并
   提交 ADR。未知或不在 allowlist 的命令仍人工接管；
5. Android uninstall 等目标明确的 destructive 动作可以逐次确认，但 `allowAlways: false`；Cookie
   清理使用 P0-2 的精确身份，并按名称/域/全部显示不同影响摘要；
6. 保留登记账号事务已经获得的有界授权，避免对完全匹配快照的普通单对象提交重复确认；
7. 保留定时任务现有严格只读链路，本批不改其 schema。

验收：`auto` 模式下 Android uninstall 和清全部 Cookie 必须出现 Studio 确认；`android_shell` 直接
拒绝并引导人工接管，批准按钮不能使其执行。只读截图和设备列表仍按设置执行；现有定时任务读取回归
保持通过。

### P1-1：迁移外部 MCP 凭证（RF-03）

沿用初版“稳定 serverId + CredentialService + 脱敏 DTO + 原子非敏感配置”的方向，增加容量预算、
rename/copy/delete 生命周期和双文件恢复状态机。引用必须版本化且指向不可变记录，例如配置保存
`credentialRef = extension:mcp.<serverId>:v<revision>`，不能让同一个 ref 原地改变含义：

1. 更新凭证时先写入新的不可变 revision，再原子写 server 配置引用该精确 revision；
2. 配置写失败时旧配置继续引用旧 revision，新 revision 只是可识别的 orphan，不能覆盖旧凭证；
3. 配置写成功后才回收不再引用的旧 revision；回收失败只产生可清理 orphan，不得影响新引用；
4. rename 保持 serverId 和引用不变；copy 生成新的 serverId 和独立 revision；delete 先删除配置引用，
   再清凭证，失败时宁可保留 orphan；
5. 启动对账扫描缺失引用、重复 revision 和 orphan，进入结构化 `migration-blocked`/cleanup 状态，不能
   猜测“最新凭证”并自动错配；
6. 任一失败保留旧配置并可幂等重试，不能返回假成功或明文降级。

### P1-2：收紧 MCP HTTP 输入（IR-04）

1. 定义 `MAX_MCP_REQUEST_BYTES`；初始建议 8 MiB，并用最大合法工具输入 contract 证明该值足够。
   读取过程中累计字节，超限立即停止并返回 `413`；同时检查可信的 `Content-Length` 以提前拒绝，
   但不能只依赖该 header；
2. JSON 解析错误只返回稳定错误码，不把正文片段、Token 或参数写进 Error、console 和诊断；
3. 覆盖无长度 header、分块超限、声明长度欺骗、连接中断和批量请求上限。

### P1-3：确认摘要由主进程生成（IR-05）

1. `ToolConfirmationInput` 不再把任意原始 params 作为 renderer 展示 DTO；
2. 每个内置工具由主进程 schema 生成有界、脱敏摘要，敏感键、正文、Cookie、Authorization、Token
   和未知嵌套对象默认隐藏；
3. 外部 MCP 重新开放前必须完成这一项，并由 broker 生成已登记工具摘要；未知工具仍默认拒绝。

### P1-4：MCP 名称和对象映射防原型键（IR-06）

1. server 名称明确拒绝 `__proto__`、`prototype`、`constructor` 和保留内部名称；
2. server 配置映射使用 `Object.create(null)`，序列化前只枚举 own properties；
3. add/update/load/migration 全部复用同一 schema，旧非法配置进入 degraded 并要求改名，不静默丢弃。

### P1/P2 后续

1. Runtime 可选初始化降级；
2. 隐藏或实现 OpenAI Compatible；
3. 搜索 workspace generation、取消和明确截断；
4. 实现或删除 `uiFontSize`；
5. 文件迁移主进程 journal；
6. 同一真实在线 Agent、PTY 和真实网站账号真人验收。

## 6. 合入顺序与门禁

```text
P0-1 外部 MCP 不传入 SDK
  -> P0-2 Cookie 值禁止进入 Agent
  -> P0 顺序-3a 强制现有 query token（IR-03 为 P1）
  -> P0-4 FileService 工作空间收敛
  -> P0-5 内外部工具统一危险操作授权
  -> P1-1 MCP 凭证迁移 / P1-2 至 P1-4 输入与摘要边界
  -> P1-H 验证后迁移 Authorization header
  -> 其他 P1/P2
  -> 真实环境验收
```

前三项都是小而明确的止血包，不应等待大一统权限架构完成。P0-1 先关闭外部绕过，P0-2 立即切断
已经可返回的登录态秘密，P0-3 防止本机旁路；之后再收敛文件访问和授权模型。

每批必须：

- 先以独立反例证明旧行为，再让同一反例随修复转绿；不把 failing test 合入 `main`；
- 运行 `pnpm verify` 和受影响 smoke；Browser Cookie 与上传必须使用真实 Electron
  `WebContentsView`/Playwright Context，不以纯 mock 证明秘密不会泄漏；
- 记录用户现在能做什么、还不能做什么；工程门禁不替代真人动作；
- 更新本文件对应 ID 状态，不回写初版错误顺序；
- IR-01、IR-02、RF-01、RF-02 任一 P0 未关闭，或 IR-03 止血未完成时，不得宣称本轮安全整改完成。

## 7. 拷问结论

- “外部 MCP 也会经过 Studio 权限宿主”——不成立；SDK 直接连接外部 server。
- “allowedTools 只是可见性列表”——不成立；当前 SDK 明确定义为无需用户提示的自动允许列表。
- “从 allowedTools 删除外部通配符就不会执行”——不成立；server 仍在 SDK 配置中，必须不传入、
  disallow 或由 `canUseTool` 默认拒绝。本方案首版选择不传入 SDK。
- “HttpOnly 能阻止 Agent 读取 Cookie”——不成立；它只限制网页 JavaScript，不限制 Playwright
  BrowserContext。
- “正常 URL 带 token 就等于服务端强制认证”——不成立；服务端当前接受缺失和错误 token。
- “所有文件入口都没有保护”——不准确；普通 Editor 有上游 hook，但底层和 Browser/Android 旁路
  仍未统一，所以 RF-01 仍是 P0。
- “scheduledTaskPolicy 会绕过危险操作”——就当前产品能力不成立；它只有严格只读工具和路径范围。
- “先迁移 MCP 凭证再做权限”——顺序错误；秘密存储重要，但不能晚于当前正在自动执行和返回登录态
  的入口。

修订后的第一目标不是完成漂亮的统一架构，而是在三个独立最小补丁中彻底不启动外部 MCP、停止
Cookie 秘密出站、强制现有 query token。只有这三道止血完成后，统一 FileService 和授权 broker
才不会在施工期间继续暴露现有 P0；header 迁移、MCP 凭证和更完整的第三方策略随后独立验证。

## 8. 实施记录

### P0-1：外部 MCP fail-closed

- `McpClientManager.composeMcpConfig()` 只生成内部 `cclink_studio` server；外部配置仍保存在原配置
  列表，可继续编辑和停用。
- `LocalClaudeCodeBackend` 在 SDK 调用边界再次按内部 server 名过滤，避免未来配置合成器回归时把外部
  stdio/http/sse server 交给 SDK。
- “全部”作用域的自动允许列表只从过滤后的内部 server 生成；UI 明确显示“已配置，等待受控授权支持”。
- canary 单测模拟 SDK 收到外部 stdio 配置后立即启动子进程写文件；修复后 server 不可见、canary
  不存在。相关 38 项单测和 TypeScript 检查通过。
- `smoke:ui` 的设置页与应用启动检查通过；同次全量 UI smoke 的 PDF ready 超时和网页事务旧 Tab
  复用失败与本阶段无关，保留到最终统一回归复核。专用真实 Agent runtime smoke 需要隔离 API key，
  未在本阶段借用用户本机账号执行。

### P0-2：Browser Cookie 安全

- 通用 Agent 工具表删除 `browser_get_cookies` 和 `browser_set_cookie`；残留旧工具名在模块执行入口直接
  拒绝，不进入 Playwright、确认或事件结果链路。
- Playwright 旧 `getCookies` 动作只返回 `cookieCount`/`persistentCookieCount`，不返回 Cookie 名称、
  value、HttpOnly 条目或 header；`setCookie` 的结果也不再回显名称。
- Cookie 清理由模糊正则改成读取主进程 Context 后按精确 `name/domain/path` identity 逐项删除。
- 45 项相关单测、TypeScript、定向 ESLint 与格式检查通过。
- 新增 `smoke:browser-cookie-security`：在隔离 Electron `WebContentsView` 和真实 Playwright Context 中
  写入 5 个测试 Cookie（含 HttpOnly canary），证明 canary 不出现在旧读取结果；删除根路径 `sid` 后，
  `sid_backup`、`sid.test`、`sid+test` 和 `/admin` 路径的同名 `sid` 均保留。smoke 已通过。

### P0 顺序-3a / P1-2：本机 MCP token 与输入边界

- `/mcp` 在读取 `Content-Length`、流式 body 和 JSON 之前恢复有效 Run token；缺失、错误、已释放、已取消
  token 对 initialize、tools/list、tools/call、ping 和 notification 统一返回相同 401。
- token 是唯一上下文来源。并行 Run A/B 的测试证明 token A/B 分别恢复自身 conversation、workspace、
  run；请求参数伪造另一 Run 的字段不会切换宿主上下文。
- 请求 envelope 上限为 8 MiB，并同时检查声明长度和读取中的实际字节；batch 上限 100。超限返回 413，
  空/畸形 JSON 与过大 batch 返回稳定错误，不记录或回显正文片段。
- 10 项 ToolHost HTTP/生命周期测试、TypeScript 检查和 `smoke:local` 11/11 通过。
- 本阶段保留已由当前 SDK 验证的 query token。P1-H 的 Authorization header 迁移仍需真实 SDK initialize、
  list、call、重连和错误重试兼容性证据，不与本次止血耦合。

### P0-4：FileService 工作空间边界

- `WorkspaceStateService` 继续作为 active workspace 唯一 owner；`FileService` 只读取该事实，并通过
  `AsyncLocalStorage` 接收 renderer id 或 Run 启动时固定的 `trustedWorkspace`，没有新增第二份工作空间状态。
- renderer FS、Editor、普通 Browser 上传/下载目标、Android Agent install/push 和 renderer APK 安装均
  进入同一 `FileService` 边界。Browser 导航、Terminal 和定时任务既有只读 schema 未改动。
- 主进程文件选择器只生成绑定 renderer、精确路径、2 分钟且有限次数的 capability；单文件读 capability
  不能写。workspace 目录选择仅允许对精确选中目录树做切换前只读预检，并在激活时消费，不能用于写入；
  最近项目由主进程登记后才可重新激活。
- 已有目标、未创建目标最近父目录、双路径 rename/move/copy、符号链接和 Run 中可见工作空间切换均有真实
  文件系统反例。核心文件打开使用 `O_NOFOLLOW`、open 后 `fstat`、路径 inode/dev 与打开前后授权复核。
- 168 项受影响单测与 Node TypeScript 检查通过。真实 Electron IPC、Browser 上传及 native picker capability
  验收留到统一 App smoke。
- residual threat：Node/Electron 没有可移植的 `openat`/目录 fd 相对操作，递归 `mkdir`、`rename`、`cp`
  以及 Playwright/ADB 按路径二次打开仍存在同用户恶意进程在极短窗口替换父目录的竞态。本轮通过多次
  realpath、最终分量 `O_NOFOLLOW` 与 `fstat` 缩小窗口，但不将该部分宣称为完全关闭。

### P0-5：统一危险操作授权

- 新增单一 `AgentToolAuthorizationBroker` 作为策略 owner；`PermissionManager` 只保留确认 UI、超时、取消
  和普通写工具的会话内 Always 记忆。内部 `McpToolHost` 与 Claude SDK `PreToolUse`/`canUseTool` 复用该
  broker；Codex ACP 已分类权限请求也通过同一入口并绑定 conversation/run，避免任一 Agent 后端绕过主进程
  安全下限。
- destructive 工具无条件逐次确认并固定 `allowAlways: false`，因此 `auto` 和历史 Always 都不能绕过。
  `android_uninstall_package` 已修正为 destructive；`browser_clear_cookies` 和 SDK `Bash` 同样适用。
- `android_shell` 从普通 Agent 工具表删除；残留旧 MCP 名、SDK 名或模块直调都直接拒绝并提示转可见
  Terminal/ADB 人工接管，确认按钮不能让命令执行。
- 外部 MCP 与未知 SDK 工具没有登记分类时默认拒绝；内部 `cclink_studio` MCP 只在 SDK 层放行到本机
  ToolHost，并在真实执行前由 broker 再次授权。外部 MCP server 本身仍维持 P0-1 的“不传入 SDK”。
- 登记账号 BrowserTask 的精确 profile/origin/side-effect capability 由既有主进程专用策略验证后可标记
  `authorizationSatisfied`，避免统一 broker 对同一有界动作重复确认；敏感最终动作仍转人工接管。
- 定时任务 schema 未改，broker 只接受其既有 read-only annotation；ToolHost 的
  `editor_read`/`editor_list + readRoots` 校验继续先于执行。
- 130 项 broker、ToolHost、Claude SDK、Codex ACP、Browser、Android 与 PermissionManager 定向测试通过；
  196 项扩大回归通过。真实 App
  无 Android 设备，因此 uninstall 副作用和 shell 人工接管设备流程留到统一验收，当前不宣称设备闭环。

### P1-1：MCP 凭证版本化迁移

- `mcp-servers.json` 升级为 schema v2，只保存稳定 `serverId`、非敏感连接字段和
  `{credentialId, revision}`；env/header 由现有 `CredentialService` 以
  `mcp:<serverId>:<revision>` 不可变记录保存。Renderer 列表 DTO 只返回是否配置、是否悬空及 env/header
  键名，不返回值或 credentialRef。
- add/update 先写新 revision、再原子切换配置，失败时回收新 revision 并保留旧配置；成功后才清理旧
  revision。rename 保留 serverId 和引用，copy 创建新 serverId 和独立 revision，delete 先断配置引用再
  清凭证。
- 启动时迁移旧格式并对账：orphan 自动清理，dangling ref 保持 fail-closed 并投影“凭证引用缺失”，不
  猜测最新 revision。配置/凭证容量失败保持旧文件，失败写入不会报告成功，可幂等重试。
- 隔离临时配置测试覆盖旧格式迁移、Renderer 脱敏、rename/copy/delete、revision 冲突、配置写失败、
  orphan、dangling ref、256 记录容量上限和原型键；298 项 MCP/凭证/IPC/Agent 扩大回归通过。
- 隔离 userData 的真实 Electron/Renderer IPC smoke 证明 DTO 和 v2 配置不含 canary、rename 保持 serverId、
  copy 使用独立 revision、delete 清除引用与 revision，且外部 canary MCP 进程从未启动。测试未读取或输出
  真实用户配置。

### P1-2：Runtime 组件初始化降级

- `RuntimeComponentManager` 保持唯一 owner，记录初始化失败为 `failed/damaged`；state bootstrap 捕获该可选
  组件异常后继续创建 Workspace、窗口和其他本地服务。
- 组件安装、检查、修复、卸载及资源解析在同一 manager 上调用 `ensureInitialized()`；目录恢复后可重试，
  未恢复时只返回组件失败或 `null`，不向 Agent/CAD/Android 伪造可用状态。
- 17 项 manager、组件 IPC、Agent runtime 和可选服务测试通过；隔离 userData 把
  `runtime-components` 预置为阻止建目录的普通文件后，真实 Electron 本地 smoke 仍为 11/11。

### P1-3：Agent API 设置真实性

- 当前能力事实固定为 `Anthropic + Claude Code`。设置 IPC 拒绝 `openai/http-api`，设置页移除 OpenAI
  provider 和 Compatible option，并将格式控件锁定为 Anthropic；其他提供商仅保留确有 Anthropic 端点者。
- 旧 `provider=openai`、`apiFormat=openai` 或 `backendType=http-api` 启动时原子迁回 Anthropic 默认组合，
  不再保留 OpenAI URL/模型形成混合假配置。连接测试和 `AgentBridge` 使用同一支持事实做主进程复核。
- 85 项设置、AgentBridge 和 backend 定向回归通过；真实 Electron 设置页/CSP/免登录 3/3 smoke 通过。
