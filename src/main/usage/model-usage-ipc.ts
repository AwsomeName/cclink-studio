import { dialog } from 'electron'
import { stat } from 'node:fs/promises'
import { modelUsageContracts as modelUsageIpc } from '../../shared/ipc/model-usage-contract'
import type { UsageResult } from '../../shared/model-usage'
import {
  registerTrustedIpcContract,
  type TrustedRendererGuard,
} from '../ipc/trusted-renderer-guard'
import type { ModelUsageService } from './model-usage-service'
export function registerModelUsageIpc(service: ModelUsageService, guard: TrustedRendererGuard) {
  let fileOperation = false
  async function result<T>(action: () => Promise<T>): Promise<UsageResult<T>> {
    try {
      return { success: true, value: await action() }
    } catch (error) {
      const raw =
        error && typeof error === 'object' && 'code' in error
          ? String(error.code)
          : 'USAGE_UNAVAILABLE'
      const code = /^[A-Z0-9_]{1,80}$/.test(raw) ? raw : 'USAGE_UNAVAILABLE'
      return {
        success: false,
        error: {
          code,
          message:
            code === 'NO_TRANSCRIPTS'
              ? '未找到 Studio 管理的历史日志，可选择会话日志目录回填。'
              : code === 'EEXIST'
                ? '文件已存在，请使用新的文件名。'
                : '统计操作未完成，原任务不受影响。请刷新或查看诊断。',
        },
      }
    }
  }
  async function withFiles<T>(action: () => Promise<T>): Promise<T> {
    if (fileOperation) throw Object.assign(new Error('BUSY'), { code: 'USAGE_BUSY' })
    fileOperation = true
    try {
      return await action()
    } finally {
      fileOperation = false
    }
  }
  registerTrustedIpcContract(modelUsageIpc.snapshot, guard, (_event, query) =>
    result(() => service.snapshot(query)),
  )
  registerTrustedIpcContract(modelUsageIpc.calls, guard, (_event, query, offset, exclude) =>
    result(() => service.calls(query, offset, exclude)),
  )
  registerTrustedIpcContract(modelUsageIpc.setEnabled, guard, (_event, enabled) =>
    result(async () => {
      await service.setEnabled(enabled)
      return null
    }),
  )
  registerTrustedIpcContract(modelUsageIpc.classify, guard, (_event, input) =>
    result(async () => {
      await service.classify(input)
      return null
    }),
  )
  registerTrustedIpcContract(modelUsageIpc.backfill, guard, (_event, selectDirectory) =>
    result(() =>
      withFiles(async () => {
        if (!selectDirectory) return service.backfill()
        const choice = await dialog.showOpenDialog({
          title: '选择 Claude Code 会话日志目录',
          properties: ['openDirectory'],
        })
        return choice.canceled || !choice.filePaths[0]
          ? null
          : service.backfill(choice.filePaths[0])
      }),
    ),
  )
  registerTrustedIpcContract(modelUsageIpc.importFile, guard, () =>
    result(() =>
      withFiles(async () => {
        const choice = await dialog.showOpenDialog({
          title: '导入用量 JSON（保留来源并去重）',
          properties: ['openFile'],
          filters: [{ name: 'Studio 用量', extensions: ['json'] }],
        })
        if (choice.canceled || !choice.filePaths[0]) return null
        if ((await stat(choice.filePaths[0])).size > 200 * 1024 * 1024)
          throw Object.assign(new Error('FILE_TOO_LARGE'), { code: 'FILE_TOO_LARGE' })
        return service.importFile(choice.filePaths[0])
      }),
    ),
  )
  registerTrustedIpcContract(modelUsageIpc.exportFile, guard, (_event, input) =>
    result(() =>
      withFiles(async () => {
        const choice = await dialog.showSaveDialog({
          title: '导出模型用量',
          defaultPath: `studio-usage-${Date.now()}.${input.format}`,
          filters: [{ name: input.format.toUpperCase(), extensions: [input.format] }],
        })
        if (choice.canceled || !choice.filePath) return null
        return service.exportFile(
          choice.filePath,
          input.format,
          input.query,
          input.excludeDevelopment,
        )
      }),
    ),
  )
}
