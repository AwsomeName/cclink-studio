import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaProjectService } from './media-project-service'
import { StoryboardProposalService, parseNarrationModelOutput } from './storyboard-proposal-service'
import { narrationScriptSchema } from '../../shared/media-production/narration-script'
import type {
  MediaProject,
  MediaProjectOperationResult,
} from '../../shared/media-production/media-project-types'
import type { WorkspaceStateService } from '../workspace/workspace-state-service'
import type { AgentBridge } from '../agent/agent-bridge'

let workspace: string
let service: MediaProjectService
let project: MediaProject
const unwrap = (r: MediaProjectOperationResult): MediaProject => {
  if (!r.success) throw new Error(r.error.message)
  return r.project
}
const newService = (): MediaProjectService =>
  new MediaProjectService({
    resolveLocalWorkspace: async (path: string) => ({
      valid: path === workspace,
      workspacePath: workspace,
    }),
    getLocalProjectId: async () => 'fixture',
  } as unknown as WorkspaceStateService)
const save = (p: MediaProject): Promise<MediaProjectOperationResult> =>
  service.save({ workspacePath: workspace, expectedRevision: p.revision, project: p })
const generate = (
  p: MediaProject,
  run: () => Promise<string[]>,
): Promise<MediaProjectOperationResult> =>
  service.generateNarration(
    { workspacePath: workspace, projectId: p.id, expectedRevision: p.revision, mode: 'generate' },
    run,
  )

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'cclink-narration-'))
  await writeFile(
    join(workspace, 'article.md'),
    '# 一次关于记忆的实验\n\n用手机记录自己的故事，数字分身是一个设想。',
  )
  service = newService()
  project = unwrap(
    await service.create({
      workspacePath: workspace,
      sourcePath: join(workspace, 'article.md'),
      platform: 'douyin',
      aspectRatio: '9:16',
      targetDurationSeconds: 30,
    }),
  )
})
afterEach(async () => {
  await rm(workspace, { recursive: true, force: true })
})

describe('narration workflow', () => {
  it('persists independent paragraphs and Markdown without changing original or legacy scenes', async () => {
    const scenes = project.scenes
    project.narration!.segments[0].text = '这是我的第一段口播。'
    project.narration!.segments.push({ id: randomUUID(), text: '这是第二段。' })
    project = unwrap(await save(project))
    const restored = unwrap(await newService().get(workspace, project.id))
    expect(restored.narration?.segments).toEqual(project.narration?.segments)
    expect(restored.scenes).toEqual(
      scenes.map((scene) => ({ ...scene, assetId: scene.assetId ?? null })),
    )
    expect(restored.narration?.revision).toBe(2)
    expect(
      await readFile(
        join(workspace, '.cclink-studio/media-projects', project.id, 'script/narration.md'),
        'utf8',
      ),
    ).toContain('这是我的第一段口播。')
    expect(await readFile(join(workspace, 'article.md'), 'utf8')).not.toContain('第一段口播')
  })

  it('invalidates confirmation on text/brief edits but not on title-only edits', async () => {
    project.narration!.segments[0].text = '有内容的口播。'
    project = unwrap(await save(project))
    project.narration!.confirmedRevision = project.narration!.revision
    project = unwrap(await save(project))
    expect(project.narration!.confirmedRevision).toBe(2)
    project.title = '新标题'
    project = unwrap(await save(project))
    expect(project.narration!.confirmedRevision).toBe(2)
    project.brief.targetDurationSeconds = 45
    project = unwrap(await save(project))
    expect(project.narration).toMatchObject({ revision: 3, confirmedRevision: null })
  })

  it('persists candidate before adoption, preserves existing text and restores the candidate', async () => {
    const result = unwrap(await generate(project, async () => ['自然的开场。', '克制的结尾。']))
    expect(result.narration?.segments[0].text).toBe('')
    expect(result.narration?.generation?.status).toBe('succeeded')
    expect(unwrap(await newService().get(workspace, project.id)).narration?.proposal).toEqual(
      result.narration?.proposal,
    )
    expect(result.narration?.proposal?.baseNarrationRevision).toBe(1)
  })

  it('rejects stale requests and duplicate generation; late results do not overwrite newer editing', async () => {
    let resolve!: (s: string[]) => void
    let signal!: () => void
    const started = new Promise<void>((r) => {
      signal = r
    })
    const task = generate(project, () => {
      signal()
      return new Promise((r) => {
        resolve = r
      })
    })
    await started
    const running = unwrap(await service.get(workspace, project.id))
    expect(running.narration?.generation?.status).toBe('running')
    const duplicate = vi.fn(async () => ['不应生成'])
    expect((await generate(running, duplicate)).success).toBe(false)
    expect(duplicate).not.toHaveBeenCalled()
    running.narration!.segments[0].text = '生成期间的新编辑。'
    unwrap(await save(running))
    resolve(['旧输入的结果。'])
    const result = unwrap(await task)
    expect(result.narration?.segments[0].text).toBe('生成期间的新编辑。')
    expect(result.narration?.proposal?.baseNarrationRevision).toBeLessThan(
      result.narration!.revision,
    )
    expect((await generate(project, duplicate)).success).toBe(false)
  })

  it('keeps prior candidate and text on model failure, without leaking raw errors', async () => {
    project = unwrap(await generate(project, async () => ['已有候选。']))
    const failed = unwrap(
      await generate(project, async () => {
        throw new Error('secret raw response')
      }),
    )
    expect(failed.narration?.generation?.status).toBe('failed')
    expect(failed.narration?.proposal).toEqual(project.narration?.proposal)
    expect(JSON.stringify(failed)).not.toContain('secret raw response')
  })

  it('rejects adoption of an outdated candidate in the main process', async () => {
    project = unwrap(await generate(project, async () => ['旧候选。']))
    project.narration!.segments[0].text = '新的内容'
    project = unwrap(await save(project))
    project.narration!.appliedProposalId = project.narration!.proposal!.id
    expect(await save(project)).toMatchObject({
      success: false,
      error: { code: 'MEDIA_PROJECT_REVISION_CONFLICT' },
    })
  })

  it('marks an orphaned running task interrupted on reopen without automatically resubmitting', async () => {
    project.narration!.generation = {
      id: randomUUID(),
      status: 'running',
      mode: 'generate',
      inputRevision: 1,
      startedAt: Date.now(),
      finishedAt: null,
      error: null,
    }
    const file = join(workspace, '.cclink-studio/media-projects', project.id, 'project.json')
    await writeFile(file, JSON.stringify(project))
    expect(
      unwrap(await newService().get(workspace, project.id)).narration?.generation?.status,
    ).toBe('interrupted')
  })

  it('rejects blank confirmation and duplicate segment identities', () => {
    expect(() =>
      narrationScriptSchema.parse({ ...project.narration, confirmedRevision: 1 }),
    ).toThrow()
    expect(() =>
      narrationScriptSchema.parse({
        ...project.narration,
        segments: [project.narration!.segments[0], project.narration!.segments[0]],
      }),
    ).toThrow()
  })

  it('returns a visible warning when the readable copy fails while preserving committed JSON', async () => {
    const path = join(
      workspace,
      '.cclink-studio/media-projects',
      project.id,
      'script/narration.md.tmp',
    )
    await mkdir(path)
    project.narration!.segments[0].text = '正文保存不能丢。'
    const result = await save(project)
    expect(result.success && result.warnings?.[0]).toContain('Markdown')
    expect(unwrap(await newService().get(workspace, project.id)).narration?.segments[0].text).toBe(
      '正文保存不能丢。',
    )
  })

  it('keeps the last valid JSON when committing the next revision fails', async () => {
    const file = join(
      workspace,
      '.cclink-studio/media-projects',
      project.id,
      `project.json.${process.pid}.tmp`,
    )
    await mkdir(file)
    project.narration!.segments[0].text = '未提交修改'
    expect(await save(project)).toMatchObject({
      success: false,
      error: { code: 'MEDIA_PROJECT_WRITE_FAILED' },
    })
    expect(unwrap(await newService().get(workspace, project.id)).narration?.segments[0].text).toBe(
      '',
    )
  })

  it('uses the existing isolated Agent bridge with narration-only prompt and strict parsing', async () => {
    const requestInternalText = vi.fn(async () => '{"segments":["一次关于记忆的实验。"]}')
    const generator = new StoryboardProposalService(
      () => ({ requestInternalText }) as unknown as AgentBridge,
    )
    expect(await generator.proposeNarration(project, 'generate')).toEqual(['一次关于记忆的实验。'])
    expect(requestInternalText).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: 'media-narration',
        workspacePath: workspace,
        prompt: expect.stringContaining('不生成分镜'),
      }),
    )
    expect(() => parseNarrationModelOutput('{"segments":[]}')).toThrow()
    expect(() => parseNarrationModelOutput('{"segments":[""],"extra":true}')).toThrow()
    expect(() => parseNarrationModelOutput('not json')).toThrow()
  })
})
