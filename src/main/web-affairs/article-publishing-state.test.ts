import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ArticlePublishingSourcePreview } from '../../shared/article-publishing/article-publishing-types'
import type { WebResourceSnapshot } from '../../shared/web-resources/web-resource-types'
import { WebAffairService, type ArticlePublishingAgentReporter } from './web-affair-service'
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

  it('atomically grants only one cross-affair article publishing execution lease', async () => {
    const first = await createDraftTask(directory, sourcePath, imagePath)
    const secondCreated = await first.service.createArticlePublishingAffair(
      {
        preview: {
          source: {
            markdownPath: sourcePath,
            contentHash: 'a'.repeat(64),
            modifiedAt: Date.now(),
            size: 36,
          },
          title: 'Second Article',
          summary: 'summary',
          assets: [
            {
              id: '66666666-6666-4666-8666-666666666666',
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
        },
        accountId: ACCOUNT_ID,
        fields: { title: 'Second Article', summary: 'summary', tags: [], category: '' },
        workspaceRef: { kind: 'local', path: directory },
      },
      WORKSPACE_ID,
    )
    if (!secondCreated.success) throw new Error(secondCreated.error.message)

    const results = await Promise.all([
      first.service.acquireArticlePublishingAttempt(first.affairId, WORKSPACE_ID),
      first.service.acquireArticlePublishingAttempt(secondCreated.data.id, WORKSPACE_ID),
    ])

    expect(results.filter((result) => result.success)).toHaveLength(1)
    expect(results.filter((result) => !result.success)).toEqual([
      expect.objectContaining({
        error: expect.objectContaining({
          message: expect.stringContaining('正在占用 Browser/Agent'),
        }),
      }),
    ])
    const snapshot = first.service.getSnapshot()
    expect(snapshot.success).toBe(true)
    if (!snapshot.success) return
    expect(
      snapshot.data.affairs.filter((affair) =>
        ['preparing', 'running', 'checking-runtime', 'waiting-human'].includes(
          affair.articlePublishing?.execution.status ?? '',
        ),
      ),
    ).toHaveLength(1)
  })

  it('persists one immutable platform draft identity across a cold service reload', async () => {
    const created = await createStartedTask(directory, sourcePath, imagePath)
    const before = created.service.getProjectSnapshot(WORKSPACE_ID)
    expect(before.success).toBe(true)
    if (!before.success) return
    const attempt = before.data.affairs[0].attempts[0]
    const draftUrl = 'https://mp.csdn.net/mp_blog/creation/editor/164148817'
    const recorded = await created.service.recordArticlePublishingDraftAnchor(
      created.affairId,
      created.attemptId,
      attempt.executionGeneration,
      attempt.launchOperationId,
      `${draftUrl}?from=runtime#body`,
      WORKSPACE_ID,
      '77777777-7777-4777-8777-777777777777',
    )
    expect(recorded.success).toBe(true)
    const baselineSnapshot = platformSnapshot()
    const snapshotted = await created.service.refreshArticlePublishingWriteSnapshot(
      {
        affairId: created.affairId,
        attemptId: created.attemptId,
        executionGeneration: created.reporter.executionGeneration,
        browserTaskRunId: '77777777-7777-4777-8777-777777777777',
        snapshot: baselineSnapshot,
      },
      WORKSPACE_ID,
    )
    expect(snapshotted.success).toBe(true)
    if (!recorded.success) return
    expect(recorded.data.articlePublishing?.draft?.url).toBe(draftUrl)

    const staleOwner = await created.service.recordArticlePublishingDraftAnchor(
      created.affairId,
      created.attemptId,
      attempt.executionGeneration,
      attempt.launchOperationId,
      draftUrl,
      WORKSPACE_ID,
      '88888888-8888-4888-8888-888888888888',
    )
    expect(staleOwner).toMatchObject({
      success: false,
      error: { code: 'INVALID_TRANSITION', message: expect.stringContaining('运行代次') },
    })

    const conflicting = await created.service.recordArticlePublishingDraftAnchor(
      created.affairId,
      created.attemptId,
      attempt.executionGeneration,
      attempt.launchOperationId,
      'https://mp.csdn.net/mp_blog/creation/editor/164148818',
      WORKSPACE_ID,
      '77777777-7777-4777-8777-777777777777',
    )
    expect(conflicting).toMatchObject({
      success: false,
      error: { code: 'INVALID_TRANSITION', message: expect.stringContaining('拒绝切换') },
    })
    await created.service.flush()

    const persistedPath = join(directory, 'affairs.json')
    const legacyV5 = JSON.parse(await readFile(persistedPath, 'utf8'))
    legacyV5.schemaVersion = 5
    delete legacyV5.affairs[0].articlePublishing.draft.platformDraftId
    await writeFile(persistedPath, JSON.stringify(legacyV5))

    const reloaded = createService(directory)
    await reloaded.load()
    const after = reloaded.getProjectSnapshot(WORKSPACE_ID)
    expect(after.success).toBe(true)
    if (!after.success) return
    expect(after.data.affairs[0].articlePublishing?.draft).toMatchObject({
      url: draftUrl,
      platformDraftId: '164148817',
    })
    await reloaded.flush()
  })

  it('rejects stale Agent generations, out-of-order checkpoints and finish bypasses', async () => {
    const created = await createStartedTask(directory, sourcePath, imagePath)
    const workspaceRef = { kind: 'local' as const, path: directory }

    await expect(
      created.service.reportArticlePublishingCheckpoint(
        {
          workspaceRef,
          affairId: created.affairId,
          attemptId: created.attemptId,
          stepId: 'verify-account',
          status: 'running',
        },
        WORKSPACE_ID,
        trustedReporter(created.reporter, 'checkpoint'),
      ),
    ).resolves.toMatchObject({
      success: false,
      error: { message: expect.stringContaining('当前文章发布步骤') },
    })

    await expect(
      created.service.reportArticlePublishingCheckpoint(
        {
          workspaceRef,
          affairId: created.affairId,
          attemptId: created.attemptId,
          stepId: 'open-editor',
          status: 'verifying',
        },
        WORKSPACE_ID,
        created.reporter,
      ),
    ).resolves.toMatchObject({
      success: false,
      error: { message: expect.stringContaining('页面证据') },
    })

    await expect(
      created.service.reportArticlePublishingCheckpoint(
        {
          workspaceRef,
          affairId: created.affairId,
          attemptId: created.attemptId,
          stepId: 'open-editor',
          status: 'verifying',
          evidence: 'visible editor observed',
        },
        WORKSPACE_ID,
        { ...created.reporter, executionGeneration: created.reporter.executionGeneration - 1 },
      ),
    ).resolves.toMatchObject({
      success: false,
      error: { message: expect.stringContaining('已失效的执行代次') },
    })

    const finishInput = {
      workspaceRef,
      affairId: created.affairId,
      attemptId: created.attemptId,
      outcome: 'succeeded' as const,
      summary: 'published',
      url: 'https://blog.csdn.net/example/article/details/123456',
    }
    await expect(created.service.finishAttempt(finishInput, WORKSPACE_ID)).resolves.toMatchObject({
      success: false,
      error: { message: expect.stringContaining('当前 Agent Run') },
    })
    await expect(
      created.service.finishAttempt(finishInput, WORKSPACE_ID, created.reporter),
    ).resolves.toMatchObject({
      success: false,
      error: { code: 'EVIDENCE_REQUIRED' },
    })
  })

  it('requires waiting and verification evidence before an image becomes uploaded', async () => {
    const { service, affairId, attemptId, assetId, reporter } = await createStartedTask(
      directory,
      sourcePath,
      imagePath,
    )
    const created = { service, affairId, attemptId, assetId, reporter, workspacePath: directory }
    await prepareUploadCheckpoint(created)
    await dispatchUploadEffect(created, 1)
    const workspaceRef = { kind: 'local' as const, path: directory }

    await expectStatus(
      service.reportArticlePublishingAsset(
        { workspaceRef, affairId, attemptId, assetId, status: 'uploading' },
        WORKSPACE_ID,
        trustedReporter(reporter, 'asset-absent'),
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
        reporter,
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
        reporter,
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
      trustedReporter(reporter, 'asset-uploaded'),
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
      trustedReporter(reporter, 'asset-uploaded'),
    )
    expect(uploaded.success).toBe(true)
    if (!uploaded.success) return
    expect(uploaded.data.articlePublishing?.assets[0]).toMatchObject({
      status: 'uploaded',
      platformUrl: 'https://img-blog.csdnimg.cn/example.png',
      platformContentHash: 'd'.repeat(64),
      uploadAttempts: [{ number: 1, status: 'succeeded' }],
    })
  })

  it('caps safe image upload attempts at three', async () => {
    const { service, affairId, attemptId, assetId, reporter } = await createStartedTask(
      directory,
      sourcePath,
      imagePath,
    )
    const created = { service, affairId, attemptId, assetId, reporter, workspacePath: directory }
    await prepareUploadCheckpoint(created)
    const workspaceRef = { kind: 'local' as const, path: directory }
    for (let number = 1; number <= 3; number += 1) {
      await dispatchUploadEffect(created, number)
      const started = await service.reportArticlePublishingAsset(
        { workspaceRef, affairId, attemptId, assetId, status: 'uploading' },
        WORKSPACE_ID,
        trustedReporter(reporter, 'asset-absent'),
      )
      expect(started.success).toBe(true)
      const failed = await service.reportArticlePublishingAsset(
        {
          workspaceRef,
          affairId,
          attemptId,
          assetId,
          status: 'retryable-failed',
          evidence: '平台明确拒绝本次上传',
          error: { code: 'UPLOAD_REJECTED', message: `第 ${number} 次失败` },
        },
        WORKSPACE_ID,
        reporter,
      )
      expect(failed.success).toBe(true)
    }
    const fourth = await service.reportArticlePublishingAsset(
      { workspaceRef, affairId, attemptId, assetId, status: 'uploading' },
      WORKSPACE_ID,
      trustedReporter(reporter, 'asset-absent'),
    )
    expect(fourth).toMatchObject({
      success: false,
      error: { code: 'INVALID_TRANSITION' },
    })
  })

  it('resumes the same interrupted Attempt and moves transient state to reconciliation', async () => {
    const created = await createStartedTask(directory, sourcePath, imagePath)
    await prepareUploadCheckpoint(created)
    await dispatchUploadEffect(created, 1)
    const uploading = await created.service.reportArticlePublishingAsset(
      {
        workspaceRef: { kind: 'local', path: directory },
        affairId: created.affairId,
        attemptId: created.attemptId,
        assetId: created.assetId,
        status: 'uploading',
      },
      WORKSPACE_ID,
      trustedReporter(created.reporter, 'asset-absent'),
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

  it('blocks an unknown upload from the prior generation before Agent binding', async () => {
    const created = await createStartedTask(directory, sourcePath, imagePath)
    await prepareUploadCheckpoint(created)
    await dispatchUploadEffect(created, 1)
    const workspaceRef = { kind: 'local' as const, path: directory }
    const uploading = await created.service.reportArticlePublishingAsset(
      {
        workspaceRef,
        affairId: created.affairId,
        attemptId: created.attemptId,
        assetId: created.assetId,
        status: 'uploading',
      },
      WORKSPACE_ID,
      trustedReporter(created.reporter, 'asset-absent'),
    )
    expect(uploading.success).toBe(true)
    const unknown = await created.service.reportArticlePublishingAsset(
      {
        workspaceRef,
        affairId: created.affairId,
        attemptId: created.attemptId,
        assetId: created.assetId,
        status: 'result-unknown',
        evidence: '上传动作已派发，但连接在页面读回前断开',
        error: { code: 'CDP_DISCONNECTED', message: '无法确认上传结果' },
      },
      WORKSPACE_ID,
      created.reporter,
    )
    expect(unknown.success).toBe(true)

    await expect(resumeAndBindPublishingTask(created)).rejects.toThrow(
      '旧代次图片或保存结果仍不确定',
    )
  })

  it('blocks an unknown draft save before Agent binding', async () => {
    const created = await createStartedTask(directory, sourcePath, imagePath)
    await prepareUploadCheckpoint(created)
    await dispatchUploadEffect(created, 1)
    const workspaceRef = { kind: 'local' as const, path: directory }
    for (const update of [
      { status: 'uploading' as const },
      { status: 'waiting-platform' as const, evidence: 'file accepted' },
      { status: 'verifying' as const, evidence: 'image visible' },
      {
        status: 'uploaded' as const,
        platformUrl: 'https://img-blog.csdnimg.cn/save-recovery.png',
        evidence: 'image hash verified',
      },
    ]) {
      const result = await created.service.reportArticlePublishingAsset(
        {
          workspaceRef,
          affairId: created.affairId,
          attemptId: created.attemptId,
          assetId: created.assetId,
          ...update,
        },
        WORKSPACE_ID,
        trustedReporter(
          created.reporter,
          update.status === 'uploading'
            ? 'asset-absent'
            : update.status === 'uploaded'
              ? 'asset-uploaded'
              : undefined,
        ),
      )
      if (!result.success) throw new Error(result.error.message)
    }
    await advanceToSaveCheckpoint(created)
    const sideEffectKey = await dispatchSaveEffect(created, 'save-draft')
    const before = created.service.getProjectSnapshot(WORKSPACE_ID)
    if (!before.success) throw new Error(before.error.message)
    const attempt = before.data.affairs[0].attempts.find((item) => item.id === created.attemptId)!
    const unknown = await created.service.observeArticlePublishingSideEffect(
      created.affairId,
      created.attemptId,
      attempt.executionGeneration,
      sideEffectKey,
      'result-unknown',
      WORKSPACE_ID,
    )
    if (!unknown.success) throw new Error(unknown.error.message)

    await expect(resumeAndBindPublishingTask(created)).rejects.toThrow(
      '旧代次图片或保存结果仍不确定',
    )
  })

  it('returns a waiting-human article task to the same Attempt for fresh observation', async () => {
    const created = await createStartedTask(directory, sourcePath, imagePath)
    const handedOff = await created.service.handoffAttempt(
      {
        workspaceRef: { kind: 'local', path: directory },
        affairId: created.affairId,
        attemptId: created.attemptId,
        reason: '需要用户处理验证码',
      },
      WORKSPACE_ID,
    )
    expect(handedOff.success).toBe(true)
    if (!handedOff.success) return
    expect(handedOff.data.articlePublishing?.execution.status).toBe('waiting-human')
    expect(handedOff.data.attempts[0].status).toBe('waiting-human')

    const resumed = await created.service.resumeArticlePublishingAfterHandoff(
      created.affairId,
      created.attemptId,
      WORKSPACE_ID,
    )
    expect(resumed.success).toBe(true)
    if (!resumed.success) return
    expect(resumed.data.attempts).toHaveLength(1)
    expect(resumed.data.attempts[0]).toMatchObject({
      id: created.attemptId,
      status: 'preparing',
    })
    expect(resumed.data.articlePublishing?.execution).toMatchObject({
      status: 'preparing',
      currentAttemptId: created.attemptId,
    })
    expect(resumed.data.articlePublishing?.checkpoints[0].status).toBe('needs-reconcile')
  })

  it('persists a recovery generation and refuses runtime binding until the exact page permit is verified', async () => {
    const created = await createStartedTask(directory, sourcePath, imagePath)
    const draftUrl = 'https://mp.csdn.net/mp_blog/creation/editor/164148817'
    const recorded = await created.service.recordArticlePublishingDraftAnchor(
      created.affairId,
      created.attemptId,
      created.reporter.executionGeneration,
      created.reporter.launchOperationId,
      draftUrl,
      WORKSPACE_ID,
      '77777777-7777-4777-8777-777777777777',
    )
    expect(recorded.success).toBe(true)
    const baselineSnapshot = platformSnapshot()
    const snapshotted = await created.service.refreshArticlePublishingWriteSnapshot(
      {
        affairId: created.affairId,
        attemptId: created.attemptId,
        executionGeneration: created.reporter.executionGeneration,
        browserTaskRunId: '77777777-7777-4777-8777-777777777777',
        snapshot: baselineSnapshot,
      },
      WORKSPACE_ID,
    )
    expect(snapshotted.success).toBe(true)
    const handedOff = await created.service.handoffAttempt(
      {
        workspaceRef: { kind: 'local', path: directory },
        affairId: created.affairId,
        attemptId: created.attemptId,
        reason: 'Studio will restart',
      },
      WORKSPACE_ID,
    )
    expect(handedOff.success).toBe(true)

    const resumed = await created.service.resumeArticlePublishingAfterHandoff(
      created.affairId,
      created.attemptId,
      WORKSPACE_ID,
    )
    expect(resumed.success).toBe(true)
    if (!resumed.success) return
    const attempt = resumed.data.attempts[0]
    const recovery = resumed.data.articlePublishing?.draft?.recovery
    expect(recovery).toMatchObject({
      executionGeneration: attempt.executionGeneration,
      status: 'locating',
      expectedDraftId: '164148817',
    })
    if (!recovery) throw new Error('恢复操作未持久化')
    const bindings = runtimeBindingsFor(attempt, {
      tabId: 'recovered-tab',
      browserTaskRunId: '88888888-8888-4888-8888-888888888888',
      browserViewRuntimeGeneration: 2,
      webContentsId: 20,
      playwrightConnectionGeneration: 3,
      playwrightPageBindingGeneration: 4,
    })

    const rejected = await created.service.bindArticlePublishingRuntime(
      created.affairId,
      attempt.id,
      attempt.executionGeneration,
      attempt.launchOperationId,
      bindings,
      WORKSPACE_ID,
    )
    expect(rejected).toMatchObject({
      success: false,
      error: { message: expect.stringContaining('写入许可') },
    })

    const verified = await created.service.verifyArticlePublishingRecovery(
      {
        affairId: created.affairId,
        attemptId: attempt.id,
        executionGeneration: attempt.executionGeneration,
        launchOperationId: attempt.launchOperationId,
        recoveryOperationId: recovery.operationId,
        draftId: '164148817',
        url: draftUrl,
        snapshot: baselineSnapshot,
        evidenceHash: 'e'.repeat(64),
        tabId: 'recovered-tab',
        browserViewRuntimeGeneration: 2,
        webContentsId: 20,
        playwrightConnectionGeneration: 3,
        playwrightPageBindingGeneration: 4,
      },
      WORKSPACE_ID,
    )
    expect(verified).toMatchObject({
      success: true,
      data: {
        articlePublishing: {
          draft: {
            recovery: {
              status: 'verified',
              writePermit: {
                recoveryOperationId: recovery.operationId,
                tabId: 'recovered-tab',
                playwrightPageBindingGeneration: 4,
              },
            },
          },
        },
      },
    })

    const bound = await created.service.bindArticlePublishingRuntime(
      created.affairId,
      attempt.id,
      attempt.executionGeneration,
      attempt.launchOperationId,
      bindings,
      WORKSPACE_ID,
    )
    expect(bound.success).toBe(true)
    if (!verified.success) return
    const permit = verified.data.articlePublishing?.draft?.recovery?.writePermit
    if (!permit) throw new Error('恢复许可未持久化')
    const rotatedSnapshot = platformSnapshot({
      bodyStructureHash: 'c'.repeat(64),
      snapshotHash: 'b'.repeat(64),
      evidenceHash: 'd'.repeat(64),
    })
    const rotated = await created.service.refreshArticlePublishingWriteSnapshot(
      {
        affairId: created.affairId,
        attemptId: attempt.id,
        executionGeneration: attempt.executionGeneration,
        browserTaskRunId: '88888888-8888-4888-8888-888888888888',
        permitId: permit.id,
        previousSnapshotHash: baselineSnapshot.snapshotHash,
        snapshot: rotatedSnapshot,
      },
      WORKSPACE_ID,
    )
    expect(rotated).toMatchObject({
      success: true,
      data: {
        articlePublishing: {
          draft: {
            recovery: { writePermit: { snapshotHash: rotatedSnapshot.snapshotHash } },
          },
        },
      },
    })
    const staleRotation = await created.service.refreshArticlePublishingWriteSnapshot(
      {
        affairId: created.affairId,
        attemptId: attempt.id,
        executionGeneration: attempt.executionGeneration,
        browserTaskRunId: '88888888-8888-4888-8888-888888888888',
        permitId: permit.id,
        previousSnapshotHash: baselineSnapshot.snapshotHash,
        snapshot: platformSnapshot({ snapshotHash: 'f'.repeat(64) }),
      },
      WORKSPACE_ID,
    )
    expect(staleRotation).toMatchObject({ success: false })
  })

  it('keeps the same Attempt retryable when Agent launch fails', async () => {
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
    expect(started.success).toBe(true)
    if (!started.success) return
    const attemptId = started.data.attempts[0].id
    const marked = await created.service.markArticlePublishingAttemptStarted(
      created.affairId,
      attemptId,
      WORKSPACE_ID,
    )
    expect(marked.success).toBe(true)

    const recovered = await created.service.interruptArticlePublishingLaunch(
      created.affairId,
      attemptId,
      '发送 Agent 任务：runtime offline',
      WORKSPACE_ID,
    )
    expect(recovered.success).toBe(true)
    if (!recovered.success) return
    expect(recovered.data.articlePublishing?.execution.status).toBe('interrupted')
    expect(recovered.data.articlePublishing?.checkpoints[0].status).toBe('pending')
    expect(recovered.data.attempts).toHaveLength(1)
    expect(recovered.data.attempts[0]).toMatchObject({
      id: attemptId,
      status: 'interrupted',
      failureMessage: '发送 Agent 任务：runtime offline',
    })

    const resumed = await created.service.resumeArticlePublishingAttempt(
      created.affairId,
      attemptId,
      WORKSPACE_ID,
    )
    expect(resumed.success).toBe(true)
    if (!resumed.success) return
    expect(resumed.data.attempts).toHaveLength(1)
    expect(resumed.data.attempts[0]).toMatchObject({ id: attemptId, status: 'preparing' })
  })

  it('interrupts a live publishing Attempt when its Agent or BrowserTask ends', async () => {
    const created = await createStartedTask(directory, sourcePath, imagePath)

    const interrupted = await created.service.interruptArticlePublishingRuntime(
      created.affairId,
      created.attemptId,
      'automation unavailable',
      WORKSPACE_ID,
    )

    expect(interrupted.success).toBe(true)
    if (!interrupted.success) return
    expect(interrupted.data.articlePublishing?.execution.status).toBe('interrupted')
    expect(interrupted.data.articlePublishing?.checkpoints[0].status).toBe('needs-reconcile')
    expect(interrupted.data.attempts[0]).toMatchObject({
      id: created.attemptId,
      status: 'interrupted',
      failureMessage: 'automation unavailable',
    })

    await expect(
      created.service.interruptArticlePublishingRuntime(
        created.affairId,
        created.attemptId,
        'late duplicate terminal event',
        WORKSPACE_ID,
      ),
    ).resolves.toMatchObject({ success: true })
  })

  it('records the publication side effect before a final click can be dispatched', async () => {
    const created = await createStartedTask(directory, sourcePath, imagePath)
    await prepareUploadCheckpoint(created)
    await dispatchUploadEffect(created, 1)
    const workspaceRef = { kind: 'local' as const, path: directory }
    for (const update of [
      { status: 'uploading' as const },
      { status: 'waiting-platform' as const, evidence: 'file accepted' },
      { status: 'verifying' as const, evidence: 'editor node visible' },
      {
        status: 'uploaded' as const,
        platformUrl: 'https://img-blog.csdnimg.cn/published.png',
        evidence: 'platform URL verified',
      },
    ]) {
      const updated = await created.service.reportArticlePublishingAsset(
        {
          workspaceRef,
          affairId: created.affairId,
          attemptId: created.attemptId,
          assetId: created.assetId,
          ...update,
        },
        WORKSPACE_ID,
        trustedReporter(
          created.reporter,
          update.status === 'uploading'
            ? 'asset-absent'
            : update.status === 'uploaded'
              ? 'asset-uploaded'
              : undefined,
        ),
      )
      expect(updated.success).toBe(true)
    }
    await advanceToPublishCheckpoint(created)

    const current = created.service.getProjectSnapshot(WORKSPACE_ID)
    expect(current.success).toBe(true)
    if (!current.success) return
    const attempt = current.data.affairs[0].attempts[0]
    const fingerprint = 'publish-fingerprint'
    const browserTaskRunId = '77777777-7777-4777-8777-777777777777'
    const reserved = await created.service.reserveArticlePublishingSideEffect(
      created.affairId,
      created.attemptId,
      attempt.executionGeneration,
      'publish',
      'final',
      fingerprint,
      browserTaskRunId,
      WORKSPACE_ID,
    )
    expect(reserved.success).toBe(true)
    const sideEffectKey = `${created.affairId}:${created.attemptId}:g${attempt.executionGeneration}:publish:final`
    const consumed = await created.service.consumeArticlePublishingSideEffect(
      created.affairId,
      created.attemptId,
      attempt.executionGeneration,
      sideEffectKey,
      fingerprint,
      browserTaskRunId,
      WORKSPACE_ID,
    )
    expect(consumed.success).toBe(true)
    if (!consumed.success) return
    expect(consumed.data.articlePublishing?.publication.status).toBe('dispatched')

    const duplicate = await created.service.consumeArticlePublishingSideEffect(
      created.affairId,
      created.attemptId,
      attempt.executionGeneration,
      sideEffectKey,
      fingerprint,
      browserTaskRunId,
      WORKSPACE_ID,
    )
    expect(duplicate).toMatchObject({ success: false, error: { code: 'INVALID_TRANSITION' } })
  })

  it('consumes a persisted side-effect capability exactly once across restart', async () => {
    const created = await createStartedTask(directory, sourcePath, imagePath)
    const snapshot = created.service.getProjectSnapshot(WORKSPACE_ID)
    expect(snapshot.success).toBe(true)
    if (!snapshot.success) return
    const attempt = snapshot.data.affairs[0].attempts[0]
    const browserTaskRunId = '77777777-7777-4777-8777-777777777777'
    const fingerprint = 'fingerprint-save-draft'
    const reserved = await created.service.reserveArticlePublishingSideEffect(
      created.affairId,
      created.attemptId,
      attempt.executionGeneration,
      'save-draft',
      'source-a',
      fingerprint,
      browserTaskRunId,
      WORKSPACE_ID,
    )
    expect(reserved.success).toBe(true)
    const sideEffectKey = `${created.affairId}:${created.attemptId}:g${attempt.executionGeneration}:save-draft:source-a`
    const consumed = await created.service.consumeArticlePublishingSideEffect(
      created.affairId,
      created.attemptId,
      attempt.executionGeneration,
      sideEffectKey,
      fingerprint,
      browserTaskRunId,
      WORKSPACE_ID,
    )
    expect(consumed.success).toBe(true)
    if (!consumed.success) return
    expect(consumed.data.articlePublishing?.sideEffects[0].status).toBe('dispatched')
    await created.service.flush()

    const reloaded = createService(directory)
    await reloaded.load()
    const duplicate = await reloaded.consumeArticlePublishingSideEffect(
      created.affairId,
      created.attemptId,
      attempt.executionGeneration,
      sideEffectKey,
      fingerprint,
      browserTaskRunId,
      WORKSPACE_ID,
    )
    expect(duplicate).toMatchObject({ success: false, error: { code: 'INVALID_TRANSITION' } })
  })

  it('ignores stale owner identities and old execution generations', async () => {
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
    expect(started.success).toBe(true)
    if (!started.success) return
    const attempt = started.data.attempts[0]
    const now = new Date().toISOString()
    const browserTaskRunId = '77777777-7777-4777-8777-777777777777'
    const bound = await created.service.bindArticlePublishingRuntime(
      created.affairId,
      attempt.id,
      attempt.executionGeneration,
      attempt.launchOperationId,
      [
        {
          id: '88888888-8888-4888-8888-888888888881',
          kind: 'agent-run',
          attemptId: attempt.id,
          executionGeneration: attempt.executionGeneration,
          launchOperationId: attempt.launchOperationId,
          status: 'active',
          boundAt: now,
          lastObservedAt: now,
          conversationId: 'conversation-a',
          agentRunId: 'run-a',
          agentRuntimeEpoch: 10,
          agentRuntimeBindingKey: 'runtime-a',
        },
        {
          id: '88888888-8888-4888-8888-888888888882',
          kind: 'browser-tab',
          attemptId: attempt.id,
          executionGeneration: attempt.executionGeneration,
          launchOperationId: attempt.launchOperationId,
          status: 'active',
          boundAt: now,
          lastObservedAt: now,
          tabId: 'tab-a',
          browserViewRuntimeGeneration: 2,
          webContentsId: 20,
        },
        {
          id: '88888888-8888-4888-8888-888888888883',
          kind: 'browser-task',
          attemptId: attempt.id,
          executionGeneration: attempt.executionGeneration,
          launchOperationId: attempt.launchOperationId,
          status: 'active',
          boundAt: now,
          lastObservedAt: now,
          browserTaskRunId,
          tabId: 'tab-a',
          browserViewRuntimeGeneration: 2,
          webContentsId: 20,
          playwrightConnectionGeneration: 3,
          playwrightPageBindingGeneration: 4,
        },
      ],
      WORKSPACE_ID,
    )
    expect(bound.success).toBe(true)

    const rebound = await created.service.rebindArticlePublishingBrowserRuntime({
      workspaceId: WORKSPACE_ID,
      affairId: created.affairId,
      attemptId: attempt.id,
      executionGeneration: attempt.executionGeneration,
      launchOperationId: attempt.launchOperationId,
      browserTaskRunId,
      tabId: 'tab-a',
      browserViewRuntimeGeneration: 2,
      webContentsId: 20,
      previousPlaywrightConnectionGeneration: 3,
      previousPlaywrightPageBindingGeneration: 4,
      playwrightConnectionGeneration: 4,
      playwrightPageBindingGeneration: 5,
    })
    expect(rebound.success).toBe(true)
    if (!rebound.success) return
    expect(
      rebound.data.attempts[0].runtimeBindings.filter(
        (binding) => binding.kind === 'browser-task' && binding.status === 'active',
      ),
    ).toEqual([
      expect.objectContaining({
        browserTaskRunId,
        playwrightConnectionGeneration: 4,
        playwrightPageBindingGeneration: 5,
      }),
    ])
    expect(
      rebound.data.attempts[0].runtimeBindings.find(
        (binding) =>
          binding.kind === 'browser-task' && binding.playwrightConnectionGeneration === 3,
      ),
    ).toMatchObject({ status: 'lost' })

    await expect(
      created.service.rebindArticlePublishingBrowserRuntime({
        workspaceId: WORKSPACE_ID,
        affairId: created.affairId,
        attemptId: attempt.id,
        executionGeneration: attempt.executionGeneration,
        launchOperationId: attempt.launchOperationId,
        browserTaskRunId,
        tabId: 'tab-a',
        browserViewRuntimeGeneration: 2,
        webContentsId: 20,
        previousPlaywrightConnectionGeneration: 3,
        previousPlaywrightPageBindingGeneration: 4,
        playwrightConnectionGeneration: 4,
        playwrightPageBindingGeneration: 5,
      }),
    ).resolves.toMatchObject({ success: true })

    const wrongOwner = await created.service.reconcileArticlePublishingRuntime({
      eventId: 'wrong-owner',
      workspaceId: WORKSPACE_ID,
      affairId: created.affairId,
      attemptId: attempt.id,
      executionGeneration: attempt.executionGeneration,
      launchOperationId: attempt.launchOperationId,
      source: 'agent-terminal',
      observedAt: now,
      runtimeIdentity: {
        kind: 'agent-run',
        conversationId: 'conversation-a',
        agentRunId: 'run-a',
        agentRuntimeEpoch: 9,
        agentRuntimeBindingKey: 'runtime-a',
      },
      reasonCode: 'OLD_OWNER',
      reason: 'late event',
    })
    expect(wrongOwner.success && wrongOwner.data.articlePublishing?.execution.status).toBe(
      'running',
    )

    const interrupted = await created.service.reconcileArticlePublishingRuntime({
      eventId: 'user-owner-check',
      workspaceId: WORKSPACE_ID,
      affairId: created.affairId,
      attemptId: attempt.id,
      executionGeneration: attempt.executionGeneration,
      launchOperationId: attempt.launchOperationId,
      source: 'user-check',
      observedAt: now,
      observedStatus: 'owner-lost',
      reasonCode: 'OWNER_LOST',
      reason: 'owner missing',
    })
    expect(interrupted.success).toBe(true)
    if (!interrupted.success) return
    expect(interrupted.data.articlePublishing?.execution.status).toBe('interrupted')
    const resumed = await created.service.resumeArticlePublishingAttempt(
      created.affairId,
      attempt.id,
      WORKSPACE_ID,
    )
    expect(resumed.success).toBe(true)
    if (!resumed.success) return
    expect(resumed.data.attempts[0].executionGeneration).toBe(attempt.executionGeneration + 1)

    const lateOldGeneration = await created.service.reconcileArticlePublishingRuntime({
      eventId: 'late-old-generation',
      workspaceId: WORKSPACE_ID,
      affairId: created.affairId,
      attemptId: attempt.id,
      executionGeneration: attempt.executionGeneration,
      launchOperationId: attempt.launchOperationId,
      source: 'agent-terminal',
      observedAt: now,
      runtimeIdentity: {
        kind: 'agent-run',
        conversationId: 'conversation-a',
        agentRunId: 'run-a',
        agentRuntimeEpoch: 10,
        agentRuntimeBindingKey: 'runtime-a',
      },
      reasonCode: 'LATE_OLD_RUN',
      reason: 'late event',
    })
    expect(lateOldGeneration.success).toBe(true)
    if (!lateOldGeneration.success) return
    expect(lateOldGeneration.data.articlePublishing?.execution.status).toBe('preparing')
  })

  it('repairs a terminal Attempt that was persisted with a running execution projection', async () => {
    const created = await createStartedTask(directory, sourcePath, imagePath)
    await created.service.flush()
    const filePath = join(directory, 'affairs.json')
    const persisted = JSON.parse(await readFile(filePath, 'utf8'))
    const affair = persisted.affairs[0]
    affair.attempts[0].status = 'cancelled'
    affair.attempts[0].endedAt = new Date().toISOString()
    affair.articlePublishing.execution.status = 'running'
    await writeFile(filePath, JSON.stringify(persisted))

    const reloaded = createService(directory)
    await reloaded.load()
    const snapshot = reloaded.getProjectSnapshot(WORKSPACE_ID)
    expect(snapshot.success).toBe(true)
    if (!snapshot.success) return
    expect(snapshot.data.affairs[0].attempts[0].status).toBe('cancelled')
    expect(snapshot.data.affairs[0].articlePublishing?.execution.status).toBe('cancelled')
    expect(snapshot.data.affairs[0].flow.nodes[0].status).toBe('cancelled')
  })

  it('repairs a dispatched final action to result-unknown instead of allowing a retry', async () => {
    const created = await createStartedTask(directory, sourcePath, imagePath)
    await created.service.flush()
    const filePath = join(directory, 'affairs.json')
    const persisted = JSON.parse(await readFile(filePath, 'utf8'))
    const affair = persisted.affairs[0]
    const attempt = affair.attempts[0]
    const now = new Date().toISOString()
    attempt.status = 'cancelled'
    attempt.endedAt = now
    affair.articlePublishing.execution.status = 'cancelled'
    affair.articlePublishing.publication = { status: 'dispatched', observedAt: now }
    affair.articlePublishing.sideEffects.push({
      key: `${affair.id}:${attempt.id}:g${attempt.executionGeneration}:publish:final`,
      affairId: affair.id,
      attemptId: attempt.id,
      executionGeneration: attempt.executionGeneration,
      kind: 'publish',
      targetId: 'final',
      actionFingerprint: 'publish-fingerprint',
      status: 'dispatched',
      reservedAt: now,
      dispatchedAt: now,
      browserTaskRunId: attempt.browserTaskRunId,
    })
    await writeFile(filePath, JSON.stringify(persisted))

    const reloaded = createService(directory)
    await reloaded.load()
    const snapshot = reloaded.getProjectSnapshot(WORKSPACE_ID)
    expect(snapshot.success).toBe(true)
    if (!snapshot.success) return
    const repaired = snapshot.data.affairs[0]
    expect(repaired.attempts[0].status).toBe('interrupted')
    expect(repaired.articlePublishing?.execution.status).toBe('result-unknown')
    expect(repaired.articlePublishing?.publication.status).toBe('result-unknown')
    expect(repaired.articlePublishing?.sideEffects.at(-1)?.status).toBe('result-unknown')

    const verification = await reloaded.resumeArticlePublishingAttempt(
      repaired.id,
      repaired.attempts[0].id,
      WORKSPACE_ID,
    )
    expect(verification.success).toBe(true)
    if (!verification.success) return
    expect(verification.data.articlePublishing?.execution).toMatchObject({
      status: 'preparing',
      currentStepId: 'verify-publication',
    })
    expect(verification.data.articlePublishing?.publication.status).toBe('result-unknown')
    const marked = await reloaded.markArticlePublishingAttemptStarted(
      repaired.id,
      repaired.attempts[0].id,
      WORKSPACE_ID,
    )
    expect(marked.success).toBe(true)
    if (!marked.success) return
    expect(marked.data.articlePublishing?.execution.currentStepId).toBe('verify-publication')
  })

  it('keeps a non-final unknown upload on its incomplete checkpoint instead of skipping to publication verification', async () => {
    const created = await createStartedTask(directory, sourcePath, imagePath)
    await prepareUploadCheckpoint(created)
    await dispatchUploadEffect(created, 1)
    const workspaceRef = { kind: 'local' as const, path: directory }
    const uploading = await created.service.reportArticlePublishingAsset(
      {
        workspaceRef,
        affairId: created.affairId,
        attemptId: created.attemptId,
        assetId: created.assetId,
        status: 'uploading',
      },
      WORKSPACE_ID,
      trustedReporter(created.reporter, 'asset-absent'),
    )
    expect(uploading.success).toBe(true)
    const unknown = await created.service.reportArticlePublishingAsset(
      {
        workspaceRef,
        affairId: created.affairId,
        attemptId: created.attemptId,
        assetId: created.assetId,
        status: 'result-unknown',
        evidence: '上传派发后无法重新读取页面',
        error: { code: 'CDP_DISCONNECTED', message: '上传派发后 CDP 断开' },
      },
      WORKSPACE_ID,
      created.reporter,
    )
    expect(unknown.success).toBe(true)
    if (!unknown.success) return
    expect(unknown.data.articlePublishing?.execution.status).toBe('result-unknown')
    expect(unknown.data.articlePublishing?.publication.status).toBe('not-started')

    const resumed = await created.service.resumeArticlePublishingAttempt(
      created.affairId,
      created.attemptId,
      WORKSPACE_ID,
    )
    expect(resumed.success).toBe(true)
    if (!resumed.success) return
    expect(resumed.data.articlePublishing?.execution.currentStepId).not.toBe('verify-publication')
    expect(resumed.data.articlePublishing?.publication.status).toBe('not-started')
  })

  it('repairs v0.1.73 data that mislabeled a non-final unknown action as publication unknown', async () => {
    const created = await createStartedTask(directory, sourcePath, imagePath)
    await prepareUploadCheckpoint(created)
    await dispatchUploadEffect(created, 1)
    const workspaceRef = { kind: 'local' as const, path: directory }
    await created.service.reportArticlePublishingAsset(
      {
        workspaceRef,
        affairId: created.affairId,
        attemptId: created.attemptId,
        assetId: created.assetId,
        status: 'uploading',
      },
      WORKSPACE_ID,
      trustedReporter(created.reporter, 'asset-absent'),
    )
    const unknown = await created.service.reportArticlePublishingAsset(
      {
        workspaceRef,
        affairId: created.affairId,
        attemptId: created.attemptId,
        assetId: created.assetId,
        status: 'result-unknown',
        evidence: '上传派发后无法重新读取页面',
        error: { code: 'CDP_DISCONNECTED', message: '上传派发后 CDP 断开' },
      },
      WORKSPACE_ID,
      created.reporter,
    )
    expect(unknown.success).toBe(true)
    await created.service.flush()

    const filePath = join(directory, 'affairs.json')
    const persisted = JSON.parse(await readFile(filePath, 'utf8'))
    const affair = persisted.affairs[0]
    const attempt = affair.attempts[0]
    const now = new Date().toISOString()
    affair.articlePublishing.execution.currentStepId = 'upload-assets'
    affair.articlePublishing.publication = { status: 'result-unknown', observedAt: now }
    affair.articlePublishing.sideEffects.push({
      key: `${affair.id}:${attempt.id}:g${attempt.executionGeneration}:upload-asset:legacy`,
      affairId: affair.id,
      attemptId: attempt.id,
      executionGeneration: attempt.executionGeneration,
      kind: 'upload-asset',
      targetId: `${created.assetId}:attempt-1`,
      actionFingerprint: 'legacy-upload-fingerprint',
      status: 'result-unknown',
      reservedAt: now,
      dispatchedAt: now,
      observedAt: now,
      browserTaskRunId: attempt.browserTaskRunId,
    })
    await writeFile(filePath, JSON.stringify(persisted))

    const reloaded = createService(directory)
    await reloaded.load()
    const snapshot = reloaded.getProjectSnapshot(WORKSPACE_ID)
    expect(snapshot.success).toBe(true)
    if (!snapshot.success) return
    const repaired = snapshot.data.affairs[0]
    expect(repaired.articlePublishing?.execution.status).toBe('result-unknown')
    expect(repaired.articlePublishing?.publication.status).toBe('not-started')
    expect(repaired.events.at(-1)?.summary).toContain('误标为最终发布未知')
  })

  it('repairs the v0.1.74 startup crash when legacy normalization exposes a lifecycle mismatch', async () => {
    const created = await createStartedTask(directory, sourcePath, imagePath)
    await prepareUploadCheckpoint(created)
    await dispatchUploadEffect(created, 1)
    const workspaceRef = { kind: 'local' as const, path: directory }
    await created.service.reportArticlePublishingAsset(
      {
        workspaceRef,
        affairId: created.affairId,
        attemptId: created.attemptId,
        assetId: created.assetId,
        status: 'uploading',
      },
      WORKSPACE_ID,
      trustedReporter(created.reporter, 'asset-absent'),
    )
    await created.service.reportArticlePublishingAsset(
      {
        workspaceRef,
        affairId: created.affairId,
        attemptId: created.attemptId,
        assetId: created.assetId,
        status: 'result-unknown',
        evidence: '上传派发后无法重新读取页面',
        error: { code: 'CDP_DISCONNECTED', message: '上传派发后 CDP 断开' },
      },
      WORKSPACE_ID,
      created.reporter,
    )
    await created.service.flush()

    const filePath = join(directory, 'affairs.json')
    const persisted = JSON.parse(await readFile(filePath, 'utf8'))
    const affair = persisted.affairs[0]
    const attempt = affair.attempts[0]
    const now = new Date().toISOString()
    attempt.status = 'waiting-human'
    affair.articlePublishing.execution.currentStepId = 'upload-assets'
    affair.articlePublishing.publication = { status: 'result-unknown', observedAt: now }
    affair.articlePublishing.sideEffects.push({
      key: `${affair.id}:${attempt.id}:g${attempt.executionGeneration}:upload-asset:v0174`,
      affairId: affair.id,
      attemptId: attempt.id,
      executionGeneration: attempt.executionGeneration,
      kind: 'upload-asset',
      targetId: `${created.assetId}:v0174`,
      actionFingerprint: 'v0174-upload-fingerprint',
      status: 'result-unknown',
      reservedAt: now,
      dispatchedAt: now,
      observedAt: now,
      browserTaskRunId: attempt.browserTaskRunId,
    })
    await writeFile(filePath, JSON.stringify(persisted))

    const reloaded = createService(directory)
    await expect(reloaded.load()).resolves.toBeUndefined()
    const snapshot = reloaded.getProjectSnapshot(WORKSPACE_ID)
    expect(snapshot.success).toBe(true)
    if (!snapshot.success) return
    const repaired = snapshot.data.affairs[0]
    expect(repaired.attempts[0].status).toBe('waiting-human')
    expect(repaired.articlePublishing?.execution.status).toBe('waiting-human')
    expect(repaired.articlePublishing?.publication.status).toBe('not-started')
    const repairedRevision = snapshot.data.revision
    await reloaded.flush()

    const secondLoad = createService(directory)
    await expect(secondLoad.load()).resolves.toBeUndefined()
    const stable = secondLoad.getProjectSnapshot(WORKSPACE_ID)
    expect(stable.success).toBe(true)
    if (!stable.success) return
    expect(stable.data.revision).toBe(repairedRevision)
    expect(stable.data.affairs[0].articlePublishing?.execution.status).toBe('waiting-human')
    await secondLoad.flush()
  })

  it('converges every persisted terminal or handoff lifecycle mismatch before strict validation', async () => {
    const created = await createStartedTask(directory, sourcePath, imagePath)
    await created.service.flush()
    const persisted = JSON.parse(await readFile(join(directory, 'affairs.json'), 'utf8'))
    const executionStatuses = [
      'draft',
      'preparing',
      'running',
      'checking-runtime',
      'waiting-human',
      'interrupted',
      'cancelled',
      'failed',
      'published',
      'result-unknown',
    ] as const
    const projections = [
      { attempt: 'waiting-human', allowed: ['waiting-human'], expected: 'waiting-human' },
      {
        attempt: 'interrupted',
        allowed: ['interrupted', 'result-unknown'],
        expected: 'interrupted',
      },
      { attempt: 'cancelled', allowed: ['cancelled'], expected: 'cancelled' },
      { attempt: 'failed', allowed: ['failed'], expected: 'failed' },
      { attempt: 'succeeded', allowed: ['published'], expected: 'published' },
    ] as const

    let caseNumber = 0
    for (const projection of projections) {
      for (const executionStatus of executionStatuses) {
        if ((projection.allowed as readonly string[]).includes(executionStatus)) continue
        caseNumber += 1
        const caseDirectory = join(directory, `projection-${caseNumber}`)
        await mkdir(caseDirectory)
        const candidate = structuredClone(persisted)
        const affair = candidate.affairs[0]
        affair.attempts[0].status = projection.attempt
        affair.articlePublishing.execution.status = executionStatus
        await writeFile(join(caseDirectory, 'affairs.json'), JSON.stringify(candidate))

        const reloaded = createService(caseDirectory)
        await expect(reloaded.load()).resolves.toBeUndefined()
        const snapshot = reloaded.getProjectSnapshot(WORKSPACE_ID)
        expect(snapshot.success).toBe(true)
        if (!snapshot.success) continue
        expect(snapshot.data.affairs[0].attempts[0].status).toBe(projection.attempt)
        expect(snapshot.data.affairs[0].articlePublishing?.execution.status).toBe(
          projection.expected,
        )
        await reloaded.flush()
      }
    }
  })

  it('preserves publication unknown when legacy evidence does not prove it came from a non-final action', async () => {
    const created = await createStartedTask(directory, sourcePath, imagePath)
    await prepareUploadCheckpoint(created)
    await dispatchUploadEffect(created, 1)
    const workspaceRef = { kind: 'local' as const, path: directory }
    await created.service.reportArticlePublishingAsset(
      {
        workspaceRef,
        affairId: created.affairId,
        attemptId: created.attemptId,
        assetId: created.assetId,
        status: 'uploading',
      },
      WORKSPACE_ID,
      trustedReporter(created.reporter, 'asset-absent'),
    )
    await created.service.reportArticlePublishingAsset(
      {
        workspaceRef,
        affairId: created.affairId,
        attemptId: created.attemptId,
        assetId: created.assetId,
        status: 'result-unknown',
        evidence: '上传派发后无法重新读取页面',
        error: { code: 'CDP_DISCONNECTED', message: '上传派发后 CDP 断开' },
      },
      WORKSPACE_ID,
      created.reporter,
    )
    await created.service.flush()

    const filePath = join(directory, 'affairs.json')
    const persisted = JSON.parse(await readFile(filePath, 'utf8'))
    const affair = persisted.affairs[0]
    const attempt = affair.attempts[0]
    const publicationObservedAt = new Date().toISOString()
    const nonFinalObservedAt = new Date(Date.parse(publicationObservedAt) - 1_000).toISOString()
    affair.articlePublishing.execution.currentStepId = 'save-draft'
    affair.articlePublishing.publication = {
      status: 'result-unknown',
      observedAt: publicationObservedAt,
    }
    affair.articlePublishing.sideEffects.push({
      key: `${affair.id}:${attempt.id}:g${attempt.executionGeneration}:save-draft:legacy`,
      affairId: affair.id,
      attemptId: attempt.id,
      executionGeneration: attempt.executionGeneration,
      kind: 'save-draft',
      targetId: 'legacy-draft',
      actionFingerprint: 'legacy-draft-fingerprint',
      status: 'result-unknown',
      reservedAt: nonFinalObservedAt,
      dispatchedAt: nonFinalObservedAt,
      observedAt: nonFinalObservedAt,
      browserTaskRunId: attempt.browserTaskRunId,
    })
    await writeFile(filePath, JSON.stringify(persisted))

    const reloaded = createService(directory)
    await reloaded.load()
    const snapshot = reloaded.getProjectSnapshot(WORKSPACE_ID)
    expect(snapshot.success).toBe(true)
    if (!snapshot.success) return
    expect(snapshot.data.affairs[0].articlePublishing?.publication.status).toBe('result-unknown')
  })

  it('still persists startup convergence when an affair already has 2,000 events', async () => {
    const created = await createStartedTask(directory, sourcePath, imagePath)
    await created.service.flush()
    const filePath = join(directory, 'affairs.json')
    const persisted = JSON.parse(await readFile(filePath, 'utf8'))
    const now = new Date().toISOString()
    persisted.affairs[0].events = Array.from({ length: 2_000 }, (_, index) => ({
      id: randomUUID(),
      type: 'node-status-changed',
      summary: `diagnostic-${index}`,
      occurredAt: now,
    }))
    await writeFile(filePath, JSON.stringify(persisted))

    const reloaded = createService(directory)
    await reloaded.load()
    const snapshot = reloaded.getProjectSnapshot(WORKSPACE_ID)
    expect(snapshot.success).toBe(true)
    if (!snapshot.success) return
    expect(snapshot.data.affairs[0].articlePublishing?.execution.status).toBe('interrupted')
    expect(snapshot.data.affairs[0].events).toHaveLength(2_000)
    expect(snapshot.data.affairs[0].events[0].summary).toContain('已压缩')
  })

  it('compacts oversized diagnostic history below the write high-water mark', async () => {
    const created = await createDraftTask(directory, sourcePath, imagePath)
    await created.service.flush()
    const filePath = join(directory, 'affairs.json')
    const persisted = JSON.parse(await readFile(filePath, 'utf8'))
    const now = new Date().toISOString()
    const events = Array.from({ length: 2_000 }, () => ({
      id: randomUUID(),
      type: 'node-status-changed',
      summary: 'x'.repeat(2_000),
      occurredAt: now,
    }))
    persisted.revision += 1
    persisted.affairs = [
      { ...persisted.affairs[0], id: randomUUID(), events },
      { ...persisted.affairs[0], id: randomUUID(), events },
    ]

    const saved = await new WebAffairStore(filePath).save(persisted)
    expect(saved.affairs.every((affair) => affair.events.length <= 500)).toBe(true)
    expect((await stat(filePath)).size).toBeLessThan(7 * 1024 * 1024)
  })

  it('replays a newer fixed recovery journal exactly once', async () => {
    const created = await createDraftTask(directory, sourcePath, imagePath)
    await created.service.flush()
    const filePath = join(directory, 'affairs.json')
    const store = new WebAffairStore(filePath)
    const primary = JSON.parse(await readFile(filePath, 'utf8'))
    const recovery = structuredClone(primary)
    recovery.revision += 1
    recovery.affairs[0].title = 'Recovered Article'
    await writeFile(
      store.recoveryPath,
      JSON.stringify({
        journalVersion: 1,
        baseRevision: primary.revision,
        targetRevision: recovery.revision,
        targetHash: createHash('sha256')
          .update(JSON.stringify({ revision: recovery.revision, affairs: recovery.affairs }))
          .digest('hex'),
        affairs: recovery.affairs,
      }),
    )

    const recovered = await store.load()
    expect(recovered.revision).toBe(recovery.revision)
    expect(recovered.affairs[0].title).toBe('Recovered Article')
    await expect(readFile(store.recoveryPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })

    const secondLoad = await store.load()
    expect(secondLoad.revision).toBe(recovery.revision)
    expect(secondLoad.affairs[0].title).toBe('Recovered Article')
  })

  it('fails closed instead of ignoring a damaged recovery journal', async () => {
    const created = await createDraftTask(directory, sourcePath, imagePath)
    await created.service.flush()
    const filePath = join(directory, 'affairs.json')
    const store = new WebAffairStore(filePath)
    const primaryBefore = await readFile(filePath, 'utf8')
    await writeFile(store.recoveryPath, '{"journalVersion":1}')

    await expect(store.load()).rejects.toThrow('恢复日志损坏')
    expect(await readFile(filePath, 'utf8')).toBe(primaryBefore)
    expect(await readFile(store.recoveryPath, 'utf8')).toContain('journalVersion')
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
  const markedAttempt = marked.data.attempts.find((attempt) => attempt.id === attemptId)!
  const now = new Date().toISOString()
  const bindingBase = {
    attemptId,
    executionGeneration: markedAttempt.executionGeneration,
    launchOperationId: markedAttempt.launchOperationId,
    status: 'active' as const,
    boundAt: now,
    lastObservedAt: now,
  }
  const bound = await created.service.bindArticlePublishingRuntime(
    created.affairId,
    attemptId,
    markedAttempt.executionGeneration,
    markedAttempt.launchOperationId,
    [
      {
        ...bindingBase,
        id: randomUUID(),
        kind: 'agent-run',
        conversationId: 'conversation-article',
        agentRunId: 'run-article',
        agentRuntimeEpoch: 1,
        agentRuntimeBindingKey: 'agent-binding-article',
      },
      {
        ...bindingBase,
        id: randomUUID(),
        kind: 'browser-tab',
        tabId: 'tab-article',
        browserViewRuntimeGeneration: 1,
        webContentsId: 10,
      },
      {
        ...bindingBase,
        id: randomUUID(),
        kind: 'browser-task',
        browserTaskRunId: '77777777-7777-4777-8777-777777777777',
        tabId: 'tab-article',
        browserViewRuntimeGeneration: 1,
        webContentsId: 10,
        playwrightConnectionGeneration: 1,
        playwrightPageBindingGeneration: 1,
      },
    ],
    WORKSPACE_ID,
  )
  if (!bound.success) throw new Error(bound.error.message)
  return {
    service: created.service,
    affairId: created.affairId,
    attemptId,
    assetId: created.assetId,
    workspacePath: directory,
    reporter: {
      workspaceId: WORKSPACE_ID,
      affairId: created.affairId,
      attemptId,
      executionGeneration: markedAttempt.executionGeneration,
      launchOperationId: markedAttempt.launchOperationId,
      conversationId: 'conversation-article',
      agentRunId: 'run-article',
    },
  }
}

type StartedTask = Awaited<ReturnType<typeof createStartedTask>>

function runtimeBindingsFor(
  attempt: { id: string; executionGeneration: number; launchOperationId: string },
  identity: {
    tabId: string
    browserTaskRunId: string
    browserViewRuntimeGeneration: number
    webContentsId: number
    playwrightConnectionGeneration: number
    playwrightPageBindingGeneration: number
  },
) {
  const now = new Date().toISOString()
  const base = {
    attemptId: attempt.id,
    executionGeneration: attempt.executionGeneration,
    launchOperationId: attempt.launchOperationId,
    status: 'active' as const,
    boundAt: now,
    lastObservedAt: now,
  }
  return [
    {
      ...base,
      id: randomUUID(),
      kind: 'agent-run' as const,
      conversationId: `conversation-g${attempt.executionGeneration}`,
      agentRunId: `run-g${attempt.executionGeneration}`,
      agentRuntimeEpoch: attempt.executionGeneration,
      agentRuntimeBindingKey: `agent-binding-g${attempt.executionGeneration}`,
    },
    {
      ...base,
      id: randomUUID(),
      kind: 'browser-tab' as const,
      tabId: identity.tabId,
      browserViewRuntimeGeneration: identity.browserViewRuntimeGeneration,
      webContentsId: identity.webContentsId,
    },
    {
      ...base,
      id: randomUUID(),
      kind: 'browser-task' as const,
      browserTaskRunId: identity.browserTaskRunId,
      tabId: identity.tabId,
      browserViewRuntimeGeneration: identity.browserViewRuntimeGeneration,
      webContentsId: identity.webContentsId,
      playwrightConnectionGeneration: identity.playwrightConnectionGeneration,
      playwrightPageBindingGeneration: identity.playwrightPageBindingGeneration,
    },
  ]
}

function trustedReporter(
  reporter: ArticlePublishingAgentReporter,
  kind?: NonNullable<ArticlePublishingAgentReporter['trustedPageEvidence']>['kind'],
  url = 'https://mp.csdn.net/mp_blog/creation/editor/164148817',
): ArticlePublishingAgentReporter {
  if (!kind) return reporter
  return {
    ...reporter,
    trustedPageEvidence: {
      adapterId: 'csdn',
      adapterVersion: 1,
      evidenceHash: 'e'.repeat(64),
      observedAt: new Date().toISOString(),
      url,
      kind,
      ...(kind === 'asset-uploaded' ? { platformContentHash: 'd'.repeat(64) } : {}),
      bodyStructureHash: 'b'.repeat(64),
      platformAccountId: 'csdn:test-user',
      platformSnapshot: platformSnapshot(),
    },
  }
}

function platformSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    adapterId: 'csdn' as const,
    adapterVersion: 1 as const,
    platformAccountId: 'csdn:test-user',
    draftId: '164148817',
    normalizedTitle: 'Article',
    bodyStructureHash: 'b'.repeat(64),
    images: [],
    imageEnumerationComplete: true as const,
    saveState: 'saved' as const,
    snapshotHash: 'a'.repeat(64),
    evidenceHash: 'e'.repeat(64),
    observedAt: new Date().toISOString(),
    ...overrides,
  }
}

async function resumeAndBindPublishingTask(
  created: StartedTask,
): Promise<ArticlePublishingAgentReporter> {
  const acquired = await created.service.acquireArticlePublishingAttempt(
    created.affairId,
    WORKSPACE_ID,
  )
  if (!acquired.success) throw new Error(acquired.error.message)
  const attempt = acquired.data.attempts.find((item) => item.id === created.attemptId)
  if (!attempt) throw new Error('恢复后的 Attempt 不存在')
  const now = new Date().toISOString()
  const base = {
    attemptId: attempt.id,
    executionGeneration: attempt.executionGeneration,
    launchOperationId: attempt.launchOperationId,
    status: 'active' as const,
    boundAt: now,
    lastObservedAt: now,
  }
  const browserTaskRunId = '88888888-8888-4888-8888-888888888888'
  const conversationId = 'conversation-article'
  const agentRunId = `run-article-g${attempt.executionGeneration}`
  const bound = await created.service.bindArticlePublishingRuntime(
    created.affairId,
    attempt.id,
    attempt.executionGeneration,
    attempt.launchOperationId,
    [
      {
        ...base,
        id: randomUUID(),
        kind: 'agent-run',
        conversationId,
        agentRunId,
        agentRuntimeEpoch: attempt.executionGeneration,
        agentRuntimeBindingKey: `agent-binding-g${attempt.executionGeneration}`,
      },
      {
        ...base,
        id: randomUUID(),
        kind: 'browser-tab',
        tabId: 'tab-article',
        browserViewRuntimeGeneration: attempt.executionGeneration,
        webContentsId: 10,
      },
      {
        ...base,
        id: randomUUID(),
        kind: 'browser-task',
        browserTaskRunId,
        tabId: 'tab-article',
        browserViewRuntimeGeneration: attempt.executionGeneration,
        webContentsId: 10,
        playwrightConnectionGeneration: attempt.executionGeneration,
        playwrightPageBindingGeneration: attempt.executionGeneration,
      },
    ],
    WORKSPACE_ID,
  )
  if (!bound.success) throw new Error(bound.error.message)
  return {
    workspaceId: WORKSPACE_ID,
    affairId: created.affairId,
    attemptId: attempt.id,
    executionGeneration: attempt.executionGeneration,
    launchOperationId: attempt.launchOperationId,
    conversationId,
    agentRunId,
  }
}

async function prepareUploadCheckpoint(created: StartedTask) {
  const workspaceRef = { kind: 'local' as const, path: created.workspacePath }
  for (const stepId of ['open-editor', 'verify-account']) {
    const snapshot = created.service.getProjectSnapshot(WORKSPACE_ID)
    if (!snapshot.success) throw new Error(snapshot.error.message)
    const checkpoint = snapshot.data.affairs[0].articlePublishing?.checkpoints.find(
      (item) => item.stepId === stepId,
    )
    const updates = [
      ...(checkpoint?.status === 'pending' ? [{ status: 'running' as const }] : []),
      { status: 'verifying' as const, evidence: `${stepId} observed` },
      { status: 'completed' as const, evidence: `${stepId} verified` },
    ]
    for (const update of updates) {
      const result = await created.service.reportArticlePublishingCheckpoint(
        {
          workspaceRef,
          affairId: created.affairId,
          attemptId: created.attemptId,
          stepId,
          ...update,
        },
        WORKSPACE_ID,
        trustedReporter(created.reporter, update.status === 'completed' ? 'checkpoint' : undefined),
      )
      if (!result.success) throw new Error(result.error.message)
    }
  }
  const running = await created.service.reportArticlePublishingCheckpoint(
    {
      workspaceRef,
      affairId: created.affairId,
      attemptId: created.attemptId,
      stepId: 'upload-assets',
      status: 'running',
    },
    WORKSPACE_ID,
    created.reporter,
  )
  if (!running.success) throw new Error(running.error.message)
}

async function dispatchUploadEffect(created: StartedTask, attemptNumber: number) {
  const snapshot = created.service.getProjectSnapshot(WORKSPACE_ID)
  if (!snapshot.success) throw new Error(snapshot.error.message)
  const attempt = snapshot.data.affairs[0].attempts[0]
  const browserTaskRunId = '77777777-7777-4777-8777-777777777777'
  const targetId = `${created.assetId}:attempt-${attemptNumber}`
  const fingerprint = `upload-${attemptNumber}`
  const reserved = await created.service.reserveArticlePublishingSideEffect(
    created.affairId,
    created.attemptId,
    attempt.executionGeneration,
    'upload-asset',
    targetId,
    fingerprint,
    browserTaskRunId,
    WORKSPACE_ID,
  )
  if (!reserved.success) throw new Error(reserved.error.message)
  const consumed = await created.service.consumeArticlePublishingSideEffect(
    created.affairId,
    created.attemptId,
    attempt.executionGeneration,
    `${created.affairId}:${created.attemptId}:g${attempt.executionGeneration}:upload-asset:${targetId}`,
    fingerprint,
    browserTaskRunId,
    WORKSPACE_ID,
  )
  if (!consumed.success) throw new Error(consumed.error.message)
}

async function reportPublishingCheckpoint(
  created: StartedTask,
  stepId: string,
  status: 'running' | 'verifying' | 'completed',
) {
  const workspaceRef = { kind: 'local' as const, path: created.workspacePath }
  const result = await created.service.reportArticlePublishingCheckpoint(
    {
      workspaceRef,
      affairId: created.affairId,
      attemptId: created.attemptId,
      stepId,
      status,
      ...(status === 'running' ? {} : { evidence: `${stepId} ${status}` }),
    },
    WORKSPACE_ID,
    trustedReporter(created.reporter, status === 'completed' ? 'checkpoint' : undefined),
  )
  if (!result.success) throw new Error(result.error.message)
}

async function dispatchSaveEffect(created: StartedTask, stepId: string): Promise<string> {
  const snapshot = created.service.getProjectSnapshot(WORKSPACE_ID)
  if (!snapshot.success) throw new Error(snapshot.error.message)
  const attempt = snapshot.data.affairs[0].attempts.find((item) => item.id === created.attemptId)!
  const targetId = stepId === 'save-draft' ? 'source-hash-test' : `autosave:${stepId}:test-action`
  const fingerprint = `${stepId}-fingerprint-g${attempt.executionGeneration}`
  const browserTaskRunId = attempt.browserTaskRunId ?? '77777777-7777-4777-8777-777777777777'
  const reserved = await created.service.reserveArticlePublishingSideEffect(
    created.affairId,
    created.attemptId,
    attempt.executionGeneration,
    'save-draft',
    targetId,
    fingerprint,
    browserTaskRunId,
    WORKSPACE_ID,
  )
  if (!reserved.success) throw new Error(reserved.error.message)
  const sideEffectKey = `${created.affairId}:${created.attemptId}:g${attempt.executionGeneration}:save-draft:${targetId}`
  const consumed = await created.service.consumeArticlePublishingSideEffect(
    created.affairId,
    created.attemptId,
    attempt.executionGeneration,
    sideEffectKey,
    fingerprint,
    browserTaskRunId,
    WORKSPACE_ID,
  )
  if (!consumed.success) throw new Error(consumed.error.message)
  return sideEffectKey
}

async function advanceToSaveCheckpoint(created: StartedTask) {
  await reportPublishingCheckpoint(created, 'upload-assets', 'verifying')
  await reportPublishingCheckpoint(created, 'upload-assets', 'completed')
  for (const stepId of ['fill-body', 'fill-fields']) {
    await reportPublishingCheckpoint(created, stepId, 'running')
    await dispatchSaveEffect(created, stepId)
    await reportPublishingCheckpoint(created, stepId, 'verifying')
    await reportPublishingCheckpoint(created, stepId, 'completed')
  }
  await reportPublishingCheckpoint(created, 'save-draft', 'running')
}

async function advanceToPublishCheckpoint(created: StartedTask) {
  await advanceToSaveCheckpoint(created)
  await dispatchSaveEffect(created, 'save-draft')
  await reportPublishingCheckpoint(created, 'save-draft', 'verifying')
  await reportPublishingCheckpoint(created, 'save-draft', 'completed')
  await reportPublishingCheckpoint(created, 'publish', 'running')
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
