import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ArticlePublishingSourcePreview } from '../../shared/article-publishing/article-publishing-types'
import type { WebResourceSnapshot } from '../../shared/web-resources/web-resource-types'
import { WebAffairService } from './web-affair-service'
import { WebAffairStore } from './web-affair-store'

const PRINCIPAL_ID = '11111111-1111-4111-8111-111111111111'
const WEBSITE_ID = '22222222-2222-4222-8222-222222222222'
const ACCOUNT_ID = '33333333-3333-4333-8333-333333333333'
const WORKSPACE_ID = '44444444-4444-4444-8444-444444444444'

describe('article publishing persistent state', () => {
  let directory = ''
  let sourcePath = ''
  let imagePath = ''

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'cclink-article-state-'))
    sourcePath = join(directory, 'article.md')
    imagePath = join(directory, 'image.png')
    await writeFile(sourcePath, '# Article\n\n![image](./image.png)')
    await writeFile(imagePath, 'image')
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('persists a saved draft and reloads it into project history', async () => {
    const created = await createDraftTask(directory, sourcePath, imagePath)
    await created.service.flush()

    const reloaded = createService(directory)
    await reloaded.load()
    const snapshot = reloaded.getProjectSnapshot(WORKSPACE_ID)
    expect(snapshot.success).toBe(true)
    if (!snapshot.success) return
    expect(snapshot.data.affairs).toHaveLength(1)
    expect(snapshot.data.affairs[0]).toMatchObject({
      id: created.affairId,
      kind: 'article-publishing',
      title: 'Article',
      articlePublishing: { execution: { status: 'draft' } },
    })
    await reloaded.flush()
  })

  it('requires waiting and verification evidence before an image becomes uploaded', async () => {
    const { service, affairId, attemptId, assetId } = await createStartedTask(
      directory,
      sourcePath,
      imagePath,
    )
    const workspaceRef = { kind: 'local' as const, path: directory }

    await expectStatus(
      service.reportArticlePublishingAsset(
        { workspaceRef, affairId, attemptId, assetId, status: 'uploading' },
        WORKSPACE_ID,
      ),
      'uploading',
    )
    await expectStatus(
      service.reportArticlePublishingAsset(
        {
          workspaceRef,
          affairId,
          attemptId,
          assetId,
          status: 'waiting-platform',
          evidence: '文件控件已接收',
        },
        WORKSPACE_ID,
      ),
      'waiting-platform',
    )
    await expectStatus(
      service.reportArticlePublishingAsset(
        {
          workspaceRef,
          affairId,
          attemptId,
          assetId,
          status: 'verifying',
          evidence: '编辑器出现新图片节点',
        },
        WORKSPACE_ID,
      ),
      'verifying',
    )
    const missingEvidence = await service.reportArticlePublishingAsset(
      {
        workspaceRef,
        affairId,
        attemptId,
        assetId,
        status: 'uploaded',
        platformUrl: 'https://img-blog.csdnimg.cn/example.png',
      },
      WORKSPACE_ID,
    )
    expect(missingEvidence).toMatchObject({
      success: false,
      error: { code: 'INVALID_TRANSITION' },
    })
    const uploaded = await service.reportArticlePublishingAsset(
      {
        workspaceRef,
        affairId,
        attemptId,
        assetId,
        status: 'uploaded',
        platformUrl: 'https://img-blog.csdnimg.cn/example.png',
        evidence: '重新读取编辑器确认平台 URL 和插入位置',
      },
      WORKSPACE_ID,
    )
    expect(uploaded.success).toBe(true)
    if (!uploaded.success) return
    expect(uploaded.data.articlePublishing?.assets[0]).toMatchObject({
      status: 'uploaded',
      platformUrl: 'https://img-blog.csdnimg.cn/example.png',
      uploadAttempts: [{ number: 1, status: 'succeeded' }],
    })
  })

  it('caps safe image upload attempts at three', async () => {
    const { service, affairId, attemptId, assetId } = await createStartedTask(
      directory,
      sourcePath,
      imagePath,
    )
    const workspaceRef = { kind: 'local' as const, path: directory }
    for (let number = 1; number <= 3; number += 1) {
      const started = await service.reportArticlePublishingAsset(
        { workspaceRef, affairId, attemptId, assetId, status: 'uploading' },
        WORKSPACE_ID,
      )
      expect(started.success).toBe(true)
      const failed = await service.reportArticlePublishingAsset(
        {
          workspaceRef,
          affairId,
          attemptId,
          assetId,
          status: 'retryable-failed',
          error: { code: 'UPLOAD_REJECTED', message: `第 ${number} 次失败` },
        },
        WORKSPACE_ID,
      )
      expect(failed.success).toBe(true)
    }
    const fourth = await service.reportArticlePublishingAsset(
      { workspaceRef, affairId, attemptId, assetId, status: 'uploading' },
      WORKSPACE_ID,
    )
    expect(fourth).toMatchObject({
      success: false,
      error: { code: 'INVALID_TRANSITION', message: expect.stringContaining('状态不能') },
    })
  })

  it('resumes the same interrupted Attempt and moves transient state to reconciliation', async () => {
    const created = await createStartedTask(directory, sourcePath, imagePath)
    const uploading = await created.service.reportArticlePublishingAsset(
      {
        workspaceRef: { kind: 'local', path: directory },
        affairId: created.affairId,
        attemptId: created.attemptId,
        assetId: created.assetId,
        status: 'uploading',
      },
      WORKSPACE_ID,
    )
    expect(uploading.success).toBe(true)
    await created.service.flush()

    const reloaded = new WebAffairService(
      () => resources(),
      new WebAffairStore(join(directory, 'affairs.json')),
      undefined,
      undefined,
      () => ({
        success: true,
        data: {
          webResourceRef: { accountId: ACCOUNT_ID },
          title: 'CSDN',
          entryUrl: 'https://editor.csdn.net/md/',
          browserProfileId: 'csdn-profile',
        },
      }),
    )
    await reloaded.load()
    const interrupted = reloaded.getProjectSnapshot(WORKSPACE_ID)
    expect(interrupted.success).toBe(true)
    if (!interrupted.success) return
    expect(interrupted.data.affairs[0].attempts[0]).toMatchObject({
      id: created.attemptId,
      status: 'interrupted',
    })
    expect(interrupted.data.affairs[0].articlePublishing?.assets[0].status).toBe('reconciling')

    const resumed = await reloaded.resumeArticlePublishingAttempt(
      created.affairId,
      created.attemptId,
      WORKSPACE_ID,
    )
    expect(resumed.success).toBe(true)
    if (!resumed.success) return
    expect(resumed.data.articlePublishing?.execution.currentAttemptId).toBe(created.attemptId)
    expect(resumed.data.articlePublishing?.assets[0].status).toBe('reconciling')
    expect(resumed.data.attempts).toHaveLength(1)
    expect(resumed.data.attempts[0]).toMatchObject({
      id: created.attemptId,
      status: 'preparing',
    })
    await reloaded.flush()
  })
})

async function createStartedTask(directory: string, sourcePath: string, imagePath: string) {
  const created = await createDraftTask(directory, sourcePath, imagePath)
  const started = await created.service.startAttempt(
    {
      workspaceRef: { kind: 'local', path: directory },
      affairId: created.affairId,
      nodeId: created.nodeId,
      accountId: ACCOUNT_ID,
    },
    WORKSPACE_ID,
  )
  if (!started.success) throw new Error(started.error.message)
  const attemptId = started.data.attempts[0].id
  const marked = await created.service.markArticlePublishingAttemptStarted(
    created.affairId,
    attemptId,
    WORKSPACE_ID,
  )
  if (!marked.success) throw new Error(marked.error.message)
  return {
    service: created.service,
    affairId: created.affairId,
    attemptId,
    assetId: created.assetId,
  }
}

function createService(directory: string): WebAffairService {
  return new WebAffairService(
    () => resources(),
    new WebAffairStore(join(directory, 'affairs.json')),
    undefined,
    undefined,
    () => ({
      success: true,
      data: {
        webResourceRef: { accountId: ACCOUNT_ID },
        title: 'CSDN',
        entryUrl: 'https://editor.csdn.net/md/',
        browserProfileId: 'csdn-profile',
      },
    }),
  )
}

async function createDraftTask(directory: string, sourcePath: string, imagePath: string) {
  const service = createService(directory)
  await service.load()
  const preview: ArticlePublishingSourcePreview = {
    source: {
      markdownPath: sourcePath,
      contentHash: 'a'.repeat(64),
      modifiedAt: Date.now(),
      size: 36,
    },
    title: 'Article',
    summary: 'summary',
    assets: [
      {
        id: '55555555-5555-4555-8555-555555555555',
        kind: 'local',
        sourcePath: imagePath,
        displayPath: 'image.png',
        contentHash: 'b'.repeat(64),
        mediaType: 'image/png',
        size: 5,
        occurrences: [{ start: 12, end: 23, alt: 'image' }],
        status: 'pending',
        uploadAttempts: [],
      },
    ],
    blockers: [],
    warnings: [],
  }
  const created = await service.createArticlePublishingAffair(
    {
      preview,
      accountId: ACCOUNT_ID,
      fields: { title: 'Article', summary: 'summary', tags: [], category: '' },
      workspaceRef: { kind: 'local', path: directory },
    },
    WORKSPACE_ID,
  )
  if (!created.success) throw new Error(created.error.message)
  return {
    service,
    affairId: created.data.id,
    nodeId: created.data.flow.nodes[0].id,
    assetId: preview.assets[0].id,
  }
}

async function expectStatus(
  promise: ReturnType<WebAffairService['reportArticlePublishingAsset']>,
  status: string,
) {
  const result = await promise
  expect(result.success).toBe(true)
  if (!result.success) return
  expect(result.data.articlePublishing?.assets[0].status).toBe(status)
}

function resources(): WebResourceSnapshot {
  const now = new Date().toISOString()
  return {
    schemaVersion: 3,
    revision: 1,
    websites: [
      {
        id: WEBSITE_ID,
        name: 'CSDN',
        origin: 'https://www.csdn.net',
        entryUrl: 'https://editor.csdn.net/md/',
        createdAt: now,
        updatedAt: now,
      },
    ],
    principals: [
      {
        id: PRINCIPAL_ID,
        kind: 'personal',
        name: 'Author',
        createdAt: now,
        updatedAt: now,
      },
    ],
    accounts: [
      {
        id: ACCOUNT_ID,
        websiteId: WEBSITE_ID,
        principalId: PRINCIPAL_ID,
        label: 'CSDN test',
        browserProfileId: 'csdn-profile',
        createdAt: now,
        updatedAt: now,
      },
    ],
    accountGroups: [],
  }
}
