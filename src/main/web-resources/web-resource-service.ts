import { randomUUID } from 'node:crypto'
import type {
  CreateWebConnectionInput,
  WebAccount,
  WebResourceConnection,
  WebResourceOperationResult,
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

  async createConnection(
    rawInput: CreateWebConnectionInput,
  ): Promise<WebResourceOperationResult<WebResourceConnection>> {
    let resolveResult:
      | ((result: WebResourceOperationResult<WebResourceConnection>) => void)
      | undefined
    const result = new Promise<WebResourceOperationResult<WebResourceConnection>>((resolve) => {
      resolveResult = resolve
    })

    const mutate = async (): Promise<void> => {
      try {
        resolveResult?.(await this.createConnectionNow(rawInput))
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

  private async createConnectionNow(
    rawInput: CreateWebConnectionInput,
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
        item.websiteId === website.id &&
        item.principalId === principal.id &&
        (item.browserProfileId === input.browserProfileId ||
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
      websiteId: website.id,
      principalId: principal.id,
      label: input.accountLabel,
      role: input.accountRole,
      browserProfileId: input.browserProfileId,
      loginHint: input.loginHint,
      createdAt: now,
      updatedAt: now,
    }
    const next: WebResourceSnapshot = {
      schemaVersion: 1,
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
}
