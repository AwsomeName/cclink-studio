/**
 * McpClientManager — external MCP non-secret configuration owner.
 *
 * `mcp-servers.json` stores only connection metadata plus immutable CredentialService revision
 * references. External servers remain runtime-disabled until a separate authorization ADR lands.
 */

import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  ExternalMcpCredentialInput,
  ExternalMcpServer,
  ExternalMcpServerInput,
} from '../../shared/ipc/agent'
import type { CredentialService } from '../credentials/credential-service'

export type { ExternalMcpServer, ExternalMcpServerInput } from '../../shared/ipc/agent'

const CONFIG_SCHEMA_VERSION = 2
const MAX_CONFIG_BYTES = 1_048_576
const MAX_SERVERS = 128
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

interface McpCredentialRef {
  credentialId: string
  revision: string
}

interface StoredMcpServer {
  serverId: string
  name: string
  transport: 'stdio' | 'http' | 'sse'
  command?: string
  args?: string[]
  url?: string
  enabled: boolean
  credentialRef?: McpCredentialRef
}

interface McpServersConfigV2 {
  schemaVersion: 2
  servers: StoredMcpServer[]
}

interface LegacyMcpServer extends Omit<ExternalMcpServerInput, 'credentials'> {
  env?: Record<string, string>
  headers?: Record<string, string>
}

interface McpClientManagerDependencies {
  writeConfig?: (configPath: string, config: McpServersConfigV2) => Promise<void>
  createServerId?: () => string
  createRevision?: () => string
}

export class McpClientManager {
  private servers: StoredMcpServer[] = []
  private loaded = false
  private lifecycleState: 'loading' | 'ready' | 'migration-blocked' | 'cleanup-needed' = 'loading'
  private loadError: string | null = null
  private pendingMutation: Promise<void> = Promise.resolve()
  private readonly writeConfig: (configPath: string, config: McpServersConfigV2) => Promise<void>
  private readonly createServerId: () => string
  private readonly createRevision: () => string

  constructor(
    private readonly credentialService: CredentialService,
    private readonly configPath = join(app.getPath('userData'), 'mcp-servers.json'),
    dependencies: McpClientManagerDependencies = {},
  ) {
    this.writeConfig = dependencies.writeConfig ?? writeConfigAtomically
    this.createServerId = dependencies.createServerId ?? randomUUID
    this.createRevision = dependencies.createRevision ?? randomUUID
  }

  async loadFromConfig(): Promise<void> {
    await this.enqueueMutation(async () => {
      try {
        await this.credentialService.ensureLoaded()
        const raw = await readConfigFile(this.configPath)
        if (raw === null) {
          const empty: McpServersConfigV2 = { schemaVersion: CONFIG_SCHEMA_VERSION, servers: [] }
          await this.writeConfig(this.configPath, empty)
          this.servers = []
        } else {
          const parsed = parseJson(raw)
          if (isV2Config(parsed)) {
            this.servers = parseV2Config(parsed).servers
          } else {
            this.servers = await this.migrateLegacyConfig(parsed)
          }
        }
        await this.cleanupOrphanRevisions(referencedCredentialIds(this.servers))
        this.lifecycleState = 'ready'
        this.loadError = null
      } catch (error) {
        this.servers = []
        this.lifecycleState = 'migration-blocked'
        this.loadError = safeErrorMessage(error, '外部 MCP 配置加载或凭证迁移失败')
      } finally {
        this.loaded = true
      }
    })
  }

  getStatus(): {
    state: 'loading' | 'ready' | 'migration-blocked' | 'cleanup-needed'
    error?: string
  } {
    return {
      state: this.lifecycleState,
      ...(this.loadError ? { error: this.loadError } : {}),
    }
  }

  getAllServers(): ExternalMcpServer[] {
    if (!this.loaded) throw new Error('外部 MCP 配置尚未加载')
    if (this.lifecycleState === 'migration-blocked') {
      throw new Error(this.loadError ?? '外部 MCP 配置迁移被阻止')
    }
    return this.servers.map((server) => this.toRendererDto(server))
  }

  /** External runtime remains disabled. This projection is for configuration UI only. */
  getEnabledServers(): ExternalMcpServer[] {
    return this.getAllServers().filter((server) => server.enabled)
  }

  composeMcpConfig(internalPort: number, sessionToken?: string): Record<string, unknown> {
    const internalUrl = new URL(`http://127.0.0.1:${internalPort}/mcp`)
    if (sessionToken) internalUrl.searchParams.set('session', sessionToken)
    return {
      mcpServers: {
        cclink_studio: { type: 'http', url: internalUrl.toString() },
      },
    }
  }

  async addServer(input: ExternalMcpServerInput): Promise<void> {
    await this.enqueueMutation(async () => {
      this.assertMutable()
      assertValidInput(input)
      assertAvailableName(this.servers, input.name)

      const serverId = this.createServerId()
      const credentialRef = await this.createCredentialRevision(serverId, input.credentials)
      const server: StoredMcpServer = {
        serverId,
        ...nonSecretFields(input),
        ...(credentialRef ? { credentialRef } : {}),
      }
      const next = [...this.servers, server]
      try {
        await this.persist(next)
      } catch (error) {
        await this.removeCredentialRevision(credentialRef)
        throw error
      }
      this.servers = next
    })
  }

  async updateServer(name: string, updates: Partial<ExternalMcpServerInput>): Promise<boolean> {
    return this.enqueueMutation(async () => {
      this.assertMutable()
      const index = this.servers.findIndex((server) => server.name === name)
      if (index < 0) return false
      const current = this.servers[index]
      const nextTransport = updates.transport ?? current.transport
      const candidateInput: ExternalMcpServerInput = {
        name: updates.name ?? current.name,
        transport: nextTransport,
        ...(nextTransport === 'stdio'
          ? {
              command:
                updates.command ?? (current.transport === 'stdio' ? current.command : undefined),
              args: updates.args ?? (current.transport === 'stdio' ? current.args : undefined),
            }
          : {
              url: updates.url ?? (current.transport !== 'stdio' ? current.url : undefined),
            }),
        enabled: updates.enabled ?? current.enabled,
      }
      assertValidInput(candidateInput)
      if (candidateInput.name !== name) assertAvailableName(this.servers, candidateInput.name)

      const replacesCredential = Object.prototype.hasOwnProperty.call(updates, 'credentials')
      const nextCredentialRef = replacesCredential
        ? await this.createCredentialRevision(current.serverId, updates.credentials)
        : current.credentialRef
      const replacement: StoredMcpServer = {
        serverId: current.serverId,
        ...nonSecretFields(candidateInput),
        ...(nextCredentialRef ? { credentialRef: nextCredentialRef } : {}),
      }
      const next = [...this.servers]
      next[index] = replacement
      try {
        await this.persist(next)
      } catch (error) {
        if (replacesCredential) await this.removeCredentialRevision(nextCredentialRef)
        throw error
      }
      this.servers = next
      if (replacesCredential && !sameCredentialRef(current.credentialRef, nextCredentialRef)) {
        await this.removeCredentialRevision(current.credentialRef)
      }
      return true
    })
  }

  async removeServer(name: string): Promise<boolean> {
    return this.enqueueMutation(async () => {
      this.assertMutable()
      const current = this.servers.find((server) => server.name === name)
      if (!current) return false
      const next = this.servers.filter((server) => server.serverId !== current.serverId)
      await this.persist(next)
      this.servers = next
      await this.removeCredentialRevision(current.credentialRef)
      return true
    })
  }

  async copyServer(name: string, newName: string): Promise<boolean> {
    return this.enqueueMutation(async () => {
      this.assertMutable()
      const source = this.servers.find((server) => server.name === name)
      if (!source) return false
      assertValidName(newName)
      assertAvailableName(this.servers, newName)
      const serverId = this.createServerId()
      const sourceCredential = this.resolveCredential(source.credentialRef)
      if (source.credentialRef && !sourceCredential) {
        throw new Error('源 MCP 的凭证引用已失效，拒绝复制')
      }
      const credentialRef = await this.createCredentialRevision(serverId, sourceCredential)
      const copy: StoredMcpServer = {
        ...source,
        serverId,
        name: newName,
        ...(credentialRef ? { credentialRef } : { credentialRef: undefined }),
      }
      const next = [...this.servers, copy]
      try {
        await this.persist(next)
      } catch (error) {
        await this.removeCredentialRevision(credentialRef)
        throw error
      }
      this.servers = next
      return true
    })
  }

  private async migrateLegacyConfig(value: unknown): Promise<StoredMcpServer[]> {
    const legacyServers = parseLegacyConfig(value)
    await this.cleanupOrphanRevisions(new Set())
    const migrated: StoredMcpServer[] = []
    const createdRefs: McpCredentialRef[] = []
    try {
      for (const legacy of legacyServers) {
        const serverId = this.createServerId()
        const credentialRef = await this.createCredentialRevision(serverId, {
          env: legacy.env,
          headers: legacy.headers,
        })
        if (credentialRef) createdRefs.push(credentialRef)
        migrated.push({
          serverId,
          ...nonSecretFields(legacy),
          ...(credentialRef ? { credentialRef } : {}),
        })
      }
      await this.persist(migrated)
      return migrated
    } catch (error) {
      await Promise.all(createdRefs.map((ref) => this.removeCredentialRevision(ref)))
      throw error
    }
  }

  private async createCredentialRevision(
    serverId: string,
    input: ExternalMcpCredentialInput | null | undefined,
  ): Promise<McpCredentialRef | undefined> {
    const normalized = normalizeCredentialInput(input)
    if (!normalized) return undefined
    const ref = { credentialId: `mcp:${serverId}`, revision: this.createRevision() }
    if (this.credentialService.resolveCredential(credentialStorageId(ref))) {
      throw new Error('MCP credential revision 冲突，拒绝覆盖不可变凭证')
    }
    await this.credentialService.setCredential({
      id: credentialStorageId(ref),
      kind: 'generic',
      fields: {
        ...(normalized.env ? { envJson: JSON.stringify(normalized.env) } : {}),
        ...(normalized.headers ? { headersJson: JSON.stringify(normalized.headers) } : {}),
      },
    })
    return ref
  }

  private resolveCredential(ref: McpCredentialRef | undefined): ExternalMcpCredentialInput | null {
    if (!ref) return null
    try {
      const record = this.credentialService.resolveCredential(credentialStorageId(ref))
      if (!record) return null
      return {
        ...(record.envJson ? { env: parseSecretRecord(record.envJson) } : {}),
        ...(record.headersJson ? { headers: parseSecretRecord(record.headersJson) } : {}),
      }
    } catch {
      return null
    }
  }

  private async removeCredentialRevision(ref: McpCredentialRef | undefined): Promise<void> {
    if (!ref) return
    try {
      await this.credentialService.removeCredential(credentialStorageId(ref))
    } catch {
      // The config/reference transaction is already committed. Recovery removes this orphan later.
      this.lifecycleState = 'cleanup-needed'
      this.loadError = '外部 MCP 旧凭证 revision 清理失败；将在下次加载重试'
    }
  }

  private async cleanupOrphanRevisions(referenced: Set<string>): Promise<void> {
    for (const metadata of this.credentialService.listMetadata()) {
      if (metadata.id.startsWith('mcp:') && !referenced.has(metadata.id)) {
        await this.credentialService.removeCredential(metadata.id)
      }
    }
  }

  private toRendererDto(server: StoredMcpServer): ExternalMcpServer {
    const credential = this.resolveCredential(server.credentialRef)
    return {
      serverId: server.serverId,
      name: server.name,
      transport: server.transport,
      ...(server.command ? { command: server.command } : {}),
      ...(server.args ? { args: [...server.args] } : {}),
      ...(server.url ? { url: server.url } : {}),
      enabled: server.enabled,
      credentialConfigured: Boolean(credential),
      credentialMissing: Boolean(server.credentialRef && !credential),
      envKeys: Object.keys(credential?.env ?? {}).sort(),
      headerNames: Object.keys(credential?.headers ?? {}).sort(),
    }
  }

  private async persist(servers: StoredMcpServer[]): Promise<void> {
    await this.writeConfig(this.configPath, {
      schemaVersion: CONFIG_SCHEMA_VERSION,
      servers: servers.map(cloneStoredServer),
    })
  }

  private assertMutable(): void {
    if (!this.loaded) throw new Error('外部 MCP 配置尚未加载')
    if (this.lifecycleState !== 'ready') {
      throw new Error(this.loadError ?? '外部 MCP 配置不在可修改状态')
    }
  }

  private async enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pendingMutation.catch(() => undefined).then(operation)
    this.pendingMutation = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}

async function readConfigFile(configPath: string): Promise<string | null> {
  try {
    const buffer = await readFile(configPath)
    if (buffer.byteLength > MAX_CONFIG_BYTES) throw new Error('外部 MCP 配置超过 1 MB 限制')
    return buffer.toString('utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function writeConfigAtomically(
  configPath: string,
  config: McpServersConfigV2,
): Promise<void> {
  const serialized = `${JSON.stringify(config, null, 2)}\n`
  if (Buffer.byteLength(serialized, 'utf8') > MAX_CONFIG_BYTES) {
    throw new Error('外部 MCP 配置超过 1 MB 限制')
  }
  const directory = dirname(configPath)
  const temporaryPath = join(directory, `.mcp-servers.${process.pid}.${randomUUID()}.tmp`)
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await writeFile(temporaryPath, serialized, { encoding: 'utf8', mode: 0o600 })
    await rename(temporaryPath, configPath)
    await chmod(configPath, 0o600)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error('外部 MCP 配置不是有效 JSON')
  }
}

function isV2Config(value: unknown): boolean {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as { schemaVersion?: unknown }).schemaVersion === 2,
  )
}

function parseV2Config(value: unknown): McpServersConfigV2 {
  const root = requireRecord(value, '外部 MCP 配置结构无效')
  if (Object.keys(root).some((key) => key !== 'schemaVersion' && key !== 'servers')) {
    throw new Error('外部 MCP 配置包含未知顶层字段')
  }
  if (root.schemaVersion !== CONFIG_SCHEMA_VERSION || !Array.isArray(root.servers)) {
    throw new Error('外部 MCP 配置版本或结构无效')
  }
  if (root.servers.length > MAX_SERVERS) throw new Error('外部 MCP Server 数量超过限制')
  const servers = root.servers.map(parseStoredServer)
  assertUniqueServers(servers)
  return { schemaVersion: CONFIG_SCHEMA_VERSION, servers }
}

function parseLegacyConfig(value: unknown): LegacyMcpServer[] {
  const root = requireRecord(value, '旧版外部 MCP 配置结构无效')
  if (!Array.isArray(root.servers) || root.servers.length > MAX_SERVERS) {
    throw new Error('旧版外部 MCP 配置 Server 列表无效')
  }
  const names = new Set<string>()
  return root.servers.map((item) => {
    const server = requireRecord(item, '旧版外部 MCP Server 结构无效')
    const legacy: LegacyMcpServer = {
      name: stringField(server.name, 'MCP 名称无效'),
      transport: transportField(server.transport),
      enabled: booleanField(server.enabled, 'MCP enabled 无效'),
      ...(server.command === undefined
        ? {}
        : { command: stringField(server.command, 'MCP 命令无效') }),
      ...(server.args === undefined ? {} : { args: stringArrayField(server.args) }),
      ...(server.url === undefined ? {} : { url: stringField(server.url, 'MCP URL 无效') }),
      ...(server.env === undefined ? {} : { env: recordField(server.env) }),
      ...(server.headers === undefined ? {} : { headers: recordField(server.headers) }),
    }
    assertValidInput({ ...legacy, credentials: { env: legacy.env, headers: legacy.headers } })
    if (names.has(legacy.name)) throw new Error('旧版外部 MCP 配置包含重名 Server')
    names.add(legacy.name)
    return legacy
  })
}

function parseStoredServer(value: unknown): StoredMcpServer {
  const server = requireRecord(value, '外部 MCP Server 结构无效')
  const allowed = new Set([
    'serverId',
    'name',
    'transport',
    'command',
    'args',
    'url',
    'enabled',
    'credentialRef',
  ])
  if (Object.keys(server).some((key) => !allowed.has(key)))
    throw new Error('外部 MCP Server 包含未知字段')
  const stored: StoredMcpServer = {
    serverId: stableIdField(server.serverId, 'MCP serverId 无效'),
    name: stringField(server.name, 'MCP 名称无效'),
    transport: transportField(server.transport),
    enabled: booleanField(server.enabled, 'MCP enabled 无效'),
    ...(server.command === undefined
      ? {}
      : { command: stringField(server.command, 'MCP 命令无效') }),
    ...(server.args === undefined ? {} : { args: stringArrayField(server.args) }),
    ...(server.url === undefined ? {} : { url: stringField(server.url, 'MCP URL 无效') }),
  }
  if (server.credentialRef !== undefined) {
    const ref = requireRecord(server.credentialRef, 'MCP credentialRef 无效')
    if (Object.keys(ref).some((key) => key !== 'credentialId' && key !== 'revision')) {
      throw new Error('MCP credentialRef 包含未知字段')
    }
    stored.credentialRef = {
      credentialId: stringField(ref.credentialId, 'MCP credentialId 无效'),
      revision: stableIdField(ref.revision, 'MCP credential revision 无效'),
    }
    if (stored.credentialRef.credentialId !== `mcp:${stored.serverId}`) {
      throw new Error('MCP credentialRef 与 serverId 不匹配')
    }
  }
  assertValidInput(nonSecretFields(stored))
  return stored
}

function nonSecretFields(input: ExternalMcpServerInput | LegacyMcpServer | StoredMcpServer) {
  return {
    name: input.name,
    transport: input.transport,
    ...(input.command ? { command: input.command } : {}),
    ...(input.args ? { args: [...input.args] } : {}),
    ...(input.url ? { url: input.url } : {}),
    enabled: input.enabled,
  }
}

function assertValidInput(input: ExternalMcpServerInput): void {
  assertValidName(input.name)
  if (!['stdio', 'http', 'sse'].includes(input.transport)) throw new Error('不支持的 MCP 传输类型')
  if (input.transport === 'stdio' && !input.command?.trim())
    throw new Error('stdio MCP 必须配置启动命令')
  if (input.transport !== 'stdio') {
    if (!input.url?.trim()) throw new Error('远程 MCP 必须配置 URL')
    const url = new URL(input.url)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('MCP URL 仅支持 http 或 https')
    if (url.username || url.password) throw new Error('MCP URL 不得包含用户名或密码')
  }
  normalizeCredentialInput(input.credentials)
}

function assertValidName(name: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(name) || DANGEROUS_KEYS.has(name)) {
    throw new Error('MCP 名称无效或使用了保留原型键')
  }
  if (name === 'cclink_studio') throw new Error('不允许使用保留名称 "cclink_studio"')
}

function assertAvailableName(servers: StoredMcpServer[], name: string): void {
  if (servers.some((server) => server.name === name)) throw new Error(`MCP server "${name}" 已存在`)
}

function assertUniqueServers(servers: StoredMcpServer[]): void {
  const ids = new Set<string>()
  const names = new Set<string>()
  for (const server of servers) {
    if (ids.has(server.serverId) || names.has(server.name))
      throw new Error('外部 MCP 配置包含重复 ID 或名称')
    ids.add(server.serverId)
    names.add(server.name)
  }
}

function normalizeCredentialInput(
  input: ExternalMcpCredentialInput | null | undefined,
): ExternalMcpCredentialInput | null {
  if (!input) return null
  const env = input.env && Object.keys(input.env).length > 0 ? recordField(input.env) : undefined
  const headers =
    input.headers && Object.keys(input.headers).length > 0 ? recordField(input.headers) : undefined
  if (!env && !headers) {
    throw new Error('MCP 凭证更新必须包含 env/header，清除请使用 null')
  }
  return { ...(env ? { env } : {}), ...(headers ? { headers } : {}) }
}

function parseSecretRecord(raw: string): Record<string, string> {
  return recordField(parseJson(raw))
}

function credentialStorageId(ref: McpCredentialRef): string {
  return `${ref.credentialId}:${ref.revision}`
}

function referencedCredentialIds(servers: StoredMcpServer[]): Set<string> {
  return new Set(
    servers.flatMap((server) =>
      server.credentialRef ? [credentialStorageId(server.credentialRef)] : [],
    ),
  )
}

function sameCredentialRef(left?: McpCredentialRef, right?: McpCredentialRef): boolean {
  return left?.credentialId === right?.credentialId && left?.revision === right?.revision
}

function cloneStoredServer(server: StoredMcpServer): StoredMcpServer {
  return {
    ...server,
    args: server.args ? [...server.args] : undefined,
    credentialRef: server.credentialRef ? { ...server.credentialRef } : undefined,
  }
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message)
  return value as Record<string, unknown>
}

function recordField(value: unknown): Record<string, string> {
  const record = requireRecord(value, 'MCP 凭证字段必须是对象')
  const entries = Object.entries(record)
  if (entries.length > 128) throw new Error('MCP 凭证字段数量超过限制')
  const result: Record<string, string> = Object.create(null)
  for (const [key, raw] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9._-]{0,255}$/.test(key) || DANGEROUS_KEYS.has(key))
      throw new Error('MCP 凭证键名无效')
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > 8_192)
      throw new Error('MCP 凭证值无效')
    result[key] = raw
  }
  return result
}

function stringField(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 32_768)
    throw new Error(message)
  return value
}

function stableIdField(value: unknown, message: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value))
    throw new Error(message)
  return value
}

function transportField(value: unknown): 'stdio' | 'http' | 'sse' {
  if (value !== 'stdio' && value !== 'http' && value !== 'sse')
    throw new Error('MCP transport 无效')
  return value
}

function booleanField(value: unknown, message: string): boolean {
  if (typeof value !== 'boolean') throw new Error(message)
  return value
}

function stringArrayField(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 128 ||
    value.some((item) => typeof item !== 'string' || item.length > 8_192)
  )
    throw new Error('MCP 参数无效')
  return [...value] as string[]
}

function safeErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}
