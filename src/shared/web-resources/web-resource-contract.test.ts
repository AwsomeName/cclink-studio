import { describe, expect, it } from 'vitest'
import { webResourcesIpcContracts } from './web-resource-contract'

describe('web resources IPC contract', () => {
  it('accepts an arbitrary http website and trims user-entered metadata', () => {
    expect(
      webResourcesIpcContracts.createConnection.parseArgs([
        {
          websiteName: '  国家知识产权局  ',
          entryUrl: 'https://cpservice.cnipa.gov.cn/',
          principalKind: 'company',
          principalName: '  示例科技有限公司 ',
          accountLabel: ' 经办账号 ',
          browserProfileId: 'cnipa-company',
          loginHint: '',
        },
      ]),
    ).toEqual([
      {
        websiteName: '国家知识产权局',
        entryUrl: 'https://cpservice.cnipa.gov.cn/',
        principalKind: 'company',
        principalName: '示例科技有限公司',
        accountLabel: '经办账号',
        browserProfileId: 'cnipa-company',
        loginHint: undefined,
        websiteNotes: undefined,
        accountRole: undefined,
      },
    ])
  })

  it('rejects executable URLs and invalid Browser Profile ids', async () => {
    const capture = (value: unknown): unknown => {
      try {
        webResourcesIpcContracts.createConnection.parseArgs([value])
      } catch (error) {
        return error
      }
      throw new Error('expected parse failure')
    }

    const executableUrlError = capture({
      websiteName: 'Bad',
      entryUrl: 'javascript:alert(1)',
      principalKind: 'personal',
      principalName: 'User',
      accountLabel: 'Account',
      browserProfileId: 'safe-profile',
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
          websiteName: 'Example',
          entryUrl: 'https://example.com',
          principalKind: 'personal',
          principalName: 'User',
          accountLabel: 'Account',
          browserProfileId: '../escape',
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

  it('does not accept extra arguments on any channel', () => {
    expect(() => webResourcesIpcContracts.getSnapshot.parseArgs(['extra'])).toThrow()
    expect(() => webResourcesIpcContracts.createConnection.parseArgs([])).toThrow()
    expect(() => webResourcesIpcContracts.importProjectOpsConfig.parseArgs([])).toThrow()
  })
})
