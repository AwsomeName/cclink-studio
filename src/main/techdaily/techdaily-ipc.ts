import type { TechDailyResult } from '../../shared/techdaily/techdaily-types'
import { techDailyIpcContracts } from '../../shared/ipc/techdaily-contract'
import {
  registerTrustedIpcContract,
  type TrustedRendererGuard,
} from '../ipc/trusted-renderer-guard'
import type { TechDailyService } from './techdaily-service'

async function run<T>(operation: () => T | Promise<T>): Promise<TechDailyResult<T>> {
  try {
    return { success: true, data: await operation() }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : '科技日报操作失败' }
  }
}

export function registerTechDailyIpc(
  getService: () => TechDailyService | null,
  guard: TrustedRendererGuard,
): void {
  const service = (): TechDailyService => {
    const current = getService()
    if (!current) throw new Error('科技日报当前不可用，其他本地功能可继续使用')
    return current
  }
  registerTrustedIpcContract(techDailyIpcContracts.getSettings, guard, (_e, input) =>
    run(() => service().getSettings(input)),
  )
  registerTrustedIpcContract(techDailyIpcContracts.saveSettings, guard, (_e, input) =>
    run(() => service().saveSettings(input)),
  )
  registerTrustedIpcContract(techDailyIpcContracts.getStatus, guard, (_e, input) =>
    run(() => service().getStatus(input)),
  )
  registerTrustedIpcContract(techDailyIpcContracts.getSearxng, guard, () =>
    run(() => service().getSearxng()),
  )
  registerTrustedIpcContract(techDailyIpcContracts.saveSearxng, guard, (_e, input) =>
    run(() => service().saveSearxng(input)),
  )
  registerTrustedIpcContract(techDailyIpcContracts.testSearxng, guard, (_e, input) =>
    run(() => service().testSearxng(input)),
  )
  registerTrustedIpcContract(techDailyIpcContracts.collect, guard, (_e, input) =>
    run(() => service().collect(input)),
  )
  registerTrustedIpcContract(techDailyIpcContracts.listMonth, guard, (_e, input) =>
    run(() => service().listMonth(input)),
  )
  registerTrustedIpcContract(techDailyIpcContracts.getRun, guard, (_e, input) =>
    run(() => service().getRun(input)),
  )
  registerTrustedIpcContract(techDailyIpcContracts.generate, guard, (_e, input) =>
    run(() => service().generate(input)),
  )
  registerTrustedIpcContract(techDailyIpcContracts.stop, guard, (_e, input) =>
    run(() => service().stop(input)),
  )
}
