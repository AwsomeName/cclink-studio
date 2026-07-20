import { describe, expect, it } from 'vitest'
import { globalWorkspaceRef, localWorkspaceRef } from '@shared/workspace-ref'
import type { Tab } from '../../types'
import {
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
})
