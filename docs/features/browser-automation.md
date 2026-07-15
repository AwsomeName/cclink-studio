# 内嵌浏览器 & Playwright 自动化

## 概述

CCLink Studio 在应用窗口内嵌入一个完整的 Chrome 浏览器，支持通过 Playwright 进行自动化操作。这是与"打开外部浏览器"或"调用 headless Chrome"完全不同的方案——浏览器渲染在窗口内部，用户可以实时看到并参与操作。

> ✅ **已实现。** WebContentsView 已在窗口内正确嵌入，Playwright 通过 CDP 连接后支持 46 个 MCP 工具（见 `src/main/mcp/modules/browser/index.ts`）。这是 CCLink Studio 的 Web 自动化支柱。

## 设计原则

1. **窗口内嵌入** — 浏览器是窗口的一部分，不是独立窗口
2. **可视化优先** — 用户必须能看到浏览器的一切行为
3. **可控可中断** — 用户随时可接管或中断自动化
4. **Agent 驱动** — 自动化由 AI Agent 发起（通过本地 Claude Code）
5. **完整 Playwright** — 必须支持 Playwright 的所有核心能力，不做阉割

## 技术方案

### WebContentsView 嵌入

使用 Electron 的 `WebContentsView` API（Electron 30+，替代已废弃的 BrowserView）将 Chromium 嵌入主窗口：

```typescript
// packages/main/src/browser/browser-manager.ts

import { WebContentsView, BrowserWindow } from 'electron'

export class BrowserManager {
  private view: WebContentsView | null = null
  private mainWindow: BrowserWindow

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow
  }

  /**
   * 创建内嵌浏览器视图
   */
  create(): void {
    this.view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
      }
    })
    this.mainWindow.contentView.addChildView(this.view)
    this.updateBounds()
  }

  /**
   * 更新浏览器视图在窗口中的位置和大小
   * 对应主工作区区域（由渲染进程通过 ResizeObserver 上报坐标）
   */
  updateBounds(bounds: { x: number; y: number; width: number; height: number }): void {
    this.view?.setBounds(bounds)
    // 注意: WebContentsView 没有 setAutoResize
    // 需要在 win.on('resize') 中手动调用 updateBounds
  }

  /**
   * 获取 CDP 端点 URL
   * Playwright 通过此 URL 连接到内嵌浏览器
   */
  async getCdpEndpoint(): Promise<string> {
    // 通过 Chrome DevTools Protocol 获取调试端口
    // 方式: 启动时设置 --remote-debugging-port
    return `http://127.0.0.1:${this.cdpPort}`
  }

  /**
   * 导航到指定 URL
   */
  async navigate(url: string): Promise<void> {
    await this.view?.webContents.loadURL(url)
  }

  /**
   * 截取当前页面截图
   */
  async screenshot(): Promise<Buffer> {
    const image = await this.view?.webContents.capturePage()
    return image?.toPNG() ?? Buffer.alloc(0)
  }

  destroy(): void {
    if (this.view) {
      this.mainWindow.contentView.removeChildView(this.view)
      this.view = null
    }
  }
}
```

### Playwright CDP 集成

```typescript
// packages/main/src/playwright/playwright-bridge.ts

import { chromium, type Browser, type Page } from 'playwright'

export class PlaywrightBridge {
  private browser: Browser | null = null
  private page: Page | null = null

  /**
   * 通过 CDP 连接到内嵌的 WebContentsView
   */
  async connect(cdpEndpoint: string): Promise<void> {
    this.browser = await chromium.connectOverCDP(cdpEndpoint)
    const contexts = this.browser.contexts()
    this.page = contexts[0]?.pages()[0] ?? await contexts[0]?.newPage()
  }

  /**
   * 执行浏览器操作（由 Agent 发起）
   * 每个操作返回结果供 Agent 分析
   */
  async executeAction(action: BrowserAction): Promise<ActionResult> {
    switch (action.type) {
      case 'navigate':
        await this.page!.goto(action.url)
        return { success: true, screenshot: await this.screenshot() }

      case 'click':
        await this.page!.click(action.selector)
        return { success: true, screenshot: await this.screenshot() }

      case 'fill':
        await this.page!.fill(action.selector, action.value)
        return { success: true }

      case 'screenshot':
        const buffer = await this.page!.screenshot()
        return { success: true, screenshot: buffer.toString('base64') }

      case 'extract':
        const content = await this.page!.textContent(action.selector)
        return { success: true, data: content }

      // ... 更多操作类型
    }
  }

  async disconnect(): Promise<void> {
    await this.browser?.close()
    this.browser = null
    this.page = null
  }
}
```

### 启动时的 CDP 端口配置

```typescript
// packages/main/src/main.ts

import { app, BrowserWindow } from 'electron'

// 在应用启动时，通过命令行开关开启 CDP
app.commandLine.appendSwitch('remote-debugging-port', '0') // 0 = 随机端口

// 获取实际分配的端口
app.on('ready', () => {
  // 读取实际端口（从 DevTools API 或进程信息获取）
  // 传递给 PlaywrightBridge.connect()
})
```

## 功能清单

### P0 — 窗口内浏览器 + 完整 Playwright 🔴 最高优先级

> 必须在 Phase 1 完成。Playwright 的所有核心功能都要验证通过。

- [x] WebContentsView 创建与嵌入主窗口（多视图，按 tabId 索引）
- [x] setBounds() 正确定位到中间工作区
- [x] 窗口 resize 时 WebContentsView 自动跟随（ResizeObserver + IPC）
- [x] CDP 端口自动获取（`--remote-debugging-port=0`）
- [x] Playwright 通过 `chromium.connectOverCDP()` 连接
- [x] 浏览器工具栏 UI（地址栏、前进/后退/刷新）

**完整 Playwright 功能验证清单（全部已实现 ✅）：**

| 功能 | Playwright API | 用途 | 状态 |
|------|---------------|------|------|
| 页面导航 | `page.goto()` | 打开任意 URL | ✅ |
| 元素点击 | `page.click()` | 点击按钮/链接 | ✅ |
| 表单填写 | `page.fill()` | 填写输入框/文本域 | ✅ |
| 文件上传 | `page.setInputFiles()` | 上传简历/附件 | ✅ |
| 截图 | `page.screenshot()` | Agent 感知页面状态 | ✅ |
| DOM 提取 | `page.textContent()` / `innerHTML` | 提取 JD、岗位信息 | ✅ |
| 网络拦截 | `page.route()` / `intercept` | 拦截 API 请求获取数据 | ✅ |
| 多 Tab | `browser.newPage()` / `pages()` | 同时操作多个页面 | ✅ |
| 等待元素 | `page.waitForSelector()` | 等待动态加载内容 | ✅ |
| 键盘输入 | `page.keyboard` | 模拟键盘操作 | ✅ |
| 鼠标操作 | `page.mouse` | 拖拽、悬停等 | ✅ |
| 下拉选择 | `page.selectOption()` | 选择城市、薪资范围 | ✅ |
| 复选框/单选 | `page.check()` / `uncheck()` | 勾选同意条款等 | ✅ |
| 拖拽上传 | `page.dragAndDrop()` | 拖拽文件上传 | ✅ |
| iframe 操作 | `frameLocator()` | 处理嵌套 iframe | ✅ |
| 对话框处理 | `page.on('dialog')` | 处理 alert/confirm | ✅ |
| 新窗口处理 | `page.waitFor('popup')` | 处理新打开的窗口 | ✅ |
| Cookie 操作 | `context.cookies()` / `addCookies()` | 保持登录态 | ✅ |
| 页面等待 | `page.waitForLoadState()` | 等待页面加载完成 | ✅ |
| JavaScript 执行 | `page.evaluate()` | 在页面中执行自定义 JS | ✅ |

> 上述 20 项核心能力已全部封装为 **46 个 MCP 工具**（`browser_*` 前缀），按类别含：只读、导航、交互、对话框、Cookie、网络拦截/mock、多 Tab、文件下载、iframe、控制台日志、弹窗、坐标鼠标等。完整清单见 `src/main/mcp/modules/browser/index.ts` 的 `BROWSER_TOOL_DEFINITIONS`。

### P1 — 浏览器增强

- [ ] Cookie 持久化（保持登录态跨会话；Cookie 读写工具已实现）
- [ ] 书签管理
- [x] 多 Tab 可视化管理（Tab 栏 UI + `browser_new_tab`/`list_tabs`/`switch_tab`）
- [x] 下载管理（`browser_wait_for_download`/`save_download`）
- [ ] 代理设置
- [x] 与 Agent 对话面板联动（工具调用桥接，46 个 `browser_*` 工具）

### P2 — 高级

- [ ] 录制回放（记录用户手动操作，生成 Agent 指令）
- [ ] 页面智能提取（结构化提取页面内容）
- [ ] 多浏览器 Profile 支持
- [ ] DevTools 面板嵌入

## UI 设计

> 浏览器 UI 遵循 VSCode 设计精神。浏览器是主工作区中的一个 Tab，与编辑器 Tab 并列，切换方式与 VSCode 切换文件 Tab 一致。

### 浏览器 Tab

浏览器作为主工作区的 Tab 存在，工具栏类似 VSCode 编辑器的面包屑栏位置：

```
┌──────────────────────────────────────────────────────────┐
│ Tab: [📄 简历.md] [🌐 浏览器 ✕] [📄 笔记.md ✕]           │
├──────────────────────────────────────────────────────────┤
│ ← → 🔄 │ https://example.com                      │ ⋮ │
├──────────────────────────────────────────────────────────┤
│                                                          │
│              (内嵌浏览器内容 — WebContentsView)               │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Agent 操作状态

当 Agent 控制浏览器时，工具栏变为状态指示：

```
┌─────────────────────────────────────────────┐
│ 🤖 Agent 正在操作... │ 正在填写表单  │ ⏸ ⏹ │
└─────────────────────────────────────────────┘
```

## 排错：「只显示左半边」不是 bounds/DPI bug

### 现象

内嵌页右侧被裁切；主进程日志显示 `workbench-content` 宽度与内嵌页 `window.innerWidth` 一致（例如均为 744），`setBounds` 使用 DIP 正确。

### 根因

**面板宽度小于页面固定内容宽度**。例如百度桌面首页 `#wrapper` 约 1250px，而 1400px 窗口扣除侧栏与 Agent 后工作区约 744px。页面横向溢出，效果等同把 Chrome 拖到 744px 宽——不是 WebContentsView 定位错误。

### 如何区分

| 检查项 | bounds 有问题 | 内容过宽（本问题） |
|--------|---------------|-------------------|
| `innerWidth` vs `bounds.width` | 不一致 | **一致** |
| `document.documentElement.scrollWidth` | 通常 ≈ innerWidth | **明显 > innerWidth** |

可通过 CDP 在已连接的内嵌页执行：

```javascript
JSON.stringify({
  innerWidth: window.innerWidth,
  scrollWidth: document.documentElement.scrollWidth,
})
```

### 处理方式

已在 `BrowserManager` 实现，**不要**通过改 DIP、加倍 width 或改坐标上报来「修」：

1. **适应宽度（默认 `fit`）**：`setZoomFactor(paneWidth / scrollWidth)`，只缩不放大。
2. **手动缩放**：工具栏 ± / 百分比。
3. **移动版**：iOS Safari UA + 重载，约 414px 视口并填满面板。

详见 `.cursor/rules/embedded-browser-viewport.mdc`。

## 安全考量

- 内嵌浏览器开启 `sandbox` 模式
- 禁止访问 `file://` 协议（除非用户明确打开本地文件）
- Playwright 操作范围仅限于当前 WebContentsView
- 网络请求不经过主进程代理（避免性能瓶颈）
- Cookie 和登录态隔离（不与系统 Chrome 共享）
