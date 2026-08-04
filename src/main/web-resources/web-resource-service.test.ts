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

  it('isolates website-account connections by stable project id', async () => {
    const service = new WebResourceService(new WebResourceStore(storePath))
    await service.load()

    await service.createConnection(baseInput, PROJECT_ID, 'shared-profile-name')
    await service.createConnection(baseInput, OTHER_PROJECT_ID, 'shared-profile-name')

    expect(service.getProjectSnapshot(PROJECT_ID)).toMatchObject({
      success: true,
      data: {
        projectId: PROJECT_ID,
        accounts: [{ projectId: PROJECT_ID, label: 'Release account' }],
      },
    })
    expect(service.getProjectSnapshot(OTHER_PROJECT_ID)).toMatchObject({
      success: true,
      data: {
        projectId: OTHER_PROJECT_ID,
        accounts: [{ projectId: OTHER_PROJECT_ID, label: 'Release account' }],
      },
    })
  })

  it('loads v1 accounts as unassigned and only exposes them after an explicit claim', async () => {
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
    expect(service.getProjectSnapshot(PROJECT_ID)).toMatchObject({
      success: true,
      data: { accounts: [], unassignedAccountCount: 1 },
    })

    await expect(service.claimLegacyConnections(PROJECT_ID)).resolves.toEqual({
      success: true,
      data: { claimedCount: 1 },
    })
    expect(service.getProjectSnapshot(PROJECT_ID)).toMatchObject({
      success: true,
      data: { accounts: [{ id: accountId, projectId: PROJECT_ID }], unassignedAccountCount: 0 },
    })
    expect(JSON.parse(await readFile(storePath, 'utf8'))).toMatchObject({
      schemaVersion: 2,
      revision: 8,
      accounts: [{ id: accountId, projectId: PROJECT_ID }],
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
