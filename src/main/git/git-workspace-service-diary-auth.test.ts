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
})
