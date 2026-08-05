import { randomUUID } from 'node:crypto'
import type {
  ClaimLegacyWebConnectionsSummary,
  BeginWebResourceDraftResult,
  CancelWebResourceDraftResult,
  CreateWebConnectionInput,
  SaveWebResourceDraftInput,
  WebAccount,
  WebResourceConnection,
  WebResourceOperationResult,
  WebResourceLaunchDescriptor,
  WebResourceProjectSnapshot,
  WebResourceSnapshot,
} from '../../shared/web-resources/web-resource-types'
import { parseCreateWebConnectionInput } from '../../shared/web-resources/web-resource-schema'
import { WebResourceStore } from './web-resource-store'
import { WebResourceDraftStore, type WebResourceDraftRecord } from './web-resource-draft-store'

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
  private drafts: WebResourceDraftRecord[] = []
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly store = new WebResourceStore(),
    private readonly draftStore = new WebResourceDraftStore(),
  ) {}

  async load(): Promise<void> {
    ;[this.snapshot, this.drafts] = await Promise.all([this.store.load(), this.draftStore.load()])
    this.assertReferentialIntegrity(this.snapshot)
  }

  async beginDraft(
    workspaceId: string,
  ): Promise<WebResourceOperationResult<BeginWebResourceDraftResult>> {
    return this.mutate(async () => {
      if (!this.snapshot) return this.unavailable()
      if (this.drafts.length >= 200) {
        return {
          success: false,
          error: { code: 'RESOURCE_LIMIT_REACHED', message: '未完成的网站账号草稿过多' },
        }
      }
      const id = randomUUID()
      const now = new Date().toISOString()
      const record: WebResourceDraftRecord = {
        id,
        workspaceId,
        browserProfileId: `web-draft-${id}`,
        state: 'open',
        createdAt: now,
        updatedAt: now,
      }
      await this.draftStore.save([...this.drafts, record])
      this.drafts = [...this.drafts, record]
      return { success: true, data: { draftId: id, browserProfileId: record.browserProfileId } }
    })
  }

  async saveDraft(
    workspaceId: string,
    input: SaveWebResourceDraftInput,
    browserState: { url: string | null; title: string | null; profileId: string | null },
  ): Promise<WebResourceOperationResult<WebResourceConnection>> {
    return this.mutateConnection(async () => {
      if (!this.snapshot) return this.unavailable()
      const draft = this.drafts.find(
        (item) => item.id === input.draftId && item.workspaceId === workspaceId,
      )
      if (!draft) {
        const converted = browserState.profileId
          ? this.getConnectionByProfile(workspaceId, browserState.profileId)
          : undefined
        return converted ? { success: true, data: converted } : this.draftNotFound()
      }
      if (browserState.profileId !== draft.browserProfileId) {
        return {
          success: false,
          error: { code: 'DRAFT_MISMATCH', message: '当前标签页不属于这个网站账号草稿' },
        }
      }
      const existing = this.getConnectionByProfile(workspaceId, draft.browserProfileId)
      if (existing) {
        await this.removeDraftBestEffort(draft.id)
        return { success: true, data: existing }
      }
      let url: URL
      try {
        url = new URL(browserState.url ?? '')
        if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported')
      } catch {
        return {
          success: false,
          error: {
            code: 'INVALID_BROWSER_STATE',
            message: '请先在当前标签页打开要保存的网站',
          },
        }
      }
      const displayName = input.displayName.trim()
      if (!displayName || displayName.length > 160) {
        return {
          success: false,
          error: { code: 'INVALID_INPUT', message: '请输入 1–160 个字符的账号名称' },
        }
      }
      const savingDraft = {
        ...draft,
        state: 'saving' as const,
        updatedAt: new Date().toISOString(),
      }
      const nextDrafts = this.drafts.map((item) => (item.id === draft.id ? savingDraft : item))
      await this.draftStore.save(nextDrafts)
      this.drafts = nextDrafts

      const websiteName = browserState.title?.trim().slice(0, 120) || url.hostname
      const created = await this.createConnectionNow(
        {
          workspaceRef: input.workspaceRef,
          websiteName,
          entryUrl: url.toString(),
          principalKind: 'organization',
          principalName: displayName,
          accountLabel: displayName,
        },
        workspaceId,
        draft.browserProfileId,
        true,
        input.duplicateResolution === 'save-another',
      )
      if (!created.success) {
        const reopened = {
          ...savingDraft,
          state: 'open' as const,
          updatedAt: new Date().toISOString(),
        }
        const reopenedDrafts = this.drafts.map((item) => (item.id === draft.id ? reopened : item))
        await this.draftStore.save(reopenedDrafts)
        this.drafts = reopenedDrafts
        return created
      }
      await this.removeDraftBestEffort(draft.id)
      return created
    })
  }

  async cancelDraft(
    workspaceId: string,
    draftId: string,
    browserProfileId: string | null,
    cleanupProfile: (profileId: string) => Promise<void>,
  ): Promise<WebResourceOperationResult<CancelWebResourceDraftResult>> {
    return this.mutate(async () => {
      const draft = this.drafts.find(
        (item) => item.id === draftId && item.workspaceId === workspaceId,
      )
      if (!draft) return this.draftNotFound()
      if (browserProfileId && browserProfileId !== draft.browserProfileId) {
        return {
          success: false,
          error: { code: 'DRAFT_MISMATCH', message: '当前标签页不属于这个网站账号草稿' },
        }
      }
      const pending = {
        ...draft,
        state: 'cleanup-pending' as const,
        updatedAt: new Date().toISOString(),
      }
      const nextDrafts = this.drafts.map((item) => (item.id === draft.id ? pending : item))
      await this.draftStore.save(nextDrafts)
      this.drafts = nextDrafts
      try {
        await cleanupProfile(draft.browserProfileId)
        const remaining = this.drafts.filter((item) => item.id !== draft.id)
        await this.draftStore.save(remaining)
        this.drafts = remaining
        return { success: true, data: { draftId, cleaned: true } }
      } catch (error) {
        console.error('[WebResourceService] 网站账号草稿清理失败:', error)
        return {
          success: false,
          error: { code: 'CLEANUP_FAILED', message: '草稿登录环境清理失败，请重试关闭' },
        }
      }
    })
  }

  async reconcileDrafts(cleanupProfile: (profileId: string) => Promise<void>): Promise<void> {
    await this.mutate(async () => {
      const remaining: WebResourceDraftRecord[] = []
      for (const draft of this.drafts) {
        if (this.getConnectionByProfile(draft.workspaceId, draft.browserProfileId)) continue
        try {
          await cleanupProfile(draft.browserProfileId)
        } catch (error) {
          console.error('[WebResourceService] 遗留网站账号草稿清理失败:', error)
          remaining.push({
            ...draft,
            state: 'cleanup-pending',
            updatedAt: new Date().toISOString(),
          })
        }
      }
      await this.draftStore.save(remaining)
      this.drafts = remaining
      return { success: true, data: undefined }
    })
  }

  resolveLaunch(
    workspaceId: string,
    accountId: string,
  ): WebResourceOperationResult<WebResourceLaunchDescriptor> {
    const connection = this.getConnection(workspaceId, accountId)
    if (!connection) {
      return {
        success: false,
        error: { code: 'RESOURCE_NOT_FOUND', message: '当前项目的网站账号不存在' },
      }
    }
    return {
      success: true,
      data: {
        webResourceRef: {
          projectId: workspaceId,
          accountId: connection.account.id,
        },
        title: connection.website.name,
        entryUrl: connection.website.entryUrl,
        browserProfileId: connection.account.browserProfileId,
      },
    }
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
    await Promise.all([this.store.flush(), this.draftStore.flush()])
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
    loginConfirmed = false,
    allowDuplicateLabel = false,
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

    const profileDuplicate = current.accounts.find(
      (item) =>
        item.projectId === projectId &&
        item.websiteId === website.id &&
        item.principalId === principal.id &&
        item.browserProfileId === browserProfileId,
    )
    if (profileDuplicate) {
      return {
        success: false,
        error: {
          code: 'DUPLICATE_ACCOUNT',
          message: '该 Browser Profile 已经保存为项目账号',
          context: { existingAccountId: profileDuplicate.id },
        },
      }
    }
    const labelDuplicate = current.accounts.find(
      (item) =>
        item.projectId === projectId &&
        item.websiteId === website.id &&
        item.principalId === principal.id &&
        normalizedKey(item.label) === normalizedKey(input.accountLabel),
    )
    if (labelDuplicate && !allowDuplicateLabel) {
      return {
        success: false,
        error: {
          code: 'DUPLICATE_ACCOUNT',
          message: '当前项目已存在名称相同的网站账号',
          context: { existingAccountId: labelDuplicate.id },
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
      loginConfirmedAt: loginConfirmed ? now : undefined,
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

  private getConnection(workspaceId: string, accountId: string): WebResourceConnection | null {
    if (!this.snapshot) return null
    const account = this.snapshot.accounts.find(
      (item) => item.id === accountId && item.projectId === workspaceId,
    )
    if (!account) return null
    const website = this.snapshot.websites.find((item) => item.id === account.websiteId)
    const principal = this.snapshot.principals.find((item) => item.id === account.principalId)
    return website && principal
      ? {
          website: structuredClone(website),
          principal: structuredClone(principal),
          account: structuredClone(account),
        }
      : null
  }

  private getConnectionByProfile(
    workspaceId: string,
    browserProfileId: string,
  ): WebResourceConnection | null {
    const account = this.snapshot?.accounts.find(
      (item) => item.projectId === workspaceId && item.browserProfileId === browserProfileId,
    )
    return account ? this.getConnection(workspaceId, account.id) : null
  }

  private draftNotFound<T>(): WebResourceOperationResult<T> {
    return {
      success: false,
      error: { code: 'DRAFT_NOT_FOUND', message: '网站账号草稿不存在或已经处理' },
    }
  }

  private async removeDraftBestEffort(draftId: string): Promise<void> {
    const remaining = this.drafts.filter((item) => item.id !== draftId)
    try {
      await this.draftStore.save(remaining)
      this.drafts = remaining
    } catch (error) {
      console.warn('[WebResourceService] 正式资源已保存，草稿索引将在下次启动时回收:', error)
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
