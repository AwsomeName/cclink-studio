import type { OwnerAgentChoice } from '../../shared/ipc/owner-research'
import type { OwnerWorkType } from '../../shared/ipc/owner-preferences'
import { sourceWindow } from './source-window'
import {
  ownerResearchIpc,
  publicFilePath,
  type ReadmeResult,
} from '../../shared/ipc/owner-research'
import {
  registerTrustedIpcContract,
  type TrustedRendererGuard,
} from '../ipc/trusted-renderer-guard'

const GITHUB_HEADERS = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'CCLink-Studio-Research',
}
/**
 * A renamed or transferred repository answers with a redirect to /repositories/<id>/…, the
 * same repository by numeric ID. Follow exactly one such hop on api.github.com; refuse others.
 */
export function renamedRepositoryTarget(location: string | null, base: string) {
  if (!location) return
  try {
    const url = new URL(location, base)
    if (
      url.protocol === 'https:' &&
      url.host === 'api.github.com' &&
      /^\/repositories\/\d+(\/|$)/.test(url.pathname)
    )
      return url.toString()
  } catch {
    return
  }
}
/**
 * Explains a GitHub refusal the Owner must not read as "the source lacks this information".
 * Returns nothing for responses that are not a quota, rate or credential refusal.
 */
export function githubRefusal(
  status: number,
  headers: Pick<Headers, 'get'>,
  authenticated: boolean,
  now = Date.now(),
): string | undefined {
  if (status === 401 && authenticated)
    return 'GitHub Token 无效或已过期，请在“设置 → API 连接 → GitHub”中更新后从本事务继续。'
  if (status !== 403 && status !== 429) return
  const later = (minutes?: number) => (minutes ? '，约 ' + minutes + ' 分钟后恢复' : '')
  const hint = authenticated
    ? ''
    : '可在“设置 → API 连接 → GitHub”配置 Token，把额度从每小时 60 次提高到 5000 次。'
  if (headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(headers.get('x-ratelimit-reset'))
    const minutes = reset > 0 ? Math.max(1, Math.ceil((reset * 1000 - now) / 60000)) : undefined
    return (
      'GitHub ' +
      (authenticated ? '账号' : '公开') +
      '接口本小时额度已用完' +
      later(minutes) +
      '。这不是资料缺失，请稍后从本事务继续。' +
      hint
    )
  }
  const retry = Number(headers.get('retry-after'))
  if (retry > 0)
    return (
      'GitHub 暂时限制了请求频率' +
      later(Math.max(1, Math.ceil(retry / 60))) +
      '。这不是资料缺失，请稍后从本事务继续。'
    )
}
/** Main-process lookup of the GitHub token kept under Settings → API connections (`git:github`). */
let githubToken: () => string | null = () => null
async function github(repo: string, suffix: string, limit: number) {
  const token = githubToken()
  // Only api.github.com ever sees the token: the first request and the single renamed-repo hop.
  const headers: Record<string, string> = token
    ? { ...GITHUB_HEADERS, Authorization: 'Bearer ' + token }
    : GITHUB_HEADERS
  const first = 'https://api.github.com/repos/' + repo + suffix
  let response = await fetch(first, {
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(20000),
  })
  if ([301, 302, 307, 308].includes(response.status)) {
    const target = renamedRepositoryTarget(response.headers.get('location'), first)
    if (!target) throw Error('GitHub 返回了不受信任的跳转（HTTP ' + response.status + '）')
    response = await fetch(target, {
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
    })
  }
  console.info('[Owner] GitHub API', {
    repo,
    resource: suffix.split('?')[0] || '/',
    status: response.status,
    authenticated: Boolean(token),
    remaining: response.headers.get('x-ratelimit-remaining'),
    limit: response.headers.get('x-ratelimit-limit'),
  })
  const refusal = githubRefusal(response.status, response.headers, Boolean(token))
  if (refusal) throw Error(refusal)
  if (!response.ok || !response.body) throw Error('GitHub HTTP ' + response.status)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.length
    if (bytes > limit) {
      await reader.cancel()
      throw Error('超过公开资料读取上限')
    }
    chunks.push(value)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
function failure(repo: string, e: unknown) {
  return { ok: false as const, error: repo + '：' + (e instanceof Error ? e.message : String(e)) }
}
// Canonical owner/name per requested name, so a renamed repository's links still verify.
const canonical = new Map<string, string>()
async function canonicalName(repo: string) {
  const known = canonical.get(repo.toLowerCase())
  if (known) return known
  const data = await github(repo, '', 256 * 1024)
  if (typeof data.full_name !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(data.full_name))
    throw Error('没有取得仓库名称')
  canonical.set(repo.toLowerCase(), data.full_name)
  return data.full_name as string
}
async function read(repo: string, path?: string, anchor = '', ref = ''): Promise<ReadmeResult> {
  try {
    const commit = ref || (await github(repo, '/commits?per_page=1', 256 * 1024))[0]?.sha
    if (typeof commit !== 'string' || !/^[a-f0-9]{40}$/i.test(commit))
      throw Error('没有取得仓库提交版本')
    const resource = path
      ? '/contents/' + path.split('/').map(encodeURIComponent).join('/')
      : '/readme'
    const data = await github(repo, resource + '?ref=' + commit, 1024 * 1024)
    if (
      data.type !== 'file' ||
      (path && data.path !== path) ||
      data.encoding !== 'base64' ||
      typeof data.content !== 'string' ||
      !/^[0-9a-f]{40}$/i.test(data.sha) ||
      typeof data.html_url !== 'string' ||
      !(await Promise.all([repo, canonicalName(repo).catch(() => repo)])).some((name) =>
        data.html_url
          .toLowerCase()
          .startsWith('https://github.com/' + name.toLowerCase() + '/blob/' + commit + '/'),
      )
    )
      throw Error('来源与请求不匹配')
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(
      Buffer.from(data.content, 'base64'),
    )
    if (!raw.trim() || raw.includes('\0')) throw Error('文件没有可读文本')
    return {
      ok: true,
      repo,
      ...sourceWindow(raw, anchor),
      url: data.html_url,
      sha: data.sha,
      at: Date.now(),
    }
  } catch (e) {
    return failure(repo, e)
  }
}
export function registerOwnerReadme(
  guard: TrustedRendererGuard,
  selectAgent: (type?: OwnerWorkType) => Promise<OwnerAgentChoice> = async () => ({
    ok: false,
    error: 'Agent 服务未就绪',
  }),
  resolveGithubToken: () => string | null = () => null,
) {
  githubToken = () => {
    try {
      return resolveGithubToken()?.trim() || null
    } catch {
      return null
    }
  }
  registerTrustedIpcContract(ownerResearchIpc.selectAgent, guard, (_e, type) =>
    selectAgent(type ?? undefined),
  )
  registerTrustedIpcContract(ownerResearchIpc.readReadme, guard, (_e, repo) => read(repo))
  registerTrustedIpcContract(ownerResearchIpc.readFile, guard, (_e, repo, path, anchor, ref) =>
    read(repo, path === '@README' ? undefined : path, anchor, ref),
  )
  registerTrustedIpcContract(ownerResearchIpc.findPaths, guard, async (_e, repo, terms, ref) => {
    try {
      const data = await github(
        repo,
        '/git/trees/' + (ref || 'HEAD') + '?recursive=1',
        12 * 1024 * 1024,
      )
      if (!Array.isArray(data.tree)) throw Error('未取得仓库文件目录')
      const candidates: { path: string; score: number }[] = []
      for (const entry of data.tree) {
        if (
          entry.type !== 'blob' ||
          !entry.size ||
          entry.size > 700000 ||
          typeof entry.path !== 'string' ||
          !publicFilePath(entry.path)
        )
          continue
        const name = entry.path.toLowerCase()
        const score = terms.reduce((n, term) => n + (name.includes(term.toLowerCase()) ? 1 : 0), 0)
        if (score) candidates.push({ path: entry.path, score })
      }
      candidates.sort(
        (a, b) =>
          b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path),
      )
      return {
        ok: true as const,
        paths: candidates.slice(0, 100).map((c) => c.path),
        truncated: Boolean(data.truncated) || candidates.length > 100,
      }
    } catch (e) {
      return failure(repo, e)
    }
  })
}
