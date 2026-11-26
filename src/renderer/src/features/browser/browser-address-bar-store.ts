import { create } from 'zustand'

/**
 * 浏览器地址栏的临时展开状态。
 *
 * 只在 renderer 内存中存在，不写入 WorkspaceState：切换标签、重启后都回到收起。
 * 地址栏显示与否只改变工作台内容区高度，网页尺寸与缩放仍由主进程 BrowserManager 唯一拥有。
 */

/** pinned：必须常显（无收起入口）；revealed：用户临时展开；hidden：收起。 */
export type BrowserAddressBarMode = 'pinned' | 'revealed' | 'hidden'

export interface BrowserAddressBarModeInput {
  /** 设置项「自动收起地址栏」。 */
  autoHide: boolean
  /** 用户点击当前浏览器标签或按 ⌘L 后临时展开。 */
  revealed: boolean
  /** 新标签页没有网页可看，必须能直接输入。 */
  newTabPage: boolean
  /** 地址栏提交的导航失败，需要能改网址重试。 */
  navigationFailed: boolean
  /** 网页内查找条复用地址栏位置。 */
  findOpen: boolean
  /** 缩放 / 账号 / 更多面板打开时保持展开。 */
  panelOpen: boolean
}

export function resolveBrowserAddressBarMode(
  input: BrowserAddressBarModeInput,
): BrowserAddressBarMode {
  if (!input.autoHide || input.newTabPage || input.navigationFailed || input.findOpen) {
    return 'pinned'
  }
  if (input.revealed || input.panelOpen) return 'revealed'
  return 'hidden'
}

interface PageSignals {
  loading: boolean
  pagePointerSequence: number
}

interface BrowserAddressBarState {
  /** 当前临时展开地址栏的浏览器标签；同一时刻最多一个。 */
  revealedTabId: string | null
  /** 打开着缩放 / 账号 / 更多面板的浏览器标签。 */
  panelOpenTabId: string | null
  /** 主进程上报的页面加载与网页点击信号。 */
  pages: Record<string, PageSignals>
  reveal: (tabId: string) => void
  collapse: (tabId: string) => void
  toggle: (tabId: string) => void
  collapseAll: () => void
  setPanelOpen: (tabId: string, open: boolean) => void
  applyPageSignals: (
    tabId: string,
    signals: { loading?: boolean; pagePointerSequence?: number },
  ) => void
}

export const useBrowserAddressBarStore = create<BrowserAddressBarState>((set) => ({
  revealedTabId: null,
  panelOpenTabId: null,
  pages: {},
  reveal: (tabId) => set({ revealedTabId: tabId }),
  collapse: (tabId) =>
    set((state) => (state.revealedTabId === tabId ? { revealedTabId: null } : state)),
  toggle: (tabId) =>
    set((state) => ({ revealedTabId: state.revealedTabId === tabId ? null : tabId })),
  collapseAll: () => set({ revealedTabId: null }),
  setPanelOpen: (tabId, open) =>
    set((state) => {
      if (open) return state.panelOpenTabId === tabId ? state : { panelOpenTabId: tabId }
      return state.panelOpenTabId === tabId ? { panelOpenTabId: null } : state
    }),
  applyPageSignals: (tabId, signals) =>
    set((state) => {
      const previous = state.pages[tabId]
      const next: PageSignals = {
        loading: signals.loading ?? previous?.loading ?? false,
        pagePointerSequence: signals.pagePointerSequence ?? previous?.pagePointerSequence ?? 0,
      }
      // 网页内按下鼠标 = 焦点回到网页：收起临时展开的地址栏；面板打开时等下一次点击。
      const clickedPage =
        previous !== undefined && next.pagePointerSequence > previous.pagePointerSequence
      const collapse =
        clickedPage && state.revealedTabId === tabId && state.panelOpenTabId !== tabId
      if (
        !collapse &&
        previous?.loading === next.loading &&
        previous.pagePointerSequence === next.pagePointerSequence
      ) {
        return state
      }
      return {
        pages: { ...state.pages, [tabId]: next },
        ...(collapse ? { revealedTabId: null } : {}),
      }
    }),
}))
