import { randomUUID } from 'node:crypto'
import { extname } from 'node:path'
import type {
  AddMediaSearchCandidateInput,
  MediaProjectAssetImportResult,
  MediaSearchCandidate,
  MediaSearchResult,
  SearchMediaAssetsInput,
} from '../../shared/media-production/media-project-types'
import type { MediaAssetService } from './media-asset-service'

const PEXELS_API_BASE = 'https://api.pexels.com/v1/'
const MAX_DOWNLOAD_BYTES = 150 * 1024 * 1024
const CANDIDATE_TTL_MS = 30 * 60_000
const LICENSE_SUMMARY = 'Pexels 内容；需保留 Pexels 链接并尽可能署名作者，使用时遵守 Pexels 条款。'

interface StoredCandidate extends MediaSearchCandidate {
  downloadUrl: string
  mimeType: string
  extension: string
  expiresAt: number
}

interface MediaSearchDependencies {
  fetch: typeof fetch
  now: () => number
}

const DEFAULT_DEPENDENCIES: MediaSearchDependencies = { fetch, now: Date.now }

export class MediaSearchService {
  private readonly candidates = new Map<string, StoredCandidate>()

  constructor(
    private readonly assetService: MediaAssetService,
    private readonly getPexelsApiKey: () => string,
    private readonly dependencies: MediaSearchDependencies = DEFAULT_DEPENDENCIES,
  ) {}

  async search(input: SearchMediaAssetsInput): Promise<MediaSearchResult> {
    const apiKey = this.getPexelsApiKey().trim()
    if (!apiKey) return unavailable('请先在设置中配置 Pexels API Key')
    this.pruneCandidates()
    const url = new URL(input.kind === 'image' ? 'search' : 'videos/search', PEXELS_API_BASE)
    url.searchParams.set('query', input.query)
    url.searchParams.set('orientation', orientationFor(input.orientation))
    url.searchParams.set('page', String(input.page ?? 1))
    url.searchParams.set('per_page', '12')
    try {
      const response = await this.dependencies.fetch(url, {
        headers: { Authorization: apiKey },
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
      })
      const text = await response.text()
      if (!response.ok) throw new Error(`Pexels API 请求失败 (${response.status})`)
      const root = parseRecord(JSON.parse(text), 'Pexels 返回无效')
      const rawItems = input.kind === 'image' ? root.photos : root.videos
      if (!Array.isArray(rawItems)) throw new Error('Pexels 返回的素材列表无效')
      const stored = rawItems.flatMap((item) => {
        const parsed = input.kind === 'image' ? parsePhoto(item) : parseVideo(item)
        if (!parsed) return []
        const candidate: StoredCandidate = {
          ...parsed,
          id: randomUUID(),
          provider: 'pexels',
          licenseSummary: LICENSE_SUMMARY,
          expiresAt: this.dependencies.now() + CANDIDATE_TTL_MS,
        }
        this.candidates.set(candidate.id, candidate)
        return [candidate]
      })
      const page = typeof root.page === 'number' ? root.page : (input.page ?? 1)
      return {
        success: true,
        provider: 'pexels',
        configured: true,
        candidates: stored.map(stripPrivateCandidateFields),
        page,
        hasMore: typeof root.next_page === 'string' && root.next_page.length > 0,
      }
    } catch (error) {
      return {
        success: false,
        provider: 'pexels',
        configured: true,
        candidates: [],
        error: {
          code: 'MEDIA_PROJECT_SEARCH_FAILED',
          message: error instanceof Error ? error.message : 'Pexels 素材搜索失败',
          recovery: '检查网络、Key 和限流状态；本地素材与图片生成仍可使用',
        },
      }
    }
  }

  async addCandidate(input: AddMediaSearchCandidateInput): Promise<MediaProjectAssetImportResult> {
    this.pruneCandidates()
    const candidate = this.candidates.get(input.candidateId)
    if (!candidate) {
      return {
        success: false,
        error: {
          code: 'MEDIA_PROJECT_SEARCH_FAILED',
          message: '搜索候选已过期或不存在',
          recovery: '重新搜索后再添加素材',
        },
      }
    }
    try {
      const url = new URL(candidate.downloadUrl)
      if (!isTrustedPexelsAssetHost(url.hostname)) throw new Error('Pexels 下载地址不受信任')
      const response = await this.dependencies.fetch(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(60_000),
      })
      if (!response.ok) throw new Error(`素材下载失败 (${response.status})`)
      const content = await readBoundedBody(response, MAX_DOWNLOAD_BYTES)
      const asset = await this.assetService.storeSearchAsset({
        workspacePath: input.workspacePath,
        projectId: input.projectId,
        content,
        extension: candidate.extension,
        kind: candidate.kind,
        mimeType: candidate.mimeType,
        fileName: `pexels-${candidate.id}${candidate.extension}`,
        provider: candidate.provider,
        remoteId: candidate.sourceUrl.split('/').filter(Boolean).at(-1) ?? candidate.id,
        sourceUrl: candidate.sourceUrl,
        author: candidate.author,
        authorUrl: candidate.authorUrl,
        licenseSummary: candidate.licenseSummary,
      })
      return { success: true, asset }
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'MEDIA_PROJECT_SEARCH_FAILED',
          message: error instanceof Error ? error.message : '搜索素材下载失败',
          recovery: '重新搜索或选择其他候选；不会影响已有工程素材',
        },
      }
    }
  }

  private pruneCandidates(): void {
    const now = this.dependencies.now()
    for (const [id, candidate] of this.candidates) {
      if (candidate.expiresAt <= now) this.candidates.delete(id)
    }
  }
}

function parsePhoto(
  value: unknown,
): Omit<StoredCandidate, 'id' | 'provider' | 'licenseSummary' | 'expiresAt'> | null {
  const photo = parseRecord(value, 'Pexels 图片无效')
  const src = parseRecord(photo.src, 'Pexels 图片地址无效')
  const downloadUrl =
    stringValue(src.large2x) || stringValue(src.large) || stringValue(src.original)
  const sourceUrl = stringValue(photo.url)
  const author = stringValue(photo.photographer)
  const authorUrl = stringValue(photo.photographer_url)
  const thumbnailUrl = stringValue(src.medium) || downloadUrl
  if (!downloadUrl || !sourceUrl || !author || !authorUrl || !thumbnailUrl) return null
  return {
    kind: 'image',
    thumbnailUrl,
    sourceUrl,
    author,
    authorUrl,
    width: positiveNumber(photo.width),
    height: positiveNumber(photo.height),
    downloadUrl,
    mimeType: 'image/jpeg',
    extension: '.jpg',
  }
}

function parseVideo(
  value: unknown,
): Omit<StoredCandidate, 'id' | 'provider' | 'licenseSummary' | 'expiresAt'> | null {
  const video = parseRecord(value, 'Pexels 视频无效')
  const user = parseRecord(video.user, 'Pexels 视频作者无效')
  const pictures = Array.isArray(video.video_pictures) ? video.video_pictures : []
  const files = (Array.isArray(video.video_files) ? video.video_files : [])
    .map((file) => parseRecord(file, 'Pexels 视频文件无效'))
    .filter(
      (file) => stringValue(file.file_type) === 'video/mp4' && Boolean(stringValue(file.link)),
    )
    .sort((left, right) => positiveNumber(right.width) - positiveNumber(left.width))
  const file = files.find((item) => positiveNumber(item.width) <= 1920) ?? files.at(-1)
  const downloadUrl = file ? stringValue(file.link) : ''
  const sourceUrl = stringValue(video.url)
  const author = stringValue(user.name)
  const authorUrl = stringValue(user.url)
  const thumbnail = pictures[0]
    ? stringValue(parseRecord(pictures[0], 'Pexels 封面无效').picture)
    : ''
  if (!downloadUrl || !sourceUrl || !author || !authorUrl || !thumbnail) return null
  return {
    kind: 'video',
    thumbnailUrl: thumbnail,
    sourceUrl,
    author,
    authorUrl,
    width: positiveNumber(video.width),
    height: positiveNumber(video.height),
    durationSeconds: positiveNumber(video.duration),
    downloadUrl,
    mimeType: 'video/mp4',
    extension: extname(new URL(downloadUrl).pathname) || '.mp4',
  }
}

function stripPrivateCandidateFields(candidate: StoredCandidate): MediaSearchCandidate {
  const {
    downloadUrl: _downloadUrl,
    mimeType: _mimeType,
    extension: _extension,
    expiresAt: _expiresAt,
    ...publicCandidate
  } = candidate
  return publicCandidate
}

async function readBoundedBody(response: Response, limit: number): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (declared > limit) throw new Error('搜索素材超过 150 MB 下载上限')
  if (!response.body) throw new Error('搜索素材响应没有内容')
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk)
    total += buffer.length
    if (total > limit) throw new Error('搜索素材超过 150 MB 下载上限')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

function orientationFor(ratio: SearchMediaAssetsInput['orientation']): string {
  if (ratio === '1:1') return 'square'
  return ratio === '9:16' ? 'portrait' : 'landscape'
}

function isTrustedPexelsAssetHost(hostname: string): boolean {
  return hostname === 'images.pexels.com' || hostname === 'videos.pexels.com'
}

function parseRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message)
  return value as Record<string, unknown>
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function positiveNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1
}

function unavailable(message: string): MediaSearchResult {
  return {
    success: false,
    provider: 'pexels',
    configured: false,
    candidates: [],
    error: {
      code: 'MEDIA_PROJECT_SEARCH_PROVIDER_UNAVAILABLE',
      message,
      recovery: '本地导入与图片生成仍可使用',
    },
  }
}
