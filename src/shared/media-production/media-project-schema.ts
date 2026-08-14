import type {
  CreateMediaProjectInput,
  MediaAspectRatio,
  MediaProject,
  MediaProjectPlatform,
  MediaProjectScene,
  SaveMediaProjectInput,
  ProposeMediaStoryboardInput,
} from './media-project-types'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f-]{27,35}$/i
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i
const ASPECT_RATIOS = new Set<MediaAspectRatio>(['16:9', '9:16', '1:1'])
const PLATFORMS = new Set<MediaProjectPlatform>([
  'douyin',
  'xiaohongshu',
  'wechat-video',
  'bilibili',
  'web',
])

export function parseMediaWorkspacePath(value: unknown): string {
  return requireString(value, '工作空间路径无效', 4096)
}

export function parseMediaProjectId(value: unknown): string {
  const id = requireString(value, '宣发视频工程 ID 无效', 64)
  if (!UUID_PATTERN.test(id)) throw new Error('宣发视频工程 ID 无效')
  return id
}

export function parseCreateMediaProjectInput(value: unknown): CreateMediaProjectInput {
  const input = requireRecord(value, '创建宣发视频工程参数无效')
  assertAllowedKeys(
    input,
    ['workspacePath', 'sourcePath', 'platform', 'aspectRatio', 'targetDurationSeconds'],
    '创建参数包含未知字段',
  )
  return {
    workspacePath: parseMediaWorkspacePath(input.workspacePath),
    sourcePath: requireString(input.sourcePath, '稿件路径无效', 4096),
    platform: parsePlatform(input.platform),
    aspectRatio: parseAspectRatio(input.aspectRatio),
    targetDurationSeconds: parseDuration(input.targetDurationSeconds, 10, 180),
  }
}

export function parseSaveMediaProjectInput(value: unknown): SaveMediaProjectInput {
  const input = requireRecord(value, '保存宣发视频工程参数无效')
  assertAllowedKeys(input, ['workspacePath', 'expectedRevision', 'project'], '保存参数包含未知字段')
  if (
    typeof input.expectedRevision !== 'number' ||
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 1
  ) {
    throw new Error('预期 revision 无效')
  }
  return {
    workspacePath: parseMediaWorkspacePath(input.workspacePath),
    expectedRevision: input.expectedRevision,
    project: parseMediaProject(input.project),
  }
}

export function parseProposeMediaStoryboardInput(value: unknown): ProposeMediaStoryboardInput {
  const input = requireRecord(value, '生成分镜提案参数无效')
  assertAllowedKeys(input, ['workspacePath', 'project'], '生成分镜提案参数包含未知字段')
  const workspacePath = parseMediaWorkspacePath(input.workspacePath)
  const project = parseMediaProject(input.project)
  if (project.workspaceRef.path !== workspacePath) {
    throw new Error('宣发视频工程与工作空间不匹配')
  }
  return { workspacePath, project }
}

export function parseMediaProject(value: unknown): MediaProject {
  const input = requireRecord(value, '宣发视频工程无效')
  assertAllowedKeys(
    input,
    [
      'schemaVersion',
      'id',
      'workspaceRef',
      'revision',
      'title',
      'source',
      'brief',
      'scenes',
      'createdAt',
      'updatedAt',
    ],
    '宣发视频工程包含未知字段',
  )
  if (input.schemaVersion !== 1) throw new Error('不支持的宣发视频工程版本')
  const workspaceRef = requireRecord(input.workspaceRef, '工作空间引用无效')
  assertAllowedKeys(workspaceRef, ['kind', 'path'], '工作空间引用包含未知字段')
  if (workspaceRef.kind !== 'local') throw new Error('宣发视频工程只能绑定本地工作空间')
  const source = requireRecord(input.source, '稿件快照无效')
  assertAllowedKeys(source, ['path', 'snapshot'], '稿件快照包含未知字段')
  const brief = requireRecord(input.brief, '视频简报无效')
  assertAllowedKeys(
    brief,
    ['platform', 'aspectRatio', 'targetDurationSeconds', 'brand'],
    '视频简报包含未知字段',
  )
  const brand = requireRecord(brief.brand, '品牌设置无效')
  assertAllowedKeys(brand, ['primaryColor', 'callToAction'], '品牌设置包含未知字段')
  const revision = parsePositiveInteger(input.revision, '工程 revision 无效')
  const createdAt = parsePositiveInteger(input.createdAt, '工程创建时间无效')
  const updatedAt = parsePositiveInteger(input.updatedAt, '工程更新时间无效')
  if (!Array.isArray(input.scenes) || input.scenes.length < 1 || input.scenes.length > 100) {
    throw new Error('工程场景数量无效')
  }
  const scenes = input.scenes.map(parseScene)
  const sceneIds = new Set(scenes.map((scene) => scene.id))
  if (sceneIds.size !== scenes.length) throw new Error('工程场景 ID 重复')
  scenes.forEach((scene, index) => {
    if (scene.order !== index) throw new Error('工程场景顺序无效')
  })
  const primaryColor = requireString(brand.primaryColor, '品牌颜色无效', 7)
  if (!HEX_COLOR_PATTERN.test(primaryColor)) throw new Error('品牌颜色无效')
  return {
    schemaVersion: 1,
    id: parseMediaProjectId(input.id),
    workspaceRef: { kind: 'local', path: parseMediaWorkspacePath(workspaceRef.path) },
    revision,
    title: requireString(input.title, '工程标题不能为空', 120),
    source: {
      path: requireString(source.path, '稿件路径无效', 4096),
      snapshot: requireString(source.snapshot, '稿件快照不能为空', 1_000_000),
    },
    brief: {
      platform: parsePlatform(brief.platform),
      aspectRatio: parseAspectRatio(brief.aspectRatio),
      targetDurationSeconds: parseDuration(brief.targetDurationSeconds, 10, 180),
      brand: {
        primaryColor,
        callToAction:
          typeof brand.callToAction === 'string' ? brand.callToAction.trim().slice(0, 240) : '',
      },
    },
    scenes,
    createdAt,
    updatedAt,
  }
}

function parseScene(value: unknown): MediaProjectScene {
  const scene = requireRecord(value, '工程场景无效')
  assertAllowedKeys(
    scene,
    [
      'id',
      'order',
      'durationSeconds',
      'narration',
      'subtitle',
      'visualDescription',
      'searchTerms',
      'generationPrompt',
      'materialKind',
    ],
    '工程场景包含未知字段',
  )
  if (!Array.isArray(scene.searchTerms) || scene.searchTerms.length > 20) {
    throw new Error('场景搜索词无效')
  }
  const materialKind = scene.materialKind
  if (
    materialKind !== 'unassigned' &&
    materialKind !== 'workspace' &&
    materialKind !== 'search' &&
    materialKind !== 'generated-image' &&
    materialKind !== 'generated-video'
  ) {
    throw new Error('场景素材类型无效')
  }
  return {
    id: parseMediaProjectId(scene.id),
    order: parseNonNegativeInteger(scene.order, '场景顺序无效'),
    durationSeconds: parseDuration(scene.durationSeconds, 1, 60),
    narration: optionalString(scene.narration, 4000),
    subtitle: optionalString(scene.subtitle, 1000),
    visualDescription: optionalString(scene.visualDescription, 4000),
    searchTerms: scene.searchTerms.map((term) => requireString(term, '场景搜索词无效', 120)),
    generationPrompt: optionalString(scene.generationPrompt, 8000),
    materialKind,
  }
}

function parsePlatform(value: unknown): MediaProjectPlatform {
  if (!PLATFORMS.has(value as MediaProjectPlatform)) throw new Error('发布平台无效')
  return value as MediaProjectPlatform
}

function parseAspectRatio(value: unknown): MediaAspectRatio {
  if (!ASPECT_RATIOS.has(value as MediaAspectRatio)) throw new Error('视频画幅无效')
  return value as MediaAspectRatio
}

function parseDuration(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error('视频时长无效')
  }
  return Math.round(value * 10) / 10
}

function parsePositiveInteger(value: unknown, message: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(message)
  }
  return value
}

function parseNonNegativeInteger(value: unknown, message: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(message)
  }
  return value
}

function optionalString(value: unknown, maxLength: number): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string' || value.length > maxLength) throw new Error('文本字段无效')
  return value.trim()
}

function requireString(value: unknown, message: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error(message)
  }
  return value.trim()
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message)
  return value as Record<string, unknown>
}

function assertAllowedKeys(value: Record<string, unknown>, keys: string[], message: string): void {
  const allowed = new Set(keys)
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error(message)
}
