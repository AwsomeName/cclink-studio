import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceStateService } from '../workspace/workspace-state-service'
import { MediaAssetService } from './media-asset-service'
import { MediaProjectService } from './media-project-service'
import { VideoGenerationService } from './video-generation-service'

let root = ''
let workspacePath = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'cclink-media-video-'))
  workspacePath = join(root, 'workspace')
  await mkdir(workspacePath, { recursive: true })
  await writeFile(join(workspacePath, 'brief.md'), '# 发布\n新的工作方式。', 'utf-8')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('VideoGenerationService', () => {
  it('persists, polls and immediately downloads a successful provider task as an asset', async () => {
    const workspaceState = createWorkspaceState()
    let now = 1_000
    const assetService = new MediaAssetService(workspaceState, () => ++now)
    const projectService = new MediaProjectService(workspaceState, () => ++now, assetService)
    const created = await projectService.create({
      workspacePath,
      sourcePath: join(workspacePath, 'brief.md'),
      platform: 'douyin',
      aspectRatio: '9:16',
      targetDurationSeconds: 10,
    })
    if (!created.success) throw new Error('fixture failed')
    const provider = {
      id: 'volcengine-jimeng-video',
      getStatus: () => ({ configured: true }),
      createTask: vi.fn(async () => ({ taskId: 'provider-task' })),
      getTask: vi.fn(async () => ({
        status: 'succeeded',
        progress: 1,
        resultUrl: 'https://output.volces.com/result.mp4',
      })),
    }
    const record = vi.fn(async () => undefined)
    const service = new VideoGenerationService(
      projectService,
      assetService,
      provider as never,
      () => ({ record }) as never,
      {
        fetch: vi.fn(async () => new Response(Buffer.from('mp4-content'), { status: 200 })),
        sleep: async () => undefined,
        now: () => ++now,
        pollIntervalMs: 0,
      },
    )

    const submitted = await service.createTask({
      workspacePath,
      projectId: created.project.id,
      projectRevision: created.project.revision,
      sceneId: created.project.scenes[0].id,
      provider: 'volcengine-jimeng-video',
      model: 'jimeng-video-3.0-pro',
      prompt: '镜头缓慢推进产品界面',
      aspectRatio: '9:16',
      durationSeconds: 5,
    })
    expect(submitted).toMatchObject({ success: true, task: { status: 'queued' } })

    await vi.waitFor(async () => {
      const listed = await service.listTasks(workspacePath, created.project.id)
      expect(listed).toMatchObject({
        success: true,
        tasks: [
          {
            status: 'succeeded',
            outputAsset: {
              source: 'generated-video',
              sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
            },
          },
        ],
      })
    })
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'succeeded', unit: 'video' }),
    )
  })
})

function createWorkspaceState(): WorkspaceStateService {
  return {
    resolveLocalWorkspace: async (path: string) => ({
      valid: resolve(path) === resolve(workspacePath),
      workspacePath: resolve(path) === resolve(workspacePath) ? resolve(workspacePath) : null,
    }),
    getLocalProjectId: async () => 'workspace-1',
  } as unknown as WorkspaceStateService
}
