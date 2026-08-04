import { randomUUID } from 'node:crypto'
import type {
  ClaimLegacyWebConnectionsSummary,
  CreateWebConnectionInput,
  WebAccount,
  WebResourceConnection,
  WebResourceOperationResult,
  WebResourceProjectSnapshot,
  WebResourceSnapshot,
} from '../../shared/web-resources/web-resource-types'
import { parseCreateWebConnectionInput } from '../../shared/web-resources/web-resource-schema'
import { WebResourceStore } from './web-resource-store'

const WEBSITE_LIMIT = 1_000
const PRINCIPAL_LIMIT = 500
const ACCOUNT_LIMIT = 2_000

function normalizedKey(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function publicError(error: unknown): WebResourceOperationResult<never> {
  const message = error instanceof Error ? error.message : String(error)
  return {
    success: false,
    error: {
      code: message.includes('限制') ? 'RESOURCE_LIMIT_REACHED' : 'STORAGE_UNAVAILABLE',
      message: message.includes('限制') ? message : '网站与账号数据保存失败',
    },
  }
}

export class WebResourceService {
  private snapshot: WebResourceSnapshot | null = null
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(private readonly store = new WebResourceStore()) {}

  async load(): Promise<void> {
    this.snapshot = await this.store.load()
    this.assertReferentialIntegrity(this.snapshot)
  }

  getSnapshot(): WebResourceOperationResult<WebResourceSnapshot> {
    if (!this.snapshot) {
      return {
        success: false,
        error: { code: 'SERVICE_UNAVAILABLE', message: '网站与账号服务尚未就绪' },
      }
    }
    return { success: true, data: structuredClone(this.snapshot) }
  }

  getProjectSnapshot(projectId: string): WebResourceOperationResult<WebResourceProjectSnapshot> {
    const result = this.getSnapshot()
    if (!result.success) return result
    const accounts = result.data.accounts.filter((account) => account.projectId === projectId)
    const websiteIds = new Set(accounts.map((account) => account.websiteId))
    const principalIds = new Set(accounts.map((account) => account.principalId))
    return {
      success: true,
      data: {
        schemaVersion: 2,
        revision: result.data.revision,
        projectId,
        websites: result.data.websites.filter((website) => websiteIds.has(website.id)),
        principals: result.data.principals.filter((principal) => principalIds.has(principal.id)),
        accounts,
        unassignedAccountCount: result.data.accounts.filter((account) => account.projectId === null)
          .length,
      },
    }
  }

  async createConnection(
    rawInput: CreateWebConnectionInput,
    projectId: string,
    browserProfileId = `web-${randomUUID()}`,
  ): Promise<WebResourceOperationResult<WebResourceConnection>> {
    let resolveResult:
      | ((result: WebResourceOperationResult<WebResourceConnection>) => void)
      | undefined
    const result = new Promise<WebResourceOperationResult<WebResourceConnection>>((resolve) => {
      resolveResult = resolve
    })

    const mutate = async (): Promise<void> => {
      try {
        resolveResult?.(await this.createConnectionNow(rawInput, projectId, browserProfileId))
      } catch (error) {
        resolveResult?.(publicError(error))
      }
    }
    this.mutationQueue = this.mutationQueue.then(mutate, mutate)
    await this.mutationQueue
    return result
  }

  async flush(): Promise<void> {
    await this.mutationQueue
    await this.store.flush()
  }

  async confirmLogin(
    projectId: string,
    accountId: string,
  ): Promise<WebResourceOperationResult<WebResourceConnection>> {
    return this.mutateConnection(async () => {
      if (!this.snapshot) return this.unavailable()
      const account = this.snapshot.accounts.find(
        (item) => item.id === accountId && item.projectId === projectId,
      )
      if (!account) {
        return {
          success: false,
          error: { code: 'RESOURCE_NOT_FOUND', message: '当前项目的网站账号不存在' },
        }
      }
      const website = this.snapshot.websites.find((item) => item.id === account.websiteId)
      const principal = this.snapshot.principals.find((item) => item.id === account.principalId)
      if (!website || !principal) {
        return {
          success: false,
          error: { code: 'RESOURCE_NOT_FOUND', message: '网站账号引用已经失效' },
        }
      }
      const now = new Date().toISOString()
      const confirmed = { ...account, loginConfirmedAt: now, updatedAt: now }
      const next = {
        ...this.snapshot,
        revision: this.snapshot.revision + 1,
        accounts: this.snapshot.accounts.map((item) => (item.id === account.id ? confirmed : item)),
      }
      await this.store.save(next)
      this.snapshot = next
      return {
        success: true,
        data: {
          website: structuredClone(website),
          principal: structuredClone(principal),
          account: structuredClone(confirmed),
        },
      }
    })
  }

  async claimLegacyConnections(
    projectId: string,
  ): Promise<WebResourceOperationResult<ClaimLegacyWebConnectionsSummary>> {
    return this.mutate(async () => {
      if (!this.snapshot) return this.unavailable()
      const claimedCount = this.snapshot.accounts.filter(
        (account) => account.projectId === null,
      ).length
      if (claimedCount === 0) return { success: true, data: { claimedCount: 0 } }
      const now = new Date().toISOString()
      const next = {
        ...this.snapshot,
        revision: this.snapshot.revision + 1,
        accounts: this.snapshot.accounts.map((account) =>
          account.projectId === null
            ? { ...account, projectId, updatedAt: now, loginConfirmedAt: undefined }
            : account,
        ),
      }
      await this.store.save(next)
      this.snapshot = next
      return { success: true, data: { claimedCount } }
    })
  }

  private async createConnectionNow(
    rawInput: CreateWebConnectionInput,
    projectId: string,
    browserProfileId: string,
  ): Promise<WebResourceOperationResult<WebResourceConnection>> {
    if (!this.snapshot) {
      return {
        success: false,
        error: { code: 'SERVICE_UNAVAILABLE', message: '网站与账号服务尚未就绪' },
      }
    }

    let input: CreateWebConnectionInput
    try {
      input = parseCreateWebConnectionInput(rawInput)
    } catch {
      return {
        success: false,
        error: { code: 'INVALID_INPUT', message: '网站或账号参数无效' },
      }
    }

    const url = new URL(input.entryUrl)
    url.hash = ''
    const entryUrl = url.toString()
    const origin = url.origin
    const now = new Date().toISOString()
    const current = this.snapshot

    let website = current.websites.find((item) => item.origin === origin)
    if (!website && current.websites.length >= WEBSITE_LIMIT) {
      return {
        success: false,
        error: { code: 'RESOURCE_LIMIT_REACHED', message: '网站数量已达到限制' },
      }
    }
    website ??= {
      id: randomUUID(),
      name: input.websiteName,
      origin,
      entryUrl,
      notes: input.websiteNotes,
      createdAt: now,
      updatedAt: now,
    }

    let principal = current.principals.find(
      (item) =>
        item.kind === input.principalKind &&
        normalizedKey(item.name) === normalizedKey(input.principalName),
    )
    if (!principal && current.principals.length >= PRINCIPAL_LIMIT) {
      return {
        success: false,
        error: { code: 'RESOURCE_LIMIT_REACHED', message: '主体数量已达到限制' },
      }
    }
    principal ??= {
      id: randomUUID(),
      kind: input.principalKind,
      name: input.principalName,
      createdAt: now,
      updatedAt: now,
    }

    const duplicate = current.accounts.find(
      (item) =>
        item.projectId === projectId &&
        item.websiteId === website.id &&
        item.principalId === principal.id &&
        (item.browserProfileId === browserProfileId ||
          normalizedKey(item.label) === normalizedKey(input.accountLabel)),
    )
    if (duplicate) {
      return {
        success: false,
        error: {
          code: 'DUPLICATE_ACCOUNT',
          message: '该网站、主体下已存在相同账号或 Browser Profile',
        },
      }
    }
    if (current.accounts.length >= ACCOUNT_LIMIT) {
      return {
        success: false,
        error: { code: 'RESOURCE_LIMIT_REACHED', message: '账号数量已达到限制' },
      }
    }

    const account: WebAccount = {
      id: randomUUID(),
      projectId,
      websiteId: website.id,
      principalId: principal.id,
      label: input.accountLabel,
      role: input.accountRole,
      browserProfileId,
      loginHint: input.loginHint,
      createdAt: now,
      updatedAt: now,
    }
    const next: WebResourceSnapshot = {
      schemaVersion: 2,
      revision: current.revision + 1,
      websites: current.websites.some((item) => item.id === website.id)
        ? current.websites
        : [...current.websites, website],
      principals: current.principals.some((item) => item.id === principal.id)
        ? current.principals
        : [...current.principals, principal],
      accounts: [...current.accounts, account],
    }

    await this.store.save(next)
    this.snapshot = next
    return {
      success: true,
      data: {
        website: structuredClone(website),
        principal: structuredClone(principal),
        account: structuredClone(account),
      },
    }
  }

  private assertReferentialIntegrity(snapshot: WebResourceSnapshot): void {
    const websiteIds = new Set(snapshot.websites.map((item) => item.id))
    const principalIds = new Set(snapshot.principals.map((item) => item.id))
    for (const account of snapshot.accounts) {
      if (!websiteIds.has(account.websiteId) || !principalIds.has(account.principalId)) {
        throw new Error('网站与账号数据存在失效引用')
      }
    }
  }

  private unavailable<T>(): WebResourceOperationResult<T> {
    return {
      success: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: '网站与账号服务尚未就绪' },
    }
  }

  private async mutate<T>(
    operation: () => Promise<WebResourceOperationResult<T>>,
  ): Promise<WebResourceOperationResult<T>> {
    let resolveResult: ((result: WebResourceOperationResult<T>) => void) | undefined
    const result = new Promise<WebResourceOperationResult<T>>((resolve) => {
      resolveResult = resolve
    })
    const mutate = async (): Promise<void> => {
      try {
        resolveResult?.(await operation())
      } catch (error) {
        resolveResult?.(publicError(error))
      }
    }
    this.mutationQueue = this.mutationQueue.then(mutate, mutate)
    await this.mutationQueue
    return result
  }

  private mutateConnection(
    operation: () => Promise<WebResourceOperationResult<WebResourceConnection>>,
  ): Promise<WebResourceOperationResult<WebResourceConnection>> {
    return this.mutate(operation)
  }
}
