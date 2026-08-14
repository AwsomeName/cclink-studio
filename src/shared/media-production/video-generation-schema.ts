import type { CreateMediaVideoTaskInput } from './video-generation-types'
import { parseMediaProjectId, parseMediaWorkspacePath } from './media-project-schema'

export function parseCreateMediaVideoTaskInput(value: unknown): CreateMediaVideoTaskInput {
  const input = record(value, '创建视频任务参数无效')
  exactKeys(input, [
    'workspacePath',
    'projectId',
    'projectRevision',
    'sceneId',
    'provider',
    'model',
    'prompt',
    'aspectRatio',
    'durationSeconds',
  ])
  if (input.provider !== 'volcengine-jimeng-video') throw new Error('视频 Provider 无效')
  if (input.model !== 'jimeng-video-3.0-pro') throw new Error('视频模型无效')
  if (input.aspectRatio !== '16:9' && input.aspectRatio !== '9:16' && input.aspectRatio !== '1:1') {
    throw new Error('视频画幅无效')
  }
  if (input.durationSeconds !== 5 && input.durationSeconds !== 10) throw new Error('视频时长无效')
  if (
    typeof input.projectRevision !== 'number' ||
    !Number.isSafeInteger(input.projectRevision) ||
    input.projectRevision < 1
  ) {
    throw new Error('工程 revision 无效')
  }
  if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 800) {
    throw new Error('视频提示词必须在 1 到 800 个字符之间')
  }
  return {
    workspacePath: parseMediaWorkspacePath(input.workspacePath),
    projectId: parseMediaProjectId(input.projectId),
    projectRevision: input.projectRevision,
    sceneId: parseMediaProjectId(input.sceneId),
    provider: input.provider,
    model: input.model,
    prompt: input.prompt.trim(),
    aspectRatio: input.aspectRatio,
    durationSeconds: input.durationSeconds,
  }
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: string[]): void {
  const allowed = new Set(keys)
  if (Object.keys(value).some((key) => !allowed.has(key)) || keys.some((key) => !(key in value))) {
    throw new Error('创建视频任务参数字段无效')
  }
}
