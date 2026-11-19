import { defineIpcInvoke } from './contract'

// Only public repository coordinates cross this boundary. The main process owns all URLs.
export const publicRepoPattern = /^[a-z\d](?:[a-z\d-]{0,38})\/[a-z\d][a-z\d._-]{0,99}$/i
export const publicFilePath = (path: string) =>
  path.length <= 360 &&
  path.split('/').every((part) => /^[a-z0-9_.+-]+$/i.test(part) && part !== '.' && part !== '..')
const commitPattern = /^[a-f0-9]{40}$/i
type PathsResult = { ok: true; paths: string[]; truncated: boolean } | { ok: false; error: string }
export type ReadmeResult =
  | {
      ok: true
      repo: string
      text: string
      url: string
      sha: string
      at: number
      startLine: number
      locations?: string[]
      matchedAnchor?: boolean
    }
  | { ok: false; error: string }
export const ownerResearchIpc = {
  readReadme: defineIpcInvoke<[string], ReadmeResult>(
    'owner-research:read-public-readme',
    (args) => {
      if (args.length !== 1 || typeof args[0] !== 'string' || !publicRepoPattern.test(args[0]))
        throw Error('无效的 GitHub 仓库名')
      return [args[0]]
    },
    () => ({ ok: false, error: '只接受公开 GitHub 仓库名 owner/repo。' }),
  ),
  findPaths: defineIpcInvoke<[string, string[], string], PathsResult>(
    'owner-research:find-paths',
    (args) => {
      const [repo, terms, ref] = args
      if (
        args.length !== 3 ||
        typeof ref !== 'string' ||
        (ref !== '' && !commitPattern.test(ref)) ||
        typeof repo !== 'string' ||
        !publicRepoPattern.test(repo) ||
        !Array.isArray(terms) ||
        !terms.length ||
        terms.length > 8 ||
        !terms.every((t) => typeof t === 'string' && /^[a-z0-9_.+/-]{1,60}$/i.test(t))
      )
        throw Error('无效的仓库或文件检索词')
      return [repo, terms, ref]
    },
    () => ({ ok: false, error: '文件检索参数无效' }),
  ),
  readFile: defineIpcInvoke<[string, string, string, string], ReadmeResult>(
    'owner-research:read-file',
    (args) => {
      const [repo, path, anchor, ref] = args
      if (
        args.length !== 4 ||
        typeof ref !== 'string' ||
        (ref !== '' && !commitPattern.test(ref)) ||
        typeof repo !== 'string' ||
        !publicRepoPattern.test(repo) ||
        typeof path !== 'string' ||
        (path !== '@README' && !publicFilePath(path)) ||
        typeof anchor !== 'string' ||
        anchor.length > 120
      )
        throw Error('无效的公开文件请求')
      return [repo, path, anchor, ref]
    },
    () => ({ ok: false, error: '公开文件请求无效' }),
  ),
}
