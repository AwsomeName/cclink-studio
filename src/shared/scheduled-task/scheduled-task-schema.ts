import type {
  SaveScheduledTaskInput,
  ScheduledTaskDefinition,
  ScheduledTaskDefinitionSource,
  StoredScheduledTaskDefinitionV2,
  ScheduledTaskOutputPolicy,
  ScheduledTaskResourceRef,
  ScheduledTaskSchedule,
  SetScheduledTaskEnabledInput,
  RunScheduledTaskInput,
  CancelScheduledTaskRunInput,
  DeleteScheduledTaskInput,
} from './scheduled-task-types'

const TASK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f-]{27,35}$/i
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const TIMEZONE_PATTERN = /^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/
const MAX_TITLE_LENGTH = 120
const MAX_INSTRUCTION_LENGTH = 32_000
const MAX_RESOURCE_COUNT = 100
const MAX_RELATIVE_PATH_LENGTH = 512

export function parseWorkspacePath(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096) {
    throw new Error('工作空间路径无效')
  }
  return value
}

export function parseScheduledTaskId(value: unknown): string {
  if (typeof value !== 'string' || !TASK_ID_PATTERN.test(value)) {
    throw new Error('定时任务 ID 无效')
  }
  return value
}

export function parseScheduledTaskSchedule(value: unknown): ScheduledTaskSchedule {
  const input = requireRecord(value, '执行时间无效')
  assertAllowedKeys(
    input,
    input.kind === 'once'
      ? ['kind', 'runAt', 'timezone']
      : input.kind === 'weekly'
        ? ['kind', 'time', 'weekdays', 'timezone']
        : ['kind', 'time', 'timezone'],
    '执行时间包含未知字段',
  )
  const timezone = requireString(input.timezone, '时区无效', 64)
  if (!TIMEZONE_PATTERN.test(timezone) || !isValidTimezone(timezone)) {
    throw new Error('时区无效')
  }

  if (input.kind === 'once') {
    if (typeof input.runAt !== 'number' || !Number.isSafeInteger(input.runAt) || input.runAt <= 0) {
      throw new Error('单次执行时间无效')
    }
    return { kind: 'once', runAt: input.runAt, timezone }
  }

  if (input.kind !== 'daily' && input.kind !== 'weekdays' && input.kind !== 'weekly') {
    throw new Error('执行周期无效')
  }
  const time = requireString(input.time, '执行时刻无效', 5)
  if (!TIME_PATTERN.test(time)) throw new Error('执行时刻无效')
  if (input.kind !== 'weekly') return { kind: input.kind, time, timezone }

  if (!Array.isArray(input.weekdays) || input.weekdays.length === 0) {
    throw new Error('每周执行日无效')
  }
  const weekdays = Array.from(new Set(input.weekdays))
  if (
    weekdays.some(
      (weekday) =>
        typeof weekday !== 'number' || !Number.isInteger(weekday) || weekday < 0 || weekday > 6,
    )
  ) {
    throw new Error('每周执行日无效')
  }
  return { kind: 'weekly', time, weekdays: weekdays.sort(), timezone }
}

interface LegacyStoredScheduledTaskDefinitionV1 {
  schemaVersion: 1
  id: string
  workspaceRef: { kind: 'local'; path: string }
  revision: number
  title: string
  instruction: string
  schedule: ScheduledTaskSchedule
  resources: ScheduledTaskResourceRef[]
  outputPolicy: ScheduledTaskOutputPolicy
  createdAt: number
  updatedAt: number
}

export type StoredScheduledTaskDefinition =
  | LegacyStoredScheduledTaskDefinitionV1
  | StoredScheduledTaskDefinitionV2

export function parseStoredScheduledTaskDefinition(value: unknown): StoredScheduledTaskDefinition {
  const input = requireRecord(value, '定时任务定义无效')
  if (input.schemaVersion === 2) return parseStoredScheduledTaskDefinitionV2(input)
  return parseLegacyStoredScheduledTaskDefinitionV1(input)
}

function parseLegacyStoredScheduledTaskDefinitionV1(
  input: Record<string, unknown>,
): LegacyStoredScheduledTaskDefinitionV1 {
  assertAllowedKeys(
    input,
    [
      'schemaVersion',
      'id',
      'workspaceRef',
      'revision',
      'title',
      'instruction',
      'schedule',
      'resources',
      'outputPolicy',
      'createdAt',
      'updatedAt',
    ],
    '定时任务定义包含未知字段',
  )
  if (input.schemaVersion !== 1) throw new Error('不支持的定时任务定义版本')
  const workspaceRef = requireRecord(input.workspaceRef, '工作空间引用无效')
  assertAllowedKeys(workspaceRef, ['kind', 'path'], '工作空间引用包含未知字段')
  if (workspaceRef.kind !== 'local') throw new Error('定时任务只能绑定本地工作空间')
  const revision = input.revision
  const createdAt = input.createdAt
  const updatedAt = input.updatedAt
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1) {
    throw new Error('定时任务 revision 无效')
  }
  if (
    typeof createdAt !== 'number' ||
    !Number.isSafeInteger(createdAt) ||
    typeof updatedAt !== 'number' ||
    !Number.isSafeInteger(updatedAt)
  ) {
    throw new Error('定时任务时间戳无效')
  }
  return {
    schemaVersion: 1,
    id: parseScheduledTaskId(input.id),
    workspaceRef: { kind: 'local', path: parseWorkspacePath(workspaceRef.path) },
    revision,
    title: parseTitle(input.title),
    instruction: parseInstruction(input.instruction),
    schedule: parseScheduledTaskSchedule(input.schedule),
    resources: parseResources(input.resources),
    outputPolicy: parseOutputPolicy(input.outputPolicy),
    createdAt,
    updatedAt,
  }
}

function parseStoredScheduledTaskDefinitionV2(
  input: Record<string, unknown>,
): StoredScheduledTaskDefinitionV2 {
  assertAllowedKeys(
    input,
    [
      'schemaVersion',
      'id',
      'revision',
      'title',
      'instruction',
      'schedule',
      'resources',
      'outputPolicy',
      'createdAt',
      'updatedAt',
    ],
    '定时任务定义包含未知字段',
  )
  const revision = parseRevision(input.revision)
  const { createdAt, updatedAt } = parseTimestamps(input.createdAt, input.updatedAt)
  return {
    schemaVersion: 2,
    id: parseScheduledTaskId(input.id),
    revision,
    title: parseTitle(input.title),
    instruction: parseInstruction(input.instruction),
    schedule: parseScheduledTaskSchedule(input.schedule),
    resources: parseResources(input.resources),
    outputPolicy: parseOutputPolicy(input.outputPolicy),
    createdAt,
    updatedAt,
  }
}

export function materializeScheduledTaskDefinition(
  stored: StoredScheduledTaskDefinition,
  workspacePath: string,
  source: ScheduledTaskDefinitionSource,
  executionDigest: string,
): ScheduledTaskDefinition {
  if (stored.schemaVersion === 1 && stored.workspaceRef.path !== workspacePath) {
    throw new Error('旧版定时任务绑定了其他工作空间')
  }
  return {
    schemaVersion: 2,
    id: stored.id,
    workspaceRef: { kind: 'local', path: parseWorkspacePath(workspacePath) },
    source,
    executionDigest,
    revision: stored.revision,
    title: stored.title,
    instruction: stored.instruction,
    schedule: stored.schedule,
    resources: stored.resources,
    outputPolicy: stored.outputPolicy,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
  }
}

export function parseSaveScheduledTaskInput(value: unknown): SaveScheduledTaskInput {
  const input = requireRecord(value, '定时任务保存参数无效')
  assertAllowedKeys(
    input,
    [
      'workspacePath',
      'taskId',
      'expectedRevision',
      'expectedExecutionDigest',
      'title',
      'instruction',
      'schedule',
      'resources',
      'outputPolicy',
      'definitionSource',
      'enable',
    ],
    '定时任务保存参数包含未知字段',
  )
  let taskId: string | undefined
  if (input.taskId !== undefined) taskId = parseScheduledTaskId(input.taskId)
  let expectedRevision: number | undefined
  if (input.expectedRevision !== undefined) {
    if (
      typeof input.expectedRevision !== 'number' ||
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 1
    ) {
      throw new Error('预期 revision 无效')
    }
    expectedRevision = input.expectedRevision
  }
  if (expectedRevision !== undefined && !taskId) throw new Error('新任务不能指定 revision')
  let expectedExecutionDigest: string | undefined
  if (input.expectedExecutionDigest !== undefined) {
    if (
      typeof input.expectedExecutionDigest !== 'string' ||
      !/^[0-9a-f]{64}$/i.test(input.expectedExecutionDigest)
    ) {
      throw new Error('预期执行摘要无效')
    }
    expectedExecutionDigest = input.expectedExecutionDigest
  }
  if (expectedExecutionDigest !== undefined && !taskId) throw new Error('新任务不能指定执行摘要')
  if (typeof input.enable !== 'boolean') throw new Error('本机启用状态无效')
  return {
    workspacePath: parseWorkspacePath(input.workspacePath),
    ...(taskId ? { taskId } : {}),
    ...(expectedRevision !== undefined ? { expectedRevision } : {}),
    ...(expectedExecutionDigest !== undefined ? { expectedExecutionDigest } : {}),
    title: parseTitle(input.title),
    instruction: parseInstruction(input.instruction),
    schedule: parseScheduledTaskSchedule(input.schedule),
    resources: parseResources(input.resources),
    outputPolicy: parseOutputPolicy(input.outputPolicy),
    ...(input.definitionSource !== undefined
      ? { definitionSource: parseDefinitionSource(input.definitionSource) }
      : {}),
    enable: input.enable,
  }
}

function parseDefinitionSource(value: unknown): ScheduledTaskDefinitionSource {
  if (value === 'local') return 'local'
  if (value === 'shared') return 'shared'
  throw new Error('任务共享范围无效')
}

function parseRevision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error('定时任务 revision 无效')
  }
  return value
}

function parseTimestamps(
  createdAtValue: unknown,
  updatedAtValue: unknown,
): { createdAt: number; updatedAt: number } {
  if (
    typeof createdAtValue !== 'number' ||
    !Number.isSafeInteger(createdAtValue) ||
    typeof updatedAtValue !== 'number' ||
    !Number.isSafeInteger(updatedAtValue)
  ) {
    throw new Error('定时任务时间戳无效')
  }
  return { createdAt: createdAtValue, updatedAt: updatedAtValue }
}

export function parseSetScheduledTaskEnabledInput(value: unknown): SetScheduledTaskEnabledInput {
  const input = requireRecord(value, '定时任务启用参数无效')
  assertAllowedKeys(input, ['workspacePath', 'taskId', 'enabled'], '定时任务启用参数包含未知字段')
  if (typeof input.enabled !== 'boolean') throw new Error('本机启用状态无效')
  return {
    workspacePath: parseWorkspacePath(input.workspacePath),
    taskId: parseScheduledTaskId(input.taskId),
    enabled: input.enabled,
  }
}

export function parseDeleteScheduledTaskInput(value: unknown): DeleteScheduledTaskInput {
  const input = requireRecord(value, '定时任务删除参数无效')
  assertAllowedKeys(
    input,
    ['workspacePath', 'taskId', 'expectedRevision'],
    '定时任务删除参数包含未知字段',
  )
  return {
    workspacePath: parseWorkspacePath(input.workspacePath),
    taskId: parseScheduledTaskId(input.taskId),
    expectedRevision: parseRevision(input.expectedRevision),
  }
}

function parseTitle(value: unknown): string {
  return requireString(value, '任务名称不能为空', MAX_TITLE_LENGTH)
}

function parseInstruction(value: unknown): string {
  return requireString(value, '任务内容不能为空', MAX_INSTRUCTION_LENGTH)
}

function parseResources(value: unknown): ScheduledTaskResourceRef[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_RESOURCE_COUNT) {
    throw new Error('绑定资源无效')
  }
  const parsed = value.map((raw): ScheduledTaskResourceRef => {
    const resource = requireRecord(raw, '绑定资源无效')
    assertAllowedKeys(
      resource,
      resource.kind === 'workspace' ? ['kind'] : ['kind', 'path'],
      '绑定资源包含未知字段',
    )
    if (resource.kind === 'workspace') return { kind: 'workspace' }
    if (resource.kind !== 'file' && resource.kind !== 'directory') {
      throw new Error('绑定资源类型无效')
    }
    return {
      kind: resource.kind,
      path: parseRelativePath(resource.path, '绑定资源路径无效'),
    }
  })
  if (!parsed.some((resource) => resource.kind === 'workspace')) {
    throw new Error('首版任务必须绑定当前工作空间')
  }
  return parsed
}

function parseOutputPolicy(value: unknown): ScheduledTaskOutputPolicy {
  const input = requireRecord(value, '输出约定无效')
  assertAllowedKeys(input, ['directory', 'fileNameTemplate', 'mode'], '输出约定包含未知字段')
  if (input.mode !== 'create-only') throw new Error('首版只允许新建输出文件')
  const fileNameTemplate = requireString(input.fileNameTemplate, '输出文件名无效', 180)
  if (
    fileNameTemplate.includes('/') ||
    fileNameTemplate.includes('\\') ||
    fileNameTemplate.includes('\0') ||
    fileNameTemplate === '.' ||
    fileNameTemplate === '..'
  ) {
    throw new Error('输出文件名不能包含路径')
  }
  if (!fileNameTemplate.toLowerCase().endsWith('.md')) {
    throw new Error('首版输出文件必须是 Markdown')
  }
  return {
    directory: parseRelativePath(input.directory, '输出目录无效'),
    fileNameTemplate,
    mode: 'create-only',
  }
}

export function parseRunScheduledTaskInput(value: unknown): RunScheduledTaskInput {
  const input = requireRecord(value, '立即运行参数无效')
  assertAllowedKeys(input, ['workspacePath', 'taskId'], '立即运行参数包含未知字段')
  return {
    workspacePath: parseWorkspacePath(input.workspacePath),
    taskId: parseScheduledTaskId(input.taskId),
  }
}

export function parseCancelScheduledTaskRunInput(value: unknown): CancelScheduledTaskRunInput {
  const input = requireRecord(value, '取消运行参数无效')
  assertAllowedKeys(input, ['workspacePath', 'runId'], '取消运行参数包含未知字段')
  const runId = requireString(input.runId, '运行 ID 无效', 128)
  if (!TASK_ID_PATTERN.test(runId)) throw new Error('运行 ID 无效')
  return {
    workspacePath: parseWorkspacePath(input.workspacePath),
    runId,
  }
}

function parseRelativePath(value: unknown, message: string): string {
  const path = requireString(value, message, MAX_RELATIVE_PATH_LENGTH)
  if (
    path.includes('\0') ||
    path.startsWith('/') ||
    path.startsWith('\\') ||
    /^[A-Za-z]:/.test(path) ||
    path.split(/[\\/]/).some((segment) => segment === '..')
  ) {
    throw new Error(message)
  }
  const normalized = path.replaceAll('\\', '/').replace(/^\.\/+/, '')
  if (!normalized) throw new Error(message)
  return normalized
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message)
  return value as Record<string, unknown>
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowedKeys: string[],
  message: string,
): void {
  const allowed = new Set(allowedKeys)
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error(message)
}

function requireString(value: unknown, message: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(message)
  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength) throw new Error(message)
  return normalized
}

function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format()
    return true
  } catch {
    return false
  }
}
