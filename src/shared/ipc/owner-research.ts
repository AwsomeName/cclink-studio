import { defineIpcInvoke } from './contract'

// Single unauthenticated public operation; callers cannot supply a URL, headers or paths.
export const publicRepoPattern = /^[a-z\d](?:[a-z\d-]{0,38})\/[a-z\d][a-z\d._-]{0,99}$/i
export type ReadmeResult =
  | { ok: true; repo: string; text: string; url: string; sha: string; at: number }
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
}
