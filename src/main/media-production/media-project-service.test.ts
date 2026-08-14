import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { WorkspaceStateService } from '../workspace/workspace-state-service'
import { MediaProjectService } from './media-project-service'

let tempDirectory = ''
let workspacePath = ''
let sourcePath = ''

beforeEach(async () => {
  tempDirectory = await mkdtemp(join(tmpdir(), 'cclink-studio-media-project-'))
  workspacePath = join(tempDirectory, 'workspace')
  sourcePath = join(workspacePath, 'launch.md')
  await mkdir(workspacePath, { recursive: true })
  await writeFile(
    sourcePath,
    [
      '# CCLink Studio 新版本',
      '',
      '从一篇稿件开始，把复杂内容拆成清晰场景。',
      '',
      '为每个场景选择真实素材、产品截图或 AI 生成内容。',
      '',
      '单个镜头可以独立修改，不需要重做整条视频。',
      '',
      '完成后导出带字幕和品牌信息的宣发视频。',
    ].join('\n'),
    'utf-8',
  )
})

afterEach(async () => {
  await rm(tempDirectory, { recursive: true, force: true })
})

describe('MediaProjectService', () => {
  it('creates a persisted storyboard from a workspace Markdown file and restores it', async () => {
    const service = createService()
    const created = await service.create(createInput())

    expect(created.success).toBe(true)
    if (!created.success) return
    expect(created.project).toMatchObject({
      revision: 1,
      title: 'CCLink Studio 新版本',
      brief: { aspectRatio: '9:16', targetDurationSeconds: 30 },
    })
    expect(created.project.scenes).toHaveLength(5)
    expect(created.project.scenes[0]).toMatchObject({ order: 0, materialKind: 'unassigned' })

    const projectFile = join(
      workspacePath,
      '.cclink-studio/media-projects',
      created.project.id,
      'project.json',
    )
    expect(JSON.parse(await readFile(projectFile, 'utf-8'))).toMatchObject({
      id: created.project.id,
      source: { path: created.project.source.path },
    })

    const restored = await createService().get(workspacePath, created.project.id)
    expect(restored).toMatchObject({
      success: true,
      project: { id: created.project.id, scenes: created.project.scenes },
    })
  })

  it('saves edits atomically and rejects a stale revision', async () => {
    const service = createService()
    const created = await service.create(createInput())
    if (!created.success) throw new Error('fixture creation failed')
    const edited = {
      ...created.project,
      title: '竖屏发布版',
      brief: {
        ...created.project.brief,
        brand: { primaryColor: '#FF5500', callToAction: '立即体验' },
      },
      scenes: created.project.scenes.map((scene, index) =>
        index === 0 ? { ...scene, subtitle: '一个稿子，直接开始做视频' } : scene,
      ),
    }

    const saved = await service.save({
      workspacePath,
      expectedRevision: 1,
      project: edited,
    })
    expect(saved).toMatchObject({
      success: true,
      project: {
        revision: 2,
        title: '竖屏发布版',
        brief: { brand: { primaryColor: '#FF5500', callToAction: '立即体验' } },
      },
    })

    const stale = await service.save({
      workspacePath,
      expectedRevision: 1,
      project: edited,
    })
    expect(stale).toMatchObject({
      success: false,
      error: { code: 'MEDIA_PROJECT_REVISION_CONFLICT' },
    })
    expect(await service.get(workspacePath, created.project.id)).toMatchObject({
      success: true,
      project: { revision: 2, title: '竖屏发布版' },
    })
  })

  it('refuses Markdown outside the active workspace', async () => {
    const outsidePath = join(tempDirectory, 'outside.md')
    await writeFile(outsidePath, '# Outside', 'utf-8')

    const result = await createService().create({ ...createInput(), sourcePath: outsidePath })

    expect(result).toMatchObject({
      success: false,
      error: { code: 'MEDIA_PROJECT_SOURCE_UNAVAILABLE', message: '稿件必须位于当前工作空间内' },
    })
  })

  it('lists summaries in most-recently-updated order', async () => {
    let timestamp = 1_000
    const service = new MediaProjectService(createWorkspaceStateService(), () => timestamp++)
    const first = await service.create(createInput())
    const second = await service.create({ ...createInput(), aspectRatio: '16:9' })
    if (!first.success || !second.success) throw new Error('fixture creation failed')

    const listed = await service.list(workspacePath)

    expect(listed).toMatchObject({
      success: true,
      projects: [
        { id: second.project.id, aspectRatio: '16:9' },
        { id: first.project.id, aspectRatio: '9:16' },
      ],
    })
  })
})

function createInput() {
  return {
    workspacePath,
    sourcePath,
    platform: 'douyin' as const,
    aspectRatio: '9:16' as const,
    targetDurationSeconds: 30,
  }
}

function createService(): MediaProjectService {
  return new MediaProjectService(createWorkspaceStateService(), () => 1_000)
}

function createWorkspaceStateService(): WorkspaceStateService {
  return {
    resolveLocalWorkspace: async (path: string) => ({
      valid: resolve(path) === resolve(workspacePath),
      workspacePath: resolve(path) === resolve(workspacePath) ? resolve(workspacePath) : null,
    }),
    getLocalProjectId: async () => 'workspace-1',
  } as unknown as WorkspaceStateService
}
