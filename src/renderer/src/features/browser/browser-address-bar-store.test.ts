import { beforeEach, describe, expect, it } from 'vitest'
import {
  resolveBrowserAddressBarMode,
  useBrowserAddressBarStore,
  type BrowserAddressBarModeInput,
} from './browser-address-bar-store'
import { getBrowserAddressBarTabHint } from '../../components/workbench/TabBar'

const base: BrowserAddressBarModeInput = {
  autoHide: true,
  revealed: false,
  newTabPage: false,
  navigationFailed: false,
  findOpen: false,
  panelOpen: false,
}

describe('resolveBrowserAddressBarMode', () => {
  it('hides by default and reveals on request', () => {
    expect(resolveBrowserAddressBarMode(base)).toBe('hidden')
    expect(resolveBrowserAddressBarMode({ ...base, revealed: true })).toBe('revealed')
  })

  it('keeps the bar open while a toolbar panel is open', () => {
    expect(resolveBrowserAddressBarMode({ ...base, panelOpen: true })).toBe('revealed')
  })

  it('pins the bar when there is nothing to see or the user opted out', () => {
    expect(resolveBrowserAddressBarMode({ ...base, autoHide: false })).toBe('pinned')
    expect(resolveBrowserAddressBarMode({ ...base, newTabPage: true })).toBe('pinned')
    expect(resolveBrowserAddressBarMode({ ...base, navigationFailed: true })).toBe('pinned')
    expect(resolveBrowserAddressBarMode({ ...base, findOpen: true, revealed: true })).toBe('pinned')
  })
})

describe('useBrowserAddressBarStore', () => {
  beforeEach(() => {
    useBrowserAddressBarStore.setState({ revealedTabId: null, panelOpenTabId: null, pages: {} })
  })

  it('toggles only the clicked tab and collapses all on tab switch', () => {
    const store = useBrowserAddressBarStore.getState()
    store.toggle('a')
    expect(useBrowserAddressBarStore.getState().revealedTabId).toBe('a')
    store.toggle('a')
    expect(useBrowserAddressBarStore.getState().revealedTabId).toBeNull()
    store.reveal('a')
    store.collapse('b')
    expect(useBrowserAddressBarStore.getState().revealedTabId).toBe('a')
    store.collapseAll()
    expect(useBrowserAddressBarStore.getState().revealedTabId).toBeNull()
  })

  it('collapses a revealed bar when the user clicks into the page', () => {
    const store = useBrowserAddressBarStore.getState()
    store.applyPageSignals('a', { loading: false, pagePointerSequence: 3 })
    store.reveal('a')
    store.applyPageSignals('a', { loading: true })
    expect(useBrowserAddressBarStore.getState().revealedTabId).toBe('a')
    expect(useBrowserAddressBarStore.getState().pages.a?.loading).toBe(true)
    store.applyPageSignals('a', { pagePointerSequence: 4 })
    expect(useBrowserAddressBarStore.getState().revealedTabId).toBeNull()
  })

  it('waits for the next page click while a toolbar panel is open', () => {
    const store = useBrowserAddressBarStore.getState()
    store.applyPageSignals('a', { pagePointerSequence: 0 })
    store.reveal('a')
    store.setPanelOpen('a', true)
    store.applyPageSignals('a', { pagePointerSequence: 1 })
    expect(useBrowserAddressBarStore.getState().revealedTabId).toBe('a')
    store.setPanelOpen('a', false)
    store.applyPageSignals('a', { pagePointerSequence: 2 })
    expect(useBrowserAddressBarStore.getState().revealedTabId).toBeNull()
  })

  it('ignores page clicks in a tab that is not revealed', () => {
    const store = useBrowserAddressBarStore.getState()
    store.applyPageSignals('a', { pagePointerSequence: 0 })
    store.reveal('b')
    store.applyPageSignals('a', { pagePointerSequence: 1 })
    expect(useBrowserAddressBarStore.getState().revealedTabId).toBe('b')
  })
})

describe('getBrowserAddressBarTabHint', () => {
  it('only hints on the active browser tab when the bar can collapse', () => {
    const indicator = { tabId: 'a', mode: 'hidden' as const, plainHttp: false, loading: false }
    expect(getBrowserAddressBarTabHint(indicator, 'a')).toBe('点击显示地址栏')
    expect(getBrowserAddressBarTabHint({ ...indicator, mode: 'revealed' }, 'a')).toBe(
      '点击收起地址栏',
    )
    expect(getBrowserAddressBarTabHint({ ...indicator, mode: 'pinned' }, 'a')).toBeNull()
    expect(getBrowserAddressBarTabHint(indicator, 'b')).toBeNull()
    expect(getBrowserAddressBarTabHint(null, 'a')).toBeNull()
  })
})
