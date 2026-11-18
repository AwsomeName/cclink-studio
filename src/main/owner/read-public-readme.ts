import { ownerResearchIpc, type ReadmeResult } from '../../shared/ipc/owner-research'
import {
  registerTrustedIpcContract,
  type TrustedRendererGuard,
} from '../ipc/trusted-renderer-guard'

async function read(repo: string): Promise<ReadmeResult> {
  try {
    const response = await fetch('https://api.github.com/repos/' + repo + '/readme', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'CCLink-Studio-Research' },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok || !response.body) throw Error('GitHub HTTP ' + response.status)
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = []
    let bytes = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.length
      if (bytes > 512 * 1024) {
        await reader.cancel()
        throw Error('README 超出读取上限')
      }
      chunks.push(value)
    }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (
      data.encoding !== 'base64' ||
      typeof data.content !== 'string' ||
      !/^[0-9a-f]{40}$/i.test(data.sha) ||
      typeof data.html_url !== 'string' ||
      !data.html_url.toLowerCase().startsWith('https://github.com/' + repo.toLowerCase() + '/blob/')
    )
      throw Error('README 元数据不完整或仓库已迁移')
    const text = Buffer.from(data.content, 'base64').toString('utf8').trim().slice(0, 9000)
    if (!text) throw Error('README 没有可读原文')
    return { ok: true, repo, url: data.html_url, sha: data.sha, at: Date.now(), text }
  } catch (e) {
    return { ok: false, error: repo + '：' + (e instanceof Error ? e.message : String(e)) }
  }
}
export function registerOwnerReadme(guard: TrustedRendererGuard) {
  registerTrustedIpcContract(ownerResearchIpc.readReadme, guard, (_e, repo) => read(repo))
}
