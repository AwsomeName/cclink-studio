# Browser Playwright/CDP 断线后无法恢复：最小修复方案

- 状态：**Proposed · P1 · 尚未实施**
- 发现时间：2026-08-25
- 首次确认版本：CCLink Studio `0.1.58`
- 影响范围：Studio 内嵌 Browser 页面仍可见、可手动操作，但 Agent 的截图、DOM 读取、填写、
  点击、上传和其他 Playwright 自动化不可用

## 结论

本次事故不是 CSDN 页面、登录 Cookie、Browser WebContents、页面缩放或文件读取失败。可见页面
仍在运行，登录态仍然存在，文案文件也已读取成功；失效的是 Studio 启动时通过 CDP 建立的
Playwright 自动化连接。事故时 `claimPageForView` 连续报告 `contexts=0、pages=0`，但
`BrowserManager` 仍能列出、导航和迁移同一个可见 Browser Tab。

当前 `PlaywrightBridge` 只在 automation runtime 启动时连接一次；没有监听运行期
`disconnected`，没有检查 `browser.isConnected()`，也没有 single-flight 重连。现有 claim 重试只
反复查询同一个失效 Browser 对象，因此不能自愈。`browser_navigate` 又直接使用 Electron
`webContents.loadURL()`，即使 Playwright 已失效仍会返回成功，导致 Agent 错把“页面导航成功”
理解为“自动化连接已恢复”。

正式修复只保留五件事：

1. Bridge 检测断线并 single-flight 有界重连。
2. 用一个递增 generation 阻止旧连接、旧 claim 和旧 close 回调污染新连接。
3. 不重建 WebContents；重连后重新 claim 现存 View。
4. 工具只在派发前恢复；导航后确认自动化绑定；失败时 BrowserTask 和 Agent 不得成功。
5. 真实 Smoke 从 Studio 内部断开它自己的 transport，再完成 CSDN 真人验收。

## 用户现在能做什么、还不能做什么

用户现在仍能在 Studio 中看到和手动操作原 Browser 页面，也可以通过完全退出并重新打开 Studio
恢复本次 Playwright 连接。用户还不能依赖 Studio 在运行期自动恢复 CDP 断线；刷新、重新导航或
重新打开同一网页不能保证恢复，因为这些操作仍可能复用失效的 `PlaywrightBridge`。

在本方案完成真实 App 验收前，不得声明 Agent 可以跨长时间运行或 Browser Tab 迁移稳定地继续
网页自动化。

## 用户端到端验收动作

只有以下真实应用链路全部通过，才能关闭本缺陷：

1. 用户在 Studio Browser 中登录 CSDN，进入文章编辑页，保留未提交表单、滚动位置和页面状态。
2. 测试主动断开 Studio 自己的 Playwright transport，但不关闭或重载 Browser WebContents。
3. 用户再次要求 Agent 截图；Studio 在有界时间内自动恢复，无需重启 App 或重新登录。
4. 恢复后 URL、标题、WebContents ID、CDP target、Profile、Session、Cookie、未提交表单、
   滚动位置、页面 boot ID 和 `performance.timeOrigin` 保持不变；页面没有 reload。
5. 同一个 Browser Tab 完成主窗口 → 辅助窗口 → 主窗口迁移后，重复断线与恢复，Agent 仍只操作
   用户可见的同一 Tab。
6. 注入 CDP 持续不可用后，可见网页和其他本地能力继续可用；BrowserTask 与 Agent run 明确失败，
   不能被一次早先成功的导航掩盖。
7. 点击、填写、脚本、Cookie、返回、刷新等动作派发后断线时不自动重放；写动作显示“结果未知”，
   Agent 必须重新观察页面。
8. 发帖、发送、删除和其他不可逆外部提交继续进入最终用户确认。

Mock、单元测试、普通导航成功或只证明页面仍可见，都不能替代以上真实 Electron + CSDN 验收。

## 事故证据与排除项

诊断报告生成于 2026-08-25 18:38，应用版本为 `0.1.58`：

1. 2026-08-24 21:04，automation runtime 启动成功，Playwright 发现 `1 Context / 1 Page`。
2. 21:21，CSDN Browser Tab 成功 claim 为 Playwright Page。
3. 2026-08-25 18:36–18:37，同一 Browser Tab 连续完成辅助窗口 → 主窗口 → 新辅助窗口迁移；
   WorkbenchTransfer 均为 `committed`、`identityMatched=true`、`failure=null`。
4. 18:37:46，Agent 首次截图失败：可见 Tab、URL 和标题仍存在，但 `claimPageForView` 报告
   `contexts=0、pages=0`。
5. 18:37:57，`browser_navigate` 返回成功；该成功只证明 Electron WebContents 完成导航。
6. 18:38:02，再次截图仍报告 `contexts=0、pages=0`，证明导航没有恢复 Playwright。
7. 最终 Browser 能力仍显示启动时的 `ready`，Agent run 显示 `completed`，但网页没有被填写。

排除项：

- CSDN 可见页面、Profile、持久 Session 和认证 Cookie 正常。
- fit-width 与 visual scale 均为 `1`，不是历史 30% 缩放回归。
- 当前任务所需 Markdown 文件读取成功；另一份 V2EX 文件 `ENOENT` 是更早的独立问题。
- 腾讯 IM 网络超时、Terminal audit JSON 警告、Android 未连接与本次故障无关。

窗口迁移与首次失败时间相邻，是优先复现方向，但日志没有记录准确断线时间，不能把迁移写成已经
确认的触发根因。最小修复直接处理任何 Playwright transport 断线。

## 架构边界

本修复不需要 ADR，不改变既有状态所有权：

| 状态/资源                                                       | 唯一所有者           | 本次职责                                          |
| --------------------------------------------------------------- | -------------------- | ------------------------------------------------- |
| Browser Tab、WebContentsView、URL、Profile、Session、窗口归属   | `BrowserManager`     | 保持现有运行事实；提供现存 View 的重新 claim 入口 |
| CDP transport、Playwright Browser/Context/Page 映射、generation | `PlaywrightBridge`   | 检测断线、串行重连、清理旧引用                    |
| BrowserTask、动作日志与终态                                     | `BrowserTaskRuntime` | 自动化恢复失败后进入失败终态                      |
| MCP 工具执行                                                    | `BrowserToolModule`  | 派发前确保连接；派发后不自动重放                  |
| Agent 完成门禁                                                  | `AgentBridge`        | 关联 BrowserTask 失败时拒绝 run 成功              |

禁止新增第二套 BrowserManager、第二个自动化 Tab registry 或独立 Browser runtime。MCP 模块不因
重连重新注册；现有 `PlaywrightBridge` 对象保持稳定，只替换其内部 Playwright 连接和 Page 投影。

## 修复一：最小连接生命周期

`PlaywrightBridge` 只新增这些字段：

```ts
private connectionGeneration = 0
private reconnectPromise: Promise<void> | null = null
private stopping = false
```

保留当前 `browser`、Context/Page 注册表和必要诊断时间。不要增加 recovery cycle、connect attempt
或新的生命周期服务。

### 断线检测

- 新 Browser 连接成功后注册 `browser.on('disconnected')`。
- `claimPageForView` 和 Browser 工具执行前检查 `browser?.isConnected()`。
- disconnected 或主动检查失败都调用同一个 `ensureConnected(trigger)`。
- `ensureConnected` 发现当前连接健康时立即返回；发现 `reconnectPromise` 时等待同一个 Promise；
  否则创建一次新的有界连接。

每个 generation 只启动一次有界 `connectOverCDP` 调用，不使用会遗留底层异步任务的
`Promise.race`。连接调用成功或失败完全 settle 后，后续需求才允许创建下一个 generation。这样一个
递增 generation 就足以隔离旧回调，不需要额外 attempt ID。

### Generation 规则

创建新连接操作时先递增 generation，并把值捕获到本次连接、Page、claim 和 close 回调中。任何
异步完成在写共享状态前都检查：

```ts
capturedGeneration === this.connectionGeneration && !this.stopping
```

涉及 Browser、Page 或 WebContents 的回调还必须校验对象身份。旧 generation 只能清理自己创建的
对象，不能替换或关闭当前 Browser，也不能清空当前 `reconnectPromise`。

停止时设置 `stopping=true`，递增 generation 使所有在途回调失效，移除监听器并清空引用；停止
期间不再启动重连。

重连失败把 Browser 自动化能力标为 `failed`；BrowserManager、手动网页和其他能力继续可用。后续
真实工具需求可以重新尝试，但禁止无限后台循环。

## 修复二：清理旧引用并重新 claim

开始新 generation 时只清理 PlaywrightBridge 自己持有的旧连接对象：

- 移除旧 Browser、Context 和 Page 上由 Bridge 注册的监听器；
- abort/作废旧的 pending claim；
- 清空旧 Page 注册、active Page 引用、旧 console/network 缓冲和 Playwright-scoped 下载引用；
- 保留 Electron Session、BrowserDownloadStore 和其他 BrowserManager 事实，不重做下载、日志
  retention 或路由配置架构。

每个 Tab 的内部绑定只需：

```ts
interface PageBinding {
  page: Page
  generation: number
  webContentsId: number
}
```

claim 完成时检查当前 generation、Tab 仍存在以及 `webContents.id` 未变化，再写入绑定。Page close
回调只有在当前 Map 中仍是同一个 `Page + generation + webContentsId` 时才能删除，防止旧 Page 的
迟到 close 误删新 Page。

新连接建立后，`BrowserManager` 对现存且已加载的 View 重新 claim。使用稳定
`tabId + targetId` 精确匹配，URL 只在唯一候选时兜底，不能跨 Profile 猜测。某个 Tab claim 失败只
记录该 Tab 错误，不主动断开已经健康的全局 CDP 连接；工具只要求自己的目标 Tab 成功绑定。

不得调用 `webContents.reload()`、重新 `loadURL()`、重建 Profile、重建 Session 或重建 Browser
Tab 来伪装恢复。重连后 Playwright `Page` 包装对象可以变化，但 WebContents、target、Profile、
Session 和网页运行状态必须保持。

## 修复三：工具派发规则

规则统一且默认安全：

1. 任何 Browser 动作派发前都调用 `ensureConnected()`，并确保任务固定的目标 Tab 已重新 claim。
2. 如果尚未派发，恢复成功后正常执行一次。
3. 一旦动作已经派发，发生断线时任何动作都不自动重放，包括读取、等待、导航、返回、刷新、
   点击、填写、按键、脚本、Cookie、Tab、下载和路由控制动作。
4. 读取动作返回连接中断；下一次工具调用可以重新观察。
5. 可能产生页面、输入、文件、Cookie、导航或外部副作用的动作返回
   `action_result_unknown_after_disconnect`，要求先重新截图。

不新增 46 动作重试矩阵、`logicalActionId` 或 `actionAttemptId`。实现只需要在单次工具调用栈中区分
“尚未派发”和“已经派发”。未来新增动作天然继承“派发后不重放”的默认规则。

### 导航的特殊返回

`browser_navigate` 使用 BrowserManager 完成可视导航后，Agent 路径必须继续等待 Playwright 重新
绑定目标 Tab。若页面已导航但 claim 失败，工具必须明确失败并报告：

```ts
{
  code: 'browser_automation_unavailable'
  navigationApplied: true
  automationReady: false
}
```

这不会回滚已经发生的导航，但能阻止 Agent 把导航成功误判为自动化恢复。用户通过普通 Browser UI
发起的导航不受 Playwright 故障阻断。

## 修复四：BrowserTask 和 Agent 完成门禁

不新增 CAS 状态系统，复用现有 BrowserTask 和 Agent run ledger，只补两条门禁：

1. Agent Browser 工具首次解析出目标 Tab 时，确保 BrowserTask 记录当前
   `conversationId + agentRunId + tabId`；`scope=all` 也不能遗漏。
2. Agent 收到该 run 的 `complete` 时，按事件的 `conversationId + runId` 查找对应 BrowserTask。
   如果任务已经 failed/cancelled、最后一个 Browser 动作失败或没有可验证成功动作，则把 complete
   归一化为 error。不得回退到其他 run 或只依据“曾有一次成功导航”。

自动重连成功且工具尚未派发时，任务可以继续。重连失败或派发后结果未知时，当前 BrowserTask
进入失败终态；现有终态保护必须确保后续 `finishTask` 不能把 failed 改回 completed。旧 run 的迟到
complete 因 runId 不匹配而被忽略，不需要新建第二套状态账本。

## 修复五：诊断和真实 Smoke

诊断只增加定位本缺陷所需字段：

- `isConnected`
- `connectionGeneration`
- 最近 disconnected/reconnect 时间、触发源和错误
- Context/Page 数量
- 目标 Tab 的 `boundGeneration`、`webContentsId` 和最近 claim 错误

不建设完整逐 Tab 五态、复杂 IPC 状态机、日志 retention 或下载诊断重构。诊断继续脱敏 URL 查询
参数，不记录 Cookie 值、表单内容、正文、凭证或验证码。

### Smoke 必须断开 Studio 自己的 transport

新增 `pnpm smoke:browser-cdp-recovery`：

1. Studio 主进程只在 smoke 模式注册内部测试入口，直接作用于当前
   `runtime.playwrightBridge`，断开它自己的 Playwright client transport。
2. 该入口不进入 preload 公共 API、MCP 工具或正式包可用表面；必须校验可信 smoke sender 和当前
   generation。
3. 不能调用 `browser.close()` 关闭 Electron Chromium；通过注入的 test-only connection adapter
   或锁定 Playwright 版本的 client connection 关闭方法，仅关闭内部 transport。
4. 外部 smoke runner 另建一条只读观察连接。内部 transport 断开期间，这条外部连接必须仍能
   读取原 target，原 WebContents 仍能执行脚本。
5. 恢复后确认 WebContents ID、target ID、Profile、Session、Cookie、表单、滚动位置、boot ID 和
   `performance.timeOrigin` 不变，内部 generation 增加且目标 Tab 重新绑定。
6. 并发触发多个截图/claim，断言只有一个 reconnect Promise 和一条新内部连接。
7. 注入旧 claim 和旧 Page close 迟到，确认不能覆盖或删除新 binding。
8. 执行主窗 → 辅助窗 → 主窗迁移前后分别断线恢复。
9. 注入重连失败，确认手动 Browser 和无关能力继续可用，BrowserTask 与 Agent run 失败。
10. 确认派发后的 Browser 动作没有自动重放。

自动 smoke 通过后，在真实 Studio + CSDN 登录页面执行本文“用户端到端验收动作”，记录结果后才能
关闭缺陷。

## 代码落点

| 文件                                       | 最小修改                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------- |
| `src/main/playwright/playwright-bridge.ts` | disconnected/isConnected、generation、single-flight 重连、旧监听器清理 |
| `src/main/browser/browser-manager.ts`      | 重新 claim 现存 View，记录目标 Tab 最近 claim 结果                     |
| `src/main/runtime/automation-runtime.ts`   | 注入 CDP 端口解析、映射能力状态、对称停止                              |
| `src/main/mcp/modules/browser/index.ts`    | 派发前恢复、导航后确认绑定、派发后不重放                               |
| `src/main/browser/browser-task-runtime.ts` | 自动化恢复失败进入现有失败终态                                         |
| `src/main/agent/agent-bridge.ts`           | 按当前 run 读取 BrowserTask，阻止误成功                                |
| Browser IPC/renderer 诊断                  | 只增加最小连接与目标 binding 字段                                      |
| `scripts/browser-cdp-recovery-smoke.*`     | Studio 内部 transport 断开和外部观察证明                               |

## 实施顺序

### M0：先固定失败测试

- disconnected 与 `isConnected=false` 触发同一个 single-flight。
- 旧 generation 的 connect、claim、close 回调不能覆盖新状态。
- 导航完成但 claim 失败时工具失败。
- BrowserTask failed 后 Agent complete 被归一化为 error。
- Smoke 入口断开的是 Studio 内部 transport。

退出条件：旧实现在这些测试上稳定失败。M0 完成前不写生产修复。

### M1：最小原位重连闭环

- 实现 Bridge 断线检测、generation、single-flight 重连和旧引用清理。
- 重连后重新 claim 当前目标及现存 View。
- 工具执行前恢复，派发后不重放。

退出条件：真实 Electron 受控页面断开内部 transport 后，下一次截图自动恢复且页面状态不变。

### M2：完成门禁、迁移组合和真人验收

- 修正 BrowserTask/Agent 完成门禁和最小诊断。
- 跑 CDP recovery smoke 与 detachable-tab smoke 组合。
- 在真实 CSDN 页面完成真人验收。

退出条件：自动门禁与真人验收均通过，才能把本文状态改为 Closed。

## 工程门禁

```bash
pnpm typecheck
pnpm test
pnpm smoke:browser-cdp-recovery
pnpm smoke:detachable-tabs-m1
pnpm verify
```

## 本次明确不做

- 不增加 recovery cycle 或 connect attempt ID。
- 不增加 46 动作重试矩阵、logical action 或 action attempt ledger。
- 不增加完整逐 Tab 五态或新的 CAS 状态系统。
- 不重构日志 retention、下载体系或路由配置架构。
- 不接入 `powerMonitor.resume`；若真实证据证明仅靠断线/需求检测不足，再单独评审。
- 不通过 reload、重新导航、重建 Tab 或重启整个 runtime 掩盖故障。

## 最终拷问

开始实现前只需要回答这些问题：

1. 每次底层连接调用是否完整 settle 后才允许下一 generation，确保单 generation 不存在两个并发
   attempt？
2. disconnect、claim 和 Page close 是否都校验 generation 与对象身份？
3. 旧 Page/Context listener 和引用是否在重连时明确释放？
4. 任意工具一旦派发，是否绝无自动重放路径？
5. 导航成功但重新绑定失败时，BrowserTask 和 Agent run 是否必然失败？
6. Smoke 是否真正断开 Studio 自己的 transport，并证明外部连接与原 WebContents 仍健康？

这六项有失败测试和明确实现落点后即可开始，不再扩大设计范围。
