import { parseMediaProjectId, parseMediaWorkspacePath } from './media-project-schema'
import type { CreateMediaRenderTaskInput } from './media-render-types'

export function parseCreateMediaRenderTaskInput(value: unknown): CreateMediaRenderTaskInput {
  const input = requireRecord(value, '成片导出参数无效')
  assertAllowedKeys(
    input,
    ['workspacePath', 'projectId', 'projectRevision', 'outputPath'],
    '成片导出参数包含未知字段',
  )
  if (
    typeof input.projectRevision !== 'number' ||
    !Number.isSafeInteger(input.projectRevision) ||
    input.projectRevision < 1
  ) {
    throw new Error('工程 revision 无效')
  }
  const outputPath = requireString(input.outputPath, '导出路径无效', 4096)
  if (!outputPath.toLowerCase().endsWith('.mp4')) throw new Error('导出文件必须使用 .mp4 扩展名')
  return {
    workspacePath: parseMediaWorkspacePath(input.workspacePath),
    projectId: parseMediaProjectId(input.projectId),
    projectRevision: input.projectRevision,
    outputPath,
  }
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message)
  return value as Record<string, unknown>
}

function requireString(value: unknown, message: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength)
    throw new Error(message)
  return value.trim()
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  message: string,
): void {
  if (Object.keys(value).some((key) => !allowedKeys.includes(key))) throw new Error(message)
}
