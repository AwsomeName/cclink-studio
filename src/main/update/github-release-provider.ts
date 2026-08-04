import { z } from 'zod'
import { parseUpdateManifest, type UpdateArchitecture } from '../../shared/update'
import {
  parseUpdateProviderCheckResult,
  type ResolvedUpdateAsset,
  type UpdateProvider,
  type UpdateProviderCheckInput,
  type UpdateProviderCheckResult,
} from './update-provider'
import { compareStableVersions } from './version'

const stableTagPattern = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const MAX_RELEASE_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_MANIFEST_RESPONSE_BYTES = 1024 * 1024

const githubAssetSchema = z
  .object({
    name: z.string().min(1).max(255),
    size: z
      .number()
      .int()
      .positive()
      .max(8 * 1024 * 1024 * 1024),
    browser_download_url: z.string().url(),
  })
  .passthrough()

const githubReleaseSchema = z
  .object({
    tag_name: z.string().min(1).max(128),
    draft: z.boolean(),
    prerelease: z.boolean(),
    published_at: z.string().datetime({ offset: true }).nullable(),
    body: z.string().nullable(),
    assets: z.array(githubAssetSchema).max(100),
  })
  .passthrough()

const githubReleaseListSchema = z.array(githubReleaseSchema).max(100)

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

export class UpdateProviderRequestError extends Error {
  constructor(
    readonly kind:
      | 'network_offline'
      | 'network_timeout'
      | 'provider_unavailable'
      | 'release_invalid'
      | 'manifest_invalid',
    message: string,
  ) {
    super(message)
    this.name = 'UpdateProviderRequestError'
  }
}

export interface GitHubReleaseProviderOptions {
  owner?: string
  repository?: string
  fetch?: FetchLike
  requestTimeoutMs?: number
}

export class GitHubReleaseProvider implements UpdateProvider {
  readonly id = 'github-release'
  private readonly owner: string
  private readonly repository: string
  private readonly fetchImpl: FetchLike
  private readonly requestTimeoutMs: number

  constructor(options: GitHubReleaseProviderOptions = {}) {
    this.owner = options.owner ?? 'AwsomeName'
    this.repository = options.repository ?? 'cclink-studio'
    this.fetchImpl = options.fetch ?? globalThis.fetch
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000
  }

  async check(input: UpdateProviderCheckInput): Promise<UpdateProviderCheckResult> {
    const releases = await this.fetchJson(
      `https://api.github.com/repos/${this.owner}/${this.repository}/releases?per_page=20`,
      input.signal,
      MAX_RELEASE_RESPONSE_BYTES,
    )
    const parsedReleases = githubReleaseListSchema.safeParse(releases)
    if (!parsedReleases.success) {
      throw new UpdateProviderRequestError('release_invalid', 'GitHub Release 响应格式无效')
    }

    const release = parsedReleases.data
      .filter(
        (candidate) =>
          !candidate.draft &&
          (input.track === 'beta' || !candidate.prerelease) &&
          stableTagPattern.test(candidate.tag_name) &&
          candidate.published_at,
      )
      .sort((left, right) =>
        compareStableVersions(right.tag_name.slice(1), left.tag_name.slice(1)),
      )[0]
    if (!release) return { status: 'up-to-date' }

    const version = release.tag_name.slice(1)
    if (compareStableVersions(version, input.currentVersion) <= 0) {
      return { status: 'up-to-date' }
    }

    const manifestAsset = release.assets.find((asset) => asset.name === 'update-manifest.json')
    if (!manifestAsset) {
      throw new UpdateProviderRequestError('manifest_invalid', 'Release 缺少更新清单')
    }
    const manifestValue = await this.fetchJson(
      this.assertReleaseAssetUrl(manifestAsset.browser_download_url),
      input.signal,
      MAX_MANIFEST_RESPONSE_BYTES,
    )
    const manifestResult = parseManifest(manifestValue)
    if (manifestResult.tag !== release.tag_name || manifestResult.version !== version) {
      throw new UpdateProviderRequestError('manifest_invalid', '更新清单与 Release 版本不一致')
    }

    const resolved = {
      status: 'available' as const,
      release: {
        manifest: manifestResult,
        architecture: input.architecture,
        publishedAt: release.published_at!,
        releaseNotes: release.body ?? '',
        prerelease: release.prerelease,
        assets: {
          dmg: this.resolveAsset(release.assets, input.architecture, manifestResult, 'dmg'),
          zip: this.resolveAsset(release.assets, input.architecture, manifestResult, 'zip'),
        },
      },
    }
    return parseUpdateProviderCheckResult(resolved)
  }

  private resolveAsset(
    releaseAssets: z.infer<typeof githubAssetSchema>[],
    architecture: UpdateArchitecture,
    manifest: ReturnType<typeof parseUpdateManifest>,
    kind: 'dmg' | 'zip',
  ): ResolvedUpdateAsset {
    const expected = manifest.assets[architecture][kind]
    const releaseAsset = releaseAssets.find((asset) => asset.name === expected.name)
    if (!releaseAsset || releaseAsset.size !== expected.size) {
      throw new UpdateProviderRequestError(
        'release_invalid',
        `Release 中的 ${architecture} ${kind.toUpperCase()} 资产与清单不一致`,
      )
    }
    return {
      kind,
      ...expected,
      downloadUrl: new URL(this.assertReleaseAssetUrl(releaseAsset.browser_download_url)),
    }
  }

  private assertReleaseAssetUrl(value: string): string {
    const url = new URL(value)
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.hostname !== 'github.com'
    ) {
      throw new UpdateProviderRequestError('release_invalid', 'Release 资产地址不受信任')
    }
    const expectedPrefix = `/${this.owner}/${this.repository}/releases/download/`
    if (!url.pathname.startsWith(expectedPrefix)) {
      throw new UpdateProviderRequestError('release_invalid', 'Release 资产不属于预期仓库')
    }
    return url.toString()
  }

  private async fetchJson(url: string, signal: AbortSignal, maxBytes: number): Promise<unknown> {
    const timeout = new AbortController()
    const timer = setTimeout(() => timeout.abort(), this.requestTimeoutMs)
    const combinedSignal = AbortSignal.any([signal, timeout.signal])
    try {
      const response = await this.fetchImpl(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'CCLink-Studio-Updater',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        redirect: 'follow',
        signal: combinedSignal,
      })
      if (!response.ok) {
        throw new UpdateProviderRequestError(
          response.status === 403 || response.status === 429
            ? 'provider_unavailable'
            : 'release_invalid',
          `更新服务返回 HTTP ${response.status}`,
        )
      }
      const declaredLength = Number(response.headers.get('content-length') ?? 0)
      if (declaredLength > maxBytes) {
        throw new UpdateProviderRequestError('release_invalid', '更新服务响应过大')
      }
      const text = await response.text()
      if (Buffer.byteLength(text, 'utf8') > maxBytes) {
        throw new UpdateProviderRequestError('release_invalid', '更新服务响应过大')
      }
      return JSON.parse(text) as unknown
    } catch (error) {
      if (error instanceof UpdateProviderRequestError) throw error
      if (combinedSignal.aborted) {
        throw new UpdateProviderRequestError(
          timeout.signal.aborted ? 'network_timeout' : 'provider_unavailable',
          timeout.signal.aborted ? '检查更新超时' : '检查更新已取消',
        )
      }
      if (error instanceof SyntaxError) {
        throw new UpdateProviderRequestError('release_invalid', '更新服务返回了无效 JSON')
      }
      throw new UpdateProviderRequestError('network_offline', '无法连接更新服务')
    } finally {
      clearTimeout(timer)
    }
  }
}

function parseManifest(value: unknown): ReturnType<typeof parseUpdateManifest> {
  try {
    return parseUpdateManifest(value)
  } catch {
    throw new UpdateProviderRequestError('manifest_invalid', '更新清单格式或签名元数据无效')
  }
}
