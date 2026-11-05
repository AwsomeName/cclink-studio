import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CclinkRuntimeStateStore } from './runtime-state-store'
import type { CclinkRemoteMessage } from '../../shared/cclink'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('CclinkRuntimeStateStore', () => {
  it('持久化明确的审批处理事实，旧执行中消息不会被推断为已审批', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cclink-tool-approval-state-'))
    roots.push(root)
    const store = new CclinkRuntimeStateStore(root)
    const messages: CclinkRemoteMessage[] = [true, undefined].map((approvalResolved, index) => ({
      type: 'agentTool',
      id: `tool-message-${index}`,
      timestamp: 1,
      tool: {
        id: `tool-${index}`,
        name: 'ExitPlanMode',
        state: 'executing',
        requestId: `request-${index}`,
        ...(approvalResolved ? { approvalResolved: true } : {}),
      },
    }))
    await store.save({
      version: 1,
      sessions: [
        {
          id: 'session-1',
          name: '审批恢复',
          workspaceId: 'workspace-1',
          workspacePath: '/srv/project',
          serverId: 'agent-1',
          status: 'idle',
          createdAt: 1,
          updatedAt: 1,
          messageCount: messages.length,
          contextUsage: 0,
        },
      ],
      messages: { 'session-1': messages },
    })
    expect((await new CclinkRuntimeStateStore(root).load()).messages['session-1']).toEqual(messages)
  })

  it('重启保留问题过期和新回合接收状态，不把历史卡片恢复为待回答', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cclink-question-state-'))
    roots.push(root)
    const store = new CclinkRuntimeStateStore(root)
    const questions: CclinkRemoteMessage[] = ['expired', 'resolved', 'cancelled', 'ended'].map(
      (status, index) => ({
        type: 'userQuestion',
        id: `question-${index}`,
        timestamp: 1,
        requestId: `request-${index}`,
        toolUseId: `tool-${index}`,
        questions: [{ id: 'market', question: '哪个市场？' }],
        status: status as 'expired' | 'resolved' | 'cancelled' | 'ended',
        ...(status === 'resolved' ? { answered: true, resolution: 'new_turn' as const } : {}),
      }),
    )
    await store.save({
      version: 1,
      sessions: [
        {
          id: 'session-1',
          name: '问答恢复',
          workspaceId: 'workspace-1',
          workspacePath: '/srv/project',
          serverId: 'agent-1',
          status: 'idle',
          createdAt: 1,
          updatedAt: 1,
          messageCount: 4,
          contextUsage: 0,
        },
      ],
      messages: { 'session-1': questions },
    })
    expect((await store.load()).messages['session-1']).toEqual(questions)
  })

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
        'session-1': [
          {
            type: 'user',
            id: 'message-1',
            content: '你好',
            timestamp: 2,
            images: [
              'https://cos.example/screenshot.png?signature=abc',
              'http://cos.example/insecure.png',
              'https://user:secret@cos.example/credential.png',
              'javascript:alert(1)',
            ],
          },
        ],
      },
    })

    const path = join(root, 'cclink-runtime-state.json')
    const raw = readFileSync(path, 'utf8')
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(raw).not.toMatch(/authToken|refreshToken|imUserSig|accessToken/u)
    expect(await store.load()).toMatchObject({
      sessions: [{ id: 'session-1', status: 'archived' }],
      messages: {
        'session-1': [
          {
            id: 'message-1',
            content: '你好',
            images: ['https://cos.example/screenshot.png?signature=abc'],
          },
        ],
      },
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

  it('加载时清理旧版本保存的相邻终态重复消息', async () => {
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
            status: 'idle',
            createdAt: 1,
            updatedAt: 2,
            messageCount: 2,
            contextUsage: 0,
          },
        ],
        messages: {
          'session-1': [
            {
              type: 'agentText',
              id: 'remote-agent-message-1-seg199',
              content: '全部任务完成。',
              timestamp: 2,
            },
            {
              type: 'agentText',
              id: 'remote-agent-message-1',
              content: '全部任务完成。',
              timestamp: 2,
            },
          ],
        },
      }),
      { mode: 0o600 },
    )

    const loaded = await new CclinkRuntimeStateStore(root).load()
    expect(loaded.messages['session-1']).toEqual([
      expect.objectContaining({ id: 'remote-agent-message-1', content: '全部任务完成。' }),
    ])
  })

  it('递归脱敏远程工具输入、输出和错误后再落盘', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cclink-runtime-state-'))
    roots.push(root)
    const store = new CclinkRuntimeStateStore(root)
    await store.save({
      version: 1,
      sessions: [
        {
          id: 'session-1',
          name: '会话',
          workspaceId: 'workspace-1',
          workspacePath: '/srv/project',
          serverId: 'agent-1',
          status: 'idle',
          createdAt: 1,
          updatedAt: 2,
          messageCount: 1,
          contextUsage: 0,
        },
      ],
      messages: {
        'session-1': [
          {
            type: 'agentTool',
            id: 'tool-message',
            timestamp: 2,
            tool: {
              id: 'tool-1',
              name: 'Bash',
              state: 'failed',
              input: { nested: { accessToken: 'secret-token' } },
              output: 'Authorization: Bearer abc.def.ghi',
              error: 'ghp_abcdefghijklmnopqrstuvwxyz',
            },
          },
        ],
      },
    })
    const raw = readFileSync(join(root, 'cclink-runtime-state.json'), 'utf8')
    expect(raw).not.toContain('secret-token')
    expect(raw).not.toContain('abc.def.ghi')
    expect(raw).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz')
    expect(raw).toContain('[REDACTED]')
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
            workspaceId: 'ws_agent_canonical',
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

  it('不再为缺少 Agent workspace_id 的旧会话生成本地哈希身份', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cclink-runtime-state-'))
    roots.push(root)
    writeFileSync(
      join(root, 'cclink-runtime-state.json'),
      JSON.stringify({
        version: 1,
        sessions: [
          {
            id: 'session-without-workspace-id',
            name: '旧会话',
            workspacePath: '/srv/project',
            serverId: 'agent-1',
            createdAt: 1,
            updatedAt: 2,
          },
        ],
        messages: {},
      }),
      { mode: 0o600 },
    )

    await expect(new CclinkRuntimeStateStore(root).load()).resolves.toMatchObject({ sessions: [] })
  })
})
