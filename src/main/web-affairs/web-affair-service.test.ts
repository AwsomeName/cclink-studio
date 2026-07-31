import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { WebResourceSnapshot } from '../../shared/web-resources/web-resource-types'
import { WebAffairService } from './web-affair-service'
import { WebAffairStore } from './web-affair-store'

const PRINCIPAL_ID = '11111111-1111-4111-8111-111111111111'
const WEBSITE_ID = '22222222-2222-4222-8222-222222222222'
const ACCOUNT_ID = '33333333-3333-4333-8333-333333333333'

describe('WebAffairService', () => {
  let directory: string
  let filePath: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'cclink-web-affair-'))
    filePath = join(directory, 'web-affairs.json')
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('creates a persistent linear DAG with explicit resource references', async () => {
    const service = createService(filePath)
    await service.load()
    const result = await service.createAffair(validInput())

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.flow.nodes).toHaveLength(3)
    expect(result.data.flow.edges).toHaveLength(2)
    expect(result.data.flow.nodes.map((node) => node.status)).toEqual([
      'ready',
      'blocked',
      'blocked',
    ])
    expect(result.data.websiteIds).toEqual([WEBSITE_ID])
    expect(result.data.materials[0].name).toBe('license.png')

    const reloaded = createService(filePath)
    await reloaded.load()
    expect(reloaded.getSnapshot()).toMatchObject({
      success: true,
      data: { revision: 1, affairs: [{ title: 'App 上架' }] },
    })
  })

  it('unlocks the next node and preserves completed-node history', async () => {
    const service = createService(filePath)
    await service.load()
    const created = await service.createAffair(validInput())
    if (!created.success) throw new Error(created.error.message)
    const firstNode = created.data.flow.nodes[0]

    const updated = await service.updateNode({
      affairId: created.data.id,
      nodeId: firstNode.id,
      status: 'completed',
      resultNote: '材料已经人工核对',
    })
    expect(updated).toMatchObject({
      success: true,
      data: {
        status: 'active',
        flow: { nodes: [{ status: 'completed' }, { status: 'ready' }, { status: 'blocked' }] },
      },
    })

    await expect(
      service.updateNode({
        affairId: created.data.id,
        nodeId: firstNode.id,
        status: 'ready',
      }),
    ).resolves.toMatchObject({
      success: false,
      error: { code: 'INVALID_TRANSITION' },
    })
  })

  it('rejects accounts that do not belong to the selected principal', async () => {
    const resources = resourceSnapshot()
    resources.accounts[0].principalId = '44444444-4444-4444-8444-444444444444'
    const service = new WebAffairService(() => resources, new WebAffairStore(filePath))
    await service.load()

    await expect(service.createAffair(validInput())).resolves.toMatchObject({
      success: false,
      error: { code: 'INVALID_RESOURCE_REFERENCE' },
    })
  })
})

function createService(filePath: string): WebAffairService {
  return new WebAffairService(() => resourceSnapshot(), new WebAffairStore(filePath))
}

function validInput() {
  return {
    title: 'App 上架',
    objective: '提交审核并取得明确结果',
    principalId: PRINCIPAL_ID,
    accountIds: [ACCOUNT_ID],
    materialPaths: ['/tmp/license.png'],
    nodeTitles: ['准备材料', '提交审核', '等待结果'],
    workspaceRef: { kind: 'local' as const, path: '/tmp/workspace' },
  }
}

function resourceSnapshot(): WebResourceSnapshot {
  const now = new Date().toISOString()
  return {
    schemaVersion: 1,
    revision: 1,
    websites: [
      {
        id: WEBSITE_ID,
        name: 'App Store Connect',
        origin: 'https://appstoreconnect.apple.com',
        entryUrl: 'https://appstoreconnect.apple.com/apps',
        createdAt: now,
        updatedAt: now,
      },
    ],
    principals: [
      {
        id: PRINCIPAL_ID,
        kind: 'company',
        name: 'Example Ltd.',
        createdAt: now,
        updatedAt: now,
      },
    ],
    accounts: [
      {
        id: ACCOUNT_ID,
        websiteId: WEBSITE_ID,
        principalId: PRINCIPAL_ID,
        label: 'Release',
        browserProfileId: 'release',
        createdAt: now,
        updatedAt: now,
      },
    ],
  }
}
