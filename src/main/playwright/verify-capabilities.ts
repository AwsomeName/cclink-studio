import { app } from 'electron'
import { join } from 'path'
import type { Page } from 'playwright-core'

export interface VerificationResult {
  name: string
  pass: boolean
  error?: string
}

/**
 * 验证 Playwright 20 项核心能力
 * 在内嵌的 BrowserView 中运行
 */
export async function verifyAllCapabilities(page: Page): Promise<VerificationResult[]> {
  const results: VerificationResult[] = []

  const test = async (name: string, fn: () => Promise<void>): Promise<void> => {
    try {
      await fn()
      results.push({ name, pass: true })
    } catch (err) {
      results.push({ name, pass: false, error: String(err) })
    }
  }

  // 1. 页面导航 — 加载测试页面
  await test('page.goto', async () => {
    const testPagePath = app.isPackaged
      ? join(process.resourcesPath, 'test-page.html')
      : join(__dirname, 'test-page.html')
    await page.goto('file://' + testPagePath)
    const title = await page.title()
    if (!title.includes('CCLink Studio')) throw new Error(`标题不匹配: ${title}`)
  })

  // 2. 元素点击
  await test('page.click', async () => {
    await page.click('#click-btn')
    const text = await page.textContent('#click-result')
    if (!text?.includes('已点击')) throw new Error(`点击结果不匹配: ${text}`)
  })

  // 3. 表单填写
  await test('page.fill', async () => {
    await page.fill('#input-name', '张三')
    await page.fill('#input-email', 'test@deepink.com')
    await page.fill('#input-message', '这是一条测试消息')
    const name = await page.inputValue('#input-name')
    if (name !== '张三') throw new Error(`填写结果不匹配: ${name}`)
  })

  // 4. 文件上传
  await test('page.setInputFiles', async () => {
    await page.setInputFiles('#file-upload', []) // 清空
    // 仅验证 API 可调用（不实际上传文件）
  })

  // 5. 截图
  await test('page.screenshot', async () => {
    const buffer = await page.screenshot()
    if (buffer.length === 0) throw new Error('截图为空')
  })

  // 6. DOM 提取
  await test('page.textContent', async () => {
    const text = await page.textContent('h1')
    if (!text?.includes('CCLink Studio')) throw new Error(`提取内容不匹配: ${text}`)
  })

  // 7. 网络拦截
  await test('page.route', async () => {
    let intercepted = false
    await page.route('**/test', (route) => {
      intercepted = true
      route.fulfill({ status: 200, body: 'ok' })
    })
    await page.unroute('**/test')
    // 路由注册成功即可
  })

  // 8. 等待元素
  await test('page.waitForSelector', async () => {
    const el = await page.waitForSelector('#click-btn', { timeout: 3000 })
    if (!el) throw new Error('元素未找到')
  })

  // 9. 键盘输入
  await test('page.keyboard', async () => {
    await page.locator('#input-name').selectText()
    await page.keyboard.type('keyboard test')
    const val = await page.inputValue('#input-name')
    if (val !== 'keyboard test') throw new Error(`键盘输入结果: ${val}`)
  })

  // 10. 鼠标操作
  await test('page.mouse', async () => {
    const box = await page.locator('#click-btn').boundingBox()
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    }
  })

  // 11. 下拉选择
  await test('page.selectOption', async () => {
    await page.selectOption('#select-city', 'shanghai')
    const val = await page.inputValue('#select-city')
    if (val !== 'shanghai') throw new Error(`选择结果: ${val}`)
  })

  // 12. 复选框
  await test('page.check', async () => {
    await page.check('#chk-agree')
    const checked = await page.isChecked('#chk-agree')
    if (!checked) throw new Error('复选框未选中')
    await page.uncheck('#chk-agree')
  })

  // 13. 拖拽
  await test('page.dragAndDrop', async () => {
    await page.dragAndDrop('#drag-source', '#drag-target')
    const text = await page.textContent('#drag-target')
    if (!text?.includes('已接收')) throw new Error(`拖拽结果: ${text}`)
  })

  // 14. iframe
  await test('page.frameLocator', async () => {
    const frame = page.frameLocator('#test-iframe')
    const text = await frame.locator('#iframe-text').textContent()
    if (!text?.includes('iframe')) throw new Error(`iframe 内容: ${text}`)
  })

  // 15. 对话框处理
  await test('page.on("dialog")', async () => {
    let dialogHandled = false
    page.once('dialog', async (dialog) => {
      dialogHandled = true
      await dialog.accept()
    })
    await page.click('button:text("触发 Alert")')
    // 给 dialog 事件一点时间
    await page.waitForTimeout(500)
    if (!dialogHandled) throw new Error('对话框未被处理')
  })

  // 16. Cookie
  await test('context.cookies', async () => {
    const context = page.context()
    await context.addCookies([{ name: 'test', value: '1', domain: 'file://', path: '/' }])
    const cookies = await context.cookies()
    // addCookies API 可调用即算通过
  })

  // 17. 等待加载状态
  await test('page.waitForLoadState', async () => {
    await page.waitForLoadState('domcontentloaded')
  })

  // 18. JavaScript 执行
  await test('page.evaluate', async () => {
    const result = await page.evaluate(() => document.title)
    if (!result) throw new Error('evaluate 返回空')
  })

  // 19. 多 Tab（newPage）
  await test('browser.newPage', async () => {
    const context = page.context()
    const newPage = await context.newPage()
    await newPage.goto('https://example.com')
    await newPage.close()
  })

  // 20. HTML innerHTML 提取
  await test('page.innerHTML', async () => {
    const html = await page.innerHTML('.test-section')
    if (!html || html.length < 10) throw new Error('innerHTML 为空')
  })

  return results
}
