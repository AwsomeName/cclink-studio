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

  it.each([false, true])(
    'creates a Weibo task with explicit allowPublish=%s without a fake draft or duplicate composer',
    async (allowPublish) => {
      const registered = resources()
      registered.websites[0].origin = 'https://weibo.com'
      registered.websites[0].entryUrl = 'https://weibo.com/'
      const service = new WebAffairService(
        () => registered,
        new WebAffairStore(join(directory, 'weibo.json')),
      )
      await service.load()
      const input = {
        preview: {
          source: { markdownPath: sourcePath, modifiedAt: Date.now(), size: 36 },
          title: 'Article',
          summary: '',
          assets: [],
          blockers: [],
          warnings: [],
        },
        accountId: ACCOUNT_ID,
        composer: { platformAccountId: '5961101548', allowPublish },
        fields: { title: 'Article', summary: '', tags: [], category: '' },
        workspaceRef: { kind: 'local' as const, path: directory },
      }
      expect(
        await service.createArticlePublishingAffair(
          { ...input, composer: { ...input.composer, platformAccountId: 'invalid' } },
          WORKSPACE_ID,
        ),
      ).toMatchObject({ success: false })
      expect(
        await service.createArticlePublishingAffair(
          {
            ...input,
            existingDraft: { url: 'https://weibo.com/', platformAccountId: '5961101548' },
          },
          WORKSPACE_ID,
        ),
      ).toMatchObject({ success: false })
      const created = await service.createArticlePublishingAffair(input, WORKSPACE_ID)
      expect(created.success).toBe(true)
      if (!created.success) throw new Error(created.error.message)
      expect(created.data.articlePublishing?.draft).toBeUndefined()
      expect(created.data.articlePublishing?.publication).toEqual({ status: 'not-started' })
      expect(
        created.data.articlePublishing?.checkpoints.find((c) => c.stepId === 'save-draft')?.label,
      ).toContain('不代表平台已保存')
      expect(await service.createArticlePublishingAffair(input, WORKSPACE_ID)).toMatchObject({
        success: false,
      })
      await service.flush()
    },
  )

  it.each(['accepted', 'stale', 'wrong-account', 'not-dispatched'] as const)(
    'binds only a current dispatched XHS receipt without declaring publication: %s',
    async (scenario) => {
      const created = await createStartedTask(directory, sourcePath, imagePath)
      await created.service.flush()
      const snapshot = JSON.parse(await readFile(join(directory, 'affairs.json'), 'utf8'))
      const affair = snapshot.affairs.find((a: { id: string }) => a.id === created.affairId)!
      const publishing = affair.articlePublishing!
      const draftId = '071c3c48-ca3e-49c3-bb52-a43c1a73def8',
        uid = '65361844000000000301e75a'
      publishing.adapterId = 'xiaohongshu'
      publishing.draft = {
        platformDraftId: draftId,
        platformAccountId: uid,
        url: 'https://creator.xiaohongshu.com/publish/publish?target=image',
        normalizedTitle: 'Article',
      }
      publishing.publication = { status: 'dispatched' }
      const effect = {
        key: 'xhs-submit',
        affairId: affair.id,
        attemptId: created.attemptId,
        executionGeneration: publishing.execution.currentGeneration,
        kind: 'publish' as const,
        targetId: 'publish',
        status: scenario === 'not-dispatched' ? ('reserved' as const) : ('dispatched' as const),
        reservedAt: new Date().toISOString(),
        dispatchedAt: new Date().toISOString(),
        browserTaskRunId: '77777777-7777-4777-8777-777777777777',
      }
      publishing.sideEffects = [effect]
      Reflect.set(created.service, 'snapshot', snapshot)
      const result = await created.service.recordXiaohongshuSubmissionReceipt(
        {
          affairId: affair.id,
          attemptId: created.attemptId,
          executionGeneration: effect.executionGeneration + (scenario === 'stale' ? 1 : 0),
          browserTaskRunId: '77777777-7777-4777-8777-777777777777',
          sideEffectKey: effect.key,
          draftId,
          uid: scenario === 'wrong-account' ? 'other' : uid,
          noteId: '6a8ed725000000002102ea10',
        },
        WORKSPACE_ID,
      )
      expect(result.success, JSON.stringify(result.success ? null : result.error)).toBe(
        scenario === 'accepted',
      )
      if (result.success) {
        expect(result.data.articlePublishing?.publication.status).toBe('dispatched')
        expect(result.data.articlePublishing?.publication.url).toBe(
          'https://www.xiaohongshu.com/explore/6a8ed725000000002102ea10',
        )
        expect(result.data.articlePublishing?.sideEffects[0].status).toBe('verified')
      }
      await created.service.flush()
    },
  )

  it.each(['accepted', 'stale', 'wrong-account', 'not-dispatched', 'not-authorized'] as const)(
    'binds only a current dispatched Weibo receipt without declaring publication: %s',
    async (scenario) => {
      const created = await createStartedTask(directory, sourcePath, imagePath)
      await created.service.flush()
      const snapshot = JSON.parse(await readFile(join(directory, 'affairs.json'), 'utf8'))
      const affair = snapshot.affairs.find((a: { id: string }) => a.id === created.affairId)!
      const publishing = affair.articlePublishing!
      const uid = '5961101548'
      publishing.adapterId = 'weibo'
      delete publishing.draft
      publishing.composer = { platformAccountId: uid, allowPublish: scenario !== 'not-authorized' }
      publishing.publication = { status: 'dispatched' }
      const effect = {
        key: 'weibo-submit',
        affairId: affair.id,
        attemptId: created.attemptId,
        executionGeneration: publishing.execution.currentGeneration,
        kind: 'publish' as const,
        targetId: 'publish',
        status: scenario === 'not-dispatched' ? ('reserved' as const) : ('dispatched' as const),
        reservedAt: new Date().toISOString(),
        dispatchedAt: new Date().toISOString(),
        browserTaskRunId: '77777777-7777-4777-8777-777777777777',
      }
      publishing.sideEffects = [effect]
      Reflect.set(created.service, 'snapshot', snapshot)
      const result = await created.service.recordWeiboSubmissionReceipt(
        {
          affairId: affair.id,
          attemptId: created.attemptId,
          executionGeneration: effect.executionGeneration + (scenario === 'stale' ? 1 : 0),
          browserTaskRunId: '77777777-7777-4777-8777-777777777777',
          sideEffectKey: effect.key,
          uid: scenario === 'wrong-account' ? 'other' : uid,
          postId: 'RhAKon2wi',
        },
        WORKSPACE_ID,
      )
      expect(result.success, JSON.stringify(result.success ? null : result.error)).toBe(
        scenario === 'accepted',
      )
      if (result.success) {
        expect(result.data.articlePublishing?.publication.status).toBe('dispatched')
        expect(result.data.articlePublishing?.publication.url).toBe(
          'https://weibo.com/5961101548/RhAKon2wi',
        )
        expect(result.data.articlePublishing?.sideEffects[0].status).toBe('verified')
      }
      await created.service.flush()
    },
  )

  it.each(['current', 'stale', 'not-skipped', 'wrong-account'])(
    'completes an unchanged Zhihu title only with current read-only evidence: %s',
    async (scenario) => {
      const created = await createStartedTask(directory, sourcePath, imagePath)
      await prepareUploadCheckpoint(created)
      await dispatchUploadEffect(created, 1)
      for (const status of ['uploading', 'waiting-platform', 'verifying', 'uploaded'] as const) {
        const result = await created.service.reportArticlePublishingAsset(
          {
            workspaceRef: { kind: 'local', path: directory },
            affairId: created.affairId,
            attemptId: created.attemptId,
            assetId: created.assetId,
            status,
            evidence: 'current image',
            ...(status === 'uploaded'
              ? { platformUrl: 'https://img-blog.csdnimg.cn/test.png' }
              : {}),
          },
          WORKSPACE_ID,
          trustedReporter(
            created.reporter,
            status === 'uploading'
              ? 'asset-absent'
              : status === 'uploaded'
                ? 'asset-uploaded'
                : undefined,
          ),
        )
        if (!result.success) throw new Error(result.error.message)
      }
      await advanceToSaveCheckpoint(created)
      await created.service.flush()
      const path = join(directory, 'affairs.json')
      const snapshot = JSON.parse(await readFile(path, 'utf8'))
      const affair = snapshot.affairs.find((a: { id: string }) => a.id === created.affairId)
      const publishing = affair.articlePublishing
      publishing.adapterId = 'zhihu'
      publishing.execution.currentStepId = 'fill-fields'
      publishing.sideEffects = publishing.sideEffects.filter(
        (e: { targetId: string }) => !e.targetId.startsWith('autosave:fill-fields:'),
      )
      const checkpoint = publishing.checkpoints.find(
        (c: { stepId: string }) => c.stepId === 'fill-fields',
      )
      checkpoint.status = 'verifying'
      checkpoint.details = [
        {
          id: 'field.title.dispatch',
          evidence: 'main page',
          observedAt: new Date().toISOString(),
          nextAction: 'verify',
          status: scenario === 'not-skipped' ? 'pending' : 'skipped',
          generation: scenario === 'stale' ? 0 : publishing.execution.currentGeneration,
        },
        {
          id: 'field.title.verify',
          evidence: 'main page',
          observedAt: new Date().toISOString(),
          nextAction: 'save',
          status: 'completed',
          generation: publishing.execution.currentGeneration,
        },
      ]
      await writeFile(path, JSON.stringify(snapshot))
      const service = created.service
      Reflect.set(service, 'snapshot', snapshot)
      const reporter = trustedReporter(
        created.reporter,
        'checkpoint',
        'https://zhuanlan.zhihu.com/p/164148817/edit',
      )
      reporter.trustedPageEvidence!.adapterId = 'zhihu'
      if (scenario === 'wrong-account') reporter.trustedPageEvidence!.platformAccountId = 'other'
      const result = await service.reportArticlePublishingCheckpoint(
        {
          workspaceRef: { kind: 'local', path: directory },
          affairId: created.affairId,
          attemptId: created.attemptId,
          stepId: 'fill-fields',
          status: 'completed',
          evidence: 'main readback',
        },
        WORKSPACE_ID,
        reporter,
      )
      expect(result.success, JSON.stringify(result.success ? null : result.error)).toBe(
        scenario === 'current',
      )
      await service.flush()
    },
  )

  it('honors explicit cancellation after the Agent has already interrupted the current attempt', async () => {
    const created = await createStartedTask(directory, sourcePath, imagePath)
    await created.service.interruptArticlePublishingLaunch(
      created.affairId,
      created.attemptId,
      'Agent 先结束',
      WORKSPACE_ID,
    )
    const cancelled = await created.service.reconcileArticlePublishingRuntime({
      ...created.reporter,
      eventId: randomUUID(),
      source: 'user-cancel',
      observedAt: new Date().toISOString(),
      observedStatus: 'cancelled',
      reasonCode: 'USER_CANCELLED',
      reason: '用户明确终止已中断运行',
    })
    expect(cancelled.success).toBe(true)
    if (!cancelled.success) throw new Error(cancelled.error.message)
    expect(cancelled.data.articlePublishing?.execution.status).toBe('cancelled')
    expect(cancelled.data.attempts.at(-1)?.status).toBe('cancelled')
    await created.service.flush()
  })

  it('revises only a terminal known draft, preserving old facts and requiring management recovery', async () => {
    const created = await createStartedTask(directory, sourcePath, imagePath)
    await prepareUploadCheckpoint(created)
    const snapshot = created.service.getProjectSnapshot(WORKSPACE_ID)
    if (!snapshot.success) throw new Error(snapshot.error.message)
    const old = snapshot.data.affairs[0].articlePublishing!
    const input = {
      reviseDraftFromAffairId: created.affairId,
      workspaceRef: { kind: 'local' as const, path: directory },
      accountId: ACCOUNT_ID,
      fields: { ...old.fields, summary: '公开修订' },
      preview: {
        source: old.source,
        title: old.fields.title,
        summary: '公开修订',
        assets: [],
        blockers: [],
        warnings: [],
      },
    }
    expect(await created.service.createArticlePublishingAffair(input, WORKSPACE_ID)).toMatchObject({
      success: false,
    })
    await created.service.finishAttempt(
      {
        workspaceRef: input.workspaceRef,
        affairId: created.affairId,
        attemptId: created.attemptId,
        outcome: 'cancelled',
        summary: '明确结束旧任务',
      },
      WORKSPACE_ID,
      created.reporter,
    )
    expect(
      await created.service.createArticlePublishingAffair(
        { ...input, fields: { ...input.fields, title: '其他标题' } },
        WORKSPACE_ID,
      ),
    ).toMatchObject({ success: false })
    expect(await created.service.createArticlePublishingAffair(input, randomUUID())).toMatchObject({
      success: false,
    })
    const revision = await created.service.createArticlePublishingAffair(input, WORKSPACE_ID)
    expect(revision.success).toBe(true)
    if (!revision.success) throw new Error(revision.error.message)
    expect(revision.data.articlePublishing?.draft?.platformDraftId).toBe(old.draft?.platformDraftId)
    expect(revision.data.articlePublishing?.checkpoints.every((c) => c.status === 'pending')).toBe(
      true,
    )
    expect(await created.service.createArticlePublishingAffair(input, WORKSPACE_ID)).toMatchObject({
      success: false,
    })
    const started = await created.service.acquireArticlePublishingAttempt(
      revision.data.id,
      WORKSPACE_ID,
    )
    expect(started.success).toBe(true)
    if (!started.success) throw new Error(started.error.message)
    expect(started.data.articlePublishing?.executionProtocol.current?.definitionId).toBe(
      'recovery.restore-exact-draft',
    )
    expect(started.data.articlePublishing?.draft?.recovery).toMatchObject({
      status: 'locating',
      expectedDraftId: old.draft?.platformDraftId,
    })
    const retained = created.service.getProjectSnapshot(WORKSPACE_ID)
    if (!retained.success) throw new Error(retained.error.message)
    expect(
      retained.data.affairs.find((a) => a.id === created.affairId)?.articlePublishing?.execution
        .status,
    ).toBe('cancelled')
    await created.service.flush()
  })

  it('persists exact detail evidence, rejects stale generations and cancellation, and retains completed business results', async () => {
    const created = await createStartedTask(directory, sourcePath, imagePath)
    const input = {
      ...created.reporter,
      results: [
        {
          id: 'body.verify',
          status: 'completed' as const,
          evidence: '原稿正文与服务端一致；saved',
        },
      ],
    }
    const record = (overrides = {}, current = true) =>
      created.service.recordArticlePublishingPlanResults({ ...input, ...overrides }, () => current)
    expect(await record({}, false)).toMatchObject({ success: false })
    expect(await record({ executionGeneration: input.executionGeneration + 1 })).toMatchObject({
      success: false,
    })
    expect(await record()).toMatchObject({ success: true })
    await record({
      results: [
        {
          id: 'body.verify',
          status: 'waiting',
          evidence: '新页面还没有读到 saved',
          reason: '等待当前页面复核',
        },
      ],
    })
    let snapshot = created.service.getProjectSnapshot(WORKSPACE_ID)
    if (!snapshot.success) throw new Error(snapshot.error.message)
    expect(
      snapshot.data.affairs[0].articlePublishing?.checkpoints.find((c) => c.stepId === 'fill-body')
        ?.details,
    ).toContainEqual(
      expect.objectContaining({
        id: 'body.verify',
        status: 'completed',
        evidence: '原稿正文与服务端一致；saved',
        recheck: expect.objectContaining({ status: 'waiting' }),
      }),
    )
    expect(await record()).toMatchObject({ success: true })
    snapshot = created.service.getProjectSnapshot(WORKSPACE_ID)
    if (!snapshot.success) throw new Error(snapshot.error.message)
    expect(
      snapshot.data.affairs[0].articlePublishing?.checkpoints
        .flatMap((c) => c.details ?? [])
        .find((d) => d.id === 'body.verify')?.recheck,
    ).toBeUndefined()
    await created.service.finishAttempt(
      {
        workspaceRef: { kind: 'local', path: directory },
        affairId: created.affairId,
        attemptId: created.attemptId,
        outcome: 'cancelled',
        summary: '测试停止',
      },
      WORKSPACE_ID,
      created.reporter,
    )
    expect(await record()).toMatchObject({ success: false })
    await created.service.flush()
    const reloaded = createService(directory)
    await reloaded.load()
    snapshot = reloaded.getProjectSnapshot(WORKSPACE_ID)
    if (!snapshot.success) throw new Error(snapshot.error.message)
    expect(
      snapshot.data.affairs[0].articlePublishing?.checkpoints.find((c) => c.stepId === 'fill-body')
        ?.details,
    ).toContainEqual(expect.objectContaining({ id: 'body.verify', status: 'completed' }))
    await reloaded.flush()
  })

  it('separates prewritten field dispatch from result verification and keeps unknown writes unresolved', async () => {
    const created = await createStartedTask(directory, sourcePath, imagePath)
    const target = 'autosave:fill-fields:summary:test'
    const taskId = '77777777-7777-4777-8777-777777777777'
    const generation = created.reporter.executionGeneration
    const key = `${created.affairId}:${created.attemptId}:g${generation}:save-draft:${target}`
    const reserved = await created.service.reserveArticlePublishingSideEffect(
      created.affairId,
      created.attemptId,
      generation,
      'save-draft',
      target,
      taskId,
      WORKSPACE_ID,
    )
    if (!reserved.success) throw new Error(reserved.error.message)
    expect(
      reserved.data.articlePublishing?.checkpoints.find((c) => c.stepId === 'fill-fields')?.details,
    ).toContainEqual(expect.objectContaining({ id: 'field.summary.dispatch', status: 'running' }))
    await created.service.consumeArticlePublishingSideEffect(
      created.affairId,
      created.attemptId,
      generation,
      key,
      taskId,
      WORKSPACE_ID,
    )
    const dispatched = await created.service.dispatchArticlePublishingSideEffect(
      created.affairId,
      created.attemptId,
      generation,
      key,
      taskId,
      WORKSPACE_ID,
    )
    if (!dispatched.success) throw new Error(dispatched.error.message)
    const details = dispatched.data.articlePublishing?.checkpoints.find(
      (c) => c.stepId === 'fill-fields',
    )?.details
    expect(details).toContainEqual(
      expect.objectContaining({ id: 'field.summary.dispatch', status: 'running' }),
    )
    expect(details).toContainEqual(
      expect.objectContaining({ id: 'field.summary.verify', status: 'verifying' }),
    )
    const unknown = await created.service.observeArticlePublishingSideEffect(
      created.affairId,
      created.attemptId,
      generation,
      key,
      'result-unknown',
      WORKSPACE_ID,
    )
    if (!unknown.success) throw new Error(unknown.error.message)
    expect(
      unknown.data.articlePublishing?.checkpoints.find((c) => c.stepId === 'fill-fields')?.details,
    ).toContainEqual(expect.objectContaining({ id: 'field.summary.verify', status: 'unknown' }))
    expect(
      await created.service.reserveArticlePublishingSideEffect(
        created.affairId,
        created.attemptId,
        generation,
        'save-draft',
        target,
        taskId,
        WORKSPACE_ID,
      ),
    ).toMatchObject({ success: false })
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

  it('retains a late first-save ID after cancel without advancing progress or accepting another generation', async () => {
    const created = await createStartedTask(directory, sourcePath, imagePath)
    const generation = created.reporter.executionGeneration
    const browserTaskRunId = '77777777-7777-4777-8777-777777777777'
    const snapshot = created.service.getProjectSnapshot(WORKSPACE_ID)
    if (!snapshot.success) throw new Error(snapshot.error.message)
    const attempt = snapshot.data.affairs[0].attempts[0]
    const key = `${created.affairId}:${created.attemptId}:g${generation}:save-draft:initial-draft:save`
    const creation = {
      sideEffectKey: key,
      platformAccountId: 'csdn:test-user',
      normalizedTitle: 'Article',
    }
    const record = (gen = generation) =>
      created.service.recordArticlePublishingDraftAnchor(
        created.affairId,
        created.attemptId,
        gen,
        attempt.launchOperationId,
        'https://mp.csdn.net/mp_blog/creation/editor/164148900',
        WORKSPACE_ID,
        browserTaskRunId,
        creation,
      )
    expect(await record()).toMatchObject({ success: false })
    await created.service.reserveArticlePublishingSideEffect(
      created.affairId,
      created.attemptId,
      generation,
      'save-draft',
      'initial-draft:save',
      browserTaskRunId,
      WORKSPACE_ID,
    )
    await created.service.consumeArticlePublishingSideEffect(
      created.affairId,
      created.attemptId,
      generation,
      key,
      browserTaskRunId,
      WORKSPACE_ID,
    )
    await created.service.dispatchArticlePublishingSideEffect(
      created.affairId,
      created.attemptId,
      generation,
      key,
      browserTaskRunId,
      WORKSPACE_ID,
    )
    const cancelled = await created.service.finishAttempt(
      {
        workspaceRef: { kind: 'local', path: directory },
        affairId: created.affairId,
        attemptId: created.attemptId,
        outcome: 'cancelled',
        summary: '首次保存派发后取消',
      },
      WORKSPACE_ID,
      created.reporter,
    )
    if (!cancelled.success) throw new Error(cancelled.error.message)
    const recorded = await record()
    expect(recorded).toMatchObject({
      success: true,
      data: {
        articlePublishing: {
          execution: { status: 'cancelled' },
          draft: { platformDraftId: '164148900', platformAccountId: 'csdn:test-user' },
          checkpoints: cancelled.data.articlePublishing?.checkpoints,
        },
      },
    })
    expect(await record(generation + 1)).toMatchObject({ success: false })
    expect(
      await created.service.reserveArticlePublishingSideEffect(
        created.affairId,
        created.attemptId,
        generation,
        'save-draft',
        'initial-draft:save',
        browserTaskRunId,
        WORKSPACE_ID,
      ),
    ).toMatchObject({ success: false })
  })

  it('atomically grants only one cross-affair article publishing execution lease', async () => {
    const first = await createDraftTask(directory, sourcePath, imagePath)
    const secondCreated = await first.service.createArticlePublishingAffair(
      {
        preview: {
          source: {
            markdownPath: sourcePath,
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

  it('keeps one draft identity and deletes the task when its persisted schema is legacy', async () => {
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
    const observed = await created.service.recordArticlePublishingPageObservation(
      {
        affairId: created.affairId,
        attemptId: created.attemptId,
        executionGeneration: created.reporter.executionGeneration,
        browserTaskRunId: '77777777-7777-4777-8777-777777777777',
        draftId: '164148817',
        platformAccountId: 'csdn:test-user',
        normalizedTitle: 'Article',
        url: draftUrl,
        saveState: 'saved',
      },
      WORKSPACE_ID,
    )
    expect(observed.success).toBe(true)
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
    expect(after.data.affairs).toEqual([])
    const rewritten = JSON.parse(await readFile(persistedPath, 'utf8'))
    expect(rewritten.schemaVersion).toBe(9)
    expect(rewritten.affairs).toEqual([])
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
      uploadAttempts: [{ number: 1, status: 'succeeded' }],
    })
  })

  it('persists the observed file-to-image URL without declaring upload success and rejects stale observations', async () => {
    const created = await createStartedTask(directory, sourcePath, imagePath)
    await prepareUploadCheckpoint(created)
    await created.service.reportArticlePublishingAsset(
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
    await dispatchUploadEffect(created, 1)
    const state = created.service.getProjectSnapshot(WORKSPACE_ID)
    if (!state.success) throw new Error('snapshot')
    const publishing = state.data.affairs[0].articlePublishing!
    const effect = publishing.sideEffects.find((e) => e.kind === 'upload-asset')!
    const input = {
      workspaceId: WORKSPACE_ID,
      affairId: created.affairId,
      attemptId: created.attemptId,
      executionGeneration: publishing.execution.currentGeneration,
      launchOperationId: publishing.execution.currentLaunchOperationId!,
      sideEffectKey: effect.key,
      assetId: created.assetId,
      platformUrl: 'https://i-blog.csdnimg.cn/direct/observed.png',
    }
    expect(
      await created.service.recordArticlePublishingImageObservation(input, () => false),
    ).toMatchObject({ success: false })
    expect(
      await created.service.recordArticlePublishingImageObservation(
        { ...input, assetId: 'other-file' },
        () => true,
      ),
    ).toMatchObject({ success: false })
    const result = await created.service.recordArticlePublishingImageObservation(input, () => true)
    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error.message)
    expect(result.data.articlePublishing?.assets[0]).toMatchObject({
      platformUrl: input.platformUrl,
      status: 'uploading',
    })
    await created.service.interruptArticlePublishingLaunch(
      created.affairId,
      created.attemptId,
      'stop',
      WORKSPACE_ID,
    )
    expect(
      await created.service.recordArticlePublishingImageObservation(input, () => true),
    ).toMatchObject({ success: false })
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

  it.each(['present', 'missing', 'not-loaded'] as const)(
    'reconciles an interrupted observed upload only on the saved original draft: %s',
    async (mode) => {
      const created = await createStartedTask(directory, sourcePath, imagePath)
      const draftUrl = 'https://mp.csdn.net/mp_blog/creation/editor/164148817'
      await created.service.recordArticlePublishingDraftAnchor(
        created.affairId,
        created.attemptId,
        created.reporter.executionGeneration,
        created.reporter.launchOperationId,
        draftUrl,
        WORKSPACE_ID,
        '77777777-7777-4777-8777-777777777777',
      )
      await created.service.recordArticlePublishingPageObservation(
        {
          affairId: created.affairId,
          attemptId: created.attemptId,
          executionGeneration: created.reporter.executionGeneration,
          browserTaskRunId: '77777777-7777-4777-8777-777777777777',
          draftId: '164148817',
          platformAccountId: 'csdn:test-user',
          normalizedTitle: 'Article',
          url: draftUrl,
          saveState: 'saved',
        },
        WORKSPACE_ID,
      )
      await prepareUploadCheckpoint(created)
      await dispatchUploadEffect(created, 1)
      await created.service.reportArticlePublishingAsset(
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
      const snapshot = created.service.getProjectSnapshot(WORKSPACE_ID)
      if (!snapshot.success) throw new Error('snapshot')
      const effect = snapshot.data.affairs[0].articlePublishing!.sideEffects.find(
        (e) => e.kind === 'upload-asset',
      )!
      const platformUrl = 'https://i-blog.csdnimg.cn/direct/observed.png'
      const observed = await created.service.recordArticlePublishingImageObservation(
        { ...created.reporter, sideEffectKey: effect.key, assetId: created.assetId, platformUrl },
        () => true,
      )
      if (!observed.success) throw new Error(observed.error.message)
      await created.service.interruptArticlePublishingLaunch(
        created.affairId,
        created.attemptId,
        'test interruption',
        WORKSPACE_ID,
      )
      const resumed = await created.service.acquireArticlePublishingAttempt(
        created.affairId,
        WORKSPACE_ID,
      )
      if (!resumed.success) throw new Error(resumed.error.message)
      const attempt = resumed.data.attempts[0]
      const recovery = resumed.data.articlePublishing!.draft!.recovery!
      const identity = {
        tabId: 'recovered-tab',
        browserTaskRunId: '88888888-8888-4888-8888-888888888888',
        browserViewRuntimeGeneration: 2,
        webContentsId: 20,
        playwrightConnectionGeneration: 2,
        playwrightPageBindingGeneration: 2,
      }
      const verification = {
        recoveryOperationId: recovery.operationId,
        draftId: '164148817',
        url: draftUrl,
        platformAccountId: 'csdn:test-user',
        normalizedTitle: 'Article',
        saveState: 'saved' as const,
      }
      const verified = await created.service.verifyArticlePublishingRecovery(
        {
          ...identity,
          ...verification,
          affairId: created.affairId,
          attemptId: attempt.id,
          executionGeneration: attempt.executionGeneration,
          launchOperationId: attempt.launchOperationId,
        },
        WORKSPACE_ID,
        { issueWritePermit: false },
      )
      if (!verified.success) throw new Error(verified.error.message)
      const bound = await created.service.bindArticlePublishingRuntime(
        created.affairId,
        attempt.id,
        attempt.executionGeneration,
        attempt.launchOperationId,
        runtimeBindingsFor(attempt, identity),
        WORKSPACE_ID,
        {
          ...verification,
          imageEnumerationComplete: true,
          images: [
            {
              src: mode === 'missing' ? 'https://i-blog.csdnimg.cn/other.png' : platformUrl,
              loaded: mode !== 'not-loaded',
            },
          ],
        },
      )
      expect(bound.success).toBe(mode === 'present')
      if (bound.success) {
        expect(bound.data.articlePublishing?.assets[0]).toMatchObject({
          status: 'uploaded',
          platformUrl,
          uploadAttempts: [{ number: 1, status: 'succeeded' }],
        })
        expect(
          bound.data.articlePublishing?.sideEffects.filter((e) => e.kind === 'upload-asset'),
        ).toEqual([expect.objectContaining({ key: effect.key, status: 'verified' })])
      }
    },
  )

  it('blocks an unknown upload until the user visually confirms whether the image exists', async () => {
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
    const resolved = await created.service.resolveArticlePublishingAsset(
      created.affairId,
      created.assetId,
      'present',
      WORKSPACE_ID,
    )
    expect(resolved).toMatchObject({
      success: true,
      data: {
        articlePublishing: {
          execution: { status: 'interrupted' },
          assets: [{ status: 'uploaded', manualResolution: { status: 'present' } }],
        },
      },
    })
  })

  it.each([
    'verified',
    'wrong-draft',
    'wrong-account',
    'wrong-title',
    'unknown-save',
    'stale-page',
    'pending-save',
  ] as const)(
    'completes save reconciliation without a redundant click only with safe autosave evidence: %s',
    async (scenario) => {
      const created = await createStartedTask(directory, sourcePath, imagePath)
      await prepareUploadCheckpoint(created)
      await dispatchUploadEffect(created, 1)
      for (const status of ['uploading', 'waiting-platform', 'verifying', 'uploaded'] as const) {
        const result = await created.service.reportArticlePublishingAsset(
          {
            workspaceRef: { kind: 'local', path: directory },
            affairId: created.affairId,
            attemptId: created.attemptId,
            assetId: created.assetId,
            status,
            evidence: 'image verified in current editor',
            ...(status === 'uploaded'
              ? { platformUrl: 'https://img-blog.csdnimg.cn/test.png' }
              : {}),
          },
          WORKSPACE_ID,
          trustedReporter(
            created.reporter,
            status === 'uploading'
              ? 'asset-absent'
              : status === 'uploaded'
                ? 'asset-uploaded'
                : undefined,
          ),
        )
        if (!result.success) throw new Error(result.error.message)
      }
      await advanceToSaveCheckpoint(created)
      if (scenario === 'pending-save') {
        const result = await created.service.reserveArticlePublishingSideEffect(
          created.affairId,
          created.attemptId,
          created.reporter.executionGeneration,
          'save-draft',
          'manual-save:pending',
          '77777777-7777-4777-8777-777777777777',
          WORKSPACE_ID,
        )
        if (!result.success) throw new Error(result.error.message)
      }
      await reportPublishingCheckpoint(created, 'save-draft', 'verifying')
      const reporter = trustedReporter(created.reporter, 'checkpoint')
      if (scenario === 'wrong-draft') reporter.trustedPageEvidence!.draftId = '999999999'
      if (scenario === 'wrong-account')
        reporter.trustedPageEvidence!.platformAccountId = 'csdn:other'
      if (scenario === 'wrong-title') reporter.trustedPageEvidence!.normalizedTitle = 'Other'
      if (scenario === 'unknown-save') reporter.trustedPageEvidence!.saveState = 'unknown'
      if (scenario === 'stale-page') reporter.trustedPageEvidence!.isCurrent = () => false
      const result = await created.service.reportArticlePublishingCheckpoint(
        {
          workspaceRef: { kind: 'local', path: directory },
          affairId: created.affairId,
          attemptId: created.attemptId,
          stepId: 'save-draft',
          status: 'completed',
          evidence: 'current original draft verified saved',
        },
        WORKSPACE_ID,
        reporter,
      )
      expect(result.success).toBe(scenario === 'verified')
      if (result.success) {
        expect(result.data.articlePublishing?.execution.currentStepId).toBe('publish')
        expect(result.data.articlePublishing?.publication.status).toBe('not-started')
        expect(
          result.data.articlePublishing?.sideEffects.some((effect) =>
            effect.targetId.startsWith('manual-save:'),
          ),
        ).toBe(false)
      }
    },
  )

  it.each([
    'matched',
    'mismatch',
    'stale',
    'wrong-draft',
    'wrong-account',
    'unknown-save',
  ] as const)(
    'finishes recovered body without replay only after complete fresh comparison: %s',
    async (mode) => {
      const created = await createStartedTask(directory, sourcePath, imagePath)
      await prepareUploadCheckpoint(created)
      await dispatchUploadEffect(created, 1)
      for (const status of ['uploading', 'waiting-platform', 'verifying', 'uploaded'] as const) {
        const result = await created.service.reportArticlePublishingAsset(
          {
            workspaceRef: { kind: 'local', path: directory },
            affairId: created.affairId,
            attemptId: created.attemptId,
            assetId: created.assetId,
            status,
            evidence: 'observed image',
            ...(status === 'uploaded'
              ? { platformUrl: 'https://img-blog.csdnimg.cn/test.png' }
              : {}),
          },
          WORKSPACE_ID,
          trustedReporter(
            created.reporter,
            status === 'uploading'
              ? 'asset-absent'
              : status === 'uploaded'
                ? 'asset-uploaded'
                : undefined,
          ),
        )
        if (!result.success) throw new Error(result.error.message)
      }
      await reportPublishingCheckpoint(created, 'upload-assets', 'verifying')
      await reportPublishingCheckpoint(created, 'upload-assets', 'completed')
      await reportPublishingCheckpoint(created, 'fill-body', 'running')
      await dispatchSaveEffect(created, 'fill-body')
      await created.service.interruptArticlePublishingLaunch(
        created.affairId,
        created.attemptId,
        'restart',
        WORKSPACE_ID,
      )
      const resumed = await created.service.acquireArticlePublishingAttempt(
        created.affairId,
        WORKSPACE_ID,
      )
      if (!resumed.success) throw new Error(resumed.error.message)
      const attempt = resumed.data.attempts[0]
      const recovery = resumed.data.articlePublishing!.draft!.recovery!
      const identity = {
        tabId: 'recovered-tab',
        browserTaskRunId: '88888888-8888-4888-8888-888888888888',
        browserViewRuntimeGeneration: 2,
        webContentsId: 20,
        playwrightConnectionGeneration: 2,
        playwrightPageBindingGeneration: 2,
      }
      const verification = {
        recoveryOperationId: recovery.operationId,
        draftId: '164148817',
        url: 'https://mp.csdn.net/mp_blog/creation/editor/164148817',
        platformAccountId: 'csdn:test-user',
        normalizedTitle: 'Article',
        saveState: 'saved' as const,
      }
      const verified = await created.service.verifyArticlePublishingRecovery(
        {
          ...identity,
          ...verification,
          affairId: created.affairId,
          attemptId: attempt.id,
          executionGeneration: attempt.executionGeneration,
          launchOperationId: attempt.launchOperationId,
        },
        WORKSPACE_ID,
        { issueWritePermit: false },
      )
      if (!verified.success) throw new Error(verified.error.message)
      const bound = await created.service.bindArticlePublishingRuntime(
        created.affairId,
        attempt.id,
        attempt.executionGeneration,
        attempt.launchOperationId,
        runtimeBindingsFor(attempt, identity),
        WORKSPACE_ID,
        verification,
      )
      if (!bound.success) throw new Error(bound.error.message)
      const operation = bound.data.articlePublishing!.executionProtocol.current!
      const inspectIdentity = {
        workspaceId: WORKSPACE_ID,
        affairId: created.affairId,
        attemptId: attempt.id,
        executionGeneration: attempt.executionGeneration,
        launchOperationId: attempt.launchOperationId,
        runtime: { ...identity, agentRunId: `run-g${attempt.executionGeneration}` },
        expectedOperationRunId: operation.operationRunId,
        expectedOperationRevision: operation.revision,
      }
      const started = await created.service.startArticlePublishingFirstInspect(inspectIdentity)
      if (!started.success) throw new Error(started.error.message)
      const completed = await created.service.completeArticlePublishingFirstInspect({
        ...inspectIdentity,
        expectedOperationRevision:
          started.data.articlePublishing!.executionProtocol.current!.revision,
        pageKind: 'editor',
        ...verification,
      })
      if (!completed.success) throw new Error(completed.error.message)
      const reporter = trustedReporter(
        {
          ...created.reporter,
          executionGeneration: attempt.executionGeneration,
          launchOperationId: attempt.launchOperationId,
          conversationId: `conversation-g${attempt.executionGeneration}`,
          agentRunId: `run-g${attempt.executionGeneration}`,
        },
        'checkpoint',
      )
      reporter.trustedPageEvidence!.bodyMatchesFrozen = mode !== 'mismatch'
      reporter.trustedPageEvidence!.isCurrent = () => mode !== 'stale'
      if (mode === 'wrong-draft') reporter.trustedPageEvidence!.draftId = '999999999'
      if (mode === 'wrong-account') reporter.trustedPageEvidence!.platformAccountId = 'csdn:other'
      if (mode === 'unknown-save') reporter.trustedPageEvidence!.saveState = 'unknown'
      const input = {
        workspaceRef: { kind: 'local' as const, path: directory },
        affairId: created.affairId,
        attemptId: attempt.id,
        stepId: 'fill-body',
        evidence: 'current complete frozen body comparison',
      }
      await created.service.reportArticlePublishingCheckpoint(
        { ...input, status: 'verifying' },
        WORKSPACE_ID,
        reporter,
      )
      const result = await created.service.reportArticlePublishingCheckpoint(
        { ...input, status: 'completed' },
        WORKSPACE_ID,
        reporter,
      )
      expect(result.success, JSON.stringify(result.success ? {} : result.error)).toBe(
        mode === 'matched',
      )
      if (result.success) {
        expect(result.data.articlePublishing!.execution.currentStepId).toBe('fill-fields')
        const writes = result.data.articlePublishing!.sideEffects.filter((e) =>
          e.targetId.startsWith('autosave:fill-body:'),
        )
        expect(writes).toHaveLength(1)
        expect(writes[0].status).toBe('verified')
        expect(writes[0].executionGeneration).toBe(1)
        expect(
          result.data
            .articlePublishing!.checkpoints.find((c) => c.stepId === 'fill-body')!
            .details?.find((d) => d.id === 'body.verify')?.status,
        ).toBe('completed')
      }
    },
  )

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
        evidence: 'image visible in editor',
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

    const attempt = handedOff.data.attempts[0]
    const binding = attempt.runtimeBindings.find((b) => b.kind === 'browser-task')!
    expect(binding.status).toBe('terminal')
    const ended = await created.service.reconcileArticlePublishingRuntime({
      eventId: 'after-handoff',
      workspaceId: WORKSPACE_ID,
      affairId: created.affairId,
      attemptId: attempt.id,
      executionGeneration: attempt.executionGeneration,
      launchOperationId: attempt.launchOperationId,
      source: 'browser-terminal',
      observedAt: new Date().toISOString(),
      runtimeIdentity: binding as never,
      reasonCode: 'RUN_ENDED',
      reason: 'Agent ended after handoff',
    })
    expect(ended.success && ended.data.articlePublishing?.execution.status).toBe('waiting-human')

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
    const observed = await created.service.recordArticlePublishingPageObservation(
      {
        affairId: created.affairId,
        attemptId: created.attemptId,
        executionGeneration: created.reporter.executionGeneration,
        browserTaskRunId: '77777777-7777-4777-8777-777777777777',
        draftId: '164148817',
        platformAccountId: 'csdn:test-user',
        normalizedTitle: 'Article',
        url: draftUrl,
        saveState: 'saved',
      },
      WORKSPACE_ID,
    )
    expect(observed.success).toBe(true)
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
        platformAccountId: 'csdn:test-user',
        normalizedTitle: 'Article',
        saveState: 'saved',
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
    const rebound = await created.service.rebindArticlePublishingBrowserRuntime({
      workspaceId: WORKSPACE_ID,
      affairId: created.affairId,
      attemptId: attempt.id,
      executionGeneration: attempt.executionGeneration,
      launchOperationId: attempt.launchOperationId,
      browserTaskRunId: '88888888-8888-4888-8888-888888888888',
      tabId: 'recovered-tab',
      previousBrowserViewRuntimeGeneration: 2,
      previousWebContentsId: 20,
      browserViewRuntimeGeneration: 3,
      webContentsId: 21,
      previousPlaywrightConnectionGeneration: 3,
      previousPlaywrightPageBindingGeneration: 4,
      playwrightConnectionGeneration: 4,
      playwrightPageBindingGeneration: 5,
      recoveryVerification: {
        recoveryOperationId: recovery.operationId,
        draftId: '164148817',
        url: draftUrl,
        platformAccountId: 'csdn:test-user',
        normalizedTitle: 'Article',
        saveState: 'saved',
      },
    })
    expect(rebound).toMatchObject({
      success: true,
      data: {
        articlePublishing: {
          draft: {
            recovery: {
              status: 'verified',
              writePermit: { playwrightPageBindingGeneration: 5 },
            },
          },
        },
      },
    })
    if (!rebound.success) return
    expect(
      rebound.data.attempts[0].runtimeBindings.filter((binding) => binding.status === 'active'),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'browser-tab',
          browserViewRuntimeGeneration: 3,
          webContentsId: 21,
        }),
        expect.objectContaining({
          kind: 'browser-task',
          browserViewRuntimeGeneration: 3,
          webContentsId: 21,
          playwrightConnectionGeneration: 4,
          playwrightPageBindingGeneration: 5,
        }),
      ]),
    )
    const permit = rebound.data.articlePublishing?.draft?.recovery?.writePermit
    if (!permit) throw new Error('恢复许可未持久化')
    const refreshed = await created.service.recordArticlePublishingPageObservation(
      {
        affairId: created.affairId,
        attemptId: attempt.id,
        executionGeneration: attempt.executionGeneration,
        browserTaskRunId: '88888888-8888-4888-8888-888888888888',
        permitId: permit.id,
        draftId: '164148817',
        platformAccountId: 'csdn:test-user',
        normalizedTitle: 'Article',
        url: draftUrl,
        saveState: 'saved',
      },
      WORKSPACE_ID,
    )
    expect(refreshed).toMatchObject({
      success: true,
      data: {
        articlePublishing: {
          draft: {
            recovery: { writePermit: { id: permit.id } },
          },
        },
      },
    })
    const stalePermit = await created.service.recordArticlePublishingPageObservation(
      {
        affairId: created.affairId,
        attemptId: attempt.id,
        executionGeneration: attempt.executionGeneration,
        browserTaskRunId: '88888888-8888-4888-8888-888888888888',
        permitId: 'stale-permit',
        draftId: '164148817',
        platformAccountId: 'csdn:test-user',
        normalizedTitle: 'Article',
        url: draftUrl,
        saveState: 'saved',
      },
      WORKSPACE_ID,
    )
    expect(stalePermit).toMatchObject({ success: false })
  })

  it('atomically exposes recovery operations and lets exact Page inspection own the first checkpoints', async () => {
    const created = await createStartedTask(directory, sourcePath, imagePath)
    const draftUrl = 'https://mp.csdn.net/mp_blog/creation/editor/164148817'
    const before = created.service.getProjectSnapshot(WORKSPACE_ID)
    if (!before.success) throw new Error(before.error.message)
    const firstAttempt = before.data.affairs[0].attempts[0]
    const anchored = await created.service.recordArticlePublishingDraftAnchor(
      created.affairId,
      created.attemptId,
      firstAttempt.executionGeneration,
      firstAttempt.launchOperationId,
      draftUrl,
      WORKSPACE_ID,
      '77777777-7777-4777-8777-777777777777',
    )
    expect(anchored.success).toBe(true)
    const observed = await created.service.recordArticlePublishingPageObservation(
      {
        affairId: created.affairId,
        attemptId: created.attemptId,
        executionGeneration: firstAttempt.executionGeneration,
        browserTaskRunId: '77777777-7777-4777-8777-777777777777',
        draftId: '164148817',
        platformAccountId: 'csdn:test-user',
        normalizedTitle: 'Article',
        url: draftUrl,
        saveState: 'saved',
      },
      WORKSPACE_ID,
    )
    expect(observed.success).toBe(true)
    const handedOff = await created.service.handoffAttempt(
      {
        workspaceRef: { kind: 'local', path: directory },
        affairId: created.affairId,
        attemptId: created.attemptId,
        reason: '模拟 Studio 重启前的人工交接',
      },
      WORKSPACE_ID,
    )
    expect(handedOff.success).toBe(true)
    const resumed = await created.service.resumeArticlePublishingAfterHandoff(
      created.affairId,
      created.attemptId,
      WORKSPACE_ID,
    )
    if (!resumed.success) throw new Error(resumed.error.message)
    const attempt = resumed.data.attempts[0]
    const recovery = resumed.data.articlePublishing?.draft?.recovery
    if (!recovery) throw new Error('恢复状态不存在')
    expect(resumed.data.articlePublishing?.executionProtocol.current).toMatchObject({
      definitionId: 'recovery.restore-exact-draft',
      checkpointId: 'open-editor',
      owner: 'studio',
    })

    const observedRecovery = await created.service.verifyArticlePublishingRecovery(
      {
        affairId: created.affairId,
        attemptId: attempt.id,
        executionGeneration: attempt.executionGeneration,
        launchOperationId: attempt.launchOperationId,
        recoveryOperationId: recovery.operationId,
        draftId: '164148817',
        url: draftUrl,
        platformAccountId: 'csdn:test-user',
        normalizedTitle: 'Article',
        saveState: 'saved',
        tabId: 'recovered-tab',
        browserViewRuntimeGeneration: 31,
        webContentsId: 310,
        playwrightConnectionGeneration: 31,
        playwrightPageBindingGeneration: 31,
      },
      WORKSPACE_ID,
      { issueWritePermit: false },
    )
    if (!observedRecovery.success) throw new Error(observedRecovery.error.message)
    expect(observedRecovery.data.articlePublishing?.draft?.recovery?.writePermit).toBeUndefined()
    expect(observedRecovery.data.articlePublishing?.executionProtocol.current).toMatchObject({
      definitionId: 'runtime.prepare-first-inspect',
      status: 'running',
    })

    const identity = {
      tabId: 'recovered-tab',
      browserTaskRunId: '88888888-8888-4888-8888-888888888888',
      browserViewRuntimeGeneration: 32,
      webContentsId: 320,
      playwrightConnectionGeneration: 32,
      playwrightPageBindingGeneration: 32,
    }
    const bindings = runtimeBindingsFor(attempt, identity)
    const bound = await created.service.bindArticlePublishingRuntime(
      created.affairId,
      attempt.id,
      attempt.executionGeneration,
      attempt.launchOperationId,
      bindings,
      WORKSPACE_ID,
      {
        recoveryOperationId: recovery.operationId,
        draftId: '164148817',
        url: draftUrl,
        platformAccountId: 'csdn:test-user',
        normalizedTitle: 'Article',
        saveState: 'saved',
      },
    )
    if (!bound.success) throw new Error(bound.error.message)
    expect(bound.data.articlePublishing?.draft?.recovery?.writePermit).toMatchObject({
      browserViewRuntimeGeneration: 32,
      playwrightPageBindingGeneration: 32,
    })
    expect(bound.data.articlePublishing?.executionProtocol.current).toMatchObject({
      definitionId: 'page.first-inspect',
      checkpointId: 'open-editor',
      status: 'ready',
      runtime: { browserTaskRunId: identity.browserTaskRunId },
    })

    const reboundIdentity = {
      ...identity,
      browserViewRuntimeGeneration: 33,
      webContentsId: 330,
      playwrightConnectionGeneration: 33,
      playwrightPageBindingGeneration: 33,
    }
    const rebound = await created.service.rebindArticlePublishingBrowserRuntime({
      workspaceId: WORKSPACE_ID,
      affairId: created.affairId,
      attemptId: attempt.id,
      executionGeneration: attempt.executionGeneration,
      launchOperationId: attempt.launchOperationId,
      browserTaskRunId: identity.browserTaskRunId,
      tabId: identity.tabId,
      previousBrowserViewRuntimeGeneration: identity.browserViewRuntimeGeneration,
      previousWebContentsId: identity.webContentsId,
      browserViewRuntimeGeneration: reboundIdentity.browserViewRuntimeGeneration,
      webContentsId: reboundIdentity.webContentsId,
      previousPlaywrightConnectionGeneration: identity.playwrightConnectionGeneration,
      previousPlaywrightPageBindingGeneration: identity.playwrightPageBindingGeneration,
      playwrightConnectionGeneration: reboundIdentity.playwrightConnectionGeneration,
      playwrightPageBindingGeneration: reboundIdentity.playwrightPageBindingGeneration,
      recoveryVerification: {
        recoveryOperationId: recovery.operationId,
        draftId: '164148817',
        url: draftUrl,
        platformAccountId: 'csdn:test-user',
        normalizedTitle: 'Article',
        saveState: 'saved',
      },
    })
    if (!rebound.success) throw new Error(rebound.error.message)
    expect(rebound.data.articlePublishing?.executionProtocol.current).toMatchObject({
      definitionId: 'page.first-inspect',
      status: 'ready',
      runtime: {
        webContentsId: 330,
        playwrightPageBindingGeneration: 33,
      },
    })

    const runtime = {
      ...reboundIdentity,
      agentRunId: `run-g${attempt.executionGeneration}`,
    }
    const openEditorOperation = rebound.data.articlePublishing?.executionProtocol.current
    if (!openEditorOperation) throw new Error('missing open-editor operation')
    const startOpenEditor = await created.service.startArticlePublishingFirstInspect({
      workspaceId: WORKSPACE_ID,
      affairId: created.affairId,
      attemptId: attempt.id,
      executionGeneration: attempt.executionGeneration,
      launchOperationId: attempt.launchOperationId,
      expectedOperationRunId: openEditorOperation.operationRunId,
      expectedOperationRevision: openEditorOperation.revision,
      runtime,
    })
    expect(startOpenEditor.success).toBe(true)
    const runningOpenEditor = startOpenEditor.success
      ? startOpenEditor.data.articlePublishing?.executionProtocol.current
      : undefined
    if (!runningOpenEditor) throw new Error('missing running open-editor operation')
    const completeOpenEditor = await created.service.completeArticlePublishingFirstInspect({
      workspaceId: WORKSPACE_ID,
      affairId: created.affairId,
      attemptId: attempt.id,
      executionGeneration: attempt.executionGeneration,
      launchOperationId: attempt.launchOperationId,
      expectedOperationRunId: runningOpenEditor.operationRunId,
      expectedOperationRevision: runningOpenEditor.revision,
      runtime,
      pageKind: 'editor',
      platformAccountId: 'csdn:test-user',
      draftId: '164148817',
      normalizedTitle: 'Article',
      saveState: 'saved',
    })
    if (!completeOpenEditor.success) throw new Error(completeOpenEditor.error.message)
    expect(completeOpenEditor.data.articlePublishing?.checkpoints[0]).toMatchObject({
      stepId: 'open-editor',
      status: 'completed',
    })
    expect(completeOpenEditor.data.articlePublishing?.executionProtocol.current).toMatchObject({
      definitionId: 'page.first-inspect',
      checkpointId: 'verify-account',
      status: 'ready',
    })

    const verifyAccountOperation =
      completeOpenEditor.data.articlePublishing?.executionProtocol.current
    if (!verifyAccountOperation) throw new Error('missing verify-account operation')
    const startedAccount = await created.service.startArticlePublishingFirstInspect({
      workspaceId: WORKSPACE_ID,
      affairId: created.affairId,
      attemptId: attempt.id,
      executionGeneration: attempt.executionGeneration,
      launchOperationId: attempt.launchOperationId,
      expectedOperationRunId: verifyAccountOperation.operationRunId,
      expectedOperationRevision: verifyAccountOperation.revision,
      runtime,
    })
    if (!startedAccount.success) throw new Error(startedAccount.error.message)
    const runningAccount = startedAccount.data.articlePublishing?.executionProtocol.current
    if (!runningAccount) throw new Error('missing running verify-account operation')
    const completeAccount = await created.service.completeArticlePublishingFirstInspect({
      workspaceId: WORKSPACE_ID,
      affairId: created.affairId,
      attemptId: attempt.id,
      executionGeneration: attempt.executionGeneration,
      launchOperationId: attempt.launchOperationId,
      expectedOperationRunId: runningAccount.operationRunId,
      expectedOperationRevision: runningAccount.revision,
      runtime,
      pageKind: 'editor',
      platformAccountId: 'csdn:test-user',
      draftId: '164148817',
      normalizedTitle: 'Article',
      saveState: 'saved',
    })
    if (!completeAccount.success) throw new Error(completeAccount.error.message)
    expect(completeAccount.data.articlePublishing?.checkpoints[1]).toMatchObject({
      stepId: 'verify-account',
      status: 'completed',
    })
    expect(completeAccount.data.articlePublishing?.execution.currentStepId).toBe('upload-assets')
    expect(completeAccount.data.articlePublishing?.executionProtocol.current).toBeUndefined()
    expect(
      completeAccount.data.articlePublishing?.executionProtocol.recentTransitions.map(
        (transition) => transition.kind,
      ),
    ).toEqual(
      expect.arrayContaining([
        'recovery-started',
        'draft-restored',
        'draft-reverified',
        'lease-transferred',
        'binding-committed',
        'runtime-ready',
        'first-inspect-started',
        'first-inspect-completed',
      ]),
    )
  })

  it('keeps an internal Runtime operation failure out of the human-handoff state', async () => {
    const created = await createStartedTask(directory, sourcePath, imagePath)
    const before = created.service.getProjectSnapshot(WORKSPACE_ID)
    if (!before.success) throw new Error(before.error.message)
    const firstAttempt = before.data.affairs[0].attempts[0]
    const draftUrl = 'https://mp.csdn.net/mp_blog/creation/editor/164148817'
    await created.service.recordArticlePublishingDraftAnchor(
      created.affairId,
      created.attemptId,
      firstAttempt.executionGeneration,
      firstAttempt.launchOperationId,
      draftUrl,
      WORKSPACE_ID,
      '77777777-7777-4777-8777-777777777777',
    )
    await created.service.recordArticlePublishingPageObservation(
      {
        affairId: created.affairId,
        attemptId: created.attemptId,
        executionGeneration: firstAttempt.executionGeneration,
        browserTaskRunId: '77777777-7777-4777-8777-777777777777',
        draftId: '164148817',
        platformAccountId: 'csdn:test-user',
        normalizedTitle: 'Article',
        url: draftUrl,
        saveState: 'saved',
      },
      WORKSPACE_ID,
    )
    await created.service.handoffAttempt(
      {
        workspaceRef: { kind: 'local', path: directory },
        affairId: created.affairId,
        attemptId: created.attemptId,
        reason: '模拟 Studio 重启前的人工交接',
      },
      WORKSPACE_ID,
    )
    const resumed = await created.service.resumeArticlePublishingAfterHandoff(
      created.affairId,
      created.attemptId,
      WORKSPACE_ID,
    )
    if (!resumed.success) throw new Error(resumed.error.message)
    const attempt = resumed.data.attempts[0]
    const currentOperation = resumed.data.articlePublishing?.executionProtocol.current
    if (!currentOperation) throw new Error('missing current operation')

    const failed = await created.service.failArticlePublishingCurrentOperation({
      workspaceId: WORKSPACE_ID,
      affairId: created.affairId,
      attemptId: attempt.id,
      executionGeneration: attempt.executionGeneration,
      launchOperationId: attempt.launchOperationId,
      expectedOperationRunId: currentOperation.operationRunId,
      expectedOperationRevision: currentOperation.revision,
      failure: {
        category: 'studio-runtime',
        code: 'studio_runtime.page_rebind_failed',
        message: 'Page Runtime 重绑定失败',
      },
    })
    if (!failed.success) throw new Error(failed.error.message)
    expect(failed.data.articlePublishing?.execution.status).toBe('interrupted')
    expect(failed.data.attempts[0]).toMatchObject({
      status: 'interrupted',
      failureMessage: 'Page Runtime 重绑定失败',
    })
    expect(failed.data.articlePublishing?.executionProtocol.current).toMatchObject({
      status: 'failed',
      failure: { category: 'studio-runtime', code: 'studio_runtime.page_rebind_failed' },
    })
    expect(failed.data.articlePublishing?.draft?.recovery).toMatchObject({
      status: 'locating',
      failureReason: 'Page Runtime 重绑定失败',
    })
    expect(failed.data.articlePublishing?.draft?.recovery?.writePermit).toBeUndefined()
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

  it('revokes the current operation and rejects a late inspect completion after cancellation', async () => {
    const created = await createStartedTask(directory, sourcePath, imagePath)
    const draftUrl = 'https://mp.csdn.net/mp_blog/creation/editor/164148817'
    await created.service.recordArticlePublishingDraftAnchor(
      created.affairId,
      created.attemptId,
      created.reporter.executionGeneration,
      created.reporter.launchOperationId,
      draftUrl,
      WORKSPACE_ID,
      '77777777-7777-4777-8777-777777777777',
    )
    await created.service.recordArticlePublishingPageObservation(
      {
        affairId: created.affairId,
        attemptId: created.attemptId,
        executionGeneration: created.reporter.executionGeneration,
        browserTaskRunId: '77777777-7777-4777-8777-777777777777',
        draftId: '164148817',
        platformAccountId: 'csdn:test-user',
        normalizedTitle: 'Article',
        url: draftUrl,
        saveState: 'saved',
      },
      WORKSPACE_ID,
    )
    await created.service.handoffAttempt(
      {
        workspaceRef: { kind: 'local', path: directory },
        affairId: created.affairId,
        attemptId: created.attemptId,
        reason: '模拟重启前交接',
      },
      WORKSPACE_ID,
    )
    const resumed = await created.service.resumeArticlePublishingAfterHandoff(
      created.affairId,
      created.attemptId,
      WORKSPACE_ID,
    )
    if (!resumed.success) throw new Error(resumed.error.message)
    const attempt = resumed.data.attempts[0]
    const recovery = resumed.data.articlePublishing?.draft?.recovery
    if (!recovery) throw new Error('missing recovery')
    await created.service.verifyArticlePublishingRecovery(
      {
        affairId: created.affairId,
        attemptId: attempt.id,
        executionGeneration: attempt.executionGeneration,
        launchOperationId: attempt.launchOperationId,
        recoveryOperationId: recovery.operationId,
        draftId: '164148817',
        url: draftUrl,
        platformAccountId: 'csdn:test-user',
        normalizedTitle: 'Article',
        saveState: 'saved',
        tabId: 'recovered-tab',
        browserViewRuntimeGeneration: 2,
        webContentsId: 20,
        playwrightConnectionGeneration: 2,
        playwrightPageBindingGeneration: 2,
      },
      WORKSPACE_ID,
      { issueWritePermit: false },
    )
    const identity = {
      tabId: 'recovered-tab',
      browserTaskRunId: '88888888-8888-4888-8888-888888888888',
      browserViewRuntimeGeneration: 3,
      webContentsId: 30,
      playwrightConnectionGeneration: 3,
      playwrightPageBindingGeneration: 3,
    }
    const bound = await created.service.bindArticlePublishingRuntime(
      created.affairId,
      attempt.id,
      attempt.executionGeneration,
      attempt.launchOperationId,
      runtimeBindingsFor(attempt, identity),
      WORKSPACE_ID,
      {
        recoveryOperationId: recovery.operationId,
        draftId: '164148817',
        url: draftUrl,
        platformAccountId: 'csdn:test-user',
        normalizedTitle: 'Article',
        saveState: 'saved',
      },
    )
    if (!bound.success) throw new Error(bound.error.message)
    const operation = bound.data.articlePublishing?.executionProtocol.current
    const runtime = operation?.runtime
    if (!operation || !runtime) throw new Error('missing current inspect operation')
    const started = await created.service.startArticlePublishingFirstInspect({
      workspaceId: WORKSPACE_ID,
      affairId: created.affairId,
      attemptId: attempt.id,
      executionGeneration: attempt.executionGeneration,
      launchOperationId: attempt.launchOperationId,
      expectedOperationRunId: operation.operationRunId,
      expectedOperationRevision: operation.revision,
      runtime,
    })
    if (!started.success) throw new Error(started.error.message)
    const runningOperation = started.data.articlePublishing?.executionProtocol.current
    if (!runningOperation) throw new Error('missing running inspect operation')
    const reporter: ArticlePublishingAgentReporter = {
      workspaceId: WORKSPACE_ID,
      affairId: created.affairId,
      attemptId: attempt.id,
      executionGeneration: attempt.executionGeneration,
      launchOperationId: attempt.launchOperationId,
      conversationId: `conversation-g${attempt.executionGeneration}`,
      agentRunId: `run-g${attempt.executionGeneration}`,
    }
    await expect(
      created.service.reportArticlePublishingCheckpoint(
        {
          workspaceRef: { kind: 'local', path: directory },
          affairId: created.affairId,
          attemptId: attempt.id,
          stepId: 'open-editor',
          status: 'verifying',
          evidence: 'Agent 尝试绕过当前 operation',
        },
        WORKSPACE_ID,
        reporter,
      ),
    ).resolves.toMatchObject({
      success: false,
      error: { message: expect.stringContaining('当前 operation 尚未完成') },
    })

    const cancelled = await created.service.finishAttempt(
      {
        workspaceRef: { kind: 'local', path: directory },
        affairId: created.affairId,
        attemptId: created.attemptId,
        outcome: 'cancelled',
        summary: '用户取消文章发布',
      },
      WORKSPACE_ID,
      reporter,
    )
    if (!cancelled.success) throw new Error(cancelled.error.message)
    expect(cancelled.data.articlePublishing?.executionProtocol.current).toMatchObject({
      operationRunId: runningOperation.operationRunId,
      revision: runningOperation.revision + 1,
      status: 'interrupted',
    })
    expect(cancelled.data.articlePublishing?.draft?.recovery?.writePermit).toBeUndefined()

    const lateCompletion = await created.service.completeArticlePublishingFirstInspect({
      workspaceId: WORKSPACE_ID,
      affairId: created.affairId,
      attemptId: created.attemptId,
      executionGeneration: attempt.executionGeneration,
      launchOperationId: attempt.launchOperationId,
      expectedOperationRunId: runningOperation.operationRunId,
      expectedOperationRevision: runningOperation.revision,
      runtime,
      pageKind: 'editor',
      platformAccountId: 'csdn:test-user',
      normalizedTitle: 'Article',
      saveState: 'saved',
    })
    expect(lateCompletion.success).toBe(false)
    const after = created.service.getProjectSnapshot(WORKSPACE_ID)
    if (!after.success) throw new Error(after.error.message)
    expect(after.data.affairs[0].articlePublishing?.checkpoints[0].status).not.toBe('completed')
    expect(after.data.affairs[0].attempts[0].status).toBe('cancelled')
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
    const browserTaskRunId = '77777777-7777-4777-8777-777777777777'
    const reserved = await created.service.reserveArticlePublishingSideEffect(
      created.affairId,
      created.attemptId,
      attempt.executionGeneration,
      'publish',
      'final',
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
      browserTaskRunId,
      WORKSPACE_ID,
    )
    expect(consumed.success).toBe(true)
    if (!consumed.success) return
    expect(consumed.data.articlePublishing?.publication.status).toBe('not-started')
    const dispatched = await created.service.dispatchArticlePublishingSideEffect(
      created.affairId,
      created.attemptId,
      attempt.executionGeneration,
      sideEffectKey,
      browserTaskRunId,
      WORKSPACE_ID,
    )
    expect(dispatched.success).toBe(true)
    if (!dispatched.success) return
    expect(dispatched.data.articlePublishing?.publication.status).toBe('dispatched')

    const duplicate = await created.service.consumeArticlePublishingSideEffect(
      created.affairId,
      created.attemptId,
      attempt.executionGeneration,
      sideEffectKey,
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
    const reserved = await created.service.reserveArticlePublishingSideEffect(
      created.affairId,
      created.attemptId,
      attempt.executionGeneration,
      'save-draft',
      'source-a',
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
      browserTaskRunId,
      WORKSPACE_ID,
    )
    expect(consumed.success).toBe(true)
    if (!consumed.success) return
    expect(consumed.data.articlePublishing?.sideEffects[0]).toMatchObject({
      status: 'reserved',
      consumedAt: expect.any(String),
    })
    await created.service.flush()

    const reloaded = createService(directory)
    await reloaded.load()
    const duplicate = await reloaded.consumeArticlePublishingSideEffect(
      created.affairId,
      created.attemptId,
      attempt.executionGeneration,
      sideEffectKey,
      browserTaskRunId,
      WORKSPACE_ID,
    )
    expect(duplicate).toMatchObject({ success: false, error: { code: 'INVALID_TRANSITION' } })
  })

  it('cancels a consumed but not yet dispatched side effect without inventing an unknown result', async () => {
    const created = await createStartedTask(directory, sourcePath, imagePath)
    const generation = created.reporter.executionGeneration
    const browserTaskRunId = '77777777-7777-4777-8777-777777777777'
    const sideEffectKey = `${created.affairId}:${created.attemptId}:g${generation}:save-draft:race-window`
    await created.service.reserveArticlePublishingSideEffect(
      created.affairId,
      created.attemptId,
      generation,
      'save-draft',
      'race-window',
      browserTaskRunId,
      WORKSPACE_ID,
    )
    const consumed = await created.service.consumeArticlePublishingSideEffect(
      created.affairId,
      created.attemptId,
      generation,
      sideEffectKey,
      browserTaskRunId,
      WORKSPACE_ID,
    )
    expect(consumed).toMatchObject({
      success: true,
      data: {
        articlePublishing: {
          sideEffects: [
            expect.objectContaining({ status: 'reserved', consumedAt: expect.any(String) }),
          ],
        },
      },
    })

    const cancelled = await created.service.finishAttempt(
      {
        workspaceRef: { kind: 'local', path: directory },
        affairId: created.affairId,
        attemptId: created.attemptId,
        outcome: 'cancelled',
        summary: '用户在动作派发前取消',
      },
      WORKSPACE_ID,
      created.reporter,
    )
    if (!cancelled.success) throw new Error(cancelled.error.message)
    expect(cancelled.data.articlePublishing?.execution.status).toBe('cancelled')
    expect(cancelled.data.articlePublishing?.sideEffects[0].status).toBe('rejected')
    expect(
      cancelled.data.articlePublishing?.checkpoints.find(
        (checkpoint) =>
          checkpoint.stepId === cancelled.data.articlePublishing?.execution.currentStepId,
      )?.status,
    ).toBe('needs-reconcile')
    await expect(
      created.service.dispatchArticlePublishingSideEffect(
        created.affairId,
        created.attemptId,
        generation,
        sideEffectKey,
        browserTaskRunId,
        WORKSPACE_ID,
      ),
    ).resolves.toMatchObject({ success: false })
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
      previousBrowserViewRuntimeGeneration: 2,
      previousWebContentsId: 20,
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
        previousBrowserViewRuntimeGeneration: 2,
        previousWebContentsId: 20,
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
      observedStatus: 'owner-alive-no-progress',
      reasonCode: 'OWNER_NO_PROGRESS',
      reason: 'owner alive but internal runtime made no progress',
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

    const saved = await new WebAffairStore(filePath).save(persisted, {
      changedAffairIds: persisted.affairs.map((affair: { id: string }) => affair.id),
    })
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
        journalVersion: 2,
        snapshotSchemaVersion: 7,
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
    expect(recovered.affairs[0].title).toBe('Article')
    await expect(readFile(store.recoveryPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })

    const secondLoad = await store.load()
    expect(secondLoad.revision).toBe(recovery.revision)
    expect(secondLoad.affairs[0].title).toBe('Article')
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

  it('never writes a subset recovery journal for a mixed changed-affair batch', async () => {
    const created = await createStartedTask(directory, sourcePath, imagePath)
    await created.service.flush()
    const filePath = join(directory, 'affairs.json')
    const primary = JSON.parse(await readFile(filePath, 'utf8'))
    const article = primary.affairs[0]
    const generic = {
      ...structuredClone(article),
      id: randomUUID(),
      kind: 'generic',
      title: '普通事务',
      articlePublishing: undefined,
      attempts: [],
    }
    const mixed = {
      ...primary,
      revision: primary.revision + 1,
      affairs: [{ ...article, title: '文章变更' }, generic],
    }
    const store = new WebAffairStore(filePath)
    Object.defineProperty(store, 'persist', {
      value: async () => {
        throw new Error('simulated crash before atomic snapshot publish')
      },
    })

    await expect(store.save(mixed, { changedAffairIds: [article.id, generic.id] })).rejects.toThrow(
      'simulated crash',
    )
    await expect(readFile(store.recoveryPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
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
      observedAt: new Date().toISOString(),
      url,
      kind,
      platformAccountId: 'csdn:test-user',
      draftId: '164148817',
      normalizedTitle: 'Article',
      saveState: 'saved',
    },
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
  const reserved = await created.service.reserveArticlePublishingSideEffect(
    created.affairId,
    created.attemptId,
    attempt.executionGeneration,
    'upload-asset',
    targetId,
    browserTaskRunId,
    WORKSPACE_ID,
  )
  if (!reserved.success) throw new Error(reserved.error.message)
  const consumed = await created.service.consumeArticlePublishingSideEffect(
    created.affairId,
    created.attemptId,
    attempt.executionGeneration,
    `${created.affairId}:${created.attemptId}:g${attempt.executionGeneration}:upload-asset:${targetId}`,
    browserTaskRunId,
    WORKSPACE_ID,
  )
  if (!consumed.success) throw new Error(consumed.error.message)
  const dispatched = await created.service.dispatchArticlePublishingSideEffect(
    created.affairId,
    created.attemptId,
    attempt.executionGeneration,
    `${created.affairId}:${created.attemptId}:g${attempt.executionGeneration}:upload-asset:${targetId}`,
    browserTaskRunId,
    WORKSPACE_ID,
  )
  if (!dispatched.success) throw new Error(dispatched.error.message)
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
  const targetId = stepId === 'save-draft' ? 'manual-save:test' : `autosave:${stepId}:test-action`
  const browserTaskRunId = attempt.browserTaskRunId ?? '77777777-7777-4777-8777-777777777777'
  const reserved = await created.service.reserveArticlePublishingSideEffect(
    created.affairId,
    created.attemptId,
    attempt.executionGeneration,
    'save-draft',
    targetId,
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
    browserTaskRunId,
    WORKSPACE_ID,
  )
  if (!consumed.success) throw new Error(consumed.error.message)
  const dispatched = await created.service.dispatchArticlePublishingSideEffect(
    created.affairId,
    created.attemptId,
    attempt.executionGeneration,
    sideEffectKey,
    browserTaskRunId,
    WORKSPACE_ID,
  )
  if (!dispatched.success) throw new Error(dispatched.error.message)
  return sideEffectKey
}

async function advanceToSaveCheckpoint(created: StartedTask) {
  await reportPublishingCheckpoint(created, 'upload-assets', 'verifying')
  await reportPublishingCheckpoint(created, 'upload-assets', 'completed')
  for (const stepId of ['fill-body', 'fill-fields']) {
    await reportPublishingCheckpoint(created, stepId, 'running')
    await dispatchSaveEffect(created, stepId)
    if (stepId === 'fill-fields') await dispatchSaveEffect(created, 'fill-fields:summary')
    await reportPublishingCheckpoint(created, stepId, 'verifying')
    await reportPublishingCheckpoint(created, stepId, 'completed')
    if (stepId === 'fill-fields') {
      const snapshot = created.service.getProjectSnapshot(WORKSPACE_ID)
      if (!snapshot.success) throw new Error(snapshot.error.message)
      expect(
        snapshot.data.affairs[0]
          .articlePublishing!.sideEffects.filter((e) =>
            e.targetId.startsWith('autosave:fill-fields:'),
          )
          .every((e) => e.status === 'verified'),
      ).toBe(true)
    }
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
