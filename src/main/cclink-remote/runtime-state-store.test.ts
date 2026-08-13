import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CclinkRuntimeStateStore } from './runtime-state-store'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('CclinkRuntimeStateStore', () => {
  it('用权限收紧的本地文件保存会话和消息，但不写入远程身份字段', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cclink-runtime-state-'))
    roots.push(root)
    const store = new CclinkRuntimeStateStore(root)
    await store.save({
      version: 1,
      sessions: [
        {
          id: 'session-1',
          name: '项目会话',
          workspaceId: 'workspace-1',
          workspacePath: '/srv/project',
          serverId: 'agent-1',
          status: 'archived',
          createdAt: 1,
          updatedAt: 2,
          messageCount: 1,
          contextUsage: 0,
        },
      ],
      messages: {
        'session-1': [{ type: 'user', id: 'message-1', content: '你好', timestamp: 2 }],
      },
    })

    const path = join(root, 'cclink-runtime-state.json')
    const raw = readFileSync(path, 'utf8')
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(raw).not.toMatch(/authToken|refreshToken|imUserSig|accessToken/u)
    expect(await store.load()).toMatchObject({
      sessions: [{ id: 'session-1', status: 'archived' }],
      messages: { 'session-1': [{ id: 'message-1', content: '你好' }] },
    })
  })

  it('加载时只保留白名单字段并把运行中状态降为 idle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cclink-runtime-state-'))
    roots.push(root)
    writeFileSync(
      join(root, 'cclink-runtime-state.json'),
      JSON.stringify({
        version: 1,
        sessions: [
          {
            id: 'session-1',
            name: '项目会话',
            workspaceId: 'workspace-1',
            workspacePath: '/srv/project',
            serverId: 'agent-1',
            status: 'active',
            createdAt: 1,
            updatedAt: 2,
            messageCount: 0,
            contextUsage: 0,
            imUserSig: 'must-be-dropped',
          },
        ],
        messages: {},
      }),
      { mode: 0o600 },
    )

    const loaded = await new CclinkRuntimeStateStore(root).load()
    expect(loaded.sessions[0]).toEqual({
      id: 'session-1',
      name: '项目会话',
      workspaceId: 'workspace-1',
      workspacePath: '/srv/project',
      serverId: 'agent-1',
      status: 'idle',
      createdAt: 1,
      updatedAt: 2,
      messageCount: 0,
      contextUsage: 0,
    })
  })

  it('只读导入旧商业端 cclink-state 的非敏感会话和消息', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cclink-runtime-state-'))
    const legacyRoot = await mkdtemp(join(tmpdir(), 'cclink-commercial-state-'))
    roots.push(root, legacyRoot)
    const legacyPath = join(legacyRoot, 'cclink-state.json')
    writeFileSync(
      legacyPath,
      JSON.stringify({
        servers: [{ id: 'agent-1', authToken: 'must-not-import' }],
        sessions: [
          {
            id: 'session-legacy',
            name: '旧会话',
            workspacePath: '/srv/project',
            serverId: 'agent-1',
            status: 'active',
            createdAt: 1,
            updatedAt: 2,
            messageCount: 1,
            contextUsage: 0,
            imUserSig: 'must-not-import',
          },
        ],
        messages: {
          'session-legacy': [
            { type: 'agentText', id: 'message-legacy', content: '旧回复', timestamp: 2 },
          ],
        },
      }),
      { mode: 0o600 },
    )

    const loaded = await new CclinkRuntimeStateStore(root, [legacyPath]).load()
    expect(loaded.sessions).toMatchObject([{ id: 'session-legacy', status: 'idle' }])
    expect(loaded.messages['session-legacy']).toMatchObject([
      { id: 'message-legacy', content: '旧回复' },
    ])
    expect(readFileSync(legacyPath, 'utf8')).toContain('must-not-import')
    expect(readFileSync(join(root, 'cclink-runtime-state.json'), 'utf8')).not.toContain(
      'must-not-import',
    )
  })
})
