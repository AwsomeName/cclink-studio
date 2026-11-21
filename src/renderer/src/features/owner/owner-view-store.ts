import { create } from 'zustand'

// View-only state for the Owner workbench: which document tabs are open per affair.
// Affair facts stay in the main-process affair directory; closing a tab never touches them.
export type OwnerDocTab =
  | { kind: 'affair'; name: string; line?: number }
  | { kind: 'source'; grantId: string; rel: string; label: string }
export const BOARD = 'board'
export const tabKey = (t: OwnerDocTab) =>
  t.kind === 'affair' ? 'affair:' + t.name : 'source:' + t.grantId + ':' + t.rel
export const tabTitle = (t: OwnerDocTab) =>
  t.kind === 'affair' ? t.name.split('/').pop() || t.name : t.rel.split('/').pop() || t.label

type View = { tabs: OwnerDocTab[]; active: string }
type State = {
  views: Record<string, View>
  open: (affairId: string, tab: OwnerDocTab) => void
  close: (affairId: string, key: string) => void
  activate: (affairId: string, key: string) => void
  closeSource: (affairId: string, grantId: string) => void
}
const empty: View = { tabs: [], active: BOARD }
export const ownerView = (s: State, affairId: string) => s.views[affairId] ?? empty

export const useOwnerView = create<State>((set) => {
  const update = (affairId: string, fn: (v: View) => View) =>
    set((s) => ({ views: { ...s.views, [affairId]: fn(s.views[affairId] ?? empty) } }))
  return {
    views: {},
    open: (affairId, tab) =>
      update(affairId, (v) => {
        const key = tabKey(tab)
        const tabs = v.tabs.some((t) => tabKey(t) === key)
          ? v.tabs.map((t) => (tabKey(t) === key ? tab : t))
          : [...v.tabs, tab].slice(-12)
        return { tabs, active: key }
      }),
    close: (affairId, key) =>
      update(affairId, (v) => {
        const index = v.tabs.findIndex((t) => tabKey(t) === key)
        const tabs = v.tabs.filter((t) => tabKey(t) !== key)
        const neighbour = tabs[Math.min(index, tabs.length - 1)]
        return {
          tabs,
          active: v.active !== key ? v.active : neighbour ? tabKey(neighbour) : BOARD,
        }
      }),
    activate: (affairId, key) => update(affairId, (v) => ({ ...v, active: key })),
    closeSource: (affairId, grantId) =>
      update(affairId, (v) => {
        const tabs = v.tabs.filter((t) => t.kind !== 'source' || t.grantId !== grantId)
        return { tabs, active: tabs.some((t) => tabKey(t) === v.active) ? v.active : BOARD }
      }),
  }
})
