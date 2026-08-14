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

const MEDIA_PROJECT_DIRECTORY = join('.cclink-studio', 'media-projects')
const MAX_SOURCE_BYTES = 1_000_000

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
  private mutationQueue: Promise<unknown> = Promise.resolve()
  private readonly changeListeners = new Set<(workspacePath: string) => void>()

  constructor(
    private readonly workspaceStateService: WorkspaceStateService,
    private readonly now: () => number = Date.now,
  ) {}

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
    try {
      const workspace = await this.resolveWorkspace(workspacePath, false)
      return { success: true, project: await this.readProject(workspace, projectId) }
    } catch (error) {
      return { success: false, error: toFailure(error) }
    }
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
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        await this.writeProject(workspacePath, project)
        this.notifyChanged(workspacePath)
        return { success: true, project }
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
        const project = parseMediaProject({
          ...input.project,
          revision: current.revision + 1,
          updatedAt: this.now(),
          scenes: input.project.scenes.map((scene, order) => ({ ...scene, order })),
        })
        await this.writeProject(workspacePath, project)
        this.notifyChanged(workspacePath)
        return { success: true, project }
      } catch (error) {
        return { success: false, error: toFailure(error) }
      }
    })
  }

  async flush(): Promise<void> {
    await this.mutationQueue.catch(() => undefined)
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

  private async writeProject(workspacePath: string, project: MediaProject): Promise<void> {
    const directory = join(projectsDirectory(workspacePath), project.id)
    const filePath = projectFilePath(workspacePath, project.id)
    const tempPath = `${filePath}.${process.pid}.tmp`
    try {
      await mkdir(directory, { recursive: true })
      await writeFile(tempPath, `${JSON.stringify(project, null, 2)}\n`, 'utf-8')
      await rename(tempPath, filePath)
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
      subtitle: narration.slice(0, 80),
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
