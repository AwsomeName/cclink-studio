import { z } from 'zod'

// Startup diagnostics for these two local domains only. Never carry raw exceptions,
// file paths, account metadata or persisted document contents across IPC.
export const webServiceStartupFailureSchema = z
  .object({
    service: z.enum(['web-resources', 'web-affairs']),
    state: z.literal('failed'),
    stage: z.enum([
      'initialize',
      'read-state',
      'restore-state',
      'validate-state',
      'recover-runtime',
    ]),
    code: z.enum([
      'STATE_INVALID',
      'STATE_TOO_LARGE',
      'STORAGE_PERMISSION_DENIED',
      'STORAGE_FULL',
      'STORAGE_UNAVAILABLE',
      'INITIALIZATION_FAILED',
    ]),
    recovery: z.enum([
      'restore-backup-and-restart',
      'check-permissions-and-restart',
      'free-disk-and-restart',
      'check-storage-and-restart',
      'restart-and-copy-diagnostics',
    ]),
    occurredAt: z.iso.datetime(),
  })
  .strict()

export type WebServiceStartupFailure = z.infer<typeof webServiceStartupFailureSchema>
export type WebServiceName = WebServiceStartupFailure['service']

const SERVICE_LABELS: Record<WebServiceName, string> = {
  'web-resources': '网站与账号',
  'web-affairs': '网页事务',
}

const STAGE_LABELS: Record<WebServiceStartupFailure['stage'], string> = {
  initialize: '初始化服务',
  'read-state': '读取状态文件',
  'restore-state': '恢复状态文件',
  'validate-state': '校验状态引用',
  'recover-runtime': '恢复执行状态',
}

const REASON_LABELS: Record<WebServiceStartupFailure['code'], string> = {
  STATE_INVALID: '状态数据格式或引用无效',
  STATE_TOO_LARGE: '状态文件超过安全大小限制',
  STORAGE_PERMISSION_DENIED: '没有读取或写入应用数据的权限',
  STORAGE_FULL: '存储空间不足或已达到配额',
  STORAGE_UNAVAILABLE: '应用数据存储无法访问',
  INITIALIZATION_FAILED: '服务初始化遇到未分类异常',
}

const RECOVERY_LABELS: Record<WebServiceStartupFailure['recovery'], string> = {
  'restore-backup-and-restart':
    '请保留现有数据并复制诊断；退出 Studio 后，从已确认有效的备份恢复，或联系维护者协助，再重新启动。不要删除状态文件。',
  'check-permissions-and-restart': '请检查 Studio 应用数据目录的读写权限，修复后重新启动 Studio。',
  'free-disk-and-restart': '请释放磁盘空间或检查存储配额，再重新启动 Studio。',
  'check-storage-and-restart': '请检查应用数据目录所在磁盘和目录是否可用，修复后重新启动 Studio。',
  'restart-and-copy-diagnostics': '请重新启动 Studio；若仍失败，请复制诊断并联系维护者。',
}

export function describeWebServiceStartupFailure(failure: WebServiceStartupFailure): string {
  return `${SERVICE_LABELS[failure.service]}启动失败：${STAGE_LABELS[failure.stage]}时，${REASON_LABELS[failure.code]}。${RECOVERY_LABELS[failure.recovery]}其他工作台能力可继续使用。`
}

export function formatWebServiceStartupDiagnostic(failure: WebServiceStartupFailure): string {
  // Explicit allowlist also protects copying when a caller supplies additional properties.
  return JSON.stringify(
    {
      service: failure.service,
      state: failure.state,
      stage: failure.stage,
      code: failure.code,
      recovery: failure.recovery,
      occurredAt: failure.occurredAt,
    },
    null,
    2,
  )
}
