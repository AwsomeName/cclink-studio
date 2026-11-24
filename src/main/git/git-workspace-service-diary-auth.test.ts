import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const transferRepository = vi.hoisted(() => vi.fn())
vi.mock('./git-transfer', () => ({ transferRepository }))
vi.mock('../workspace/workspace-settings-files', () => ({
  readWorkspaceSettings: async () => ({
    settings: { type: 'diary', diary: { directory: '日记', timezone: 'UTC', taskIds: [] } },
  }),
}))
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

import type { WorkspaceStateService } from '../workspace/workspace-state-service'
import { GitWorkspaceService } from './git-workspace-service'
import { GitBackupError } from '../git-backup/git-backup-error'

let root = ''
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'cclink-diary-auth-')))
  transferRepository.mockReset()
  transferRepository.mockResolvedValue({ workspacePath: root, remoteUrl: 'x' })
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function service(saved: { username: string; token: string } | null) {
  const state = {
    listLocalWorkspaces: () => [{ workspacePath: root, projectId: 'p' }],
    verifyLocalIdentity: async () => undefined,
    getFixedSpaces: () => ({ personal: { workspacePath: root, diaryRootConfirmed: true } }),
    getSnapshot: async () => ({
      sections: { 'personal-diary-sync': { remoteUrl: 'https://github.com/me/my-space.git' } },
    }),
    setSection: async () => undefined,
  } as unknown as WorkspaceStateService
  const resolveAuthentication = vi.fn(async () => saved)
  return { svc: new GitWorkspaceService(state, { resolveAuthentication }), resolveAuthentication }
}

describe('My Space sync authentication', () => {
  it('uses the saved GitHub account when no one-off credential is given', async () => {
    const { svc, resolveAuthentication } = service({ username: 'me', token: 'saved' })
    await svc.transfer({ action: 'diary-sync', workspacePath: root })
    expect(resolveAuthentication).toHaveBeenCalledWith('https://github.com/me/my-space.git')
    expect(transferRepository.mock.calls[0][1].authentication).toEqual({
      username: 'me',
      token: 'saved',
    })
  })

  it('prefers a one-off token and stays unauthenticated without a saved account', async () => {
    const withToken = service({ username: 'me', token: 'saved' })
    await withToken.svc.transfer({ action: 'diary-sync', workspacePath: root, token: 'once' })
    expect(transferRepository.mock.calls[0][1].authentication).toEqual({
      username: 'git',
      token: 'once',
    })
    const none = service(null)
    await none.svc.transfer({ action: 'diary-sync', workspacePath: root })
    expect(transferRepository.mock.calls[1][1].authentication).toBeUndefined()
  })

  it('logs the git stderr and auth source, and names the missing saved account', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const failure = () =>
      new GitBackupError('AUTHENTICATION_FAILED', 'Git 认证失败，请检查账号、Token 或 SSH 权限', {
        stderr:
          "fatal: could not read Username for 'https://github.com':\n terminal prompts disabled",
      })
    try {
      const none = service(null)
      transferRepository.mockRejectedValueOnce(failure())
      const error = await none.svc
        .transfer({ action: 'diary-sync', workspacePath: root })
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(GitBackupError)
      expect((error as GitBackupError).code).toBe('AUTHENTICATION_FAILED')
      expect((error as Error).message).toMatch(/认证/)
      expect((error as Error).message).toContain('尚未保存 GitHub 用户名和 Token')
      const line = String(warn.mock.calls.at(-1)?.[0])
      expect(line).toContain('[GitSync] diary-sync failed')
      expect(line).toContain('"authSource":"none"')
      expect(line).toContain('"host":"github.com"')
      expect(line).toContain('could not read Username')
      expect(line).not.toContain('my-space')

      const saved = service({ username: 'me', token: 'saved' })
      transferRepository.mockRejectedValueOnce(failure())
      const savedError = await saved.svc
        .transfer({ action: 'diary-sync', workspacePath: root })
        .catch((e: unknown) => e)
      expect((savedError as Error).message).toBe('Git 认证失败，请检查账号、Token 或 SSH 权限')
      expect(String(warn.mock.calls.at(-1)?.[0])).toContain('"authSource":"saved-github"')
    } finally {
      warn.mockRestore()
    }
  })
})
