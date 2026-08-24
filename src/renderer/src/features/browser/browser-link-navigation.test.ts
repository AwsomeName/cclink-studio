import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { localWorkspaceRef } from '@shared/workspace-ref'
import { useTabStore } from '../../stores/tab-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import {
  normalizeHttpUrl,
  openHttpUrlInNewBrowserTab,
  resolveBrowserLinkClick,
} from './browser-link-navigation'

class FakeElement {
  constructor(
    private readonly anchor: {
      href: string
      textContent: string
    } | null,
  ) {}

  closest(selector: string): FakeElement | null {
    return selector === 'a[href]' && this.anchor ? this : null
  }

  getAttribute(name: string): string | null {
    return name === 'href' ? (this.anchor?.href ?? null) : null
  }

  get textContent(): string | null {
    return this.anchor?.textContent ?? null
  }
}

beforeEach(() => {
  vi.stubGlobal('Element', FakeElement)
  vi.stubGlobal('window', {
    cclinkStudio: {
      workspaceState: { setSection: vi.fn().mockResolvedValue({ success: true }) },
    },
  })
  useTabStore.setState({ tabs: [], activeTabId: null })
  useWorkspaceStore.setState({
    activeWorkspaceRef: localWorkspaceRef('/workspace/current'),
    generation: 1,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('browser link navigation', () => {
  it('only accepts absolute HTTP and HTTPS URLs', () => {
    expect(normalizeHttpUrl('https://example.com/a')).toBe('https://example.com/a')
    expect(normalizeHttpUrl('http://example.com')).toBe('http://example.com/')
    expect(normalizeHttpUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeHttpUrl('file:///etc/passwd')).toBeNull()
    expect(normalizeHttpUrl('/relative')).toBeNull()
  })

  it('resolves a primary click on a nested element inside an HTTP link', () => {
    const target = new FakeElement({ href: 'https://example.com/article', textContent: '文章链接' })

    expect(resolveBrowserLinkClick({ button: 0, target } as unknown as MouseEvent)).toEqual({
      url: 'https://example.com/article',
      title: '文章链接',
    })
    expect(resolveBrowserLinkClick({ button: 1, target } as unknown as MouseEvent)).toBeNull()
  })

  it('opens Agent and Markdown links in ordinary browsing when the source is not a Browser', async () => {
    const documentWorkspace = localWorkspaceRef('/workspace/document')
    useTabStore.setState({
      tabs: [
        {
          id: 'editor-1',
          type: 'editor',
          title: 'article.md',
          icon: '📝',
          workspaceRef: documentWorkspace,
        },
      ],
      activeTabId: 'editor-1',
    })

    await expect(
      openHttpUrlInNewBrowserTab({
        url: 'https://example.com/article',
        title: '文章链接',
        sourceTabId: 'editor-1',
      }),
    ).resolves.toBe(true)

    expect(useTabStore.getState().tabs.at(-1)).toEqual(
      expect.objectContaining({
        type: 'browser',
        title: '文章链接',
        initialUrl: 'https://example.com/article',
        workspaceRef: documentWorkspace,
        browserProfile: null,
      }),
    )
  })

  it('inherits the source Browser account environment when opening a new tab', async () => {
    const sourceWorkspace = localWorkspaceRef('/workspace/source')
    useTabStore.setState({
      tabs: [
        {
          id: 'browser-source',
          type: 'browser',
          title: '账号来源',
          icon: '🌐',
          workspaceRef: sourceWorkspace,
          browserProfile: 'account-profile',
          webResourceRef: { accountId: 'account-1' },
        },
      ],
      activeTabId: 'browser-source',
    })

    await expect(
      openHttpUrlInNewBrowserTab({
        url: 'https://example.com/next',
        sourceTabId: 'browser-source',
      }),
    ).resolves.toBe(true)

    expect(useTabStore.getState().tabs.at(-1)).toMatchObject({
      initialUrl: 'https://example.com/next',
      browserProfile: 'account-profile',
      webResourceRef: { accountId: 'account-1' },
      workspaceRef: sourceWorkspace,
    })
  })
})
