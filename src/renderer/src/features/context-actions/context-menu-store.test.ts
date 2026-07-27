import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useContextMenuStore } from './context-menu-store'

describe('tab context menu browser preview', () => {
  beforeEach(() => {
    useContextMenuStore.setState({
      open: false,
      x: 0,
      y: 0,
      target: null,
      focusReturn: null,
      editingContributionId: null,
      inputValue: '',
      browserPreviewDataUrl: null,
      workspaceKeyAtOpen: null,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the preview until the browser view has time to reattach', () => {
    const preview = 'data:image/png;base64,preview'
    useContextMenuStore.getState().show({
      target: { kind: 'tab', workspaceKey: '/workspace', tabId: 'browser-1', tabType: 'browser' },
      x: 20,
      y: 30,
      browserPreviewDataUrl: preview,
    })

    expect(useContextMenuStore.getState()).toMatchObject({
      open: true,
      target: { kind: 'tab', tabId: 'browser-1' },
      browserPreviewDataUrl: preview,
    })

    useContextMenuStore.getState().hide()
    expect(useContextMenuStore.getState()).toMatchObject({
      open: false,
      target: null,
      browserPreviewDataUrl: preview,
    })

    useContextMenuStore.getState().clearBrowserPreview()
    expect(useContextMenuStore.getState().browserPreviewDataUrl).toBeNull()
  })

  it('clears a stale preview when a non-browser menu opens', () => {
    useContextMenuStore.setState({ browserPreviewDataUrl: 'data:image/png;base64,old' })
    useContextMenuStore.getState().show({
      target: { kind: 'tab', workspaceKey: '/workspace', tabId: 'editor-1', tabType: 'editor' },
      x: 10,
      y: 12,
    })

    expect(useContextMenuStore.getState().browserPreviewDataUrl).toBeNull()
  })

  it('lets executed commands transfer focus before restoring the menu trigger', () => {
    const focus = vi.fn()
    const focusReturn = { isConnected: true, focus } as unknown as HTMLElement
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame)
    const store = useContextMenuStore.getState()

    store.show({
      target: { kind: 'file', workspaceKey: '/a', path: '/a/a.md', name: 'a.md', fileType: 'file' },
      x: 10,
      y: 20,
      focusReturn,
    })
    store.hide('execute')
    expect(focus).not.toHaveBeenCalled()

    store.show({
      target: { kind: 'file', workspaceKey: '/a', path: '/a/a.md', name: 'a.md', fileType: 'file' },
      x: 10,
      y: 20,
      focusReturn,
    })
    store.hide('escape')
    expect(requestAnimationFrame).toHaveBeenCalledOnce()
    expect(focus).toHaveBeenCalledOnce()
  })
})
