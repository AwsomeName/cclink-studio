# 可配置快捷键系统

> 状态：M1 已实现并通过真实应用验收；M2、M3 尚未开始。日期：2026-08-14。
> 关联事实源：`docs/architecture.md`、`docs/features/context-action-system.md`。

## 结论

CCLink Studio 的快捷键必须成为统一命令系统的一种入口，而不是由各组件分别监听
`keydown`。命令名称、作用域、默认快捷键、可用条件和执行入口由 Command Registry
统一定义；配置页只保存用户对命令键位的覆盖，不保存业务行为或可执行条件。

`Cmd/Ctrl+F` 的稳定命令定义为 `workbench.find`。快捷键、命令面板、工具栏和上下文菜单
均调用该命令；现有 `terminal.find` 并入该命令，不长期保留两个“查找”事实源。命令根据
Tab Store 的当前活动对象解析既有 Editor、Terminal 或 Browser 操作面，再由 Markdown、
源码编辑器、Terminal 或 Browser 各自拥有查找词、匹配结果、高亮和定位状态。

本方案不需要 ADR。它是在落实现有“用户命令只有一个定义源”的架构宪法，不是引入例外。

## 当前实现状态

M1“本地操作面可配置查找”已经落地：设置页从 Command Registry 读取可配置命令，
`workbench.find` 已统一 Markdown、源码编辑器和 Terminal 的查找入口；用户覆盖通过
SettingsService 串行、原子保存。录制态由 renderer capture phase 和 main 的有时限保护共同
拦截，避免 `Cmd/Ctrl+B/W/Q`、Escape 和 Delete 触发原业务动作。

2026-08-14 的真实应用 smoke 已验证：在设置页将查找从 `Cmd/Ctrl+F` 改为
`Cmd/Ctrl+G` 后，旧键立即失效、新键立即打开 Markdown 查找，Studio 重启后配置仍存在，
查找不会把文档变为未保存。`pnpm verify` 同期通过（244 个测试文件、1393 项通过、2 项跳过）。

当前还不能宣称“全部快捷键可配置”或“跨全部操作面查找完成”：旧快捷键迁移属于 M2；网页
焦点内的 Browser 查找属于 M3。源码编辑器和 Terminal 已接入统一命令与既有 surface，但本轮
真实 App smoke 只覆盖了 Markdown 的改键闭环。

## 实施前问题

实施前 `Command.shortcut` 只是展示字符串，真正的快捷键分散在
`use-global-shortcuts.ts`、Markdown、源码编辑器、Tiptap 扩展和其他组件中。现状已经出现：

- 命令声明了快捷键，但没有对应执行绑定；
- Terminal 已有 `terminal.find` 上下文命令，但没有统一的 `Cmd/Ctrl+F` 路由；
- Markdown 通过组件级 `window.keydown` 实现查找，绕过 Command Registry；
- Markdown 与源码编辑器分别维护 `Cmd/Ctrl+S`；
- Browser 使用独立 `WebContentsView`，renderer 的键盘监听无法覆盖网页焦点；
- 配置页“快捷键”区域只有两条静态文案，没有读取、修改、冲突检查或持久化逻辑。

继续按组件增加监听会重新引入命令分叉、快捷键冲突和多个事实源。

## 用户端到端验收

最终用户必须能在真实应用中完成以下动作：

1. 打开“设置 → 快捷键”，搜索“查找”。
2. 点击“查找当前内容”，录入新的组合键。
3. 新快捷键立即生效，旧快捷键停止响应。
4. 在 Markdown、源码编辑器、Terminal 和 Browser 中都能查找当前内容。
5. 快捷键冲突时看到冲突命令和作用域，不发生静默覆盖。
6. 清除自定义键位、恢复单项默认或恢复全部默认。
7. 重启 Studio 后自定义配置仍然存在。
8. 录制或执行快捷键不会误改正文、触发保存、提交 Terminal 命令或操作网页。
9. 输入法组合阶段、普通文本输入和弹窗键盘操作不被全局快捷键抢占。

在上述真实应用验收通过前，只能声明对应工程门禁完成，不能声明可配置快捷键产品闭环完成。

## 能力边界

第一版支持：

- 单段组合键，例如 `Primary+F`、`Primary+Shift+P`；
- `Primary` 在 macOS 映射为 Command，在 Windows/Linux 映射为 Control；
- 全局、工作台、编辑器、Markdown、Terminal 和 Browser 作用域；
- 单命令修改、清除、恢复默认和全部恢复默认；
- 同一快捷键在互斥作用域中复用；
- 冲突检测、持久化、重启恢复和运行时立即生效。

第一版不支持：

- `Cmd+K Cmd+S` 一类连续键序列；
- 工作空间级快捷键配置或配置 Profile；
- 插件动态注入快捷键；
- 修改系统保留快捷键；
- 为同一命令配置超过四个组合键。

## 领域模型

快捷键使用结构化数据，不持久化 `"Cmd+F"` 这类展示字符串：

```ts
type ShortcutModifier = 'primary' | 'control' | 'alt' | 'shift'

interface KeyChord {
  code: string
  modifiers: ShortcutModifier[]
}

type ShortcutScope =
  | 'global'
  | 'workbench'
  | 'editor'
  | 'markdown'
  | 'terminal'
  | 'browser'

interface CommandShortcutPolicy {
  scope: ShortcutScope
  inputPolicy: 'allow' | 'deny'
  defaultBindings: KeyChord[]
}

interface KeybindingOverride {
  commandId: string
  bindings: KeyChord[]
}
```

现有 `Command` 扩展为：

```ts
interface Command {
  id: string
  label: string
  category?: string
  shortcutPolicy?: CommandShortcutPolicy
  configurable?: boolean
  action: (context?: CommandContext) => unknown | Promise<unknown>
}
```

第一版每个命令只能声明一个固定作用域和一个固定输入策略。用户覆盖只能改变组合键，不能
改变作用域、输入策略、权限、风险、可用条件或执行函数。这样冲突判断不依赖用户可编辑的
动态作用域，也避免同一命令在多个作用域产生难以解释的优先级。

## 状态所有权

| 状态 | 唯一所有者 | 生命周期 |
| --- | --- | --- |
| 命令名称、作用域、默认键位和执行入口 | Command Registry | renderer 窗口生命周期 |
| 用户快捷键覆盖 | SettingsService | `userData/settings.json` 持久化 |
| 当前有效键位索引 | Keybinding Resolver 派生 | 随命令或设置变化重建 |
| 正在录制的组合键 | Shortcut Router 的瞬时 capture session | 配置页录制期间 |
| 当前活动对象 | 既有 Tab Store | 跟随工作台 Tab 生命周期 |
| Markdown/Terminal/Browser 查找状态 | 既有 Editor、Terminal、Browser 操作面 | 跟随对应 Tab |
| Browser 有效键位缓存 | main Browser Shortcut Adapter | 只作传输缓存，不持久化 |

不得建立独立快捷键配置文件或第二个持久化 Store。SettingsService 继续是应用设置事实源；
renderer 的 Resolver 只保存可重建索引。

不得新增通用 Shortcut Surface Registry。Editor 继续复用 `editor-context-surface.ts`，Terminal
继续复用 `terminal-context-surface.ts`，Browser 继续由 BrowserManager 拥有运行态；当前活动
对象只从 Tab Store 解析。

## 命令和既有操作面

### `workbench.find`

`workbench.find` 默认绑定 `Primary+F`，不直接实现搜索。它从 Tab Store 解析当前活动 Tab，
再调用既有领域操作面。Editor context surface 增加 `openFind()` / `closeFind()` 能力；Terminal
复用现有同名能力；Browser 通过 BrowserManager 的有界 IPC 执行。

- Markdown 复用现有纯文本匹配、Decoration 高亮和前后定位；
- SourceTextEditor 使用 textarea 的 `selectionStart` / `selectionEnd`；
- Terminal 复用 `TerminalContextSurface.openFind()`，原 `terminal.find` 菜单 contribution 改为
  引用 `workbench.find`，随后删除重复命令；
- Browser 通过有界 IPC 调用 Electron `findInPage`；
- 当前 Tab 不支持查找时，命令返回明确的 disabled reason。

后续 `workbench.save`、`workbench.closeTab`、`browser.focusLocation`、编辑器格式命令按同一
模式迁移。既有操作面只贡献领域能力，不解析全局快捷键。

## Shortcut Router

renderer 只保留一个窗口级 Shortcut Router。路由优先级固定为：

1. 快捷键录制 capture session；
2. 当前弹窗或浮层；
3. 当前聚焦的既有 Editor、Terminal 或 Browser 操作面；
4. 当前活动 Tab；
5. 全局命令。

规则：

- `event.defaultPrevented` 或 `event.isComposing` 时不执行普通命令；
- 普通输入框默认不执行应用命令，命令显式声明 `inputPolicy: 'allow'` 才可进入；
- 更具体作用域已经命中时，即使命令当前禁用，也不得降级执行另一含义的全局命令；
- 一次键盘事件最多执行一个 command ID；
- Router 统一调用 `executeCommand(commandId, { source: 'shortcut', target })`；
- 未命中的按键交还浏览器、Tiptap、xterm 或系统原生行为。

录制态是例外：renderer Router 必须在 capture phase 拦截并调用 `preventDefault()`、
`stopPropagation()` 和必要的 `stopImmediatePropagation()`，先于 Tiptap、xterm 和组件监听器
消费按键。M1 同时为主窗口 WebContents 增加有界的录制保护开关，使 `Cmd/Ctrl+Q`、
`Cmd/Ctrl+W` 等原生菜单 accelerator 在录制期间不会退出应用或关闭 Tab。该保护只接受带
sessionId 和超时的启停，不执行任何命令；窗口失焦、配置页卸载或超时必须自动释放。

例如 Markdown 中的 `Cmd/Ctrl+B` 优先执行粗体，不得因为文档只读而突然切换侧栏。

## 配置页

当前静态快捷键区域替换为独立的 `KeybindingsSettings` 组件，不能继续把交互堆进巨型
`SettingsPage.tsx`。

页面提供：

- 按命令名、分类和 command ID 搜索；
- 按全局、工作台、编辑器、Terminal、Browser 分类；
- 显示命令名、作用域、当前键位和“默认/已修改”状态；
- 修改、清除、恢复单项默认；
- 恢复全部快捷键默认；
- 显示当前不可用或尚未注册的命令覆盖。

录制流程：

1. 用户点击快捷键按钮，Router 创建带 sessionId 和超时的 capture session；
2. renderer capture phase 和 main 录制保护同步启用；
3. 下一次按键只用于录制，不执行命令、Tiptap 格式、Terminal 输入或系统 accelerator；
4. `Escape` 取消，`Backspace/Delete` 清除，事件本身不得继续传播；
5. Resolver 检查作用域冲突；
6. 无冲突时持久化并立即重建有效键位；
7. 有冲突时显示冲突命令，用户只能取消，或确认改绑并清除原命令；
8. SettingsService 保存失败时保留旧的有效配置并显示错误；
9. 成功、取消、失焦、卸载或超时都必须释放 renderer 和 main 的录制保护。

同一组合键可在静态可证明互斥的作用域中复用。作用域相同或优先级相同且可能同时命中时，
必须判定为冲突。录制 `Cmd/Ctrl+B` 时不能触发 Tiptap 粗体；录制 `Cmd/Ctrl+W`、
`Cmd/Ctrl+Q`、`Escape` 或 `Delete` 时也不能产生录制语义之外的副作用。

`SETTINGS_SEARCH_INDEX` 同时加入“快捷键/keyboard/keybinding/command”等检索词。

## 持久化与校验

在 `AppSettings` 增加：

```ts
keybindingOverrides: KeybindingOverride[]
```

默认值为空数组，表示全部使用命令默认值。shared IPC schema 和磁盘加载同时校验：

- 最多 256 个命令覆盖；
- 单命令最多 4 个组合键；
- command ID、code 和 modifier 使用白名单或有界格式；
- 禁止没有修饰键的普通字符；
- 禁止 `Cmd+Q`、`Cmd+Space` 等系统保留组合；
- 同一 command ID 只保留一条规范化覆盖；
- 未注册命令不执行，保留为可诊断的 orphan override。

实现时复用 SettingsService，并把设置写入收敛为串行、临时文件写入后原子替换。快速连续改键
不能让较早写入覆盖较新状态。“恢复全部快捷键默认”只能执行
`updateSettings({ keybindingOverrides: [] })`，严禁调用现有 `resetSettings()`；后者会重置其他
设置并清理凭证，不属于快捷键页权限范围。

## Browser `WebContentsView` 适配

Browser 网页焦点位于独立 WebContents，renderer Router 无法直接收到键盘事件。M3 增加
只服务于 `workbench.find` 的有界 Browser Shortcut Adapter：

1. renderer 根据命令和用户覆盖生成带单调 `configVersion` 的 Browser 键位快照；
2. 通过严格 schema IPC 同步到 main，main 只接受字面量 command ID `workbench.find`；
3. main 应答实际应用的 `configVersion`，renderer 收到确认后才显示“Browser 已生效”；
4. main 在 Browser WebContents 的 `before-input-event` 中同步判断并阻止已注册按键；
5. main 只向 renderer 发送 `workbench.find`、configVersion、tabId、workspaceKey 和触发序号；
6. renderer 校验 configVersion、当前 workspace、活动 tab 和 Browser runtime generation；
7. 校验通过后仍由统一 Command Registry 执行 `workbench.find`；
8. 查找调用 `webContents.findInPage()` / `stopFindInPage()`；
9. 结果事件携带 requestId 和 Browser runtime generation，只返回当前序号和总数，不返回网页正文。

建议契约：

```text
shortcuts:syncBrowserBindings
shortcuts:browserTriggered
browser:startFind
browser:stopFind
browser:findResult
```

Browser adapter 的同步缓存不是第二事实源。同步失败时 renderer 显示“配置已保存，但浏览器
快捷键尚未同步”，并提供重试；其他本地能力继续使用新配置。首版不得设计通用任意命令
转发通道；以后扩展 Browser 快捷键必须修改 shared 白名单契约和测试。

## 权限和诊断

- 快捷键设置只改变本地按键映射，不扩展命令权限；
- 危险和外部副作用命令仍执行原有确认策略；
- main 不接受 renderer 请求执行任意 command ID；
- 诊断只记录 command ID、作用域、规范化 chord、触发来源、执行结果和失败分类；
- 不记录输入框内容、Markdown 查询词、Terminal 输出或网页正文。

需要区分：`unmatched`、`conflict`、`disabled`、`stale-surface`、`browser-sync-failed`、
`settings-save-failed` 和 `invalid-override`。

## 代码落点

```text
src/shared/keybindings.ts
src/shared/ipc/shortcuts.ts
src/shared/ipc/shortcuts-contract.ts
src/shared/ipc/shortcuts-schema.ts

src/renderer/src/features/shortcuts/
  keybinding-resolver.ts
  shortcut-conflicts.ts
  shortcut-context.ts
  shortcut-router.ts
  use-shortcut-router.ts

src/renderer/src/components/settings/
  KeybindingsSettings.tsx

src/main/browser/
  browser-shortcut-adapter.ts
```

现有 `command-store.ts` 继续拥有命令。`use-global-shortcuts.ts` 在迁移完成后删除或仅保留引导
到统一 Router 的薄挂载，不再包含业务 `if/else`。

## 实施顺序

### M1：可配置查找最小闭环（已完成）

- 建立 shared keybinding 类型、Resolver、冲突规则和唯一 Router；
- 新增 `workbench.find`；
- 迁移 Markdown 的组件级 `Cmd/Ctrl+F`；
- 扩展 Markdown 与 SourceTextEditor 共用的既有 Editor surface、复用 Terminal surface，
  并把 `terminal.find` 合并到 `workbench.find`；
- 增加 renderer capture phase 与 main 录制保护，阻断录制态副作用；
- 将 SettingsService 写入改为串行、原子替换，并保证快捷键恢复不触碰其他设置和凭证；
- 配置页支持搜索、录制、冲突、清除、恢复和持久化；
- 真实 App 验证改键、立即生效、不产生 dirty 和重启恢复。

M1 只可命名为“本地操作面可配置查找”，不能宣称 Browser 或全部快捷键完成。

### M2：收回 renderer 内既有快捷键

- 迁移保存、新建/关闭 Tab、地址栏、侧栏、Agent 面板、刷新和缩放；
- 迁移 Markdown 格式命令并处理 `Cmd/Ctrl+B` 作用域复用；
- 删除组件级全局监听和重复 store 直调；
- 增加声明键位与实际路由一致性门禁。

M2 必须等待 M1 真人验收通过。每迁移一个命令，就在同一批次删除它的旧入口并验证只执行
一次；不得建立长期兼容双路由。

### M3：Browser 闭环

- 定义 configVersion、应用确认、stale tab/runtime generation 和 `workbench.find` 字面量白名单；
- 完成 Browser Shortcut Adapter 与有界 IPC；
- 接入 `findInPage`、停止查找和结果事件；
- 浏览器查找栏显示当前/总数；
- 自定义键位在网页获得焦点时仍生效；
- 完成真实网页 smoke 后，才可声明 `workbench.find` 跨操作面闭环。

## 自动化门禁

单元和集成测试至少覆盖：

- chord 规范化、平台显示和修饰键顺序；
- 作用域优先级、输入框策略、IME、`defaultPrevented` 和一次只执行一个命令；
- 默认值与覆盖合并、清除、单项恢复和全部恢复；
- 同作用域冲突、互斥作用域复用和录制状态隔离；
- 录制 `Cmd/Ctrl+B/W/Q`、Escape 和 Delete 时没有 Tiptap、Tab、应用或系统副作用；
- IPC schema 上限、非法 command ID、系统保留键和 orphan override；
- Browser configVersion 应答、`workbench.find` 白名单、stale tab 和 runtime generation；
- 设置写入失败时运行态不假装已生效。

真实应用 smoke 至少覆盖：

1. 在设置页把“查找当前内容”从 `Cmd/Ctrl+F` 改为另一个组合键；
2. 旧键失效、新键在 Markdown 和 Terminal 生效；
3. 查找定位后文档仍显示“已保存”；
4. 重启后配置仍存在；
5. 制造冲突并确认没有静默覆盖；
6. Browser 网页焦点内使用自定义键查找并前后定位；
7. 恢复默认后 `Cmd/Ctrl+F` 重新生效；
8. 恢复全部快捷键后，主题、Agent 设置、凭证和其他应用配置均保持不变。

`pnpm verify` 或受影响 smoke 未通过时，不得宣称对应阶段完成。

## 止损和残余风险

- Browser 键盘转发若连续失败两次，停止扩展更多 Browser 快捷键，先只完成查找闭环并报告；
- SettingsService 原子写入若演变成大范围持久化重构，拆成独立工程准备任务，不能冒充快捷键
  用户进度；
- 不为首轮连续键、插件键位或工作空间 Profile 预建复杂抽象；
- 迁移期间允许旧监听与 Router 短暂共存，但同一 command 在任一提交中只能有一个生效入口，
  自动化必须防止双执行；
- 配置页、命令面板和菜单显示的快捷键必须由同一 Resolver 生成，不允许保留硬编码文案。
