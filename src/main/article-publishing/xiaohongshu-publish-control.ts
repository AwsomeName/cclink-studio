import type { Page } from 'playwright-core'

export const XIAOHONGSHU_SAVE_SELECTOR = 'xhs-publish-btn[save-text="暂存离开"]'
export const XIAOHONGSHU_PUBLISH_SELECTOR = 'xhs-publish-btn[submit-text="发布"]'

interface DomNode {
  nodeName: string
  nodeValue?: string
  backendNodeId: number
  attributes?: string[]
  children?: DomNode[]
  shadowRoots?: DomNode[]
}

/** Only buttons actually inside the visible platform component; outside decoys cannot match. */
export function findXiaohongshuControl(root: DomNode, action: 'save' | 'publish'): DomNode {
  const hosts: DomNode[] = []
  const walk = (node: DomNode, visit: (node: DomNode) => void) => {
    visit(node)
    for (const child of node.children ?? []) walk(child, visit)
  }
  walk(root, (node) => {
    if (node.nodeName === 'XHS-PUBLISH-BTN') hosts.push(node)
  })
  if (hosts.length !== 1) throw new Error('小红书提交组件不是唯一元素')
  const label = action === 'save' ? '暂存离开' : '发布'
  const attrs = Object.fromEntries(
    Array.from({ length: (hosts[0].attributes?.length ?? 0) / 2 }, (_, i) => [
      hosts[0].attributes![i * 2],
      hosts[0].attributes![i * 2 + 1],
    ]),
  )
  const prefix = action === 'save' ? 'save' : 'submit'
  if (
    attrs[`${prefix}-text`] !== label ||
    attrs[`${prefix}-disabled`] !== 'false' ||
    attrs['submit-loading'] === 'true'
  )
    throw new Error('小红书控件文案、可用性或加载状态不符合预期')
  const matches: DomNode[] = []
  for (const shadow of hosts[0].shadowRoots ?? [])
    walk(shadow, (node) => {
      if (
        node.nodeName === 'BUTTON' &&
        (node.children ?? [])
          .map((child) => child.nodeValue ?? '')
          .join('')
          .trim() === label
      )
        matches.push(node)
    })
  if (matches.length !== 1) throw new Error('小红书保存/发布按钮无法唯一对应')
  const buttonAttrs = matches[0].attributes ?? []
  if (
    buttonAttrs.includes('disabled') ||
    buttonAttrs.some((v, i) => v === 'aria-disabled' && buttonAttrs[i + 1] === 'true')
  )
    throw new Error('小红书目标按钮不可用')
  return matches[0]
}

/** Called only after the existing action authorization. Physical click; no platform handler calls. */
export async function clickXiaohongshuControl(
  page: Page,
  action: 'save' | 'publish',
  assertCurrent: () => void | Promise<void>,
): Promise<void> {
  const url = new URL(page.url())
  if (url.origin !== 'https://creator.xiaohongshu.com' || url.pathname !== '/publish/publish')
    throw new Error('小红书保存/发布控件不在原编辑页')
  await assertCurrent()
  const host = page.locator('xhs-publish-btn')
  if ((await host.count()) !== 1 || !(await host.isVisible()))
    throw new Error('小红书提交组件不可见或不唯一')
  await host.scrollIntoViewIfNeeded()
  const session = await page.context().newCDPSession(page)
  try {
    const { root } = await session.send('DOM.getDocument', { depth: -1, pierce: true })
    const button = findXiaohongshuControl(root, action)
    const { quads } = await session.send('DOM.getContentQuads', {
      backendNodeId: button.backendNodeId,
    })
    if (quads.length !== 1 || quads[0].length !== 8) throw new Error('小红书控件布局不唯一')
    const q = quads[0]
    const x = (q[0] + q[2] + q[4] + q[6]) / 4,
      y = (q[1] + q[3] + q[5] + q[7]) / 4
    const hit = await session.send('DOM.getNodeForLocation', {
      x: Math.round(x),
      y: Math.round(y),
      includeUserAgentShadowDOM: true,
    })
    if (hit.backendNodeId !== button.backendNodeId) throw new Error('小红书控件被其他元素遮挡')
    await assertCurrent()
    if (page.url() !== url.href) throw new Error('小红书页面已变化')
    await page.mouse.click(x, y)
  } finally {
    await session.detach()
  }
}
