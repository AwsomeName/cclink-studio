/**
 * 浏览器工具模块
 *
 * 提供 46 个 Playwright 浏览器自动化工具。
 * 实现统一的 ToolModule 接口，可注册到 McpToolHost。
 */

import type {
  ToolModule,
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionPolicy,
} from '../../types'
import type { PlaywrightBridge } from '../../../playwright/playwright-bridge'
import { executePlaywrightAction } from '../../../playwright/playwright-actions'
import type { BrowserTaskRuntime } from '../../../browser/browser-task-runtime'
import type { BrowserManager } from '../../../browser/browser-manager'
import { classifyBrowserError } from '../../../browser/browser-task-errors'
import { summarizeBrowserActionParams } from '../../../browser/browser-task-runtime'

/**
 * 46 个浏览器工具定义
 *
 * 工具名以 browser_ 为前缀，通过 toolNameToActionType() 映射到
 * executePlaywrightAction 的 action type。
 */
const BROWSER_TOOL_DEFINITIONS: ToolDefinition[] = [
  // ── 只读工具 ──────────────────────────────
  {
    name: 'browser_screenshot',
    description: '截取当前页面的屏幕截图，返回 base64 编码的 PNG 图片',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'browser_extract',
    description: '提取页面内容。提供 selector 时返回该元素的文本，否则返回整个页面 HTML',
    inputSchema: {
      type: 'object',
      properties: { selector: { type: 'string', description: '可选的 CSS 选择器' } },
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'browser_title',
    description: '获取当前页面的标题',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'browser_input_value',
    description: '获取匹配 CSS 选择器的输入框的当前值',
    inputSchema: {
      type: 'object',
      properties: { selector: { type: 'string', description: 'CSS 选择器' } },
      required: ['selector'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'browser_wait_for_selector',
    description: '等待匹配 CSS 选择器的元素出现在页面上',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS 选择器' },
        timeout: { type: 'number', description: '超时时间（毫秒），默认 5000' },
      },
      required: ['selector'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },

  // ── 导航工具 ──────────────────
  {
    name: 'browser_navigate',
    description: '在当前浏览器页面中导航到指定 URL',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: '目标 URL' } },
      required: ['url'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'browser_go_back',
    description: '浏览器后退到上一页',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'browser_go_forward',
    description: '浏览器前进到下一页',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'browser_reload',
    description: '刷新当前页面',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },

  // ── 交互工具（写入操作） ──────────────────
  {
    name: 'browser_click',
    description: '点击页面上匹配 CSS 选择器的元素',
    inputSchema: {
      type: 'object',
      properties: { selector: { type: 'string', description: 'CSS 选择器' } },
      required: ['selector'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'browser_fill',
    description: '在匹配 CSS 选择器的输入框中填写文本（会先清空已有内容）',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS 选择器' },
        value: { type: 'string', description: '要填写的文本' },
      },
      required: ['selector', 'value'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'browser_select',
    description: '在下拉选择框中选择指定选项',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS 选择器' },
        value: { type: 'string', description: '要选择的选项值' },
      },
      required: ['selector', 'value'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'browser_check',
    description: '勾选匹配 CSS 选择器的复选框或单选按钮',
    inputSchema: {
      type: 'object',
      properties: { selector: { type: 'string', description: 'CSS 选择器' } },
      required: ['selector'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'browser_uncheck',
    description: '取消勾选匹配 CSS 选择器的复选框',
    inputSchema: {
      type: 'object',
      properties: { selector: { type: 'string', description: 'CSS 选择器' } },
      required: ['selector'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'browser_press',
    description: '在匹配 CSS 选择器的元素上模拟按键',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS 选择器' },
        key: { type: 'string', description: '按键名称，如 Enter、Tab、Escape' },
      },
      required: ['selector', 'key'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },

  // ── 高级交互工具 ───────
  {
    name: 'browser_hover',
    description: '将鼠标悬停在匹配 CSS 选择器的元素上（触发下拉菜单、tooltip 等）',
    inputSchema: {
      type: 'object',
      properties: { selector: { type: 'string', description: 'CSS 选择器' } },
      required: ['selector'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'browser_scroll',
    description: '滚动页面或指定元素。支持上下左右四个方向',
    inputSchema: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          description: '滚动方向：up、down、left、right，默认 down',
          enum: ['up', 'down', 'left', 'right'],
        },
        amount: { type: 'number', description: '滚动距离（像素），默认 300' },
        selector: { type: 'string', description: '可选，滚动指定元素而非整个页面' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'browser_upload_file',
    description: '上传本地文件到网页的文件选择控件。用于上传照片、文档、代码压缩包等',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: '文件输入框（input[type=file]）的 CSS 选择器' },
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: '要上传的本地文件绝对路径数组',
        },
      },
      required: ['selector', 'paths'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'browser_wait_for_navigation',
    description: '等待页面导航完成（点击提交按钮、链接跳转后使用）。等待 DOM 加载和网络空闲',
    inputSchema: {
      type: 'object',
      properties: {
        timeout: { type: 'number', description: '超时时间（毫秒），默认 10000' },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'browser_press_key',
    description:
      '在页面上按下键盘按键（不需要指定元素）。用于 Tab 切换字段、Enter 提交、Escape 关闭弹窗、组合键等',
    inputSchema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: '按键名称，如 Tab、Enter、Escape、ArrowDown、Control+a',
        },
      },
      required: ['key'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'browser_drag_drop',
    description: '将一个元素拖拽到另一个元素上（用于拖拽上传等场景）',
    inputSchema: {
      type: 'object',
      properties: {
        sourceSelector: { type: 'string', description: '被拖拽元素的 CSS 选择器' },
        targetSelector: { type: 'string', description: '目标放置区域的 CSS 选择器' },
      },
      required: ['sourceSelector', 'targetSelector'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },

  // ── 潜在破坏性工具 ──────────────────────
  {
    name: 'browser_evaluate',
    description: '在页面上下文中执行 JavaScript 表达式并返回结果',
    inputSchema: {
      type: 'object',
      properties: { expression: { type: 'string', description: '要执行的 JavaScript 表达式' } },
      required: ['expression'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },

  // ── 对话框处理 ──────────────────────
  {
    name: 'browser_handle_dialog',
    description:
      '处理弹出的对话框（alert/confirm/prompt）。可以接受或关闭对话框，对 prompt 类型可输入文本',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作：accept（确认）或 dismiss（取消）',
          enum: ['accept', 'dismiss'],
        },
        text: {
          type: 'string',
          description: '对 prompt 对话框输入的文本（仅 prompt 类型需要）',
        },
      },
      required: ['action'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'browser_set_auto_dialog',
    description: '设置自动处理所有后续对话框。默认为自动确认（accept），可改为自动取消（dismiss）',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '自动处理模式：accept（自动确认）或 dismiss（自动取消）',
          enum: ['accept', 'dismiss'],
        },
        text: {
          type: 'string',
          description: '对 prompt 对话框自动输入的文本',
        },
      },
      required: ['action'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },

  // ── Cookie 管理 ──────────────────────
  {
    name: 'browser_get_cookies',
    description: '获取当前页面的所有 Cookie。可指定 URL 过滤特定域名的 Cookie',
    inputSchema: {
      type: 'object',
      properties: {
        urls: {
          type: 'array',
          items: { type: 'string' },
          description: '可选，只获取匹配这些 URL 的 Cookie',
        },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'browser_set_cookie',
    description: '设置一个 Cookie。需要提供名称和值，可选指定域名、路径、安全属性等',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Cookie 名称' },
        value: { type: 'string', description: 'Cookie 值' },
        url: { type: 'string', description: 'Cookie 关联的 URL（与 domain 二选一）' },
        domain: { type: 'string', description: 'Cookie 域名（如 .example.com）' },
        path: { type: 'string', description: 'Cookie 路径，默认 /' },
        secure: { type: 'boolean', description: '是否仅限 HTTPS' },
        httpOnly: { type: 'boolean', description: '是否禁止 JavaScript 访问' },
        sameSite: {
          type: 'string',
          description: 'SameSite 策略：Strict、Lax、None',
          enum: ['Strict', 'Lax', 'None'],
        },
      },
      required: ['name', 'value'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'browser_clear_cookies',
    description: '清除 Cookie。不传参数清除所有，传 names 清除指定名称，传 domain 清除指定域名',
    inputSchema: {
      type: 'object',
      properties: {
        names: {
          type: 'array',
          items: { type: 'string' },
          description: '要清除的 Cookie 名称列表',
        },
        domain: { type: 'string', description: '只清除该域名下的 Cookie' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },

  // ── 网络拦截 ──────────────────────
  {
    name: 'browser_intercept_request',
    description:
      '拦截匹配 URL 模式的网络请求。可阻止请求（block）、修改请求头（modify）或放行（continue）',
    inputSchema: {
      type: 'object',
      properties: {
        urlPattern: {
          type: 'string',
          description: 'URL 匹配模式（支持 glob 通配符，如 **/*.png）',
        },
        action: {
          type: 'string',
          description: '拦截行为：block（阻止）、modify（修改请求头后继续）、continue（放行）',
          enum: ['block', 'modify', 'continue'],
        },
        headers: {
          type: 'object',
          description: '修改请求时要设置的请求头（仅 action=modify 时生效）',
        },
      },
      required: ['urlPattern', 'action'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'browser_mock_response',
    description: '模拟接口响应。拦截匹配 URL 的请求并返回自定义的状态码、响应体和头信息',
    inputSchema: {
      type: 'object',
      properties: {
        urlPattern: { type: 'string', description: 'URL 匹配模式' },
        statusCode: { type: 'number', description: '响应状态码，默认 200' },
        body: { type: 'string', description: '响应体内容' },
        contentType: { type: 'string', description: 'Content-Type，默认 application/json' },
        headers: {
          type: 'object',
          description: '额外的响应头',
        },
      },
      required: ['urlPattern'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'browser_get_network_logs',
    description: '获取捕获的网络请求日志。可传入 filter 参数按 URL 子串过滤',
    inputSchema: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: '按 URL 子串过滤日志' },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'browser_clear_intercepts',
    description: '清除所有已注册的请求拦截规则',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },

  // ── 多 Tab 管理 ──────────────────────
  {
    name: 'browser_new_tab',
    description: '打开一个新的浏览器标签页。可指定初始 URL',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '可选，新标签页打开的 URL' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'browser_close_tab',
    description: '关闭指定的浏览器标签页',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: { type: 'string', description: '要关闭的标签页 ID' },
      },
      required: ['tabId'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'browser_list_tabs',
    description: '列出所有打开的浏览器标签页，返回每个标签页的 ID、URL 和标题',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'browser_switch_tab',
    description: '切换到指定的浏览器标签页',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: { type: 'string', description: '要切换到的标签页 ID' },
      },
      required: ['tabId'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'browser_get_tab_info',
    description: '获取当前活跃标签页的详细信息（ID、URL、标题）',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },

  // ── 文件下载 ──────────────────────
  {
    name: 'browser_wait_for_download',
    description:
      '等待文件下载事件触发。返回下载 ID 和文件名，后续可用 save_download 保存到指定路径',
    inputSchema: {
      type: 'object',
      properties: {
        timeout: { type: 'number', description: '等待超时时间（毫秒），默认 30000' },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'browser_download_info',
    description: '获取已捕获下载的详细信息（文件名、URL）',
    inputSchema: {
      type: 'object',
      properties: {
        downloadId: { type: 'string', description: '下载 ID（由 wait_for_download 返回）' },
      },
      required: ['downloadId'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'browser_save_download',
    description: '将已捕获的下载保存到本地指定路径',
    inputSchema: {
      type: 'object',
      properties: {
        downloadId: { type: 'string', description: '下载 ID' },
        path: { type: 'string', description: '保存到本地的绝对路径' },
      },
      required: ['downloadId', 'path'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },

  // ── iframe / Frame ──────────────────────
  {
    name: 'browser_list_frames',
    description: '列出当前页面中所有的 iframe 和 frame，返回每个 frame 的名称和 URL',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: 'browser_frame_execute',
    description: '在指定的 iframe 中执行操作（点击、填写等）。需要 iframe 的 CSS 选择器',
    inputSchema: {
      type: 'object',
      properties: {
        frameSelector: { type: 'string', description: 'iframe 元素的 CSS 选择器' },
        frameAction: {
          type: 'string',
          description: '要执行的操作：click 或 fill',
          enum: ['click', 'fill'],
        },
        selector: { type: 'string', description: 'iframe 内部元素的 CSS 选择器' },
        value: { type: 'string', description: '填写文本（frameAction=fill 时需要）' },
      },
      required: ['frameSelector', 'frameAction', 'selector'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'browser_frame_content',
    description: '提取指定 iframe 的内容。可通过 frameUrl 或 frameName 定位 iframe',
    inputSchema: {
      type: 'object',
      properties: {
        frameUrl: { type: 'string', description: '通过 URL 子串匹配 iframe' },
        frameName: { type: 'string', description: '通过 name 属性匹配 iframe' },
        selector: { type: 'string', description: '可选，只提取 iframe 中特定元素的文本' },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },

  // ── 控制台日志 ──────────────────────
  {
    name: 'browser_get_console_logs',
    description: '获取页面的控制台日志（console.log、warn、error、info），用于调试页面问题',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },

  // ── 弹窗处理 ──────────────────────
  {
    name: 'browser_wait_for_popup',
    description: '等待弹窗（window.open）打开，返回新弹窗的 tabId 和 URL',
    inputSchema: {
      type: 'object',
      properties: {
        timeout: { type: 'number', description: '等待超时时间（毫秒），默认 5000' },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },

  // ── 坐标鼠标操作 ──────────────────────
  {
    name: 'browser_mouse_click',
    description: '在页面指定坐标位置点击。适用于无法用 CSS 选择器定位元素的场景',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: '点击的 X 坐标' },
        y: { type: 'number', description: '点击的 Y 坐标' },
        button: {
          type: 'string',
          description: '鼠标按键：left、right、middle，默认 left',
          enum: ['left', 'right', 'middle'],
        },
        clickCount: { type: 'number', description: '点击次数，默认 1（双击为 2）' },
      },
      required: ['x', 'y'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'browser_mouse_move',
    description: '将鼠标移动到页面指定坐标位置',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: '目标 X 坐标' },
        y: { type: 'number', description: '目标 Y 坐标' },
      },
      required: ['x', 'y'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
]

/**
 * MCP 工具名 → Playwright action type 映射
 *
 * browser_navigate → navigate
 * browser_wait_for_selector → waitForSelector
 */
export function toolNameToActionType(toolName: string): string {
  const withoutPrefix = toolName.replace(/^browser_/, '')
  return withoutPrefix.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}

/**
 * 浏览器工具模块
 *
 * 实现 ToolModule 接口，将 46 个 Playwright 操作
 * 封装为可注册到 McpToolHost 的工具模块。
 */
export class BrowserToolModule implements ToolModule {
  readonly name = 'browser'
  readonly tools: ToolDefinition[] = BROWSER_TOOL_DEFINITIONS

  constructor(
    private playwrightBridge: PlaywrightBridge,
    private browserTaskRuntime?: BrowserTaskRuntime | null,
    private browserManager?: BrowserManager | null,
  ) {}

  async getExecutionPolicy(
    toolName: string,
    params: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolExecutionPolicy | null> {
    const actionType = toolNameToActionType(toolName)
    if (!['click', 'press', 'pressKey', 'mouseClick', 'evaluate'].includes(actionType)) {
      return null
    }
    const hasWorkspaceContext = context?.workspaceKey !== undefined
    const workspaceKey = context?.workspaceKey ?? null
    const tabId = hasWorkspaceContext
      ? ((await this.browserManager?.waitForActiveViewForWorkspace?.(workspaceKey)) ??
        this.browserManager?.getViewIdForWorkspace?.(workspaceKey) ??
        null)
      : ((await this.browserManager?.waitForActiveView?.()) ??
        this.browserManager?.getActiveViewId() ??
        this.playwrightBridge.getActiveTabId())
    if (!tabId) return null

    await this.syncVisibleTab(tabId, true, hasWorkspaceContext ? workspaceKey : undefined).catch(
      () => undefined,
    )
    const reason = await this.getV2exSubmissionConfirmationReason(
      actionType,
      params,
      this.playwrightBridge.getPage(),
      tabId,
    )
    if (!reason) return null
    return {
      requireConfirmation: true,
      riskLevel: 'destructive',
      reason,
      allowAlways: false,
    }
  }

  async execute(
    toolName: string,
    params: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<unknown> {
    const actionType = toolNameToActionType(toolName)
    const hasWorkspaceContext = context?.workspaceKey !== undefined
    const workspaceKey = context?.workspaceKey ?? null
    const visibleTabId = hasWorkspaceContext
      ? ((await this.browserManager?.waitForActiveViewForWorkspace?.(workspaceKey)) ??
        this.browserManager?.getViewIdForWorkspace?.(workspaceKey) ??
        null)
      : ((await this.browserManager?.waitForActiveView?.()) ??
        this.browserManager?.getActiveViewId() ??
        this.playwrightBridge.getActiveTabId())

    if (hasWorkspaceContext && !visibleTabId) {
      if (actionType === 'listTabs') {
        return {
          tabs: this.browserManager?.listViewsForWorkspace?.(workspaceKey) ?? [],
          activeTabId: null,
        }
      }
      throw new Error(
        `浏览器资源未绑定到任务所属项目（workspace=${workspaceKey ?? 'global'}）。请切换到该项目并打开浏览器后重试。`,
      )
    }
    if (visibleTabId) {
      await this.syncVisibleTab(
        visibleTabId,
        requiresPlaywrightPage(actionType),
        hasWorkspaceContext ? workspaceKey : undefined,
      )
    }

    const page = this.playwrightBridge.getPage()
    const tabId =
      visibleTabId ?? (hasWorkspaceContext ? null : this.playwrightBridge.getActiveTabId())
    const mandatoryConfirmationReason = await this.getV2exSubmissionConfirmationReason(
      actionType,
      params,
      page,
      tabId,
    )
    if (mandatoryConfirmationReason && context?.confirmationGranted !== true) {
      throw new Error(`${mandatoryConfirmationReason}，必须先取得本次用户确认`)
    }
    let actionLogId: string | null = null
    if (tabId) {
      const task = this.browserTaskRuntime?.assertCanRunAction(tabId)
      if (task) {
        const log = this.browserTaskRuntime!.startActionLog({
          taskRunId: task.id,
          tabId,
          action: actionType,
          paramsSummary: summarizeBrowserActionParams(actionType, params),
        })
        actionLogId = log.id
      }
    }

    try {
      const result = await this.executeVisibleBrowserAction(
        actionType,
        params,
        page,
        tabId,
        hasWorkspaceContext ? workspaceKey : undefined,
      )
      if (actionLogId) {
        this.browserTaskRuntime!.succeedActionLog(actionLogId)
      }
      return result
    } catch (error) {
      if (actionLogId) {
        this.browserTaskRuntime!.failActionLog(actionLogId, {
          reason: classifyBrowserError(error),
          errorMessage: error instanceof Error ? error.message : String(error),
        })
      }
      throw error
    }
  }

  private async syncVisibleTab(
    tabId: string,
    requirePlaywrightPage: boolean,
    workspaceKey?: string | null,
  ): Promise<void> {
    if (
      workspaceKey === undefined ||
      this.browserManager?.isWorkspaceActive?.(workspaceKey) !== false
    ) {
      this.browserManager?.setActive(tabId)
    }
    try {
      await this.playwrightBridge.switchToPage(tabId)
    } catch (error) {
      if (!requirePlaywrightPage || !this.browserManager) return
      await this.browserManager.ensurePlaywrightPage(tabId)
      await this.playwrightBridge.switchToPage(tabId).catch(() => {
        throw error
      })
    }
  }

  private async executeVisibleBrowserAction(
    actionType: string,
    params: Record<string, unknown>,
    page: ReturnType<PlaywrightBridge['getPage']>,
    tabId: string | null,
    workspaceKey?: string | null,
  ): Promise<unknown> {
    if (workspaceKey !== undefined && actionType === 'newTab') {
      throw new Error('Agent 不能创建脱离项目归属的浏览器 Tab，请由工作台新建浏览器')
    }
    if (
      this.browserManager &&
      workspaceKey !== undefined &&
      (actionType === 'closeTab' || actionType === 'switchTab')
    ) {
      const targetTabId = String(params.tabId ?? '')
      if (!targetTabId || this.browserManager.getViewWorkspaceKey(targetTabId) !== workspaceKey) {
        throw new Error('目标浏览器 Tab 不属于任务项目，已拒绝跨项目操作')
      }
    }
    if (this.browserManager && actionType === 'listTabs') {
      return {
        tabs:
          workspaceKey === undefined
            ? this.browserManager.listViews()
            : this.browserManager.listViewsForWorkspace(workspaceKey),
        activeTabId:
          workspaceKey === undefined
            ? this.browserManager.getActiveViewId()
            : this.browserManager.getViewIdForWorkspace(workspaceKey),
      }
    }

    if (this.browserManager && tabId) {
      switch (actionType) {
        case 'navigate': {
          const url = String(params.url ?? '')
          if (!url) throw new Error('必须提供目标 URL')
          await this.browserManager.navigate(tabId, url)
          return {
            tabId,
            url: this.browserManager.getCurrentURL(tabId),
            title: this.browserManager.getTitle(tabId),
          }
        }
        case 'goBack':
          this.browserManager.goBack(tabId)
          return {
            tabId,
            url: this.browserManager.getCurrentURL(tabId),
            title: this.browserManager.getTitle(tabId),
          }
        case 'goForward':
          this.browserManager.goForward(tabId)
          return {
            tabId,
            url: this.browserManager.getCurrentURL(tabId),
            title: this.browserManager.getTitle(tabId),
          }
        case 'reload':
          this.browserManager.reload(tabId)
          return {
            tabId,
            url: this.browserManager.getCurrentURL(tabId),
            title: this.browserManager.getTitle(tabId),
          }
        case 'getTabInfo':
          return {
            tabId,
            url: this.browserManager.getCurrentURL(tabId),
            title: this.browserManager.getTitle(tabId),
          }
        default: {
          if (!page) {
            throw new Error('可视浏览器页面尚未就绪，请稍后自动重试')
          }
          this.assertPlaywrightMatchesVisibleTab(page, tabId)
        }
      }
    }

    if (!page) {
      throw new Error('可视浏览器页面尚未就绪，请稍后自动重试')
    }
    return executePlaywrightAction(page, { type: actionType, ...params }, this.playwrightBridge)
  }

  private assertPlaywrightMatchesVisibleTab(
    page: NonNullable<ReturnType<PlaywrightBridge['getPage']>>,
    tabId: string,
  ): void {
    if (!this.browserManager) return
    const visibleUrl = this.browserManager.getCurrentURL(tabId)
    const playwrightUrl = page.url()
    if (!visibleUrl || !playwrightUrl) return
    if (normalizeComparableUrl(visibleUrl) === normalizeComparableUrl(playwrightUrl)) return
    throw new Error(
      `浏览器自动化目标与可视页面不一致：可视页面=${visibleUrl}，工具页面=${playwrightUrl}。请刷新或重新打开浏览器 Tab 后重试。`,
    )
  }

  private async getV2exSubmissionConfirmationReason(
    actionType: string,
    params: Record<string, unknown>,
    page: ReturnType<PlaywrightBridge['getPage']>,
    tabId: string | null,
  ): Promise<string | null> {
    if (!page) return null
    const url = tabId ? (this.browserManager?.getCurrentURL(tabId) ?? page.url()) : page.url()
    if (!isV2exUrl(url)) return null

    const path = safeUrlPath(url)
    if (actionType === 'evaluate' && isV2exPublishingPath(path)) {
      return 'V2EX 发布页面脚本执行（可能绕过可见提交控件）'
    }

    if (!['click', 'press', 'pressKey', 'mouseClick'].includes(actionType)) return null
    if ((actionType === 'press' || actionType === 'pressKey') && params.key !== 'Enter') return null

    const result = await page
      .evaluate(
        ({ action, selector, x, y }) => {
          let element: Element | null = null
          try {
            if (action === 'click' || action === 'press') {
              element = selector ? document.querySelector(selector) : null
            } else if (action === 'pressKey') {
              element = document.activeElement
            } else if (action === 'mouseClick') {
              element = document.elementFromPoint(Number(x), Number(y))
            }
          } catch {
            return { sensitive: false, label: '' }
          }

          const target = element?.closest('button, input, [role="button"]') ?? element
          const form = target?.closest('form')
          if (!target || !form) return { sensitive: false, label: '' }

          const text = String(
            target.getAttribute('value') ||
              target.getAttribute('aria-label') ||
              target.textContent ||
              '',
          ).trim()
          const lowerText = text.toLowerCase()
          const type = (target.getAttribute('type') || '').toLowerCase()
          const hasEditor = Boolean(form.querySelector('textarea, [contenteditable="true"]'))
          const publishingPath =
            /^\/new(?:\/|$)/.test(location.pathname) ||
            /^\/t\/\d+/.test(location.pathname) ||
            /^\/(?:edit|update)\//.test(location.pathname)
          const isPreview = /预览|preview/.test(lowerText)
          const isEnter = action === 'press' || action === 'pressKey'
          const isSubmitControl =
            type === 'submit' ||
            /创建主题|发布主题|发表|发布|提交回复|回复|保存修改|保存|post|submit|reply/.test(
              lowerText,
            )

          return {
            sensitive: publishingPath && hasEditor && !isPreview && (isEnter || isSubmitControl),
            label: text,
          }
        },
        {
          action: actionType,
          selector: String(params.selector ?? ''),
          x: Number(params.x ?? 0),
          y: Number(params.y ?? 0),
        },
      )
      .catch(() => ({ sensitive: false, label: '' }))

    if (!result.sensitive) return null
    return `V2EX 最终发布动作${result.label ? `（${result.label}）` : ''}`
  }
}

function requiresPlaywrightPage(actionType: string): boolean {
  return !['navigate', 'goBack', 'goForward', 'reload', 'getTabInfo', 'listTabs'].includes(
    actionType,
  )
}

function normalizeComparableUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return url.replace(/\/$/, '')
  }
}

function isV2exUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return hostname === 'v2ex.com' || hostname.endsWith('.v2ex.com')
  } catch {
    return false
  }
}

function safeUrlPath(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return ''
  }
}

function isV2exPublishingPath(path: string): boolean {
  return /^\/new(?:\/|$)/.test(path) || /^\/t\/\d+/.test(path) || /^\/(?:edit|update)\//.test(path)
}
