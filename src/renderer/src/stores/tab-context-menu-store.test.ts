import { beforeEach, describe, expect, it } from 'vitest'
import { useTabContextMenuStore } from './tab-context-menu-store'

describe('tab context menu browser preview', () => {
  beforeEach(() => {
    useTabContextMenuStore.setState({
      open: false,
      x: 0,
      y: 0,
      tabId: null,
      browserPreviewDataUrl: null,
    })
  })

  it('keeps the preview until the browser view has time to reattach', () => {
    const preview = 'data:image/png;base64,preview'
    useTabContextMenuStore.getState().show('browser-1', 20, 30, preview)

    expect(useTabContextMenuStore.getState()).toMatchObject({
      open: true,
      tabId: 'browser-1',
      browserPreviewDataUrl: preview,
    })

    useTabContextMenuStore.getState().hide()
    expect(useTabContextMenuStore.getState()).toMatchObject({
      open: false,
      tabId: null,
      browserPreviewDataUrl: preview,
    })

    useTabContextMenuStore.getState().clearBrowserPreview()
    expect(useTabContextMenuStore.getState().browserPreviewDataUrl).toBeNull()
  })

  it('clears a stale preview when a non-browser menu opens', () => {
    useTabContextMenuStore.setState({ browserPreviewDataUrl: 'data:image/png;base64,old' })
    useTabContextMenuStore.getState().show('editor-1', 10, 12)

    expect(useTabContextMenuStore.getState().browserPreviewDataUrl).toBeNull()
  })
})
