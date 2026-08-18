import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({ userData: '' }))

vi.mock('electron', () => ({
  app: {
    getPath: () => electronMock.userData,
  },
}))

import type { CreateWebConnectionInput } from '../../shared/web-resources/web-resource-types'
import { WebResourceService } from './web-resource-service'
import { WebResourceStore } from './web-resource-store'
import { WebResourceDraftStore } from './web-resource-draft-store'

let tempDir = ''
let storePath = ''
const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_PROJECT_ID = '22222222-2222-4222-8222-222222222222'

const baseInput: CreateWebConnectionInput = {
  workspaceRef: { kind: 'local', path: '/tmp/cclink-project' },
  websiteName: 'App Store Connect',
  entryUrl: 'https://appstoreconnect.apple.com/apps',
  principalKind: 'company',
  principalName: 'Example Technology Ltd.',
  accountLabel: 'Release account',
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'cclink-studio-web-resources-'))
  electronMock.userData = tempDir
  storePath = join(tempDir, 'web-resources.json')
})

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
})

describe('WebResourceService', () => {
  it('turns one observed browser draft into a confirmed project resource using the same profile', async () => {
    const draftPath = join(tempDir, 'web-resource-drafts.json')
    const service = new WebResourceService(
      new WebResourceStore(storePath),
      new WebResourceDraftStore(draftPath),
    )
    await service.load()

    const begun = await service.beginDraft(PROJECT_ID)
    expect(begun.success).toBe(true)
    if (!begun.success) return

    const saved = await service.saveDraft(
      PROJECT_ID,
      {
        workspaceRef: baseInput.workspaceRef,
        draftId: begun.data.draftId,
        tabId: 'tab-draft',
        displayName: '张三公司',
      },
      {
        url: 'https://appstoreconnect.apple.com/apps',
        title: 'App Store Connect',
        profileId: begun.data.browserProfileId,
      },
    )

    expect(saved).toMatchObject({
      success: true,
      data: {
        website: { name: 'App Store Connect' },
        account: {
          label: '张三公司',
          browserProfileId: begun.data.browserProfileId,
          loginConfirmedAt: expect.any(String),
        },
      },
    })
    expect(JSON.parse(await readFile(draftPath, 'utf8'))).toEqual({
      schemaVersion: 1,
      records: [],
    })

    const repeated = await service.saveDraft(
      PROJECT_ID,
      {
        workspaceRef: baseInput.workspaceRef,
        draftId: begun.data.draftId,
        tabId: 'tab-draft',
        displayName: '张三公司',
      },
      {
        url: 'https://appstoreconnect.apple.com/apps',
        title: 'App Store Connect',
        profileId: begun.data.browserProfileId,
      },
    )
    expect(repeated).toMatchObject({
      success: true,
      data: { account: { id: saved.success ? saved.data.account.id : undefined } },
    })
    expect(service.getSnapshot()).toMatchObject({ success: true, data: { revision: 1 } })
  })

  it('keeps cleanup-pending drafts for startup reconciliation after profile cleanup fails', async () => {
    const draftPath = join(tempDir, 'web-resource-drafts.json')
    const service = new WebResourceService(
      new WebResourceStore(storePath),
      new WebResourceDraftStore(draftPath),
    )
    await service.load()
    const begun = await service.beginDraft(PROJECT_ID)
    if (!begun.success) throw new Error(begun.error.message)

    const failed = await service.cancelDraft(
      PROJECT_ID,
      begun.data.draftId,
      begun.data.browserProfileId,
      async () => Promise.reject(new Error('locked')),
    )
    expect(failed).toMatchObject({ success: false, error: { code: 'CLEANUP_FAILED' } })
    expect(JSON.parse(await readFile(draftPath, 'utf8'))).toMatchObject({
      records: [{ id: begun.data.draftId, state: 'cleanup-pending' }],
    })

    const reloaded = new WebResourceService(
      new WebResourceStore(storePath),
      new WebResourceDraftStore(draftPath),
    )
    await reloaded.load()
    const cleanup = vi.fn().mockResolvedValue(undefined)
    await reloaded.reconcileDrafts(cleanup)
    expect(cleanup).toHaveBeenCalledWith(begun.data.browserProfileId)
    expect(JSON.parse(await readFile(draftPath, 'utf8'))).toEqual({
      schemaVersion: 1,
      records: [],
    })
  })

  it('offers an explicit duplicate branch and preserves isolated profiles when saved as another account', async () => {
    const service = new WebResourceService(
      new WebResourceStore(storePath),
      new WebResourceDraftStore(join(tempDir, 'web-resource-drafts.json')),
    )
    await service.load()
    const first = await service.beginDraft(PROJECT_ID)
    if (!first.success) throw new Error(first.error.message)
    const firstSaved = await service.saveDraft(
      PROJECT_ID,
      {
        workspaceRef: baseInput.workspaceRef,
        draftId: first.data.draftId,
        tabId: 'tab-first',
        displayName: '张三公司',
      },
      {
        url: 'https://appstoreconnect.apple.com/apps',
        title: 'App Store Connect',
        profileId: first.data.browserProfileId,
      },
    )
    if (!firstSaved.success) throw new Error(firstSaved.error.message)

    const second = await service.beginDraft(PROJECT_ID)
    if (!second.success) throw new Error(second.error.message)
    const duplicate = await service.saveDraft(
      PROJECT_ID,
      {
        workspaceRef: baseInput.workspaceRef,
        draftId: second.data.draftId,
        tabId: 'tab-second',
        displayName: '张三公司',
      },
      {
        url: 'https://appstoreconnect.apple.com/apps',
        title: 'App Store Connect',
        profileId: second.data.browserProfileId,
      },
    )
    expect(duplicate).toMatchObject({
      success: false,
      error: {
        code: 'DUPLICATE_ACCOUNT',
        context: { existingAccountId: firstSaved.data.account.id },
      },
    })

    const savedAnother = await service.saveDraft(
      PROJECT_ID,
      {
        workspaceRef: baseInput.workspaceRef,
        draftId: second.data.draftId,
        tabId: 'tab-second',
        displayName: '张三公司',
        duplicateResolution: 'save-another',
      },
      {
        url: 'https://appstoreconnect.apple.com/apps',
        title: 'App Store Connect',
        profileId: second.data.browserProfileId,
      },
    )
    expect(savedAnother).toMatchObject({
      success: true,
      data: { account: { browserProfileId: second.data.browserProfileId } },
    })
    expect(service.getProjectSnapshot(PROJECT_ID)).toMatchObject({
      success: true,
      data: {
        accounts: [
          { browserProfileId: first.data.browserProfileId },
          { browserProfileId: second.data.browserProfileId },
        ],
      },
    })
  })

  it('cleans a cancelled draft profile and keeps it out of formal resources', async () => {
    const service = new WebResourceService(
      new WebResourceStore(storePath),
      new WebResourceDraftStore(join(tempDir, 'web-resource-drafts.json')),
    )
    await service.load()
    const begun = await service.beginDraft(PROJECT_ID)
    expect(begun.success).toBe(true)
    if (!begun.success) return
    const cleanupProfile = vi.fn().mockResolvedValue(undefined)

    await expect(
      service.cancelDraft(PROJECT_ID, begun.data.draftId, null, cleanupProfile),
    ).resolves.toEqual({
      success: true,
      data: { draftId: begun.data.draftId, cleaned: true },
    })
    expect(cleanupProfile).toHaveBeenCalledWith(begun.data.browserProfileId)
    expect(service.getProjectSnapshot(PROJECT_ID)).toMatchObject({
      success: true,
      data: { accounts: [] },
    })
  })

  it('persists one atomic website-principal-account connection', async () => {
    const service = new WebResourceService(new WebResourceStore(storePath))
    await service.load()

    const created = await service.createConnection(baseInput, PROJECT_ID, 'apple-release')
    expect(created.success).toBe(true)
    expect(service.getSnapshot()).toMatchObject({
      success: true,
      data: {
        revision: 1,
        websites: [{ origin: 'https://appstoreconnect.apple.com' }],
        principals: [{ name: 'Example Technology Ltd.' }],
        accounts: [{ browserProfileId: 'apple-release' }],
      },
    })

    const reloaded = new WebResourceService(new WebResourceStore(storePath))
    await reloaded.load()
    expect(reloaded.getSnapshot()).toMatchObject({
      success: true,
      data: { revision: 1, accounts: [{ label: 'Release account' }] },
    })
  })

  it('serializes concurrent mutations without losing an account', async () => {
    const service = new WebResourceService(new WebResourceStore(storePath))
    await service.load()

    const [first, second] = await Promise.all([
      service.createConnection(baseInput, PROJECT_ID, 'apple-release'),
      service.createConnection(
        {
          ...baseInput,
          accountLabel: 'Finance account',
        },
        PROJECT_ID,
        'apple-finance',
      ),
    ])

    expect(first.success).toBe(true)
    expect(second.success).toBe(true)
    expect(service.getSnapshot()).toMatchObject({
      success: true,
      data: {
        revision: 2,
        websites: [{ origin: 'https://appstoreconnect.apple.com' }],
        accounts: [{ browserProfileId: 'apple-release' }, { browserProfileId: 'apple-finance' }],
      },
    })
  })

  it('versions global account groups and preserves aliases when duplicate accounts are merged', async () => {
    const service = new WebResourceService(new WebResourceStore(storePath))
    await service.load()
    const primary = await service.createConnection(baseInput, PROJECT_ID, 'apple-release')
    const duplicate = await service.createConnection(
      { ...baseInput, accountLabel: 'Release account duplicate' },
      OTHER_PROJECT_ID,
      'apple-release-duplicate',
    )
    if (!primary.success || !duplicate.success) throw new Error('测试账号创建失败')

    const createdGroup = await service.createAccountGroup({
      name: '国内发布矩阵',
      accountIds: [primary.data.account.id, duplicate.data.account.id],
    })
    expect(createdGroup).toMatchObject({ success: true, data: { revision: 1 } })
    if (!createdGroup.success) return

    await expect(
      service.updateAccountGroup({
        groupId: createdGroup.data.id,
        expectedRevision: 99,
        name: '过期修改',
        accountIds: [primary.data.account.id],
      }),
    ).resolves.toMatchObject({ success: false, error: { code: 'REVISION_CONFLICT' } })

    const merged = await service.mergeAccounts({
      primaryAccountId: primary.data.account.id,
      duplicateAccountId: duplicate.data.account.id,
    })
    expect(merged).toMatchObject({
      success: true,
      data: { mergedIntoAccountId: primary.data.account.id, archivedAt: expect.any(String) },
    })
    expect(service.resolveLaunch(duplicate.data.account.id)).toMatchObject({
      success: true,
      data: {
        browserProfileId: 'apple-release',
        webResourceRef: { accountId: primary.data.account.id },
      },
    })
    expect(service.getSnapshot()).toMatchObject({
      success: true,
      data: {
        accountGroups: [
          {
            id: createdGroup.data.id,
            revision: 2,
            accountIds: [primary.data.account.id],
          },
        ],
      },
    })
  })

  it('keeps one global account identity across project contexts', async () => {
    const service = new WebResourceService(new WebResourceStore(storePath))
    await service.load()

    const first = await service.createConnection(baseInput, PROJECT_ID, 'shared-profile-name')
    const duplicate = await service.createConnection(
      baseInput,
      OTHER_PROJECT_ID,
      'shared-profile-name',
    )

    expect(first).toMatchObject({ success: true })
    expect(duplicate).toMatchObject({
      success: false,
      error: { code: 'DUPLICATE_ACCOUNT' },
    })
    expect(service.getProjectSnapshot(PROJECT_ID)).toEqual(
      service.getProjectSnapshot(OTHER_PROJECT_ID),
    )
    expect(service.getSnapshot()).toMatchObject({
      success: true,
      data: {
        accounts: [{ label: 'Release account', browserProfileId: 'shared-profile-name' }],
      },
    })
  })

  it('migrates v1 accounts into the global catalog without changing ids or profiles', async () => {
    const now = new Date().toISOString()
    const websiteId = '33333333-3333-4333-8333-333333333333'
    const principalId = '44444444-4444-4444-8444-444444444444'
    const accountId = '55555555-5555-4555-8555-555555555555'
    await writeFile(
      storePath,
      JSON.stringify({
        schemaVersion: 1,
        revision: 7,
        websites: [
          {
            id: websiteId,
            name: 'Legacy Portal',
            origin: 'https://legacy.example.com',
            entryUrl: 'https://legacy.example.com/',
            createdAt: now,
            updatedAt: now,
          },
        ],
        principals: [
          {
            id: principalId,
            kind: 'company',
            name: 'Legacy Ltd.',
            createdAt: now,
            updatedAt: now,
          },
        ],
        accounts: [
          {
            id: accountId,
            websiteId,
            principalId,
            label: 'Legacy account',
            browserProfileId: 'legacy-profile',
            createdAt: now,
            updatedAt: now,
          },
        ],
      }),
      'utf8',
    )

    const service = new WebResourceService(new WebResourceStore(storePath))
    await service.load()
    expect(service.getSnapshot()).toMatchObject({
      success: true,
      data: {
        schemaVersion: 3,
        revision: 7,
        accounts: [{ id: accountId, browserProfileId: 'legacy-profile' }],
        accountGroups: [],
      },
    })

    await expect(service.claimLegacyConnections(PROJECT_ID)).resolves.toEqual({
      success: true,
      data: { claimedCount: 0 },
    })
    expect(JSON.parse(await readFile(storePath, 'utf8'))).toMatchObject({
      schemaVersion: 3,
      revision: 7,
      accounts: [{ id: accountId, browserProfileId: 'legacy-profile' }],
      accountGroups: [],
    })
    expect(JSON.parse(await readFile(`${storePath}.bak`, 'utf8'))).toMatchObject({
      schemaVersion: 1,
      accounts: [{ id: accountId, browserProfileId: 'legacy-profile' }],
    })
  })

  it('rejects a duplicate account without advancing the revision', async () => {
    const service = new WebResourceService(new WebResourceStore(storePath))
    await service.load()
    await service.createConnection(baseInput, PROJECT_ID, 'apple-release')

    const duplicate = await service.createConnection(
      {
        ...baseInput,
        accountLabel: 'Renamed display label',
      },
      PROJECT_ID,
      'apple-release',
    )

    expect(duplicate).toMatchObject({
      success: false,
      error: { code: 'DUPLICATE_ACCOUNT' },
    })
    expect(service.getSnapshot()).toMatchObject({
      success: true,
      data: { revision: 1, accounts: [{ label: 'Release account' }] },
    })
  })

  it('recovers a valid backup when the primary file is corrupt', async () => {
    const service = new WebResourceService(new WebResourceStore(storePath))
    await service.load()
    await service.createConnection(baseInput, PROJECT_ID, 'apple-release')
    await service.createConnection(
      {
        workspaceRef: { kind: 'local', path: '/tmp/cclink-project' },
        websiteName: '阿里云',
        entryUrl: 'https://beian.aliyun.com/',
        principalKind: 'company',
        principalName: 'Example Technology Ltd.',
        accountLabel: '备案账号',
      },
      PROJECT_ID,
      'aliyun-filing',
    )
    await writeFile(storePath, '{corrupt', 'utf8')

    const recovered = new WebResourceService(new WebResourceStore(storePath))
    await recovered.load()

    expect(recovered.getSnapshot()).toMatchObject({
      success: true,
      data: {
        revision: 1,
        accounts: [{ browserProfileId: 'apple-release' }],
      },
    })
    expect(JSON.parse(await readFile(storePath, 'utf8'))).toMatchObject({ revision: 1 })
  })

  it('preserves the failure when both primary and backup are corrupt', async () => {
    await writeFile(storePath, '{primary-corrupt', 'utf8')
    await writeFile(`${storePath}.bak`, '{backup-corrupt', 'utf8')
    const service = new WebResourceService(new WebResourceStore(storePath))

    await expect(service.load()).rejects.toThrow('原文件已保留')
    await expect(readFile(storePath, 'utf8')).resolves.toBe('{primary-corrupt')
    await expect(readFile(`${storePath}.bak`, 'utf8')).resolves.toBe('{backup-corrupt')
  })
})
