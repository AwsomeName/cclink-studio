import type { WebSearchResult } from '../../shared/web-search/web-search-types'
import { webSearchIpcContracts } from '../../shared/ipc/web-search-contract'
import {
  registerTrustedIpcContract,
  type TrustedRendererGuard,
} from '../ipc/trusted-renderer-guard'
import type { WebSearchService } from './web-search-service'

async function run<T>(operation: () => T | Promise<T>): Promise<WebSearchResult<T>> {
  try {
    return { success: true, data: await operation() }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : '联网搜索操作失败' }
  }
}

export function registerWebSearchIpc(
  getService: () => WebSearchService | null,
  guard: TrustedRendererGuard,
): void {
  const service = (): WebSearchService => {
    const current = getService()
    if (!current) throw new Error('联网搜索当前不可用，其他本地功能可继续使用')
    return current
  }
  registerTrustedIpcContract(webSearchIpcContracts.getStatus, guard, () =>
    run(() => service().getStatus()),
  )
  registerTrustedIpcContract(webSearchIpcContracts.saveSettings, guard, (_event, input) =>
    run(() => service().saveSettings(input)),
  )
  registerTrustedIpcContract(webSearchIpcContracts.verify, guard, (_event, input) =>
    run(() => service().verify(input)),
  )
  registerTrustedIpcContract(webSearchIpcContracts.getUsage, guard, (_event, month) =>
    run(() => service().getUsage(month)),
  )
}
