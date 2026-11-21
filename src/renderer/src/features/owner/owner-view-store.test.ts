import { beforeEach, describe, expect, it } from 'vitest'
import { BOARD, ownerView, tabKey, tabTitle, useOwnerView } from './owner-view-store'

const A = 'affair-a',
  B = 'affair-b'
const report = { kind: 'affair' as const, name: '交付物/Ibex 源码入门卡.md' }
const evidence = { kind: 'affair' as const, name: '资料/05-ibex_if_stage.sv.md', line: 668 }
const note = { kind: 'source' as const, grantId: 'g1', rel: 'rtl/if.sv', label: 'notes' }

describe('Owner view tabs', () => {
  beforeEach(() => useOwnerView.setState({ views: {} }))
  const view = (id: string) => ownerView(useOwnerView.getState(), id)

  it('opens documents per affair, reuses a tab and updates its line', () => {
    const { open } = useOwnerView.getState()
    open(A, report)
    open(A, { ...evidence, line: 10 })
    open(A, evidence)
    expect(view(A).tabs).toEqual([report, evidence])
    expect(view(A).active).toBe(tabKey(evidence))
    expect(view(B)).toEqual({ tabs: [], active: BOARD })
    expect(tabTitle(report)).toBe('Ibex 源码入门卡.md')
  })

  it('falls back to a neighbour, then the board, when closing the active tab', () => {
    const { open, close } = useOwnerView.getState()
    open(A, report)
    open(A, evidence)
    close(A, tabKey(evidence))
    expect(view(A).active).toBe(tabKey(report))
    close(A, tabKey(report))
    expect(view(A)).toEqual({ tabs: [], active: BOARD })
  })

  it('drops tabs of a revoked source directory', () => {
    const { open, closeSource } = useOwnerView.getState()
    open(A, report)
    open(A, note)
    closeSource(A, 'g1')
    expect(view(A).tabs).toEqual([report])
    expect(view(A).active).toBe(BOARD)
  })
})
