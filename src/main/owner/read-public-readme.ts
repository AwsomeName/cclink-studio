import type { OwnerAgentChoice } from '../../shared/ipc/owner-research'
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
async function github(repo: string, suffix: string, limit: number) {
  const first = 'https://api.github.com/repos/' + repo + suffix
  let response = await fetch(first, {
    headers: GITHUB_HEADERS,
    redirect: 'manual',
    signal: AbortSignal.timeout(20000),
  })
  if ([301, 302, 307, 308].includes(response.status)) {
    const target = renamedRepositoryTarget(response.headers.get('location'), first)
    if (!target) throw Error('GitHub 返回了不受信任的跳转（HTTP ' + response.status + '）')
    response = await fetch(target, {
      headers: GITHUB_HEADERS,
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
    })
  }
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
  selectAgent: () => Promise<OwnerAgentChoice> = async () => ({
    ok: false,
    error: 'Agent 服务未就绪',
  }),
) {
  registerTrustedIpcContract(ownerResearchIpc.selectAgent, guard, () => selectAgent())
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
