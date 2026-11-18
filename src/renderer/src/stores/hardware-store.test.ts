import { afterEach, expect, it, vi } from 'vitest'
import { useHardwareStore } from './hardware-store'
import type { HardwareProjectSummary } from '@shared/ipc/hardware'

afterEach(() => {
  useHardwareStore.getState().clear()
  vi.unstubAllGlobals()
})

it('does not show a previous project scan after switching projects or clearing the view', async () => {
  const pending = new Map<string, (value: HardwareProjectSummary) => void>()
  vi.stubGlobal('window', {
    cclinkStudio: {
      hardware: {
        scanWorkspace: (path: string) => new Promise((resolve) => pending.set(path, resolve)),
      },
    },
  })
  const first = useHardwareStore.getState().scanWorkspace('/first')
  const second = useHardwareStore.getState().scanWorkspace('/second')
  const summary = (workspacePath: string) =>
    ({ workspacePath, artifacts: [] }) as unknown as HardwareProjectSummary
  pending.get('/second')!(summary('/second'))
  await second
  pending.get('/first')!(summary('/first'))
  await first
  expect(useHardwareStore.getState().summary?.workspacePath).toBe('/second')
  const late = useHardwareStore.getState().scanWorkspace('/late')
  useHardwareStore.getState().clear()
  pending.get('/late')!(summary('/late'))
  await late
  expect(useHardwareStore.getState().summary).toBeNull()
})
