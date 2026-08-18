import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { HORIZONTAL_PAN_SCRIPT, installHorizontalPanSupport } from './browser-horizontal-pan'

class FakeElement {
  nodeType = 1
  parentElement: FakeElement | null = null
  overflowX = 'visible'
  scrollWidth = 0
  clientWidth = 0
  scrollLeft = 0
}

function installScript(): {
  listener: (event: Record<string, unknown>) => void
  root: FakeElement
  body: FakeElement
} {
  const root = new FakeElement()
  const body = new FakeElement()
  body.parentElement = root
  let listener: ((event: Record<string, unknown>) => void) | null = null
  const document = {
    scrollingElement: root,
    documentElement: root,
    body,
    addEventListener: vi.fn(
      (_type: string, installed: (event: Record<string, unknown>) => void) => {
        listener = installed
      },
    ),
  }
  vm.runInNewContext(HORIZONTAL_PAN_SCRIPT, {
    document,
    Element: FakeElement,
    Node: { ELEMENT_NODE: 1 },
    WheelEvent: { DOM_DELTA_LINE: 1, DOM_DELTA_PAGE: 2 },
    innerWidth: 800,
    getComputedStyle: (element: FakeElement) => ({ overflowX: element.overflowX }),
  })
  if (!listener) throw new Error('horizontal pan listener was not installed')
  return { listener, root, body }
}

function wheelEvent(target: FakeElement, overrides: Record<string, unknown> = {}) {
  return {
    target,
    deltaX: 120,
    deltaY: 0,
    deltaMode: 0,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    defaultPrevented: false,
    composedPath: () => [target],
    preventDefault: vi.fn(),
    ...overrides,
  }
}

describe('browser horizontal pan support', () => {
  it('moves a hidden-overflow page when Chromium has no native horizontal scroller', () => {
    const { listener, root, body } = installScript()
    body.overflowX = 'hidden'
    root.clientWidth = 800
    root.scrollWidth = 1400
    const event = wheelEvent(body)

    listener(event)

    expect(root.scrollLeft).toBe(120)
    expect(event.preventDefault).toHaveBeenCalledOnce()
  })

  it('leaves ordinary horizontal scrollers to Chromium', () => {
    const { listener, root } = installScript()
    root.overflowX = 'auto'
    root.clientWidth = 800
    root.scrollWidth = 1400
    const event = wheelEvent(root)

    listener(event)

    expect(root.scrollLeft).toBe(0)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('maps Shift + wheel to horizontal movement without hijacking pinch zoom', () => {
    const { listener, root } = installScript()
    root.overflowX = 'hidden'
    root.clientWidth = 800
    root.scrollWidth = 1400
    listener(wheelEvent(root, { deltaX: 0, deltaY: 3, deltaMode: 1, shiftKey: true }))
    expect(root.scrollLeft).toBe(96)

    listener(wheelEvent(root, { deltaX: 50, ctrlKey: true }))
    expect(root.scrollLeft).toBe(96)
  })

  it('installs into an isolated world', async () => {
    const executeJavaScriptInIsolatedWorld = vi.fn().mockResolvedValue(undefined)

    await installHorizontalPanSupport({ executeJavaScriptInIsolatedWorld } as never)

    expect(executeJavaScriptInIsolatedWorld).toHaveBeenCalledWith(expect.any(Number), [
      expect.objectContaining({ code: expect.stringContaining('__cclinkHorizontalPanInstalled') }),
    ])
  })
})
