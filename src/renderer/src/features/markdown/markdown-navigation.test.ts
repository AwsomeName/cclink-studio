import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentMountedResource } from '../../types'
import { useTabStore } from '../../stores/tab-store'
import {
  MARKDOWN_REVEAL_RANGE_EVENT,
  openFileRangeResource,
  type MarkdownRevealRange,
} from './markdown-navigation'

describe('openFileRangeResource', () => {
  beforeEach(() => {
    useTabStore.setState({
      tabs: [
        {
          id: 'virtual-note',
          type: 'editor',
          title: '未命名.md',
          icon: '📄',
          initialContent: '# 草稿',
        },
      ],
      activeTabId: null,
    })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
  })

  it('activates an unsaved markdown tab and dispatches its line range by tabId', () => {
    const eventTarget = new EventTarget()
    vi.stubGlobal('window', eventTarget)
    let detail: MarkdownRevealRange | undefined
    eventTarget.addEventListener(MARKDOWN_REVEAL_RANGE_EVENT, (event) => {
      detail = (event as CustomEvent<MarkdownRevealRange>).detail
    })

    openFileRangeResource(virtualRangeResource())

    expect(useTabStore.getState().activeTabId).toBe('virtual-note')
    expect(detail).toEqual({
      filePath: undefined,
      tabId: 'virtual-note',
      startLine: 2,
      endLine: 4,
      startColumn: 1,
      endColumn: 8,
    })
  })
})

function virtualRangeResource(): AgentMountedResource {
  return {
    id: 'file-range:virtual-note:2:4',
    kind: 'file-range',
    label: '未命名.md:L2-L4',
    ref: {
      type: 'file-range',
      tabId: 'virtual-note',
      format: 'markdown',
      startLine: 2,
      endLine: 4,
      startColumn: 1,
      endColumn: 8,
      selectedText: '草稿内容',
      sourceSnapshot: '草稿内容',
    },
  }
}
