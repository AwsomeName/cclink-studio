import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import {
  collectMarkdownDestinations,
  decodeMarkdownPath,
  isExternalMarkdownDestination,
  splitMarkdownDestinationSuffix,
} from '../../shared/markdown-document'
import type { FileService } from '../fs/file-service'
import type { WebAffairService } from '../web-affairs/web-affair-service'
import type {
  ArticlePublishingAsset,
  ArticlePublishingSourcePreview,
  CreateArticlePublishingTaskInput,
  InspectArticlePublishingSourceInput,
  ReportArticlePublishingAssetInput,
  ReportArticlePublishingCheckpointInput,
  StartArticlePublishingTaskInput,
  StartArticlePublishingTaskResult,
} from '../../shared/article-publishing/article-publishing-types'
import {
  createArticlePublishingTaskInputSchema,
  inspectArticlePublishingSourceInputSchema,
  reportArticlePublishingAssetInputSchema,
  reportArticlePublishingCheckpointInputSchema,
  startArticlePublishingTaskInputSchema,
} from '../../shared/article-publishing/article-publishing-schema'
import type {
  WebAffairOperationResult,
  WebAffairProjectSnapshot,
} from '../../shared/web-affairs/web-affair-types'

const MAX_SOURCE_BYTES = 10 * 1024 * 1024
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const SUPPORTED_IMAGE_TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
])

interface ImageReference {
  destination: string
  start: number
  end: number
  alt: string
}

export class ArticlePublishingService {
  constructor(
    private readonly fileService: FileService,
    private readonly webAffairService: WebAffairService,
    private readonly resolveRealPath: (path: string) => Promise<string> = realpath,
  ) {}

  async inspectSource(
    rawInput: InspectArticlePublishingSourceInput,
  ): Promise<WebAffairOperationResult<ArticlePublishingSourcePreview>> {
    const parsed = inspectArticlePublishingSourceInputSchema.safeParse(rawInput)
    if (!parsed.success || parsed.data.workspaceRef.kind !== 'local') {
      return invalid('请先在本地工作空间选择 Markdown')
    }
    try {
      return {
        success: true,
        data: await this.buildPreview(parsed.data.markdownPath, parsed.data.workspaceRef.path),
      }
    } catch (error) {
      return invalid(error instanceof Error ? error.message : String(error))
    }
  }

  async createTask(
    rawInput: CreateArticlePublishingTaskInput,
    workspaceId: string,
  ): Promise<
    WebAffairOperationResult<import('../../shared/web-affairs/web-affair-types').WebAffair>
  > {
    const parsed = createArticlePublishingTaskInputSchema.safeParse(rawInput)
    if (!parsed.success || parsed.data.workspaceRef.kind !== 'local') {
      return invalid('文章发布草稿参数无效')
    }
    const previewResult = await this.inspectSource({
      workspaceRef: parsed.data.workspaceRef,
      markdownPath: parsed.data.markdownPath,
    })
    if (!previewResult.success) return previewResult
    if (previewResult.data.blockers.length > 0) {
      return invalid(previewResult.data.blockers.join('；'))
    }
    return this.webAffairService.createArticlePublishingAffair(
      {
        preview: previewResult.data,
        accountId: parsed.data.accountId,
        fields: parsed.data.fields,
        workspaceRef: parsed.data.workspaceRef,
      },
      workspaceId,
    )
  }

  async startTask(
    rawInput: StartArticlePublishingTaskInput,
    workspaceId: string,
  ): Promise<WebAffairOperationResult<StartArticlePublishingTaskResult>> {
    const parsed = startArticlePublishingTaskInputSchema.safeParse(rawInput)
    if (!parsed.success || parsed.data.workspaceRef.kind !== 'local') {
      return invalid('启动文章发布参数无效')
    }
    const snapshot = this.webAffairService.getProjectSnapshot(workspaceId)
    if (!snapshot.success) return snapshot
    const affair = snapshot.data.affairs.find(
      (item) => item.id === parsed.data.affairId && item.kind === 'article-publishing',
    )
    const publishing = affair?.articlePublishing
    if (!affair || !publishing) return notFound('文章发布事务不存在')
    const preview = await this.buildPreview(
      publishing.source.markdownPath,
      parsed.data.workspaceRef.path,
    ).catch(() => null)
    if (!preview || preview.source.contentHash !== publishing.source.contentHash) {
      return invalid('源 Markdown 已变化，不能恢复旧 Attempt；请以新内容创建发布任务')
    }
    const currentHashes = preview.assets.map((asset) => asset.contentHash).sort()
    const frozenHashes = publishing.assets.map((asset) => asset.contentHash).sort()
    if (JSON.stringify(currentHashes) !== JSON.stringify(frozenHashes)) {
      return invalid('正文图片已变化，不能恢复旧 Attempt；请重新创建发布任务')
    }

    const currentAttempt = publishing.execution.currentAttemptId
      ? affair.attempts.find((attempt) => attempt.id === publishing.execution.currentAttemptId)
      : undefined
    let result
    let resumed = false
    if (currentAttempt?.status === 'interrupted') {
      result = await this.webAffairService.resumeArticlePublishingAttempt(
        affair.id,
        currentAttempt.id,
        workspaceId,
      )
      resumed = true
    } else if (currentAttempt && publishing.execution.status === 'waiting-human') {
      result = await this.webAffairService.resumeArticlePublishingAfterHandoff(
        affair.id,
        currentAttempt.id,
        workspaceId,
      )
      resumed = true
    } else if (
      currentAttempt &&
      !['failed', 'cancelled', 'succeeded'].includes(currentAttempt.status)
    ) {
      return invalid('当前发布 Attempt 已经在运行或等待处理')
    } else {
      result = await this.webAffairService.startAttempt(
        {
          workspaceRef: parsed.data.workspaceRef,
          affairId: affair.id,
          nodeId: affair.flow.nodes[0].id,
          accountId: publishing.accountId,
        },
        workspaceId,
      )
    }
    if (!result.success) return result
    const attempt = resumed
      ? result.data.attempts.find((item) => item.id === currentAttempt?.id)
      : result.data.attempts[result.data.attempts.length - 1]
    if (!attempt) return invalid('发布 Attempt 创建失败')
    const marked = await this.webAffairService.markArticlePublishingAttemptStarted(
      affair.id,
      attempt.id,
      workspaceId,
    )
    if (!marked.success) return marked
    return {
      success: true,
      data: {
        affair: marked.data,
        attemptId: attempt.id,
        resumed,
        agentPrompt: buildAgentPrompt(marked.data, attempt.id),
      },
    }
  }

  reportCheckpoint(input: ReportArticlePublishingCheckpointInput, workspaceId: string) {
    const parsed = reportArticlePublishingCheckpointInputSchema.safeParse(input)
    if (!parsed.success) return Promise.resolve(invalid('文章发布检查点参数无效'))
    return this.webAffairService.reportArticlePublishingCheckpoint(parsed.data, workspaceId)
  }

  reportAsset(input: ReportArticlePublishingAssetInput, workspaceId: string) {
    const parsed = reportArticlePublishingAssetInputSchema.safeParse(input)
    if (!parsed.success) return Promise.resolve(invalid('正文图片状态参数无效'))
    return this.webAffairService.reportArticlePublishingAsset(parsed.data, workspaceId)
  }

  private async buildPreview(
    markdownPath: string,
    workspacePath: string,
  ): Promise<ArticlePublishingSourcePreview> {
    if (!/\.(?:md|markdown)$/iu.test(markdownPath)) throw new Error('只支持 Markdown 文件')
    const [realWorkspacePath, realMarkdownPath] = await Promise.all([
      this.resolveRealPath(workspacePath),
      this.resolveRealPath(markdownPath),
    ])
    if (!isPathWithin(realWorkspacePath, realMarkdownPath)) {
      throw new Error('Markdown 必须位于当前工作空间内')
    }
    const snapshot = await this.fileService.readTextDocument(realMarkdownPath)
    if (snapshot.size > MAX_SOURCE_BYTES) throw new Error('Markdown 超过 10MB 限制')
    const blockers: string[] = []
    const warnings: string[] = []
    const byIdentity = new Map<string, ArticlePublishingAsset>()
    for (const reference of collectImageReferences(snapshot.content)) {
      if (isExternalMarkdownDestination(reference.destination)) {
        const hash = sha256(reference.destination)
        const current = byIdentity.get(`remote:${reference.destination}`)
        const occurrence = { start: reference.start, end: reference.end, alt: reference.alt }
        if (current) current.occurrences.push(occurrence)
        else {
          byIdentity.set(`remote:${reference.destination}`, {
            id: stableAssetId(hash),
            kind: 'remote',
            sourcePath: reference.destination,
            displayPath: reference.destination,
            contentHash: hash,
            occurrences: [occurrence],
            status: 'uploaded',
            platformUrl: reference.destination,
            uploadAttempts: [],
          })
        }
        warnings.push(`外链图片不会转存：${reference.destination}`)
        continue
      }
      const rawPath = splitMarkdownDestinationSuffix(reference.destination).path
      const absolutePath = resolve(dirname(realMarkdownPath), decodeMarkdownPath(rawPath))
      const extension = extname(absolutePath).toLowerCase()
      const mediaType = SUPPORTED_IMAGE_TYPES.get(extension)
      if (!mediaType) {
        blockers.push(`不支持的图片格式：${rawPath}`)
        continue
      }
      try {
        const realAssetPath = await this.resolveRealPath(absolutePath)
        if (!isPathWithin(realWorkspacePath, realAssetPath)) {
          blockers.push(`图片超出当前工作空间：${rawPath}`)
          continue
        }
        const [metadata, file] = await Promise.all([
          this.fileService.stat(realAssetPath),
          this.fileService.readFile(realAssetPath),
        ])
        if (metadata.type !== 'file') throw new Error('图片路径不是文件')
        if (metadata.size > MAX_IMAGE_BYTES) {
          blockers.push(`图片超过 20MB：${rawPath}`)
          continue
        }
        const contentHash = createHash('sha256')
          .update(Buffer.from(file.content, 'base64'))
          .digest('hex')
        const identity = `local:${contentHash}`
        const occurrence = { start: reference.start, end: reference.end, alt: reference.alt }
        const current = byIdentity.get(identity)
        if (current) current.occurrences.push(occurrence)
        else {
          byIdentity.set(identity, {
            id: stableAssetId(contentHash),
            kind: 'local',
            sourcePath: realAssetPath,
            displayPath:
              relative(dirname(realMarkdownPath), realAssetPath) || basename(realAssetPath),
            contentHash,
            mediaType,
            size: metadata.size,
            occurrences: [occurrence],
            status: 'pending',
            uploadAttempts: [],
          })
        }
      } catch (error) {
        blockers.push(
          `图片不可用：${rawPath}（${error instanceof Error ? error.message : String(error)}）`,
        )
      }
    }
    return {
      source: {
        markdownPath: snapshot.path,
        contentHash: snapshot.hash,
        modifiedAt: snapshot.modifiedAt,
        size: snapshot.size,
      },
      title: extractTitle(snapshot.content, markdownPath),
      summary: extractSummary(snapshot.content),
      assets: [...byIdentity.values()],
      blockers: [...new Set(blockers)],
      warnings: [...new Set(warnings)],
    }
  }
}

function collectImageReferences(markdown: string): ImageReference[] {
  const references: ImageReference[] = collectMarkdownDestinations(markdown)
    .filter((destination) => destination.image)
    .map((destination) => ({
      destination: destination.value,
      start: destination.start,
      end: destination.end,
      alt: extractInlineAlt(markdown, destination.start),
    }))
  const definitions = new Map<string, string>()
  for (const match of markdown.matchAll(
    /^ {0,3}\[([^\n\x5d]+)\]:\s*(?:<([^>\n]+)>|([^\s\n]+))/gimu,
  )) {
    definitions.set(match[1].trim().toLowerCase(), match[2] ?? match[3] ?? '')
  }
  for (const match of markdown.matchAll(/!\[([^\n\x5d]*)\]\[([^\n\x5d]+)\]/gu)) {
    const destination = definitions.get(match[2].trim().toLowerCase())
    if (!destination) continue
    references.push({
      destination,
      start: match.index,
      end: match.index + match[0].length,
      alt: match[1],
    })
  }
  for (const match of markdown.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/giu)) {
    const alt = /\balt\s*=\s*["']([^"']*)["']/iu.exec(match[0])?.[1] ?? ''
    references.push({
      destination: match[1],
      start: match.index,
      end: match.index + match[0].length,
      alt,
    })
  }
  return references.sort((left, right) => left.start - right.start)
}

function extractInlineAlt(markdown: string, destinationStart: number): string {
  const prefix = markdown.slice(Math.max(0, destinationStart - 1_000), destinationStart)
  return /!\[([^\n\x5d]*)\]\(\s*(?:<)?[^\n]*$/u.exec(prefix)?.[1] ?? ''
}

function extractTitle(markdown: string, markdownPath: string): string {
  const frontmatter = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/u.exec(markdown)?.[1]
  const frontmatterTitle = frontmatter
    ? /^title:\s*["']?(.+?)["']?\s*$/imu.exec(frontmatter)?.[1]?.trim()
    : undefined
  const heading = /^#\s+(.+)$/mu.exec(markdown)?.[1]?.trim()
  return frontmatterTitle || heading || basename(markdownPath).replace(/\.(?:md|markdown)$/iu, '')
}

function extractSummary(markdown: string): string {
  const body = markdown.replace(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/u, '')
  return (
    body
      .split(/\n\s*\n/u)
      .map((paragraph) =>
        paragraph
          .replace(/^#+\s+/u, '')
          .replace(/!\[[^\x5d]*\]\([^)]*\)/gu, '')
          .trim(),
      )
      .find((paragraph) => paragraph && !paragraph.startsWith('```')) ?? ''
  ).slice(0, 500)
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function stableAssetId(contentHash: string): string {
  const value = contentHash.slice(0, 32).split('')
  value[12] = '4'
  value[16] = '8'
  const hex = value.join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function isPathWithin(rootPath: string, targetPath: string): boolean {
  const relativePath = relative(rootPath, targetPath)
  return (
    relativePath === '' ||
    (!relativePath.startsWith(`..${sep}`) && relativePath !== '..' && !isAbsolute(relativePath))
  )
}

function buildAgentPrompt(
  affair: import('../../shared/web-affairs/web-affair-types').WebAffair,
  attemptId: string,
): string {
  const publishing = affair.articlePublishing!
  const localAssets = publishing.assets.filter((asset) => asset.kind === 'local')
  const firstIncomplete = publishing.checkpoints.find(
    (checkpoint) => checkpoint.status !== 'completed',
  )
  return [
    `执行一条已由用户在 Studio 明确启动的 CSDN 单篇文章发布事务。`,
    `affairId=${affair.id}`,
    `attemptId=${attemptId}`,
    `accountId=${publishing.accountId}`,
    `sourceMarkdownPath=${publishing.source.markdownPath}`,
    `从检查点 ${firstIncomplete?.stepId ?? 'verify-publication'} 开始；已完成检查点和已核验图片不得重放。`,
    `先调用 web_account_open，并同时传入 accountId、affairId、attemptId，使 BrowserTask 绑定本发布事务；再调用 web_affair_get 读取冻结状态。`,
    `图片共有 ${localAssets.length} 张。每张上传必须依次报告 uploading、waiting-platform、verifying；只有重新读取编辑器取得平台 URL 和页面证据后才能报告 uploaded。`,
    `文章发布动作由主进程根据当前事务、步骤、账号、页面和适配器三态核验；普通“确认上传”和已授权的单篇常规发布可继续，人工专属或未知动作会自动暂停。`,
    `单图最多 3 次安全尝试；派发后结果不明必须报告 result-unknown 并先对账，禁止盲目重复上传。`,
    `验证码、风控、法律/版权声明、账号或内容不一致、未知页面必须暂停给用户。`,
    `发布动作派发后必须立即进入结果核验；断线或证据不足只报告 result-unknown，禁止再次点击发布。`,
  ].join('\n')
}

function invalid<T>(message: string): WebAffairOperationResult<T> {
  return { success: false, error: { code: 'INVALID_INPUT', message } }
}

function notFound<T>(message: string): WebAffairOperationResult<T> {
  return { success: false, error: { code: 'NOT_FOUND', message } }
}

export function articlePublishingAffairs(snapshot: WebAffairProjectSnapshot) {
  return snapshot.affairs.filter(
    (affair) => affair.kind === 'article-publishing' && Boolean(affair.articlePublishing),
  )
}
