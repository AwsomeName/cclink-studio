import { clickXiaohongshuControl, XIAOHONGSHU_SAVE_SELECTOR, XIAOHONGSHU_PUBLISH_SELECTOR } from '../article-publishing/xiaohongshu-publish-control'
/**
 * Playwright 操作执行器
 *
 * 从 agent-ipc.ts 提取的共享函数，供 IPC 和 MCP server 复用。
 * 支持 46 种浏览器自动化操作。
 */

import type { PlaywrightBridge } from './playwright-bridge'

/**
 * 执行单个 Playwright 操作
 *
 * @param page - Playwright Page 实例
 * @param action - 操作指令，type 字段标识操作类型
 * @param bridge - 可选的 PlaywrightBridge 实例，用于需要 context 或状态管理的操作
 * @returns 操作结果
 */
export async function executePlaywrightAction(
  page: import('playwright-core').Page | null,
  action: { type: string; [key: string]: any },
  bridge?: PlaywrightBridge,
  assertDispatchStillCurrent?: () => void,
  trustedArticleBodyHtml?: string,
): Promise<any> {
  switch (action.type) {
    // ── 基础导航操作 ──────────────────────────────

    case 'navigate':
      await page!.goto(action.url)
      return { url: page!.url() }

    case 'click':
      if (new URL(page!.url()).origin === 'https://creator.xiaohongshu.com' && [XIAOHONGSHU_SAVE_SELECTOR,XIAOHONGSHU_PUBLISH_SELECTOR].includes(action.selector)) {
        if (!assertDispatchStillCurrent) throw new Error('小红书保存/发布需要主进程动作许可')
        await clickXiaohongshuControl(page!, action.selector === XIAOHONGSHU_SAVE_SELECTOR ? 'save' : 'publish', assertDispatchStillCurrent)
        return {clicked:action.selector}
      }
      await page!.click(action.selector)
      return { clicked: action.selector }

    case 'fill':
      if (trustedArticleBodyHtml !== undefined && new URL(page!.url()).origin === 'https://creator.xiaohongshu.com') {
        if (new URL(page!.url()).pathname !== '/publish/publish' || action.selector !== '.tiptap.ProseMirror[contenteditable="true"]' || !assertDispatchStillCurrent) throw new Error('小红书正文目标或派发许可不匹配')
        assertDispatchStillCurrent()
        await page!.locator(action.selector).fill(trustedArticleBodyHtml)
        return {filled:action.selector}
      }
      if (
        trustedArticleBodyHtml !== undefined &&
        new URL(page!.url()).origin === 'https://juejin.cn'
      ) {
        if (
          !/^\/editor\/drafts\/\d+$/u.test(new URL(page!.url()).pathname) ||
          action.selector !== '.CodeMirror textarea'
        )
          throw new Error('正文目标不是掘金原稿 Markdown 编辑器')
        await page!.locator('.bytemd-toolbar-tab:text-is("编辑")').click()
        assertDispatchStillCurrent?.()
        const input = page!.locator('.CodeMirror textarea')
        await input.press('ControlOrMeta+a')
        assertDispatchStillCurrent?.()
        await input.press('Backspace')
        const empty = await page!.evaluate(
          () =>
            (
              document.querySelector('.CodeMirror') as
                | (HTMLElement & { CodeMirror?: { getValue(): string } })
                | null
            )?.CodeMirror?.getValue() === '',
        )
        if (!empty) throw new Error('掘金正文未清空，停止写入')
        assertDispatchStillCurrent?.()
        await input.fill(trustedArticleBodyHtml)
        assertDispatchStillCurrent?.()
        await page!.locator('.bytemd-toolbar-tab:text-is("预览")').click()
        return { filled: action.selector }
      }
      if (trustedArticleBodyHtml !== undefined) {
        if (
          new URL(page!.url()).origin !== 'https://zhuanlan.zhihu.com' ||
          action.selector !== '.public-DraftEditor-content[contenteditable="true"]'
        )
          throw new Error('格式化正文目标不是受支持的知乎编辑器')
        const body = page!.locator(action.selector)
        await body.click()
        assertDispatchStillCurrent?.()
        await body.press('ControlOrMeta+a')
        assertDispatchStillCurrent?.()
        await body.press('Backspace')
        const empty = await body.evaluate(
          (element) =>
            !element.querySelector('img') &&
            !(element.textContent ?? '').replace(/[\s\u200b]/gu, ''),
        )
        if (!empty) throw new Error('知乎旧正文未完整清空，已停止粘贴，避免重复正文或图片')
        assertDispatchStillCurrent?.()
        await body.evaluate((element, html) => {
          const data = new DataTransfer()
          data.setData('text/html', html)
          data.setData(
            'text/plain',
            new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '',
          )
          element.dispatchEvent(
            new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }),
          )
        }, trustedArticleBodyHtml)
        return { filled: action.selector }
      }
      await page!.fill(action.selector, action.value)
      return { filled: action.selector }

    case 'screenshot': {
      const buffer = await page!.screenshot({ type: 'png' })
      return { screenshot: buffer.toString('base64') }
    }

    case 'extract':
      if (action.selector) {
        return { text: await page!.textContent(action.selector) }
      }
      return { html: await page!.content() }

    case 'select':
      await page!.selectOption(action.selector, action.value)
      return { selected: action.value }

    case 'check':
      await page!.check(action.selector)
      return { checked: action.selector }

    case 'uncheck':
      await page!.uncheck(action.selector)
      return { unchecked: action.selector }

    case 'press':
      await page!.press(action.selector, action.key)
      return { pressed: action.key }

    case 'waitForSelector':
      await page!.waitForSelector(action.selector, { timeout: action.timeout ?? 5000 })
      return { found: action.selector }

    case 'evaluate': {
      const result = await page!.evaluate(action.expression)
      return { result }
    }

    case 'goBack':
      await page!.goBack()
      return { url: page!.url() }

    case 'goForward':
      await page!.goForward()
      return { url: page!.url() }

    case 'reload':
      await page!.reload()
      return { url: page!.url() }

    case 'title':
      return { title: await page!.title() }

    case 'inputValue':
      return { value: await page!.inputValue(action.selector) }

    // ── 高级交互操作 ──────────────────────────────

    case 'hover':
      await page!.hover(action.selector)
      return { hovered: action.selector }

    case 'scroll': {
      const direction = action.direction || 'down'
      const amount = action.amount || 300
      if (action.selector) {
        await page!.evaluate(
          ({ sel, dir, amt }) => {
            const el = document.querySelector(sel) as HTMLElement | null
            if (!el) return
            switch (dir) {
              case 'up':
                el.scrollBy(0, -amt)
                break
              case 'down':
                el.scrollBy(0, amt)
                break
              case 'left':
                el.scrollBy(-amt, 0)
                break
              case 'right':
                el.scrollBy(amt, 0)
                break
            }
          },
          { sel: action.selector, dir: direction, amt: amount },
        )
      } else {
        await page!.evaluate(
          ({ dir, amt }) => {
            switch (dir) {
              case 'up':
                window.scrollBy(0, -amt)
                break
              case 'down':
                window.scrollBy(0, amt)
                break
              case 'left':
                window.scrollBy(-amt, 0)
                break
              case 'right':
                window.scrollBy(amt, 0)
                break
            }
          },
          { dir: direction, amt: amount },
        )
      }
      return { scrolled: direction, amount }
    }

    case 'uploadFile': {
      const selector = action.selector as string
      const paths = action.paths as string[]
      if (!paths || paths.length === 0) {
        throw new Error('必须提供至少一个文件路径')
      }
      if (new URL(page!.url()).origin === 'https://juejin.cn' && selector === '.CodeMirror') {
        if (!/^\/editor\/drafts\/\d+$/u.test(new URL(page!.url()).pathname) || paths.length !== 1)
          throw new Error('掘金图片粘贴只允许原稿中的单张冻结图片')
        const mime = /\.png$/iu.test(paths[0])
          ? 'image/png'
          : /\.jpe?g$/iu.test(paths[0])
            ? 'image/jpeg'
            : /\.webp$/iu.test(paths[0])
              ? 'image/webp'
              : null
        if (!mime) throw new Error('不支持的正文图片类型')
        const { readFile } = await import('node:fs/promises')
        const bytes = await readFile(paths[0])
        assertDispatchStillCurrent?.()
        await page!.locator('.bytemd-toolbar-tab:text-is("编辑")').click()
        assertDispatchStillCurrent?.()
        await page!.locator('.CodeMirror textarea').focus()
        assertDispatchStillCurrent?.()
        await page!.locator('.CodeMirror').evaluate(
          (element, payload) => {
            const data = new DataTransfer()
            const bytes = Uint8Array.from(atob(payload.base64), (c) => c.charCodeAt(0))
            data.items.add(new File([bytes], payload.name, { type: payload.mime }))
            const input = element.querySelector('textarea')
            if (!input) throw new Error('掘金图片粘贴输入区已消失')
            input.dispatchEvent(
              new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }),
            )
          },
          { base64: bytes.toString('base64'), mime, name: paths[0].split('/').pop()! },
        )
        return { uploaded: 1, files: [paths[0].split('/').pop()] }
      }
      const locator = page!.locator(selector)
      await locator.setInputFiles(paths)
      return { uploaded: paths.length, files: paths.map((p: string) => p.split('/').pop()) }
    }

    case 'waitForNavigation': {
      const timeout = action.timeout || 10000
      await page!.waitForLoadState('domcontentloaded', { timeout })
      await page!.waitForLoadState('networkidle', { timeout }).catch(() => {
        // networkidle 可能超时（长轮询等），不阻塞
      })
      return { url: page!.url(), title: await page!.title() }
    }

    case 'pressKey':
      await page!.keyboard.press(action.key)
      return { pressed: action.key }

    case 'dragDrop': {
      await page!.dragAndDrop(action.sourceSelector, action.targetSelector)
      return { dragged: action.sourceSelector, dropped: action.targetSelector }
    }

    // ── 对话框处理 ──────────────────────────────

    case 'handleDialog': {
      const activePage = bridge!.getActivePage()!
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('等待对话框超时（5秒）'))
        }, 5000)

        activePage.once('dialog', async (dialog) => {
          clearTimeout(timeout)
          const info = {
            type: dialog.type(),
            message: dialog.message(),
            defaultValue: dialog.defaultValue(),
          }
          if (action.action === 'accept') {
            await dialog.accept(action.text)
          } else {
            await dialog.dismiss()
          }
          resolve(info)
        })
      })
    }

    case 'setAutoDialog': {
      bridge!.setDialogAutoAction(action.action, action.text)
      return { autoDialog: action.action }
    }

    // ── Cookie 管理 ──────────────────────────────

    case 'getCookies': {
      const ctx = bridge!.getContext()!
      const urls = action.urls as string[] | undefined
      const cookies = urls ? await ctx.cookies(urls) : await ctx.cookies()
      return {
        cookieCount: cookies.length,
        persistentCookieCount: cookies.filter((cookie) => cookie.expires > 0).length,
      }
    }

    case 'setCookie': {
      const ctx = bridge!.getContext()!
      await ctx.addCookies([
        {
          name: action.name,
          value: action.value,
          ...(action.url && { url: action.url }),
          ...(action.domain && { domain: action.domain }),
          ...(action.path && { path: action.path }),
          ...(action.secure !== undefined && { secure: action.secure }),
          ...(action.httpOnly !== undefined && { httpOnly: action.httpOnly }),
          ...(action.sameSite && { sameSite: action.sameSite as 'Strict' | 'Lax' | 'None' }),
          ...(action.expires && { expires: action.expires }),
        },
      ])
      return { set: true }
    }

    case 'clearCookies': {
      const ctx = bridge!.getContext()!
      const cookies = await ctx.cookies()
      if (action.names && (action.names as string[]).length > 0) {
        const names = new Set((action.names as string[]).filter((name) => typeof name === 'string'))
        const matchingCookies = cookies.filter(
          (cookie) =>
            names.has(cookie.name) &&
            (!action.domain || cookie.domain === action.domain) &&
            (!action.path || cookie.path === action.path),
        )
        for (const cookie of matchingCookies) {
          await ctx.clearCookies({
            name: cookie.name,
            domain: cookie.domain,
            path: cookie.path,
          })
        }
        return { cleared: matchingCookies.length }
      } else if (action.domain || action.path) {
        const matchingCookies = cookies.filter(
          (cookie) =>
            (!action.domain || cookie.domain === action.domain) &&
            (!action.path || cookie.path === action.path),
        )
        for (const cookie of matchingCookies) {
          await ctx.clearCookies({
            name: cookie.name,
            domain: cookie.domain,
            path: cookie.path,
          })
        }
        return { cleared: matchingCookies.length }
      } else {
        await ctx.clearCookies()
        return { cleared: cookies.length }
      }
    }

    // ── 网络拦截 ──────────────────────────────

    case 'interceptRequest': {
      const activePage = bridge!.getActivePage()!
      const pattern = action.urlPattern as string
      // 移除已有拦截
      const existing = bridge!.getRouteHandler(pattern)
      if (existing) {
        await activePage.unroute(pattern).catch(() => {})
      }
      // 注册新路由
      await activePage.route(pattern, (route) => {
        const handler = bridge!.getRouteHandler(pattern)
        if (!handler) {
          route.continue()
          return
        }
        switch (handler.action) {
          case 'block':
            route.abort()
            break
          case 'mock':
            route.fulfill({
              status: handler.statusCode ?? 200,
              body: handler.body ?? '',
              headers: handler.headers ?? {},
            })
            break
          case 'modify':
            route.continue({ headers: handler.headers })
            break
          default:
            route.continue()
        }
      })
      bridge!.setRouteHandler(pattern, {
        action: action.action,
        headers: action.headers as Record<string, string> | undefined,
      })
      return { intercepting: pattern, action: action.action }
    }

    case 'mockResponse': {
      const pattern = action.urlPattern as string
      const handler = {
        action: 'mock' as const,
        statusCode: (action.statusCode ?? 200) as number,
        body: action.body as string | undefined,
        contentType: action.contentType as string | undefined,
        headers: {
          'Content-Type': action.contentType ?? 'application/json',
          ...(action.headers as Record<string, string> | undefined),
        },
      }
      // 如果没有路由，先创建一个
      const existing = bridge!.getRouteHandler(pattern)
      if (!existing) {
        const activePage = bridge!.getActivePage()!
        await activePage.route(pattern, (route) => {
          const h = bridge!.getRouteHandler(pattern)
          if (!h) {
            route.continue()
            return
          }
          route.fulfill({
            status: h.statusCode ?? 200,
            body: h.body ?? '',
            headers: h.headers ?? {},
          })
        })
      }
      bridge!.setRouteHandler(pattern, handler)
      return { mocking: pattern, statusCode: handler.statusCode }
    }

    case 'getNetworkLogs': {
      const logs = bridge!.getNetworkLog()
      if (action.filter) {
        const filtered = logs.filter((l) => l.url.includes(action.filter))
        return { logs: filtered, total: logs.length, filtered: filtered.length }
      }
      return { logs, total: logs.length }
    }

    case 'clearIntercepts': {
      const activePage = bridge!.getActivePage()!
      const oldHandlers = bridge!.clearRouteHandlers()
      for (const [pattern] of oldHandlers) {
        await activePage.unroute(pattern).catch(() => {})
      }
      return { cleared: oldHandlers.size }
    }

    // ── 多 Tab 管理 ──────────────────────────────

    case 'newTab': {
      const ctx = bridge!.getContext()!
      const newPage = await ctx.newPage()
      if (action.url) await newPage.goto(action.url)
      const tabId = bridge!.registerPage(newPage)
      await bridge!.switchToPage(tabId)
      return { tabId, url: newPage.url() }
    }

    case 'closeTab': {
      const tabId = action.tabId as string
      const targetPage = bridge!.getPageById(tabId)
      if (!targetPage) throw new Error(`Tab 不存在: ${tabId}`)
      await targetPage.close()
      bridge!.unregisterPage(tabId)
      return { closed: tabId }
    }

    case 'listTabs': {
      const tabs = await bridge!.listPages()
      return { tabs, activeTabId: bridge!.getActiveTabId() }
    }

    case 'switchTab': {
      const tabId = action.tabId as string
      await bridge!.switchToPage(tabId)
      return { activeTabId: tabId, url: bridge!.getActivePage()?.url() }
    }

    case 'getTabInfo': {
      const activePage = bridge!.getActivePage()!
      return {
        tabId: bridge!.getActiveTabId(),
        url: activePage.url(),
        title: await activePage.title(),
      }
    }

    // ── 文件下载 ──────────────────────────────

    case 'waitForDownload': {
      const activePage = bridge!.getActivePage()!
      const download = await activePage.waitForEvent('download', {
        timeout: action.timeout ?? 30000,
      })
      const downloadId = bridge!.storeDownload('', download)
      return {
        downloadId,
        suggestedFilename: download.suggestedFilename(),
        url: download.url(),
      }
    }

    case 'downloadInfo': {
      const download = bridge!.getDownload(action.downloadId as string)
      if (!download) throw new Error(`下载不存在: ${action.downloadId}`)
      return {
        suggestedFilename: download.suggestedFilename(),
        url: download.url(),
      }
    }

    case 'saveDownload': {
      const download = bridge!.getDownload(action.downloadId as string)
      if (!download) throw new Error(`下载不存在: ${action.downloadId}`)
      await download.saveAs(action.path as string)
      bridge!.markDownloadSavedAs(action.downloadId as string, action.path as string)
      return { saved: action.path, filename: download.suggestedFilename() }
    }

    // ── iframe / Frame ──────────────────────────────

    case 'listFrames': {
      const frames = page!.frames().filter((frame) => frame !== page!.mainFrame())
      return frames.map((f, i) => ({
        index: i,
        name: f.name(),
        url: f.url(),
      }))
    }

    case 'frameExecute': {
      const frameLocator = page!.frameLocator(action.frameSelector as string)
      const frameAction = action.frameAction as string
      const selector = action.selector as string

      switch (frameAction) {
        case 'click':
          await frameLocator.locator(selector).click()
          return { clicked: selector, frame: action.frameSelector }
        case 'fill':
          // The current CSDN CKEditor does not mark locator.fill's input event dirty.
          // A real, non-editing key event lets its existing change listener/60s autosave run.
          // Pin the element: a replacement iframe must not receive the follow-up key.
          if (
            assertDispatchStillCurrent &&
            /^https:\/\/mp\.csdn\.net\/mp_blog\/creation\/editor(?:\/\d+)?(?:[?#]|$)/u.test(
              page!.url(),
            ) &&
            action.frameSelector === 'iframe.cke_wysiwyg_frame' &&
            selector === 'body.cke_editable[contenteditable="true"]'
          ) {
            const body = await frameLocator.locator(selector).elementHandle()
            if (!body) throw new Error('CSDN 正文编辑区域已经失效')
            try {
              assertDispatchStillCurrent()
              if (trustedArticleBodyHtml !== undefined) {
                await page!.evaluate(async (html) => {
                  const editor = (
                    window as unknown as {
                      CKEDITOR?: {
                        instances?: {
                          editor?: {
                            status: string
                            setData(html: string, done: () => void): void
                            fire(name: string): void
                          }
                        }
                      }
                    }
                  ).CKEDITOR?.instances?.editor
                  if (editor?.status !== 'ready') throw new Error('CSDN 正文编辑器未就绪')
                  await new Promise<void>((resolve) => editor.setData(html, resolve))
                }, trustedArticleBodyHtml)
                assertDispatchStillCurrent()
                await page!.evaluate(() => {
                  const editor = (
                    window as unknown as {
                      CKEDITOR?: { instances?: { editor?: { fire(name: string): void } } }
                    }
                  ).CKEDITOR?.instances?.editor
                  if (!editor) throw new Error('正文编辑器已失效')
                  editor.fire('change')
                })
              } else {
                await body.fill(action.value as string)
                assertDispatchStillCurrent()
                await body.press('ArrowRight')
              }
              return { filled: selector, frame: action.frameSelector }
            } finally {
              await body.dispose()
            }
          }
          await frameLocator.locator(selector).fill(action.value as string)
          return { filled: selector, frame: action.frameSelector }
        default:
          throw new Error(`不支持的 frame 操作: ${frameAction}`)
      }
    }

    case 'frameContent': {
      if (action.frameSelector) {
        if (!action.selector) throw new Error('按 iframe selector 读取时必须指定正文 selector')
        return {
          text: await page!
            .frameLocator(action.frameSelector as string)
            .locator(action.selector as string)
            .textContent(),
        }
      }
      // CKEditor's iframe shares the editor URL with the top document. Never select the
      // top document or an unrelated globally active Page as this task's iframe content.
      const frames = page!.frames().filter((frame) => frame !== page!.mainFrame())
      const matches = action.frameUrl
        ? frames.filter((f) => f.url().includes(action.frameUrl as string))
        : action.frameName
          ? frames.filter((f) => f.name() === action.frameName)
          : []
      if (matches.length > 1)
        throw new Error('多个 iframe 匹配，请使用 listFrames 后指定唯一名称或 URL')
      const targetFrame = matches[0]

      if (!targetFrame) throw new Error('未找到指定的 iframe，请使用 listFrames 查看可用 frame')

      if (action.selector) {
        return { text: await targetFrame.textContent(action.selector as string) }
      }
      return { html: await targetFrame.content() }
    }

    // ── 控制台日志 ──────────────────────────────

    case 'getConsoleLogs': {
      const logs = bridge!.getConsoleLogs()
      return { logs, total: logs.length }
    }

    // ── 弹窗处理 ──────────────────────────────

    case 'waitForPopup': {
      const activePage = bridge!.getActivePage()!
      const popup = await activePage.waitForEvent('popup', {
        timeout: action.timeout ?? 5000,
      })
      const tabId = (await bridge!.waitForClaimedPageId(popup)) ?? bridge!.registerPage(popup)
      return { tabId, url: popup.url() }
    }

    // ── 坐标鼠标操作 ──────────────────────────────

    case 'mouseClick': {
      const activePage = bridge!.getActivePage()!
      await activePage.mouse.click(action.x as number, action.y as number, {
        button: (action.button as 'left' | 'right' | 'middle') ?? 'left',
        clickCount: (action.clickCount as number) ?? 1,
      })
      return { clicked: { x: action.x, y: action.y } }
    }

    case 'mouseMove': {
      const activePage = bridge!.getActivePage()!
      await activePage.mouse.move(action.x as number, action.y as number)
      return { moved: { x: action.x, y: action.y } }
    }

    default:
      throw new Error(`未知操作类型: ${action.type}`)
  }
}

/**
 * 所有支持的 Playwright action type
 */
export const PLAYWRIGHT_ACTION_TYPES = [
  // ── 基础操作（22 项）──
  'navigate',
  'click',
  'fill',
  'screenshot',
  'extract',
  'select',
  'check',
  'uncheck',
  'press',
  'waitForSelector',
  'evaluate',
  'goBack',
  'goForward',
  'reload',
  'title',
  'inputValue',
  // ── 高级交互 ──
  'hover',
  'scroll',
  'uploadFile',
  'waitForNavigation',
  'pressKey',
  'dragDrop',
  // ── 对话框处理 ──
  'handleDialog',
  'setAutoDialog',
  // ── Cookie 管理 ──
  'getCookies',
  'setCookie',
  'clearCookies',
  // ── 网络拦截 ──
  'interceptRequest',
  'mockResponse',
  'getNetworkLogs',
  'clearIntercepts',
  // ── 多 Tab 管理 ──
  'newTab',
  'closeTab',
  'listTabs',
  'switchTab',
  'getTabInfo',
  // ── 文件下载 ──
  'waitForDownload',
  'downloadInfo',
  'saveDownload',
  // ── iframe / Frame ──
  'listFrames',
  'frameExecute',
  'frameContent',
  // ── 控制台日志 ──
  'getConsoleLogs',
  // ── 弹窗处理 ──
  'waitForPopup',
  // ── 坐标鼠标操作 ──
  'mouseClick',
  'mouseMove',
] as const

export type PlaywrightActionType = (typeof PLAYWRIGHT_ACTION_TYPES)[number]
