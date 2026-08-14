import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import type {
  MediaProject,
  MediaProjectAsset,
  MediaProjectFailure,
} from '../../shared/media-production/media-project-types'
import type {
  CreateMediaRenderTaskInput,
  MediaRenderRuntimeStatus,
  MediaRenderRuntimeStatusResult,
  MediaRenderStep,
  MediaRenderTask,
  MediaRenderTaskListResult,
  MediaRenderTaskResult,
} from '../../shared/media-production/media-render-types'
import type { MediaProjectService } from './media-project-service'

const TASK_FILE = 'render-tasks.json'

interface CommandResult {
  stdout: string
  stderr: string
}

interface MediaRenderDependencies {
  now: () => number
  run: (executable: string, args: string[]) => Promise<CommandResult>
  configuredExecutable?: string
}

const DEFAULT_DEPENDENCIES: MediaRenderDependencies = {
  now: Date.now,
  run: (executable, args) =>
    new Promise((resolve, reject) => {
      execFile(executable, args, { maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`${stderr || stdout || error.message}`.trim()))
          return
        }
        resolve({ stdout, stderr })
      })
    }),
  configuredExecutable: process.env.CCLINK_FFMPEG_PATH,
}

interface ResolvedRuntime {
  status: MediaRenderRuntimeStatus
  executable: string | null
}

export class MediaRenderService {
  private mutationQueue: Promise<unknown> = Promise.resolve()
  private readonly activeTasks = new Map<string, Promise<void>>()
  private runtimePromise: Promise<ResolvedRuntime> | null = null

  constructor(
    private readonly projectService: MediaProjectService,
    private readonly dependencies: MediaRenderDependencies = DEFAULT_DEPENDENCIES,
  ) {}

  async getRuntimeStatus(): Promise<MediaRenderRuntimeStatusResult> {
    return { success: true, runtime: (await this.resolveRuntime()).status }
  }

  async createTask(input: CreateMediaRenderTaskInput): Promise<MediaRenderTaskResult> {
    const runtime = await this.resolveRuntime()
    if (!runtime.executable) {
      return failure(
        'MEDIA_PROJECT_RENDER_UNAVAILABLE',
        runtime.status.reason || '未检测到可用的 FFmpeg',
        '安装包含 libx264 与 subtitles 滤镜的 FFmpeg，重启 Studio 后再导出',
      )
    }
    const projectResult = await this.projectService.get(input.workspacePath, input.projectId)
    if (!projectResult.success) return projectResult
    if (projectResult.project.revision !== input.projectRevision) {
      return failure('MEDIA_PROJECT_REVISION_CONFLICT', '工程已更新，请保存并基于最新版本重新导出')
    }
    const validationError = await validateProjectForRender(projectResult.project)
    if (validationError) return failure('MEDIA_PROJECT_RENDER_FAILED', validationError)

    const now = this.dependencies.now()
    const task: MediaRenderTask = {
      id: randomUUID(),
      workspacePath: projectResult.project.workspaceRef.path,
      projectId: input.projectId,
      projectRevision: input.projectRevision,
      status: 'queued',
      step: 'validating',
      progress: 0,
      outputPath: input.outputPath,
      createdAt: now,
      updatedAt: now,
    }
    await this.upsertTask(task)
    this.startRender(task, projectResult.project, runtime.executable)
    return { success: true, task }
  }

  async listTasks(workspacePath: string, projectId: string): Promise<MediaRenderTaskListResult> {
    try {
      const project = await this.projectService.get(workspacePath, projectId)
      if (!project.success) return { success: false, tasks: [], error: project.error }
      const tasks = await this.readTasks(project.project.workspaceRef.path, projectId)
      let changed = false
      const reconciled = tasks.map((task) => {
        if (
          (task.status === 'queued' || task.status === 'running') &&
          !this.activeTasks.has(task.id)
        ) {
          changed = true
          return {
            ...task,
            status: 'failed' as const,
            errorMessage: 'Studio 上次退出时本地渲染尚未完成',
            recovery: '保留原工程和素材，可点击重试重新导出',
            updatedAt: this.dependencies.now(),
          }
        }
        return task
      })
      if (changed) await this.writeTasks(project.project.workspaceRef.path, projectId, reconciled)
      return { success: true, tasks: reconciled.sort((a, b) => b.createdAt - a.createdAt) }
    } catch (error) {
      return {
        success: false,
        tasks: [],
        error: {
          code: 'MEDIA_PROJECT_STORE_INVALID',
          message: error instanceof Error ? error.message : '成片任务账本无法读取',
        },
      }
    }
  }

  async retryTask(workspacePath: string, taskId: string): Promise<MediaRenderTaskResult> {
    const projectIds = await this.projectService.list(workspacePath)
    if (!projectIds.success) return { success: false, error: projectIds.error }
    for (const summary of projectIds.projects) {
      const tasks = await this.readTasks(workspacePath, summary.id).catch(() => [])
      const task = tasks.find((candidate) => candidate.id === taskId)
      if (!task) continue
      const project = await this.projectService.get(workspacePath, task.projectId)
      if (!project.success) return project
      return this.createTask({
        workspacePath,
        projectId: task.projectId,
        projectRevision: project.project.revision,
        outputPath: task.outputPath,
      })
    }
    return failure('MEDIA_PROJECT_NOT_FOUND', '待重试的成片任务不存在')
  }

  async flush(): Promise<void> {
    await this.mutationQueue.catch(() => undefined)
  }

  private startRender(task: MediaRenderTask, project: MediaProject, executable: string): void {
    const promise = this.render(task, project, executable)
      .catch(async (error) => {
        const latest = (
          await this.readTasks(task.workspacePath, task.projectId).catch(() => [])
        ).find((candidate) => candidate.id === task.id)
        await this.upsertTask({
          ...(latest ?? task),
          status: 'failed',
          errorMessage: sanitizeProcessError(error),
          recovery: '工程和素材均已保留；修复提示的问题后可单独重试导出',
          updatedAt: this.dependencies.now(),
        })
      })
      .finally(() => this.activeTasks.delete(task.id))
    this.activeTasks.set(task.id, promise)
  }

  private async render(
    task: MediaRenderTask,
    project: MediaProject,
    executable: string,
  ): Promise<void> {
    const renderDirectory = await this.renderDirectory(task.workspacePath, task.projectId, task.id)
    await mkdir(renderDirectory, { recursive: true })
    await mkdir(dirname(task.outputPath), { recursive: true })
    const dimensions = dimensionsFor(project.brief.aspectRatio)
    const visualAssets = new Map((project.assets ?? []).map((asset) => [asset.id, asset]))
    let currentTask = await this.setProgress(task, 'preparing', 4)
    const clips: string[] = []

    for (const [index, scene] of project.scenes.entries()) {
      const asset = visualAssets.get(scene.assetId ?? '')!
      const clipPath = join(renderDirectory, `scene-${String(index + 1).padStart(3, '0')}.mp4`)
      const duration = scene.durationSeconds.toFixed(3)
      const videoFilter = buildSceneFilter(
        dimensions.width,
        dimensions.height,
        scene.durationSeconds,
        project.renderSettings?.transition ?? 'cut',
        asset.kind === 'image',
      )
      const args =
        asset.kind === 'image'
          ? ['-y', '-loop', '1', '-framerate', '30', '-i', asset.path, '-t', duration]
          : ['-y', '-stream_loop', '-1', '-i', asset.path, '-t', duration]
      await this.dependencies.run(executable, [
        ...args,
        '-vf',
        videoFilter,
        '-an',
        '-c:v',
        'libx264',
        '-preset',
        'medium',
        '-crf',
        '20',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        clipPath,
      ])
      clips.push(clipPath)
      currentTask = await this.setProgress(
        currentTask,
        'rendering-scenes',
        8 + Math.round(((index + 1) / project.scenes.length) * 57),
      )
    }

    const concatList = join(renderDirectory, 'clips.ffconcat')
    await writeFile(
      concatList,
      `ffconcat version 1.0\n${clips.map((path) => `file '${escapeConcatPath(path)}'`).join('\n')}\n`,
      'utf-8',
    )
    const concatenated = join(renderDirectory, 'concatenated.mp4')
    currentTask = await this.setProgress(currentTask, 'concatenating', 68)
    await this.dependencies.run(executable, [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      concatList,
      '-c',
      'copy',
      concatenated,
    ])

    const companion = companionPaths(task.outputPath)
    await writeFile(companion.subtitle, createSrt(project), 'utf-8')
    await writeFile(companion.sources, createSources(project), 'utf-8')
    currentTask = await this.setProgress(currentTask, 'compositing', 76)
    const temporaryOutput = join(
      dirname(task.outputPath),
      `.${basename(task.outputPath, extname(task.outputPath))}.${task.id}.tmp.mp4`,
    )
    await this.dependencies.run(
      executable,
      buildCompositeArgs(project, concatenated, companion.subtitle, temporaryOutput),
    )
    currentTask = await this.setProgress(currentTask, 'exporting', 96)
    await rename(temporaryOutput, task.outputPath)
    await this.upsertTask({
      ...currentTask,
      status: 'succeeded',
      step: 'completed',
      progress: 100,
      subtitlePath: companion.subtitle,
      sourcesPath: companion.sources,
      updatedAt: this.dependencies.now(),
    })
  }

  private async setProgress(
    task: MediaRenderTask,
    step: MediaRenderStep,
    progress: number,
  ): Promise<MediaRenderTask> {
    const next: MediaRenderTask = {
      ...task,
      status: 'running',
      step,
      progress,
      updatedAt: this.dependencies.now(),
    }
    await this.upsertTask(next)
    return next
  }

  private async resolveRuntime(): Promise<ResolvedRuntime> {
    this.runtimePromise ??= this.detectRuntime()
    return this.runtimePromise
  }

  private async detectRuntime(): Promise<ResolvedRuntime> {
    const configured = this.dependencies.configuredExecutable?.trim()
    const candidates = [
      ...(configured ? [{ executable: configured, source: 'configured-path' as const }] : []),
      { executable: 'ffmpeg', source: 'system-path' as const },
      { executable: '/opt/homebrew/bin/ffmpeg', source: 'system-path' as const },
      { executable: '/usr/local/bin/ffmpeg', source: 'system-path' as const },
    ]
    const checked = new Set<string>()
    for (const candidate of candidates) {
      if (checked.has(candidate.executable)) continue
      checked.add(candidate.executable)
      try {
        if (candidate.executable.includes('/')) await access(candidate.executable, constants.X_OK)
        const version = await this.dependencies.run(candidate.executable, ['-version'])
        const filters = await this.dependencies.run(candidate.executable, [
          '-hide_banner',
          '-filters',
        ])
        const encoders = await this.dependencies.run(candidate.executable, [
          '-hide_banner',
          '-encoders',
        ])
        if (!filters.stdout.includes('subtitles') && !filters.stderr.includes('subtitles')) continue
        if (!encoders.stdout.includes('libx264') && !encoders.stderr.includes('libx264')) continue
        return {
          executable: candidate.executable,
          status: {
            available: true,
            version: (version.stdout || version.stderr).split('\n')[0]?.trim() || null,
            source: candidate.source,
          },
        }
      } catch {
        // Continue probing fixed, bounded candidates.
      }
    }
    return {
      executable: null,
      status: {
        available: false,
        version: null,
        source: 'unavailable',
        reason: '未检测到同时支持 libx264 和 subtitles 滤镜的 FFmpeg',
      },
    }
  }

  private async upsertTask(task: MediaRenderTask): Promise<void> {
    await this.enqueue(async () => {
      const tasks = await this.readTasks(task.workspacePath, task.projectId)
      const index = tasks.findIndex((candidate) => candidate.id === task.id)
      if (index >= 0) tasks[index] = task
      else tasks.push(task)
      await this.writeTasks(task.workspacePath, task.projectId, tasks)
    })
  }

  private async readTasks(workspacePath: string, projectId: string): Promise<MediaRenderTask[]> {
    const path = await this.taskFile(workspacePath, projectId)
    try {
      const value = JSON.parse(await readFile(path, 'utf-8'))
      if (!Array.isArray(value)) throw new Error('成片任务账本无效')
      return value.map(parseTask)
    } catch (error) {
      if (isMissingFileError(error)) return []
      throw error
    }
  }

  private async writeTasks(
    workspacePath: string,
    projectId: string,
    tasks: MediaRenderTask[],
  ): Promise<void> {
    const path = await this.taskFile(workspacePath, projectId)
    const temporaryPath = `${path}.${process.pid}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(tasks, null, 2)}\n`, 'utf-8')
    await rename(temporaryPath, path)
  }

  private async taskFile(workspacePath: string, projectId: string): Promise<string> {
    const workspace = await realpath(workspacePath)
    return join(workspace, '.cclink-studio', 'media-projects', projectId, TASK_FILE)
  }

  private async renderDirectory(
    workspacePath: string,
    projectId: string,
    taskId: string,
  ): Promise<string> {
    const workspace = await realpath(workspacePath)
    return join(workspace, '.cclink-studio', 'media-projects', projectId, 'renders', taskId)
  }

  private async enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation)
    this.mutationQueue = result.catch(() => undefined)
    return result
  }
}

async function validateProjectForRender(project: MediaProject): Promise<string | null> {
  const assets = new Map((project.assets ?? []).map((asset) => [asset.id, asset]))
  for (const scene of project.scenes) {
    const asset = assets.get(scene.assetId ?? '')
    if (!asset) return `场景 ${scene.order + 1} 尚未选择素材`
    if (asset.kind !== 'image' && asset.kind !== 'video') {
      return `场景 ${scene.order + 1} 的主素材必须是图片或视频`
    }
    try {
      await access(asset.path, constants.R_OK)
    } catch {
      return `场景 ${scene.order + 1} 的素材文件已丢失`
    }
  }
  return null
}

function buildSceneFilter(
  width: number,
  height: number,
  durationSeconds: number,
  transition: 'cut' | 'fade',
  animateImage: boolean,
): string {
  const normalized = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`
  const motion = animateImage
    ? `zoompan=z='min(zoom+0.0005,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Math.ceil(durationSeconds * 30)}:s=${width}x${height}:fps=30`
    : 'fps=30'
  const base = `${normalized},${motion},setsar=1,format=yuv420p`
  if (transition === 'cut') return base
  const fadeOutStart = Math.max(0, durationSeconds - 0.25).toFixed(3)
  return `${base},fade=t=in:st=0:d=0.25,fade=t=out:st=${fadeOutStart}:d=0.25`
}

function buildCompositeArgs(
  project: MediaProject,
  inputPath: string,
  subtitlePath: string,
  outputPath: string,
): string[] {
  const assets = new Map((project.assets ?? []).map((asset) => [asset.id, asset]))
  const logo = project.renderSettings?.logoAssetId
    ? assets.get(project.renderSettings.logoAssetId)
    : undefined
  const music = project.renderSettings?.musicAssetId
    ? assets.get(project.renderSettings.musicAssetId)
    : undefined
  const args = ['-y', '-i', inputPath]
  let nextInput = 1
  let logoInput: number | null = null
  let musicInput: number | null = null
  if (logo) {
    logoInput = nextInput++
    args.push('-loop', '1', '-i', logo.path)
  }
  if (music) {
    musicInput = nextInput
    args.push('-stream_loop', '-1', '-i', music.path)
  }
  const filters = [
    `[0:v]subtitles='${escapeFilterPath(subtitlePath)}':force_style='FontName=Arial,FontSize=22,Outline=2,Shadow=0,MarginV=48'[captioned]`,
  ]
  let videoOutput = 'captioned'
  if (logoInput !== null) {
    filters.push(`[${logoInput}:v]scale=220:-1:force_original_aspect_ratio=decrease[logo]`)
    filters.push(`[captioned][logo]overlay=W-w-36:36:format=auto[vout]`)
    videoOutput = 'vout'
  }
  if (musicInput !== null) {
    const totalDuration = project.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0)
    const fadeOutStart = Math.max(0, totalDuration - 0.8).toFixed(3)
    filters.push(
      `[${musicInput}:a]volume=${project.renderSettings?.musicVolume ?? 0.18},afade=t=in:st=0:d=0.5,afade=t=out:st=${fadeOutStart}:d=0.8[aout]`,
    )
  }
  args.push('-filter_complex', filters.join(';'), '-map', `[${videoOutput}]`)
  if (musicInput !== null) args.push('-map', '[aout]', '-shortest')
  else args.push('-an')
  args.push(
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    ...(musicInput !== null ? ['-c:a', 'aac', '-b:a', '192k'] : []),
    '-movflags',
    '+faststart',
    outputPath,
  )
  return args
}

function createSrt(project: MediaProject): string {
  let currentSeconds = 0
  const cues = project.scenes.map((scene, index) => {
    const start = formatSrtTime(currentSeconds)
    currentSeconds += scene.durationSeconds
    const end = formatSrtTime(currentSeconds)
    const cta = index === project.scenes.length - 1 ? project.brief.brand.callToAction.trim() : ''
    const text = [scene.subtitle.trim(), cta].filter(Boolean).join('\n') || ' '
    return `${index + 1}\n${start} --> ${end}\n${text}\n`
  })
  return `${cues.join('\n')}\n`
}

function createSources(project: MediaProject): string {
  const assets = new Map((project.assets ?? []).map((asset) => [asset.id, asset]))
  const used = new Map<string, { asset: MediaProjectAsset; scenes: number[] }>()
  for (const scene of project.scenes) {
    const asset = assets.get(scene.assetId ?? '')
    if (!asset) continue
    const entry = used.get(asset.id) ?? { asset, scenes: [] }
    entry.scenes.push(scene.order + 1)
    used.set(asset.id, entry)
  }
  for (const id of [project.renderSettings?.logoAssetId, project.renderSettings?.musicAssetId]) {
    if (!id) continue
    const asset = assets.get(id)
    if (asset && !used.has(id)) used.set(id, { asset, scenes: [] })
  }
  const lines = [
    `# ${project.title} — 素材来源`,
    '',
    `导出工程 revision：${project.revision}`,
    `生成时间：${new Date().toISOString()}`,
    '',
  ]
  for (const { asset, scenes } of used.values()) {
    lines.push(`## ${asset.fileName}`, '')
    lines.push(`- 用途：${scenes.length ? `场景 ${scenes.join('、')}` : 'Logo / 背景音乐'}`)
    lines.push(`- 类型：${asset.kind}`)
    lines.push(`- 来源：${asset.source}`)
    lines.push(`- SHA-256：${asset.sha256}`)
    if (asset.provenance.provider) lines.push(`- Provider：${asset.provenance.provider}`)
    if (asset.provenance.author) lines.push(`- 作者：${asset.provenance.author}`)
    if (asset.provenance.sourceUrl) lines.push(`- 原页面：${asset.provenance.sourceUrl}`)
    if (asset.provenance.licenseSummary) {
      lines.push(`- 许可摘要：${asset.provenance.licenseSummary}`)
    }
    if (asset.provenance.originalPath)
      lines.push(`- 原始本机路径：${asset.provenance.originalPath}`)
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

function companionPaths(outputPath: string): { subtitle: string; sources: string } {
  const base = join(dirname(outputPath), basename(outputPath, extname(outputPath)))
  return { subtitle: `${base}.srt`, sources: `${base}.sources.md` }
}

function dimensionsFor(aspectRatio: MediaProject['brief']['aspectRatio']): {
  width: number
  height: number
} {
  if (aspectRatio === '9:16') return { width: 1080, height: 1920 }
  if (aspectRatio === '1:1') return { width: 1080, height: 1080 }
  return { width: 1920, height: 1080 }
}

function formatSrtTime(seconds: number): string {
  const milliseconds = Math.round(seconds * 1000)
  const hours = Math.floor(milliseconds / 3_600_000)
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000)
  const secs = Math.floor((milliseconds % 60_000) / 1000)
  const millis = milliseconds % 1000
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(secs, 2)},${pad(millis, 3)}`
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, '0')
}

function escapeConcatPath(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "'\\''")
}

function escapeFilterPath(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'")
}

function parseTask(value: unknown): MediaRenderTask {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('成片任务无效')
  const task = value as Partial<MediaRenderTask>
  if (
    typeof task.id !== 'string' ||
    typeof task.workspacePath !== 'string' ||
    typeof task.projectId !== 'string' ||
    typeof task.projectRevision !== 'number' ||
    typeof task.outputPath !== 'string' ||
    typeof task.status !== 'string' ||
    typeof task.step !== 'string' ||
    typeof task.progress !== 'number' ||
    typeof task.createdAt !== 'number' ||
    typeof task.updatedAt !== 'number'
  ) {
    throw new Error('成片任务无效')
  }
  return task as MediaRenderTask
}

function sanitizeProcessError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'FFmpeg 渲染失败'
  return message.replaceAll(process.cwd(), '<app>').slice(0, 2000)
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

function failure(
  code: MediaProjectFailure['code'],
  message: string,
  recovery?: string,
): MediaRenderTaskResult {
  return { success: false, error: { code, message, ...(recovery ? { recovery } : {}) } }
}
