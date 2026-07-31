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

const baseInput: CreateWebConnectionInput = {
  websiteName: 'App Store Connect',
  entryUrl: 'https://appstoreconnect.apple.com/apps',
  principalKind: 'company',
  principalName: 'Example Technology Ltd.',
  accountLabel: 'Release account',
  browserProfileId: 'apple-release',
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

    const created = await service.createConnection(baseInput)
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
      service.createConnection(baseInput),
      service.createConnection({
        ...baseInput,
        accountLabel: 'Finance account',
        browserProfileId: 'apple-finance',
      }),
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

  it('rejects a duplicate account without advancing the revision', async () => {
    const service = new WebResourceService(new WebResourceStore(storePath))
    await service.load()
    await service.createConnection(baseInput)

    const duplicate = await service.createConnection({
      ...baseInput,
      accountLabel: 'Renamed display label',
    })

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
    await service.createConnection(baseInput)
    await service.createConnection({
      websiteName: '阿里云',
      entryUrl: 'https://beian.aliyun.com/',
      principalKind: 'company',
      principalName: 'Example Technology Ltd.',
      accountLabel: '备案账号',
      browserProfileId: 'aliyun-filing',
    })
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
