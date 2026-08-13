import { describe, expect, it } from 'vitest'
import { cclinkRemotePathSchema, cclinkRemoteRefSchema } from './cclink-remote-ipc'

describe('CCLink remote IPC schema', () => {
  it('接受有界的 CCLink RemoteWorkspaceRef', () => {
    expect(
      cclinkRemoteRefSchema.parse({
        kind: 'remote',
        transport: 'cclink',
        endpointId: 'agent-1',
        workspaceId: 'workspace-1',
        path: '/srv/project',
      }),
    ).toMatchObject({ endpointId: 'agent-1', path: '/srv/project' })
  })

  it('拒绝未知字段、空字符路径和超长输入', () => {
    expect(() =>
      cclinkRemoteRefSchema.parse({
        kind: 'remote',
        transport: 'cclink',
        endpointId: 'agent-1',
        workspaceId: 'workspace-1',
        path: '/srv/project',
        refreshToken: 'must-not-cross-preload',
      }),
    ).toThrow()
    expect(() => cclinkRemotePathSchema.parse('/srv/project\0secret')).toThrow()
    expect(() => cclinkRemotePathSchema.parse(`/${'x'.repeat(4097)}`)).toThrow()
  })
})
