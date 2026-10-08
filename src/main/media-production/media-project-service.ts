import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join, resolve, sep } from 'node:path'
import {
  parseMediaProject,
  parseMediaProjectId,
} from '../../shared/media-production/media-project-schema'
import type {
  CreateMediaProjectInput,
  MediaProject,
  MediaProjectErrorCode,
  MediaProjectFailure,
  MediaProjectListResult,
  MediaProjectOperationResult,
  MediaProjectScene,
  MediaProjectSummary,
  SaveMediaProjectInput,
} from '../../shared/media-production/media-project-types'
import type { WorkspaceStateService } from '../workspace/workspace-state-service'
import { MediaAssetService } from './media-asset-service'
import {
  initialNarration,
  narrationInputKey,
  narrationScriptSchema,
  type GenerateNarrationInput,
} from '../../shared/media-production/narration-script'

const MEDIA_PROJECT_DIRECTORY = join('.cclink-studio', 'media-projects')
const MAX_SOURCE_BYTES = 1_000_000
const DEFAULT_SUBTITLE_MAX_CHARACTERS = 32

class MediaProjectServiceError extends Error {
  constructor(
    readonly code: MediaProjectErrorCode,
    message: string,
    readonly recovery?: string,
  ) {
    super(message)
    this.name = 'MediaProjectServiceError'
  }
}

export class MediaProjectService {
  hasActiveWork(): boolean {
    return this.activeNarrations.size > 0
  }
  private mutationQueue: Promise<unknown> = Promise.resolve()
  private readonly changeListeners = new Set<(workspacePath: string) => void>()
  private readonly mediaAssetService: MediaAssetService
  private readonly activeNarrations = new Set<string>()

  constructor(
    private readonly workspaceStateService: WorkspaceStateService,
    private readonly now: () => number = Date.now,
    mediaAssetService?: MediaAssetService,
  ) {
    this.mediaAssetService = mediaAssetService ?? new MediaAssetService(workspaceStateService, now)
  }

  onChanged(listener: (workspacePath: string) => void): () => void {
    this.changeListeners.add(listener)
    return () => this.changeListeners.delete(listener)
  }

  async list(workspacePath: string): Promise<MediaProjectListResult> {
    try {
      const workspace = await this.resolveWorkspace(workspacePath, false)
      const directory = projectsDirectory(workspace)
      let entries
      try {
        entries = await readdir(directory, { withFileTypes: true })
      } catch (error) {
        if (isMissingFileError(error)) return { success: true, projects: [] }
        throw error
      }

      const projects: MediaProjectSummary[] = []
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        try {
          const id = parseMediaProjectId(entry.name)
          projects.push(toSummary(await this.readProject(workspace, id)))
        } catch {
          throw new MediaProjectServiceError(
            'MEDIA_PROJECT_STORE_INVALID',
            `宣发视频工程 ${entry.name} 无法读取`,
            '修复或移走 .cclink-studio/media-projects 中损坏的工程后重试',
          )
        }
      }
      projects.sort((left, right) => right.updatedAt - left.updatedAt)
      return { success: true, projects }
    } catch (error) {
      return { success: false, projects: [], error: toFailure(error) }
    }
  }

  async get(workspacePath: string, projectId: string): Promise<MediaProjectOperationResult> {
    return this.enqueue(async () => {
      try {
        const workspace = await this.resolveWorkspace(workspacePath, false)
        const project = await this.readProject(workspace, projectId)
        if (
          project.narration?.generation?.status === 'running' &&
          !this.activeNarrations.has(`${workspace}:${projectId}`)
        ) {
          project.narration.generation = {
            ...project.narration.generation,
            status: 'interrupted',
            finishedAt: this.now(),
            error: '上次口播生成已中断。现有正文和候选保留，可手动重新生成。',
          }
          project.revision++
          project.updatedAt = this.now()
          await this.writeProject(workspace, project)
        }
        return { success: true, project }
      } catch (error) {
        return { success: false, error: toFailure(error) }
      }
    })
  }

  async create(input: CreateMediaProjectInput): Promise<MediaProjectOperationResult> {
    return this.enqueue(async () => {
      try {
        const workspacePath = await this.resolveWorkspace(input.workspacePath, true)
        const sourcePath = await this.resolveSource(workspacePath, input.sourcePath)
        const sourceStat = await stat(sourcePath)
        if (!sourceStat.isFile() || sourceStat.size > MAX_SOURCE_BYTES) {
          throw new MediaProjectServiceError(
            'MEDIA_PROJECT_SOURCE_UNAVAILABLE',
            '稿件不是可读取的 Markdown 文件，或文件超过 1 MB',
            '选择当前工作空间中较小的 Markdown 稿件后重试',
          )
        }
        const snapshot = await readFile(sourcePath, 'utf-8')
        if (!snapshot.trim()) {
          throw new MediaProjectServiceError(
            'MEDIA_PROJECT_SOURCE_UNAVAILABLE',
            '稿件内容为空',
            '先补充稿件内容后再创建宣发视频',
          )
        }
        const timestamp = this.now()
        const title = extractTitle(snapshot, sourcePath)
        const project: MediaProject = {
          schemaVersion: 1,
          id: randomUUID(),
          workspaceRef: { kind: 'local', path: workspacePath },
          revision: 1,
          title,
          source: { path: sourcePath, snapshot },
          brief: {
            platform: input.platform,
            aspectRatio: input.aspectRatio,
            targetDurationSeconds: input.targetDurationSeconds,
            brand: { primaryColor: '#5B8CFF', callToAction: '' },
          },
          scenes: createStoryboard(snapshot, title, input.targetDurationSeconds),
          narration: initialNarration([{ id: randomUUID(), text: '' }]),
          assets: [],
          renderSettings: {
            logoAssetId: null,
            musicAssetId: null,
            musicVolume: 0.18,
            transition: 'cut',
          },
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        const warnings = await this.writeProject(workspacePath, project)
        this.notifyChanged(workspacePath)
        return { success: true, project, warnings }
      } catch (error) {
        return { success: false, error: toFailure(error) }
      }
    })
  }

  async save(input: SaveMediaProjectInput): Promise<MediaProjectOperationResult> {
    return this.enqueue(async () => {
      try {
        const workspacePath = await this.resolveWorkspace(input.workspacePath, true)
        const current = await this.readProject(workspacePath, input.project.id)
        if (current.revision !== input.expectedRevision) {
          throw new MediaProjectServiceError(
            'MEDIA_PROJECT_REVISION_CONFLICT',
            '工程已在其他位置更新，没有覆盖较新的版本',
            '重新打开工程并合并修改后再保存',
          )
        }
        if (
          input.project.workspaceRef.path !== workspacePath ||
          input.project.source.path !== current.source.path ||
          input.project.source.snapshot !== current.source.snapshot ||
          input.project.createdAt !== current.createdAt
        ) {
          throw new MediaProjectServiceError(
            'MEDIA_PROJECT_INVALID',
            '工程身份或稿件快照不能通过编辑界面修改',
          )
        }
        const previousNarration =
          current.narration ??
          initialNarration(current.scenes.map((s) => ({ id: s.id, text: s.narration })))
        const incomingNarration = input.project.narration ?? previousNarration
        if (
          incomingNarration.appliedProposalId !== previousNarration.appliedProposalId &&
          incomingNarration.appliedProposalId !== null
        ) {
          if (
            incomingNarration.appliedProposalId !== previousNarration.proposal?.id ||
            previousNarration.proposal.baseNarrationRevision !== previousNarration.revision
          ) {
            throw new MediaProjectServiceError(
              'MEDIA_PROJECT_REVISION_CONFLICT',
              'AI 候选已过期，不能直接采用；请重新生成或手工修改',
            )
          }
        }
        const narrationChanged =
          narrationInputKey(previousNarration, current.brief) !==
          narrationInputKey(incomingNarration, input.project.brief)
        const narration = narrationScriptSchema.parse({
          ...incomingNarration,
          revision: previousNarration.revision + (narrationChanged ? 1 : 0),
          confirmedRevision: narrationChanged ? null : incomingNarration.confirmedRevision,
          proposal: previousNarration.proposal,
          generation: previousNarration.generation,
        })
        const project = parseMediaProject({
          ...input.project,
          narration,
          revision: current.revision + 1,
          updatedAt: this.now(),
          scenes: input.project.scenes.map((scene, order) => ({ ...scene, order })),
        })
        await this.mediaAssetService.validateProjectAssets(workspacePath, project)
        const warnings = await this.writeProject(workspacePath, project)
        this.notifyChanged(workspacePath)
        return { success: true, project, warnings }
      } catch (error) {
        return { success: false, error: toFailure(error) }
      }
    })
  }

  async flush(): Promise<void> {
    await this.mutationQueue.catch(() => undefined)
  }

  async generateNarration(
    input: GenerateNarrationInput,
    generate: (project: MediaProject, mode: GenerateNarrationInput['mode']) => Promise<string[]>,
  ): Promise<MediaProjectOperationResult> {
    let binding: string | null = null
    try {
      const started = await this.enqueue(async () => {
        const workspace = await this.resolveWorkspace(input.workspacePath, true)
        const current = await this.readProject(workspace, input.projectId)
        if (current.revision !== input.expectedRevision)
          throw new MediaProjectServiceError(
            'MEDIA_PROJECT_REVISION_CONFLICT',
            '工程已更新，请重新打开后生成口播',
          )
        const key = `${workspace}:${current.id}`
        if (this.activeNarrations.has(key))
          throw new MediaProjectServiceError(
            'MEDIA_PROJECT_INVALID',
            '此工程正在生成口播，请等待当前任务结束',
          )
        const narration =
          current.narration ??
          initialNarration(current.scenes.map((s) => ({ id: s.id, text: s.narration })))
        if (input.mode !== 'generate' && !narration.segments.some((s) => s.text.trim()))
          throw new MediaProjectServiceError('MEDIA_PROJECT_INVALID', '请先写入口播，再精简或改写')
        const project: MediaProject = {
          ...current,
          revision: current.revision + 1,
          updatedAt: this.now(),
          narration: {
            ...narration,
            generation: {
              id: randomUUID(),
              status: 'running',
              mode: input.mode,
              inputRevision: narration.revision,
              startedAt: this.now(),
              finishedAt: null,
              error: null,
            },
          },
        }
        await this.writeProject(workspace, project)
        binding = key
        this.activeNarrations.add(key)
        this.notifyChanged(workspace)
        return project
      })
      let segments: string[] | null = null
      try {
        segments = await generate(started, input.mode)
      } catch {
        /* Do not persist raw model errors or prompt content. */
      }
      return await this.enqueue(async () => {
        const workspace = await this.resolveWorkspace(input.workspacePath, true)
        const current = await this.readProject(workspace, input.projectId)
        const narration = current.narration!
        const task = started.narration!.generation!
        let proposal = narration.proposal
        if (segments) {
          try {
            proposal = narrationScriptSchema.parse({
              ...narration,
              proposal: {
                id: task.id,
                baseNarrationRevision: started.narration!.revision,
                segments: segments.map((text) => ({ id: randomUUID(), text })),
                createdAt: this.now(),
              },
            }).proposal
            if (proposal?.segments.some((s) => !s.text.trim())) segments = null
          } catch {
            segments = null
          }
        }
        const project = parseMediaProject({
          ...current,
          revision: current.revision + 1,
          updatedAt: this.now(),
          narration: {
            ...narration,
            proposal: segments ? proposal : narration.proposal,
            generation: {
              ...task,
              status: segments ? 'succeeded' : 'failed',
              finishedAt: this.now(),
              error: segments
                ? null
                : '未取得有效口播。请检查 Agent 配置与网络后重试，也可继续手写；原稿和现有口播未改变。',
            },
          },
        })
        const warnings = await this.writeProject(workspace, project)
        this.notifyChanged(workspace)
        return { success: true as const, project, warnings }
      })
    } catch (error) {
      return { success: false, error: toFailure(error) }
    } finally {
      if (binding) this.activeNarrations.delete(binding)
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(operation, operation)
    this.mutationQueue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  private async resolveWorkspace(workspacePath: string, writable: boolean): Promise<string> {
    const resolved = await this.workspaceStateService.resolveLocalWorkspace(workspacePath)
    if (!resolved.valid || !resolved.workspacePath) {
      throw new MediaProjectServiceError(
        'MEDIA_PROJECT_WORKSPACE_UNAVAILABLE',
        '当前本地工作空间不可用',
        '重新打开本地工作空间后重试',
      )
    }
    if (writable && !(await this.workspaceStateService.getLocalProjectId(resolved.workspacePath))) {
      throw new MediaProjectServiceError(
        'MEDIA_PROJECT_WORKSPACE_UNAVAILABLE',
        '当前工作空间不可写，无法保存宣发视频工程',
        '确认工作空间可写后重新打开',
      )
    }
    return resolved.workspacePath
  }

  private async resolveSource(workspacePath: string, sourcePath: string): Promise<string> {
    if (!['.md', '.markdown'].includes(extname(sourcePath).toLowerCase())) {
      throw new MediaProjectServiceError(
        'MEDIA_PROJECT_SOURCE_UNAVAILABLE',
        '首版只支持 Markdown 稿件',
      )
    }
    try {
      const [workspaceRealPath, sourceRealPath] = await Promise.all([
        realpath(workspacePath),
        realpath(resolve(sourcePath)),
      ])
      if (
        sourceRealPath !== workspaceRealPath &&
        !sourceRealPath.startsWith(`${workspaceRealPath}${sep}`)
      ) {
        throw new MediaProjectServiceError(
          'MEDIA_PROJECT_SOURCE_UNAVAILABLE',
          '稿件必须位于当前工作空间内',
        )
      }
      return sourceRealPath
    } catch (error) {
      if (error instanceof MediaProjectServiceError) throw error
      throw new MediaProjectServiceError(
        'MEDIA_PROJECT_SOURCE_UNAVAILABLE',
        '无法读取所选稿件',
        '确认文件仍存在且具有读取权限后重试',
      )
    }
  }

  private async readProject(workspacePath: string, projectId: string): Promise<MediaProject> {
    parseMediaProjectId(projectId)
    try {
      const project = parseMediaProject(
        JSON.parse(await readFile(projectFilePath(workspacePath, projectId), 'utf-8')),
      )
      if (project.id !== projectId || project.workspaceRef.path !== workspacePath) {
        throw new Error('工程身份或工作空间不匹配')
      }
      return project
    } catch (error) {
      if (isMissingFileError(error)) {
        throw new MediaProjectServiceError(
          'MEDIA_PROJECT_NOT_FOUND',
          '宣发视频工程不存在',
          '刷新生产侧栏后重试',
        )
      }
      if (error instanceof MediaProjectServiceError) throw error
      throw new MediaProjectServiceError(
        'MEDIA_PROJECT_STORE_INVALID',
        '宣发视频工程不可读取',
        '检查工作空间中的工程定义文件后重试',
      )
    }
  }

  private async writeProject(workspacePath: string, project: MediaProject): Promise<string[]> {
    const directory = join(projectsDirectory(workspacePath), project.id)
    const filePath = projectFilePath(workspacePath, project.id)
    const tempPath = `${filePath}.${process.pid}.tmp`
    try {
      await mkdir(directory, { recursive: true })
      await writeFile(tempPath, `${JSON.stringify(project, null, 2)}\n`, 'utf-8')
      await rename(tempPath, filePath)
      // Readable projection only; the atomic JSON above is the sole authority.
      if (project.narration) {
        try {
          const scriptDirectory = join(directory, 'script')
          await mkdir(scriptDirectory, { recursive: true })
          const markdownPath = join(scriptDirectory, 'narration.md')
          await writeFile(
            `${markdownPath}.tmp`,
            `# ${project.title}\n\n> 口播版本 ${project.narration.revision} · ${project.narration.confirmedRevision === project.narration.revision ? '已确认' : '待确认'}\n> 可读副本；请在 Studio 编辑正文，外部修改不会自动导入。\n\n${project.narration.segments.map((s) => s.text).join('\n\n')}\n`,
            'utf-8',
          )
          await rename(`${markdownPath}.tmp`, markdownPath)
        } catch {
          console.warn('[MediaProjectService] 口播可读副本写入失败；工程 JSON 已保存')
          return ['工程 JSON 已保存，但口播 Markdown 副本写入失败；修复目录权限后再次保存可重建。']
        }
      }
      return []
    } catch (error) {
      console.error('[MediaProjectService] 工程写入失败:', error)
      throw new MediaProjectServiceError(
        'MEDIA_PROJECT_WRITE_FAILED',
        '宣发视频工程写入失败',
        '确认工作空间可写且磁盘空间充足后重试',
      )
    }
  }

  private notifyChanged(workspacePath: string): void {
    for (const listener of this.changeListeners) listener(workspacePath)
  }
}

function projectsDirectory(workspacePath: string): string {
  return join(workspacePath, MEDIA_PROJECT_DIRECTORY)
}

function projectFilePath(workspacePath: string, projectId: string): string {
  return join(projectsDirectory(workspacePath), projectId, 'project.json')
}

function toSummary(project: MediaProject): MediaProjectSummary {
  return {
    id: project.id,
    title: project.title,
    sourcePath: project.source.path,
    aspectRatio: project.brief.aspectRatio,
    targetDurationSeconds: project.brief.targetDurationSeconds,
    sceneCount: project.scenes.length,
    ...(project.narration
      ? { narrationSegmentCount: project.narration.segments.filter((s) => s.text.trim()).length }
      : {}),
    revision: project.revision,
    updatedAt: project.updatedAt,
  }
}

function extractTitle(markdown: string, sourcePath: string): string {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim()
  return (heading || basename(sourcePath, extname(sourcePath))).slice(0, 120)
}

function createStoryboard(
  markdown: string,
  title: string,
  targetDurationSeconds: number,
): MediaProjectScene[] {
  const desiredCount = Math.max(4, Math.min(8, Math.round(targetDurationSeconds / 6)))
  const sourceSegments = markdownToSegments(markdown)
  const segments = distributeSegments(sourceSegments, desiredCount, title)
  const duration = Math.round((targetDurationSeconds / segments.length) * 10) / 10
  return segments.map((narration, order) => {
    const keywords = extractKeywords(narration, title)
    return {
      id: randomUUID(),
      order,
      durationSeconds: duration,
      narration,
      subtitle: createSceneSubtitle(narration, title, order),
      visualDescription:
        order === 0
          ? `用清晰的开场画面介绍「${title}」`
          : `用产品画面、真实场景或信息图表达：${narration.slice(0, 100)}`,
      searchTerms: keywords,
      generationPrompt: `宣发视频镜头，${keywords.join('，')}，画面简洁，品牌感，避免画面文字`,
      materialKind: 'unassigned',
    }
  })
}

function createSceneSubtitle(narration: string, title: string, order: number): string {
  const source = (order === 0 ? title : narration).replace(/\s+/g, ' ').trim()
  if (source.length <= DEFAULT_SUBTITLE_MAX_CHARACTERS) return source
  const sentence = source
    .split(/(?<=[。！？!?])/u)
    .find((value) => value.trim().length >= 8)
    ?.trim()
  const candidate = sentence || source
  if (candidate.length <= DEFAULT_SUBTITLE_MAX_CHARACTERS) return candidate
  const prefix = candidate.slice(0, DEFAULT_SUBTITLE_MAX_CHARACTERS)
  const punctuation = Math.max(
    prefix.lastIndexOf('，'),
    prefix.lastIndexOf(','),
    prefix.lastIndexOf('；'),
    prefix.lastIndexOf(';'),
    prefix.lastIndexOf('：'),
    prefix.lastIndexOf(':'),
  )
  return `${prefix.slice(0, punctuation >= 12 ? punctuation : DEFAULT_SUBTITLE_MAX_CHARACTERS).trim()}…`
}

function markdownToSegments(markdown: string): string[] {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .split(/\n{2,}|(?<=[。！？!?])\s*/u)
    .map((value) =>
      value
        .replace(/[*_`>#]/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((value) => value.length >= 2)
}

function distributeSegments(source: string[], count: number, title: string): string[] {
  const segments = source.length > 0 ? source : [title]
  if (segments.length >= count) {
    const groups = Array.from({ length: count }, () => [] as string[])
    segments.forEach((segment, index) => {
      groups[Math.min(count - 1, Math.floor((index * count) / segments.length))].push(segment)
    })
    return groups.map((group) => group.join(' ').slice(0, 1200))
  }
  const output = [...segments]
  const fallbacks = [
    `开场提出「${title}」带来的核心价值。`,
    `展示「${title}」解决问题的真实使用场景。`,
    `突出「${title}」最值得记住的产品能力。`,
    `用明确行动号召结束「${title}」的介绍。`,
  ]
  while (output.length < count) output.push(fallbacks[output.length % fallbacks.length])
  return output.slice(0, count)
}

function extractKeywords(text: string, title: string): string[] {
  const latin = text.match(/[A-Za-z][A-Za-z0-9_-]{2,}/g) ?? []
  const chinese = text.match(/[\p{Script=Han}]{2,8}/gu) ?? []
  return Array.from(new Set([title, ...latin, ...chinese])).slice(0, 5)
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

function toFailure(error: unknown): MediaProjectFailure {
  if (error instanceof MediaProjectServiceError) {
    return { code: error.code, message: error.message, recovery: error.recovery }
  }
  console.error('[MediaProjectService] 未分类错误:', error)
  return {
    code: 'MEDIA_PROJECT_STORE_INVALID',
    message: '宣发视频工程操作失败',
    recovery: '查看诊断信息并重试',
  }
}
