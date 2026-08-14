import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { MediaProject } from '../../shared/media-production/media-project-types'
import type { MediaProjectService } from './media-project-service'
import { MediaRenderService } from './media-render-service'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const SCENE_ID = '22222222-2222-4222-8222-222222222222'
const ASSET_ID = '33333333-3333-4333-8333-333333333333'

describe('MediaRenderService', () => {
  it('creates deterministic MP4, SRT and source-list outputs through an external runtime', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'cclink-render-'))
    const projectDirectory = join(workspacePath, '.cclink-studio', 'media-projects', PROJECT_ID)
    await mkdir(projectDirectory, { recursive: true })
    const imagePath = join(projectDirectory, 'image.png')
    await writeFile(imagePath, 'image')
    const project = createProject(workspacePath, imagePath)
    const calls: string[][] = []
    const service = new MediaRenderService(projectService(project), {
      now: incrementingClock(),
      configuredExecutable: '/test/ffmpeg',
      run: async (_executable, args) => {
        calls.push(args)
        if (args.includes('-version')) return { stdout: 'ffmpeg version test', stderr: '' }
        if (args.includes('-filters')) return { stdout: ' ... subtitles ...', stderr: '' }
        if (args.includes('-encoders')) return { stdout: ' ... libx264 ...', stderr: '' }
        const outputPath = args.at(-1)
        if (outputPath?.endsWith('.mp4')) await writeFile(outputPath, 'video')
        return { stdout: '', stderr: '' }
      },
    })
    const outputPath = join(workspacePath, 'campaign.mp4')

    const created = await service.createTask({
      workspacePath,
      projectId: PROJECT_ID,
      projectRevision: 1,
      outputPath,
    })
    expect(created.success).toBe(true)
    const completed = await waitForTerminal(service, workspacePath)

    expect(completed.status).toBe('succeeded')
    expect(await readFile(outputPath, 'utf-8')).toBe('video')
    expect(await readFile(join(workspacePath, 'campaign.srt'), 'utf-8')).toContain('立即体验')
    expect(await readFile(join(workspacePath, 'campaign.sources.md'), 'utf-8')).toContain('SHA-256')
    expect(calls.some((args) => args.includes('libx264'))).toBe(true)
    expect(calls.some((args) => args.includes('-filter_complex'))).toBe(true)
  })

  it('degrades without blocking the project when a compatible runtime is absent', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'cclink-render-missing-'))
    const project = createProject(workspacePath, join(workspacePath, 'missing.png'))
    const service = new MediaRenderService(projectService(project), {
      now: Date.now,
      run: async () => {
        throw new Error('not found')
      },
    })

    const status = await service.getRuntimeStatus()
    expect(status.success && status.runtime.available).toBe(false)
    const result = await service.createTask({
      workspacePath,
      projectId: PROJECT_ID,
      projectRevision: 1,
      outputPath: join(workspacePath, 'campaign.mp4'),
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.code).toBe('MEDIA_PROJECT_RENDER_UNAVAILABLE')
  })

  it('reconciles an interrupted local render into an explicit retryable failure', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'cclink-render-recover-'))
    const projectDirectory = join(workspacePath, '.cclink-studio', 'media-projects', PROJECT_ID)
    await mkdir(projectDirectory, { recursive: true })
    const project = createProject(workspacePath, join(workspacePath, 'image.png'))
    await writeFile(
      join(projectDirectory, 'render-tasks.json'),
      JSON.stringify([
        {
          id: '44444444-4444-4444-8444-444444444444',
          workspacePath,
          projectId: PROJECT_ID,
          projectRevision: 1,
          status: 'running',
          step: 'rendering-scenes',
          progress: 42,
          outputPath: join(workspacePath, 'campaign.mp4'),
          createdAt: 1,
          updatedAt: 2,
        },
      ]),
    )
    const service = new MediaRenderService(projectService(project))

    const result = await service.listTasks(workspacePath, PROJECT_ID)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.tasks[0]).toMatchObject({
        status: 'failed',
        step: 'rendering-scenes',
        recovery: expect.stringContaining('重试'),
      })
    }
  })
})

async function waitForTerminal(
  service: MediaRenderService,
  workspacePath: string,
): Promise<
  Awaited<ReturnType<MediaRenderService['listTasks']>> extends { tasks: infer T }
    ? T extends Array<infer U>
      ? U
      : never
    : never
> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const result = await service.listTasks(workspacePath, PROJECT_ID)
    if (result.success && result.tasks[0]?.status === 'succeeded') return result.tasks[0] as never
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('render did not finish')
}

function projectService(project: MediaProject): MediaProjectService {
  return {
    get: async () => ({ success: true as const, project }),
    list: async () => ({
      success: true as const,
      projects: [
        {
          id: project.id,
          title: project.title,
          sourcePath: project.source.path,
          aspectRatio: project.brief.aspectRatio,
          targetDurationSeconds: project.brief.targetDurationSeconds,
          sceneCount: project.scenes.length,
          revision: project.revision,
          updatedAt: project.updatedAt,
        },
      ],
    }),
  } as unknown as MediaProjectService
}

function createProject(workspacePath: string, imagePath: string): MediaProject {
  return {
    schemaVersion: 1,
    id: PROJECT_ID,
    workspaceRef: { kind: 'local', path: workspacePath },
    revision: 1,
    title: '产品发布',
    source: { path: join(workspacePath, '稿件.md'), snapshot: '# 产品发布' },
    brief: {
      platform: 'web',
      aspectRatio: '16:9',
      targetDurationSeconds: 5,
      brand: { primaryColor: '#5B8CFF', callToAction: '立即体验' },
    },
    scenes: [
      {
        id: SCENE_ID,
        order: 0,
        durationSeconds: 5,
        narration: '旁白',
        subtitle: '产品已发布',
        visualDescription: '产品画面',
        searchTerms: ['产品'],
        generationPrompt: '产品发布画面',
        materialKind: 'workspace',
        assetId: ASSET_ID,
      },
    ],
    assets: [
      {
        id: ASSET_ID,
        kind: 'image',
        source: 'local-import',
        fileName: 'image.png',
        path: imagePath,
        mimeType: 'image/png',
        sizeBytes: 5,
        sha256: 'a'.repeat(64),
        provenance: { originalPath: imagePath },
        addedAt: 1,
      },
    ],
    renderSettings: {
      logoAssetId: null,
      musicAssetId: null,
      musicVolume: 0.18,
      transition: 'fade',
    },
    createdAt: 1,
    updatedAt: 1,
  }
}

function incrementingClock(): () => number {
  let now = 1_000
  return () => ++now
}
