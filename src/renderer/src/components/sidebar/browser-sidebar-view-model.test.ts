import { describe, expect, it } from 'vitest'
import { globalWorkspaceRef, localWorkspaceRef } from '@shared/workspace-ref'
import type { Tab } from '../../types'
import {
  findOrdinaryBrowserTabByUrl,
  getBrowserDisplayTitle,
  getBrowserTabsForWorkspace,
  getBrowserUrlLabel,
} from './browser-sidebar-view-model'

const projectA = localWorkspaceRef('/workspace/a')
const projectB = localWorkspaceRef('/workspace/b')

const tabs: Tab[] = [
  { id: 'a-1', type: 'browser', title: 'A1', icon: 'B', workspaceRef: projectA },
  { id: 'b-1', type: 'browser', title: 'B1', icon: 'B', workspaceRef: projectB },
  { id: 'a-file', type: 'editor', title: 'File', icon: 'F', workspaceRef: projectA },
  { id: 'a-2', type: 'browser', title: 'A2', icon: 'B', workspaceRef: projectA },
  { id: 'legacy', type: 'browser', title: 'Legacy', icon: 'B' },
]

describe('browser sidebar view model', () => {
  it('只返回当前项目浏览器，并保持 Workbench Tab 顺序', () => {
    expect(getBrowserTabsForWorkspace(tabs, projectA).map((tab) => tab.id)).toEqual(['a-1', 'a-2'])
    expect(getBrowserTabsForWorkspace(tabs, projectB).map((tab) => tab.id)).toEqual(['b-1'])
    expect(getBrowserTabsForWorkspace(tabs, globalWorkspaceRef())).toEqual([])
  })

  it('从 URL 提取紧凑的站点标识', () => {
    expect(getBrowserUrlLabel('https://example.com/path?q=1')).toBe('example.com')
    expect(getBrowserUrlLabel('not a url')).toBe('not a url')
  })

  it('默认标题跟随网页，手动重命名始终优先', () => {
    expect(getBrowserDisplayTitle('浏览器', 'Example Page')).toBe('Example Page')
    expect(getBrowserDisplayTitle('运营看板', 'Example Page')).toBe('运营看板')
  })

  it('书签和历史只复用同 URL 的默认环境 Tab', () => {
    const sameUrlTabs: Tab[] = [
      {
        id: 'account',
        type: 'browser',
        title: '账号环境',
        icon: 'B',
        workspaceRef: projectA,
        browserProfile: 'account-profile',
        webResourceRef: { accountId: 'account-a' },
      },
      {
        id: 'ordinary',
        type: 'browser',
        title: '默认环境',
        icon: 'B',
        workspaceRef: projectA,
        browserProfile: null,
      },
    ]
    const browserTabs = {
      account: { url: 'https://example.com/' },
      ordinary: { url: 'https://example.com/' },
    }

    expect(findOrdinaryBrowserTabByUrl(sameUrlTabs, browserTabs, 'https://example.com/')?.id).toBe(
      'ordinary',
    )
    expect(
      findOrdinaryBrowserTabByUrl(sameUrlTabs.slice(0, 1), browserTabs, 'https://example.com/'),
    ).toBeUndefined()
  })
})
