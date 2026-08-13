import { createHash, randomUUID } from 'node:crypto'
import { app } from 'electron'
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { z } from 'zod'
import type {
  AgentRoleDraft,
  AgentRoleExportResult,
  AgentRoleImportDecision,
  AgentRoleImportPreview,
  AgentRoleImportPreviewResult,
  AgentRoleMutationResult,
  AgentRoleRef,
  AgentRoleSummary,
} from '../../shared/agent-role'
import { agentRoleDraftSchema } from '../../shared/ipc/agent-schema'
import { BuiltinAgentSkillRegistry } from './agent-skill-registry'
import {
  AGENT_PROFILE_PROMPT_COMPILER_VERSION,
  BuiltinAgentRoleRegistry,
  type BuiltinAgentRole,
} from './agent-profile-registry'

const STORE_SCHEMA_VERSION = 1
const PACKAGE_SCHEMA_VERSION = 1
const MAX_STORE_BYTES = 8 * 1024 * 1024
const MAX_PACKAGE_BYTES = 1024 * 1024
const IMPORT_TOKEN_TTL_MS = 10 * 60 * 1000
const MAX_PENDING_IMPORTS = 32

interface LocalAgentRoleVersion extends AgentRoleDraft {
  roleId: string
  version: number
  source: 'local' | 'imported'
  createdAt: number
}

interface LocalAgentRoleRecord {
  roleId: string
  archived: boolean
  versions: LocalAgentRoleVersion[]
}

interface LocalAgentRoleSnapshot {
  schemaVersion: 1
  roles: LocalAgentRoleRecord[]
}

interface ImportedRolePackage {
  roleId: string
  version: number
  createdAt: number
  contentHash: string
  draft: AgentRoleDraft
}

interface PendingImport {
  expiresAt: number
  imported: ImportedRolePackage
  preview: AgentRoleImportPreview
}

const rolePackageSchema = z
  .object({
    schemaVersion: z.literal(PACKAGE_SCHEMA_VERSION),
    roleId: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, '角色标识格式无效'),
    version: z.number().int().positive().max(1_000_000),
    createdAt: z.number().finite().nonnegative(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    role: agentRoleDraftSchema.omit({ soulMarkdown: true }),
  })
  .strict()

function emptySnapshot(): LocalAgentRoleSnapshot {
  return { schemaVersion: STORE_SCHEMA_VERSION, roles: [] }
}

function hashRole(roleId: string, version: number, draft: AgentRoleDraft): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        id: roleId,
        version,
        label: draft.label,
        description: draft.description,
        systemInstructions: draft.instructions.join('\n'),
        goals: draft.goals,
        suitableFor: draft.suitableFor,
        unsuitableFor: draft.unsuitableFor,
        boundaries: draft.boundaries,
        examples: draft.examples,
        soulMarkdown: draft.soulMarkdown ?? null,
        recommendedSkillRefs: draft.recommendedSkillRefs,
      }),
    )
    .digest('hex')
}

function hashSoul(markdown: string): string {
  return createHash('sha256').update(markdown).digest('hex')
}

function assertSafeSoul(markdown: string | undefined): void {
  if (!markdown) return
  const prohibited = [
    /<\s*(script|iframe|object|embed|img)\b/i,
    /\bon[a-z]+\s*=/i,
    /(?:@import|include::|\{[%{]\s*include)\b/i,
    /!\[[^\]]*\]\(\s*https?:\/\//i,
  ]
  if (prohibited.some((pattern) => pattern.test(markdown))) {
    throw new Error('SOUL.md 包含脚本、可执行 HTML 或远程 include，已拒绝')
  }
}

function normalizeDraft(value: unknown): AgentRoleDraft {
  const draft = agentRoleDraftSchema.parse(value) as AgentRoleDraft
  assertSafeSoul(draft.soulMarkdown)
  return structuredClone(draft)
}

function draftFieldsFromRecord(item: Record<string, unknown>): Record<string, unknown> {
  return {
    label: item.label,
    description: item.description,
    icon: item.icon,
    goals: item.goals,
    suitableFor: item.suitableFor,
    unsuitableFor: item.unsuitableFor,
    instructions: item.instructions,
    boundaries: item.boundaries,
    examples: item.examples,
    soulMarkdown: item.soulMarkdown,
    recommendedSkillRefs: item.recommendedSkillRefs,
    disclaimer: item.disclaimer,
  }
}

function toDefinition(version: LocalAgentRoleVersion): BuiltinAgentRole {
  return {
    id: version.roleId,
    version: version.version,
    label: version.label,
    description: version.description,
    icon: version.icon,
    disclaimer: version.disclaimer,
    systemInstructions: version.instructions.join('\n'),
    goals: version.goals,
    suitableFor: version.suitableFor,
    unsuitableFor: version.unsuitableFor,
    boundaries: version.boundaries,
    examples: version.examples,
    soulMarkdown: version.soulMarkdown,
    recommendedSkillRefs: version.recommendedSkillRefs,
  }
}

function toSummary(
  version: LocalAgentRoleVersion,
  archived: boolean,
  isLatest: boolean,
): AgentRoleSummary {
  return {
    roleId: version.roleId,
    version: version.version,
    source: version.source,
    archived,
    isLatest,
    createdAt: version.createdAt,
    label: version.label,
    description: version.description,
    icon: version.icon,
    goals: structuredClone(version.goals),
    suitableFor: structuredClone(version.suitableFor),
    unsuitableFor: structuredClone(version.unsuitableFor),
    instructions: structuredClone(version.instructions),
    boundaries: structuredClone(version.boundaries),
    examples: structuredClone(version.examples),
    contentHash: hashRole(version.roleId, version.version, version),
    recommendedSkillRefs: structuredClone(version.recommendedSkillRefs),
    ...(version.soulMarkdown
      ? {
          soul: {
            format: 'markdown' as const,
            source: version.source,
            markdown: version.soulMarkdown,
            contentHash: hashSoul(version.soulMarkdown),
          },
        }
      : {}),
    ...(version.disclaimer ? { disclaimer: version.disclaimer } : {}),
  }
}

function copySummaryToDraft(summary: AgentRoleSummary): AgentRoleDraft {
  return {
    label: summary.label,
    description: summary.description,
    icon: summary.icon,
    goals: structuredClone(summary.goals),
    suitableFor: structuredClone(summary.suitableFor),
    unsuitableFor: structuredClone(summary.unsuitableFor),
    instructions: structuredClone(summary.instructions),
    boundaries: structuredClone(summary.boundaries),
    examples: structuredClone(summary.examples),
    soulMarkdown: summary.soul?.markdown,
    recommendedSkillRefs: structuredClone(summary.recommendedSkillRefs),
    disclaimer: summary.disclaimer,
  }
}

function safeDirectoryName(label: string): string {
  const normalized = label
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return normalized || 'agent-role'
}

export class AgentRoleStore {
  readonly filePath: string
  readonly backupPath: string
  private saveQueue: Promise<void> = Promise.resolve()

  constructor(filePath = join(app.getPath('userData'), 'agent-roles', 'roles.json')) {
    this.filePath = filePath
    this.backupPath = `${filePath}.bak`
  }

  async load(): Promise<LocalAgentRoleSnapshot> {
    let primaryError: unknown
    try {
      const primary = await this.read(this.filePath)
      if (primary) return primary
    } catch (error) {
      primaryError = error
    }
    let backup: LocalAgentRoleSnapshot | null = null
    try {
      backup = await this.read(this.backupPath)
    } catch (error) {
      throw new Error(
        `本地角色主文件和备份均损坏：${error instanceof Error ? error.message : String(error)}`,
      )
    }
    if (backup) {
      await this.save(backup, false)
      return backup
    }
    if (primaryError) throw primaryError
    return emptySnapshot()
  }

  async save(snapshot: LocalAgentRoleSnapshot, preservePrimary = true): Promise<void> {
    const normalized = parseSnapshot(snapshot)
    const serialized = JSON.stringify(normalized, null, 2)
    if (Buffer.byteLength(serialized, 'utf8') > MAX_STORE_BYTES) {
      throw new Error('本地角色数据超过大小限制')
    }
    const persist = async (): Promise<void> => {
      await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 })
      if (preservePrimary) {
        await copyFile(this.filePath, this.backupPath).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error
        })
      }
      const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`
      await writeFile(temporaryPath, serialized, { encoding: 'utf8', mode: 0o600 })
      await rename(temporaryPath, this.filePath)
    }
    const pending = this.saveQueue.then(persist, persist)
    this.saveQueue = pending.catch(() => undefined)
    await pending
  }

  async flush(): Promise<void> {
    await this.saveQueue
  }

  private async read(path: string): Promise<LocalAgentRoleSnapshot | null> {
    try {
      const metadata = await stat(path)
      if (metadata.size > MAX_STORE_BYTES) throw new Error('本地角色数据超过大小限制')
      return parseSnapshot(JSON.parse(await readFile(path, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw new Error(`本地角色数据损坏：${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

function parseSnapshot(value: unknown): LocalAgentRoleSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('角色数据不是对象')
  }
  const candidate = value as { schemaVersion?: unknown; roles?: unknown }
  if (candidate.schemaVersion !== STORE_SCHEMA_VERSION || !Array.isArray(candidate.roles)) {
    throw new Error('角色数据版本不受支持')
  }
  const seenIds = new Set<string>()
  const roles = candidate.roles.map((rawRecord) => {
    if (!rawRecord || typeof rawRecord !== 'object' || Array.isArray(rawRecord)) {
      throw new Error('角色记录无效')
    }
    const record = rawRecord as { roleId?: unknown; archived?: unknown; versions?: unknown }
    if (
      typeof record.roleId !== 'string' ||
      !record.roleId.trim() ||
      typeof record.archived !== 'boolean' ||
      !Array.isArray(record.versions) ||
      record.versions.length === 0
    ) {
      throw new Error('角色记录字段无效')
    }
    if (seenIds.has(record.roleId)) throw new Error(`角色标识重复: ${record.roleId}`)
    seenIds.add(record.roleId)
    const seenVersions = new Set<number>()
    const versions = record.versions.map((rawVersion) => {
      if (!rawVersion || typeof rawVersion !== 'object' || Array.isArray(rawVersion)) {
        throw new Error('角色版本无效')
      }
      const item = rawVersion as Record<string, unknown>
      if (
        item.roleId !== record.roleId ||
        !Number.isInteger(item.version) ||
        (item.version as number) < 1 ||
        (item.source !== 'local' && item.source !== 'imported') ||
        typeof item.createdAt !== 'number'
      ) {
        throw new Error('角色版本元数据无效')
      }
      if (seenVersions.has(item.version as number)) throw new Error('角色版本号重复')
      seenVersions.add(item.version as number)
      const draft = normalizeDraft(draftFieldsFromRecord(item))
      return {
        ...draft,
        roleId: record.roleId as string,
        version: item.version as number,
        source: item.source as 'local' | 'imported',
        createdAt: item.createdAt,
      }
    })
    versions.sort((left, right) => left.version - right.version)
    return { roleId: record.roleId, archived: record.archived, versions }
  })
  return { schemaVersion: STORE_SCHEMA_VERSION, roles }
}

export class AgentRoleRegistry {
  private readonly builtin = new BuiltinAgentRoleRegistry()
  private snapshot: LocalAgentRoleSnapshot = emptySnapshot()
  private readonly pendingImports = new Map<string, PendingImport>()

  constructor(
    private readonly store = new AgentRoleStore(),
    private readonly skills = new BuiltinAgentSkillRegistry(),
  ) {}

  async load(): Promise<void> {
    this.snapshot = await this.store.load()
  }

  async flush(): Promise<void> {
    await this.store.flush()
  }

  list(): AgentRoleSummary[] {
    const builtins = this.builtin.list()
    const locals = this.snapshot.roles.flatMap((record) => {
      const latestVersion = Math.max(...record.versions.map((version) => version.version))
      return record.versions.map((version) =>
        toSummary(version, record.archived, version.version === latestVersion),
      )
    })
    return [...builtins, ...locals]
  }

  resolve(ref: AgentRoleRef | null | undefined): BuiltinAgentRole {
    try {
      return this.builtin.resolve(ref)
    } catch (builtinError) {
      if (!ref) throw builtinError
      const version = this.findLocalVersion(ref)
      if (!version) throw builtinError
      return toDefinition(version)
    }
  }

  buildSystemInstructions(role: BuiltinAgentRole): string {
    return this.builtin.buildSystemInstructions(role)
  }

  buildConversationCompatibilityFingerprint(
    runtimeCompatibilityFingerprint: string | null,
    ref: AgentRoleRef | null | undefined,
    configurationRevision = 1,
    skillFingerprints: readonly string[] = [],
  ): string | null {
    if (!runtimeCompatibilityFingerprint) return null
    const role = this.resolve(ref)
    const summary = this.getSummary({ roleId: role.id, version: role.version })
    return createHash('sha256')
      .update(runtimeCompatibilityFingerprint)
      .update('\0')
      .update(role.id)
      .update('\0')
      .update(String(role.version))
      .update('\0')
      .update(String(configurationRevision))
      .update('\0')
      .update(String(AGENT_PROFILE_PROMPT_COMPILER_VERSION))
      .update('\0')
      .update(summary.contentHash)
      .update('\0')
      .update(skillFingerprints.join('\0'))
      .digest('hex')
  }

  async create(draftValue: AgentRoleDraft): Promise<AgentRoleMutationResult> {
    try {
      const draft = normalizeDraft(draftValue)
      const roleId = `local-${randomUUID()}`
      const version: LocalAgentRoleVersion = {
        ...draft,
        roleId,
        version: 1,
        source: 'local',
        createdAt: Date.now(),
      }
      const next = structuredClone(this.snapshot)
      next.roles.push({ roleId, archived: false, versions: [version] })
      await this.commit(next)
      return { success: true, role: toSummary(version, false, true) }
    } catch (error) {
      return mutationFailure(error)
    }
  }

  async update(
    roleId: string,
    baseVersion: number,
    draftValue: AgentRoleDraft,
  ): Promise<AgentRoleMutationResult> {
    try {
      const draft = normalizeDraft(draftValue)
      const record = this.snapshot.roles.find((item) => item.roleId === roleId)
      if (!record) throw new Error('内置角色只读；请先复制为本地角色')
      const latest = record.versions.at(-1)!
      if (latest.version !== baseVersion) {
        throw new Error(`角色已有 v${latest.version}，请先查看最新版本再保存`)
      }
      const version: LocalAgentRoleVersion = {
        ...draft,
        roleId,
        version: latest.version + 1,
        source: latest.source,
        createdAt: Date.now(),
      }
      const next = structuredClone(this.snapshot)
      next.roles.find((item) => item.roleId === roleId)!.versions.push(version)
      await this.commit(next)
      return { success: true, role: toSummary(version, record.archived, true) }
    } catch (error) {
      return mutationFailure(error)
    }
  }

  async copy(ref: AgentRoleRef): Promise<AgentRoleMutationResult> {
    try {
      const source = this.getSummary(ref)
      return this.create({ ...copySummaryToDraft(source), label: `${source.label} 副本` })
    } catch (error) {
      return mutationFailure(error)
    }
  }

  async setArchived(roleId: string, archived: boolean): Promise<AgentRoleMutationResult> {
    try {
      const record = this.snapshot.roles.find((item) => item.roleId === roleId)
      if (!record) throw new Error('内置角色不能归档')
      const next = structuredClone(this.snapshot)
      next.roles.find((item) => item.roleId === roleId)!.archived = archived
      await this.commit(next)
      const latest = record.versions.at(-1)!
      return { success: true, role: toSummary(latest, archived, true) }
    } catch (error) {
      return mutationFailure(error)
    }
  }

  async export(ref: AgentRoleRef, parentDirectory: string): Promise<AgentRoleExportResult> {
    try {
      if (!isAbsolute(parentDirectory)) throw new Error('导出目录必须是绝对路径')
      const summary = this.getSummary(ref)
      const draft = copySummaryToDraft(summary)
      const directoryPath = join(
        parentDirectory,
        safeDirectoryName(`${summary.label}-${summary.roleId}-v${summary.version}`),
      )
      await mkdir(directoryPath, { recursive: false, mode: 0o700 })
      const { soulMarkdown: _soulMarkdown, ...roleWithoutSoul } = draft
      await writeFile(
        join(directoryPath, 'role.json'),
        JSON.stringify(
          {
            schemaVersion: PACKAGE_SCHEMA_VERSION,
            roleId: summary.roleId,
            version: summary.version,
            createdAt: summary.createdAt,
            contentHash: summary.contentHash,
            role: roleWithoutSoul,
          },
          null,
          2,
        ),
        { encoding: 'utf8', mode: 0o600 },
      )
      if (draft.soulMarkdown) {
        await writeFile(join(directoryPath, 'SOUL.md'), draft.soulMarkdown, {
          encoding: 'utf8',
          mode: 0o600,
        })
      }
      return { success: true, directoryPath }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async previewImport(roleJsonPath: string): Promise<AgentRoleImportPreviewResult> {
    try {
      if (!isAbsolute(roleJsonPath)) throw new Error('角色包路径必须是绝对路径')
      if (basename(roleJsonPath).toLowerCase() !== 'role.json') {
        throw new Error('请选择角色包中的 role.json')
      }
      const metadata = await stat(roleJsonPath)
      if (metadata.size > MAX_PACKAGE_BYTES) throw new Error('role.json 超过大小限制')
      const manifest = rolePackageSchema.parse(JSON.parse(await readFile(roleJsonPath, 'utf8')))
      const soul = await readOptionalSoul(dirname(roleJsonPath))
      const draft = normalizeDraft({ ...manifest.role, ...(soul ? { soulMarkdown: soul } : {}) })
      const imported: ImportedRolePackage = {
        roleId: manifest.roleId,
        version: manifest.version,
        createdAt: manifest.createdAt,
        contentHash: manifest.contentHash,
        draft,
      }
      const computedHash = hashRole(imported.roleId, imported.version, imported.draft)
      if (computedHash !== imported.contentHash) {
        throw new Error('角色包内容指纹不匹配，文件可能已被修改或损坏')
      }
      const sameVersion = this.list().find(
        (role) => role.roleId === imported.roleId && role.version === imported.version,
      )
      const sameId = this.list().some((role) => role.roleId === imported.roleId)
      const conflict = sameVersion
        ? sameVersion.contentHash === imported.contentHash
          ? 'same-content'
          : 'same-id'
        : sameId
          ? 'same-id'
          : 'none'
      const role = importedToSummary(imported)
      const availableSkills = this.skills.list()
      const skillStatuses = draft.recommendedSkillRefs.map((ref) => {
        const skill = availableSkills.find(
          (candidate) => candidate.skillId === ref.skillId && candidate.version === ref.version,
        )
        return {
          ...ref,
          available: Boolean(skill?.available),
          ...(skill?.label ? { label: skill.label } : {}),
        }
      })
      const warnings = [
        ...(skillStatuses.some((skill) => !skill.available)
          ? ['部分建议 Skill 当前不可用；角色仍可导入，但不会自动安装或挂载。']
          : []),
        '角色包不能声明工具、权限、凭证或 Provider；导入不会改变任何授权。',
      ]
      const token = randomUUID()
      const preview: AgentRoleImportPreview = {
        token,
        sourceLabel: roleJsonPath,
        role,
        conflict,
        skillStatuses,
        warnings,
      }
      this.prunePendingImports()
      if (this.pendingImports.size >= MAX_PENDING_IMPORTS) {
        const oldest = this.pendingImports.keys().next().value
        if (oldest) this.pendingImports.delete(oldest)
      }
      this.pendingImports.set(token, {
        expiresAt: Date.now() + IMPORT_TOKEN_TTL_MS,
        imported,
        preview,
      })
      return { success: true, preview }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async commitImport(
    token: string,
    decision: AgentRoleImportDecision,
  ): Promise<AgentRoleMutationResult> {
    const pending = this.pendingImports.get(token)
    this.pendingImports.delete(token)
    if (!pending || pending.expiresAt < Date.now()) {
      return { success: false, error: '导入预览已过期，请重新选择角色包' }
    }
    try {
      const { imported, preview } = pending
      if (preview.conflict === 'same-content' && decision === 'update') {
        return { success: true, role: this.getSummary(imported) }
      }
      if (decision === 'copy') {
        return this.create({ ...imported.draft, label: `${imported.draft.label}（导入副本）` })
      }
      if (this.builtin.list().some((role) => role.roleId === imported.roleId)) {
        throw new Error('内置角色不能被导入包更新；请选择另存副本')
      }
      const next = structuredClone(this.snapshot)
      let record = next.roles.find((item) => item.roleId === imported.roleId)
      if (!record) {
        record = { roleId: imported.roleId, archived: false, versions: [] }
        next.roles.push(record)
      }
      const latestVersion = record.versions.at(-1)?.version ?? 0
      const targetVersion =
        imported.version > latestVersion &&
        !record.versions.some((version) => version.version === imported.version)
          ? imported.version
          : latestVersion + 1
      const version: LocalAgentRoleVersion = {
        ...imported.draft,
        roleId: imported.roleId,
        version: targetVersion,
        source: 'imported',
        createdAt: imported.createdAt || Date.now(),
      }
      record.versions.push(version)
      record.versions.sort((left, right) => left.version - right.version)
      await this.commit(next)
      return { success: true, role: toSummary(version, record.archived, true) }
    } catch (error) {
      return mutationFailure(error)
    }
  }

  private getSummary(ref: AgentRoleRef): AgentRoleSummary {
    const summary = this.list().find(
      (role) => role.roleId === ref.roleId && role.version === ref.version,
    )
    if (!summary) throw new Error(`Agent 角色不可用: ${ref.roleId}@${ref.version}`)
    return summary
  }

  private findLocalVersion(ref: AgentRoleRef): LocalAgentRoleVersion | undefined {
    return this.snapshot.roles
      .find((record) => record.roleId === ref.roleId)
      ?.versions.find((version) => version.version === ref.version)
  }

  private async commit(next: LocalAgentRoleSnapshot): Promise<void> {
    await this.store.save(next)
    this.snapshot = next
  }

  private prunePendingImports(): void {
    const now = Date.now()
    for (const [token, pending] of this.pendingImports) {
      if (pending.expiresAt < now) this.pendingImports.delete(token)
    }
  }
}

function importedToSummary(imported: ImportedRolePackage): AgentRoleSummary {
  const version: LocalAgentRoleVersion = {
    ...imported.draft,
    roleId: imported.roleId,
    version: imported.version,
    source: 'imported',
    createdAt: imported.createdAt,
  }
  return toSummary(version, false, true)
}

async function readOptionalSoul(directory: string): Promise<string | undefined> {
  for (const name of ['SOUL.md', 'soul.md']) {
    const path = join(directory, name)
    try {
      const metadata = await stat(path)
      if (metadata.size > MAX_PACKAGE_BYTES) throw new Error(`${name} 超过大小限制`)
      return (await readFile(path, 'utf8')).replace(/\r\n/g, '\n').trim()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return undefined
}

function mutationFailure(error: unknown): AgentRoleMutationResult {
  return { success: false, error: error instanceof Error ? error.message : String(error) }
}
