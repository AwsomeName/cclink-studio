import { describe, expect, it } from 'vitest'
import { webResourcesIpcContracts } from './web-resource-contract'

describe('web resources IPC contract', () => {
  it('accepts an arbitrary http website and trims user-entered metadata', () => {
    expect(
      webResourcesIpcContracts.createConnection.parseArgs([
        {
          workspaceRef: { kind: 'local', path: ' /Users/example/project ' },
          websiteName: '  国家知识产权局  ',
          entryUrl: 'https://cpservice.cnipa.gov.cn/',
          principalKind: 'company',
          principalName: '  示例科技有限公司 ',
          accountLabel: ' 经办账号 ',
          loginHint: '',
        },
      ]),
    ).toEqual([
      {
        workspaceRef: { kind: 'local', path: '/Users/example/project' },
        websiteName: '国家知识产权局',
        entryUrl: 'https://cpservice.cnipa.gov.cn/',
        principalKind: 'company',
        principalName: '示例科技有限公司',
        accountLabel: '经办账号',
        loginHint: undefined,
        websiteNotes: undefined,
        accountRole: undefined,
      },
    ])
  })

  it('rejects executable URLs and renderer-supplied session identifiers', async () => {
    const capture = (value: unknown): unknown => {
      try {
        webResourcesIpcContracts.createConnection.parseArgs([value])
      } catch (error) {
        return error
      }
      throw new Error('expected parse failure')
    }

    const executableUrlError = capture({
      workspaceRef: { kind: 'local', path: '/Users/example/project' },
      websiteName: 'Bad',
      entryUrl: 'javascript:alert(1)',
      principalKind: 'personal',
      principalName: 'User',
      accountLabel: 'Account',
    })
    await expect(
      webResourcesIpcContracts.createConnection.mapParseError?.(executableUrlError),
    ).resolves.toMatchObject({
      success: false,
      error: { code: 'INVALID_INPUT' },
    })

    expect(() =>
      webResourcesIpcContracts.createConnection.parseArgs([
        {
          workspaceRef: { kind: 'local', path: '/Users/example/project' },
          websiteName: 'Example',
          entryUrl: 'https://example.com',
          principalKind: 'personal',
          principalName: 'User',
          accountLabel: 'Account',
          browserProfileId: 'renderer-must-not-control-this',
        },
      ]),
    ).toThrow()
  })

  it('validates legacy import scope and principal', () => {
    expect(
      webResourcesIpcContracts.importProjectOpsConfig.parseArgs([
        {
          workspacePath: ' /Users/example/project ',
          principalKind: 'company',
          principalName: ' Example Ltd. ',
        },
      ]),
    ).toEqual([
      {
        workspacePath: '/Users/example/project',
        principalKind: 'company',
        principalName: 'Example Ltd.',
      },
    ])
    expect(() =>
      webResourcesIpcContracts.importProjectOpsConfig.parseArgs([
        { workspacePath: '', principalKind: 'company', principalName: 'Example Ltd.' },
      ]),
    ).toThrow()
  })

  it('accepts only the one-field draft save contract', () => {
    expect(
      webResourcesIpcContracts.saveDraft.parseArgs([
        {
          workspaceRef: { kind: 'local', path: ' /Users/example/project ' },
          draftId: '11111111-1111-4111-8111-111111111111',
          tabId: ' tab-draft ',
          displayName: ' 张三公司 ',
        },
      ]),
    ).toEqual([
      {
        workspaceRef: { kind: 'local', path: '/Users/example/project' },
        draftId: '11111111-1111-4111-8111-111111111111',
        tabId: 'tab-draft',
        displayName: '张三公司',
      },
    ])
    expect(() =>
      webResourcesIpcContracts.saveDraft.parseArgs([
        {
          workspaceRef: { kind: 'local', path: '/Users/example/project' },
          draftId: '11111111-1111-4111-8111-111111111111',
          tabId: 'tab-draft',
          displayName: '张三公司',
          accountRole: '不允许额外设计',
        },
      ]),
    ).toThrow()
  })

  it('does not accept extra arguments on any channel', () => {
    expect(() => webResourcesIpcContracts.getSnapshot.parseArgs(['extra'])).toThrow()
    expect(() => webResourcesIpcContracts.createConnection.parseArgs([])).toThrow()
    expect(() => webResourcesIpcContracts.beginDraft.parseArgs([])).toThrow()
    expect(() => webResourcesIpcContracts.saveDraft.parseArgs([])).toThrow()
    expect(() => webResourcesIpcContracts.importProjectOpsConfig.parseArgs([])).toThrow()
  })
})
