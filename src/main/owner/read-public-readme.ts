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

async function github(repo: string, suffix: string, limit: number) {
  const response = await fetch('https://api.github.com/repos/' + repo + suffix, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'CCLink-Studio-Research' },
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
  })
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
      !data.html_url
        .toLowerCase()
        .startsWith('https://github.com/' + repo.toLowerCase() + '/blob/' + commit + '/')
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
export function registerOwnerReadme(guard: TrustedRendererGuard) {
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
