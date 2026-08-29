import { readFileSync, readdirSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { agentIpcContracts, agentMcpIpcContracts } from '../../shared/ipc/agent-contract'
import { agentIpc, agentMcpIpc } from '../../shared/ipc/agent'
import { androidIpcContracts } from '../../shared/ipc/android-contract'
import { androidIpc, androidIpcEvents } from '../../shared/ipc/android'
import {
  browserDownloadIpcContracts,
  browserIpcContracts,
  browserTaskIpcContracts,
} from '../../shared/ipc/browser-contract'
import {
  browserDownloadIpc,
  browserIpc,
  browserIpcEvents,
  browserTaskIpc,
} from '../../shared/ipc/browser'
import { defineIpcInvoke, defineNoArgsIpc } from '../../shared/ipc/contract'
import { dataSourceIpcContracts } from '../../shared/ipc/data-source-contract'
import { dataSourceIpc } from '../../shared/ipc/data-source'
import { cadIpc } from '../../shared/ipc/cad'
import { editorIpc, editorIpcEvents } from '../../shared/ipc/editor'
import { gitBackupIpc } from '../../shared/ipc/git-backup'
import { hardwareIpc } from '../../shared/ipc/hardware'
import { projectOpsIpc } from '../../shared/ipc/project-ops'
import { wechatIpc } from '../../shared/ipc/wechat'
import { workspaceStateIpc } from '../../shared/ipc/workspace-state'
import {
  cadIpcContracts,
  editorIpcContracts,
  gitBackupIpcContracts,
  hardwareIpcContracts,
  projectOpsIpcContracts,
  wechatIpcContracts,
  workspaceStateIpcContracts,
} from '../../shared/ipc/workbench-contract'
import { dialogIpcContracts as dialogIpc } from '../../shared/ipc/dialog-contract'
import { fsIpcContracts } from '../../shared/ipc/fs-contract'
import { fsIpc } from '../../shared/ipc/fs'
import { settingsIpcContracts as settingsIpc } from '../../shared/ipc/settings-contract'
import { terminalIpcContracts } from '../../shared/ipc/terminal-contract'
import {
  parseTerminalConfirmationRequest,
  parseTerminalExecutionEvent,
  terminalIpc,
  terminalIpcEvents,
} from '../../shared/ipc/terminal'
import { webResourcesIpcContracts } from '../../shared/web-resources/web-resource-contract'
import { webResourcesIpc } from '../../shared/web-resources/web-resource'
import { webAffairsIpcContracts } from '../../shared/web-affairs/web-affair-contract'
import { webAffairsIpc } from '../../shared/web-affairs/web-affair'
import {
  ipcInvokeContractInventory,
  legacyIpcChannels,
  legacyIpcEventFlowInventory,
  legacyIpcNamespaceInventory,
} from './ipc-contract-legacy-inventory'
import { ipcEventFlowInventory } from './ipc-event-flow-inventory'

describe('IPC invoke contracts', () => {
  it('rejects unexpected arguments for no-argument channels', () => {
    const contract = defineNoArgsIpc<{ success: boolean }>('test:no-args')

    expect(contract.parseArgs([])).toEqual([])
    expect(() => contract.parseArgs(['unexpected'])).toThrow('不接受参数')
  })

  it('uses the declared parser as the runtime argument boundary', () => {
    const contract = defineIpcInvoke<[number], string>('test:number', (args) => {
      if (args.length !== 1 || typeof args[0] !== 'number') throw new Error('expected number')
      return [args[0]]
    })

    expect(contract.parseArgs([42])).toEqual([42])
    expect(() => contract.parseArgs(['42'])).toThrow('expected number')
  })

  it('allows contracts to preserve structured parse failures', async () => {
    const contract = defineIpcInvoke<[number], { success: boolean; error?: string }>(
      'test:mapped-error',
      () => {
        throw new Error('invalid')
      },
      async () => ({ success: false, error: 'invalid input' }),
    )

    await expect(contract.mapParseError?.(new Error('invalid'))).resolves.toEqual({
      success: false,
      error: 'invalid input',
    })
  })

  it('validates parameterized Settings and Dialog calls from shared declarations', async () => {
    expect(settingsIpc.set.parseArgs([{ permissionMode: 'strict' }])).toEqual([
      { permissionMode: 'strict' },
    ])
    await expect(
      settingsIpc.set.mapParseError?.(
        captureError(() => settingsIpc.set.parseArgs([{ permissionMode: 'unrestricted' }])),
      ),
    ).resolves.toEqual({ success: false, error: '设置参数无效' })

    expect(dialogIpc.showOpenDialog.parseArgs([])).toEqual([undefined])
    expect(dialogIpc.showOpenDialog.parseArgs([{ defaultPath: '/workspace/project' }])).toEqual([
      { defaultPath: '/workspace/project' },
    ])
    expect(dialogIpc.showMessageBox.parseArgs([{ message: '确认继续？' }])).toEqual([
      { message: '确认继续？' },
    ])
    expect(() => dialogIpc.showMessageBox.parseArgs([{ message: '' }, 'extra'])).toThrow()
  })

  it('binds every Filesystem definition to a bounded runtime parser', () => {
    expect(Object.keys(fsIpcContracts)).toEqual(Object.keys(fsIpc))
    expect(fsIpcContracts.readFile.parseArgs(['/workspace/note.md'])).toEqual([
      '/workspace/note.md',
    ])
    expect(fsIpcContracts.createFile.parseArgs(['/workspace/new.md'])).toEqual([
      '/workspace/new.md',
    ])
    expect(
      fsIpcContracts.saveTextDocument.parseArgs([
        { filePath: '/workspace/note.md', content: '# Note', force: true },
      ]),
    ).toEqual([{ filePath: '/workspace/note.md', content: '# Note', force: true }])
    expect(() => fsIpcContracts.readFile.parseArgs(['/workspace/bad\0path'])).toThrow()
    expect(() => fsIpcContracts.rename.parseArgs(['/workspace/old.md'])).toThrow()
    expect(() => fsIpcContracts.watchDirStop.parseArgs(['not-a-uuid'])).toThrow()
  })

  it('binds every Terminal definition to its approved runtime boundary', async () => {
    expect(Object.keys(terminalIpcContracts)).toEqual(Object.keys(terminalIpc))
    expect(Object.keys(terminalIpcEvents)).toHaveLength(2)
    expect(
      terminalIpcContracts.startPty.parseArgs([
        {
          terminalSessionId: ' terminal-1 ',
          runtime: {
            location: 'local',
            transport: 'local',
            backend: 'local-shell',
            workspaceRef: { kind: 'local', path: '/workspace' },
          },
        },
      ]),
    ).toEqual([
      {
        terminalSessionId: 'terminal-1',
        runtime: {
          location: 'local',
          transport: 'local',
          backend: 'local-shell',
          workspaceRef: { kind: 'local', path: '/workspace' },
        },
        size: { columns: 80, rows: 24 },
      },
    ])
    const lifecycleInput = {
      terminalSessionId: 'terminal-1',
      workspaceKey: '/workspace',
      kind: 'created' as const,
      runtime: {
        location: 'local' as const,
        transport: 'local' as const,
        backend: 'local-shell' as const,
        workspaceRef: { kind: 'local' as const, path: '/workspace' },
      },
      permissionPolicy: {
        mode: 'ask-risky-command' as const,
        requireConfirmationFor: ['write' as const],
      },
      closePolicy: 'keep-running' as const,
    }
    expect(terminalIpcContracts.recordLifecycleEvent.parseArgs([lifecycleInput])).toEqual([
      lifecycleInput,
    ])
    expect(() =>
      terminalIpcContracts.recordLifecycleEvent.parseArgs([
        { terminalSessionId: 'terminal-1', kind: 'command-submitted' },
      ]),
    ).toThrow()
    expect(() =>
      terminalIpcContracts.submitCommand.parseArgs([
        {
          terminalSessionId: 'terminal-1',
          command: 'pwd',
          actor: 'robot',
          permissionPolicy: {
            mode: 'ask-risky-command',
            requireConfirmationFor: ['write'],
          },
        },
      ]),
    ).toThrow()
    expect(() =>
      terminalIpcContracts.submitCommand.parseArgs([
        {
          terminalSessionId: 'terminal-1',
          command: 'x'.repeat(100_001),
          actor: 'user',
          permissionPolicy: {
            mode: 'ask-risky-command',
            requireConfirmationFor: ['write'],
          },
        },
      ]),
    ).toThrow()
    expect(
      terminalIpcContracts.submitCommand.parseArgs([
        {
          terminalSessionId: 'terminal-1',
          command: 'pwd',
          actor: 'user',
          permissionPolicy: {
            mode: 'ask-risky-command',
            requireConfirmationFor: ['not-a-risk'],
          },
          legacyExtension: { enabled: true },
        } as never,
      ]),
    ).toHaveLength(1)
    expect(() =>
      terminalIpcContracts.recordLifecycleEvent.parseArgs([
        {
          terminalSessionId: 'terminal-1',
          kind: 'created',
          unexpected: { nested: 'x'.repeat(100_001) },
        },
      ]),
    ).toThrow()
    expect(terminalIpcContracts.listAuditEvents.parseArgs([])).toEqual([undefined])
    expect(
      terminalIpcContracts.listAuditEvents.parseArgs([
        { terminalSessionId: 'terminal-1', workspaceKey: 123, limit: 2.8 },
      ]),
    ).toEqual([{ terminalSessionId: 'terminal-1', workspaceKey: 123, limit: 2.8 }])
    expect(
      terminalIpcContracts.listAuditEvents.parseArgs([{ nested: { legacy: true } } as never]),
    ).toEqual([{ nested: { legacy: true } }])
    expect(terminalIpcContracts.listAuditEvents.parseArgs([{}, { ignored: true }])).toEqual([{}])
    expect(terminalIpcContracts.listSessions.parseArgs(['legacy-extra'])).toEqual([])
    expect(terminalIpcContracts.clearAuditEvents.parseArgs(['legacy-extra'])).toEqual([])
    expect(() =>
      terminalIpcContracts.listAuditEvents.parseArgs([
        { nested: { oversized: 'x'.repeat(100_001) } } as never,
      ]),
    ).toThrow()
    expect(() => terminalIpcContracts.listSessions.parseArgs(['x'.repeat(100_001)])).toThrow()
    await expect(
      terminalIpcContracts.startPty.mapParseError?.(
        captureError(() => terminalIpcContracts.startPty.parseArgs([{ terminalSessionId: '' }])),
      ),
    ).resolves.toEqual({ success: false, error: 'Terminal PTY 启动参数无效' })
  })

  it('bounds Terminal pushed event payloads before renderer callbacks', () => {
    expect(
      parseTerminalExecutionEvent({
        kind: 'output',
        sessionId: 'terminal-1',
        data: 'ok',
        stream: 'stdout',
        timestamp: 1,
      }),
    ).not.toBeNull()
    expect(
      parseTerminalExecutionEvent({
        kind: 'output',
        sessionId: 'terminal-1',
        stream: 'stdout',
        timestamp: 1,
      }),
    ).toBeNull()
    expect(
      parseTerminalConfirmationRequest({
        id: 'confirmation-1',
        createdAt: 1,
        expiresAt: 2,
        terminalSessionId: 'terminal-1',
        command: 'pwd',
        actor: 'user',
        risk: 'read',
        reason: 'read-only',
        runtime: {
          location: 'local',
          transport: 'local',
          backend: 'local-shell',
          workspaceRef: { kind: 'local', path: '/workspace' },
        },
      }),
    ).not.toBeNull()
    expect(
      parseTerminalConfirmationRequest({
        id: 'confirmation-1',
        createdAt: 1,
        expiresAt: 2,
        terminalSessionId: 'terminal-1',
        command: 'pwd',
        actor: 'robot',
        risk: 'read',
        reason: 'read-only',
        runtime: {
          location: 'local',
          transport: 'local',
          backend: 'local-shell',
          workspaceRef: { kind: 'local', path: '/workspace' },
        },
      }),
    ).toBeNull()
  })

  it('binds every Android definition and retained event to one shared declaration', async () => {
    expect(Object.keys(androidIpcContracts)).toEqual(Object.keys(androidIpc))
    expect(Object.keys(androidIpcEvents).sort()).toEqual([
      'mirrorDisconnected',
      'mirrorError',
      'storeInstallProgress',
      'touch',
      'videoFrame',
    ])
    expect(androidIpcContracts.connectPhysical.parseArgs([' device-1 '])).toEqual(['device-1'])
    expect(androidIpcContracts.swipe.parseArgs([1, 2, 3, 4, undefined])).toEqual([
      1,
      2,
      3,
      4,
      undefined,
    ])
    expect(androidIpcContracts.listPackages.parseArgs([undefined])).toEqual([undefined])
    await expect(
      androidIpcContracts.installApk.mapParseError?.(
        captureError(() => androidIpcContracts.installApk.parseArgs(['../payload.sh'])),
      ),
    ).rejects.toThrow()
  })

  it('binds every DataSource definition and preserves its structured parse error', async () => {
    expect(Object.keys(dataSourceIpcContracts)).toEqual(Object.keys(dataSourceIpc))
    expect(dataSourceIpcContracts.testConnection.parseArgs([' source-1 '])).toEqual(['source-1'])
    expect(dataSourceIpcContracts.listSavedQueries.parseArgs([undefined])).toEqual([undefined])
    await expect(
      dataSourceIpcContracts.createSource.mapParseError?.(
        captureError(() =>
          dataSourceIpcContracts.createSource.parseArgs([
            { type: 'elasticsearch', name: '', endpoint: 'file:///tmp/index' },
          ]),
        ),
      ),
    ).resolves.toMatchObject({
      success: false,
      error: { code: 'DATA_SOURCE_QUERY_INVALID' },
    })
  })

  it('binds every remaining workbench definition to the existing bounded parsers', async () => {
    expect(Object.keys(workspaceStateIpcContracts)).toEqual(Object.keys(workspaceStateIpc))
    expect(Object.keys(gitBackupIpcContracts)).toEqual(Object.keys(gitBackupIpc))
    expect(Object.keys(hardwareIpcContracts)).toEqual(Object.keys(hardwareIpc))
    expect(Object.keys(cadIpcContracts)).toEqual(Object.keys(cadIpc))
    expect(Object.keys(projectOpsIpcContracts)).toEqual(Object.keys(projectOpsIpc))
    expect(Object.keys(editorIpcContracts)).toEqual(Object.keys(editorIpc))
    expect(Object.keys(wechatIpcContracts)).toEqual(Object.keys(wechatIpc))
    expect(Object.keys(editorIpcEvents)).toEqual(['readRequest', 'saveRequest'])

    expect(workspaceStateIpcContracts.get.parseArgs(['/workspace', undefined])).toEqual([
      '/workspace',
      undefined,
    ])
    expect(gitBackupIpcContracts.backup.parseArgs([{ workspacePath: '/workspace' }])).toEqual([
      { workspacePath: '/workspace' },
    ])
    expect(
      cadIpcContracts.convertModel.parseArgs([{ inputPath: '/workspace/model.step' }]),
    ).toEqual([{ inputPath: '/workspace/model.step' }])
    expect(() =>
      hardwareIpcContracts.readGerberLayerPreview.parseArgs([
        '/workspace',
        '/workspace/gerber.zip',
        '../escape.gbr',
      ]),
    ).toThrow()
    await expect(
      wechatIpcContracts.convert.mapParseError?.(
        captureError(() => wechatIpcContracts.convert.parseArgs([{ markdown: 42 }])),
      ),
    ).resolves.toMatchObject({ error: expect.any(String) })
  })

  it('binds every Agent and MCP definition to a bounded runtime parser', () => {
    expect(Object.keys(agentIpcContracts)).toEqual(Object.keys(agentIpc))
    expect(Object.keys(agentMcpIpcContracts)).toEqual(Object.keys(agentMcpIpc))
    expect(agentIpcContracts.sendMessage.parseArgs(['  hello  '])).toEqual(['hello'])
    expect(
      agentIpcContracts.sendMessage.parseArgs([
        'conversation-1',
        { message: '  hello  ', workspaceRef: { kind: 'local', path: '/tmp/project' } },
      ]),
    ).toEqual([
      'conversation-1',
      { message: 'hello', workspaceRef: { kind: 'local', path: '/tmp/project' } },
    ])
    expect(
      agentIpcContracts.sendMessage.parseArgs([
        'conversation-remote',
        {
          message: '总结项目',
          workspaceRef: {
            kind: 'remote',
            transport: 'cclink',
            endpointId: 'agent-1',
            workspaceId: 'workspace-1',
            path: '/srv/project',
          },
        },
      ]),
    ).toEqual([
      'conversation-remote',
      {
        message: '总结项目',
        workspaceRef: {
          kind: 'remote',
          transport: 'cclink',
          endpointId: 'agent-1',
          workspaceId: 'workspace-1',
          path: '/srv/project',
        },
      },
    ])
    expect(agentIpcContracts.getStatus.parseArgs([])).toEqual([undefined])
    expect(agentIpcContracts.listRoles.parseArgs([])).toEqual([])
    expect(agentIpcContracts.listSkills.parseArgs([])).toEqual([])
    const roleDraft = {
      label: '本地审稿人',
      description: '审阅内容',
      icon: 'fact-checker' as const,
      goals: ['给出建议'],
      suitableFor: [],
      unsuitableFor: [],
      instructions: ['区分事实与观点'],
      boundaries: ['不扩大权限'],
      examples: [],
      soulMarkdown: '# 原则',
      recommendedSkillRefs: [{ skillId: 'grill-me', version: 1 }],
    }
    expect(agentIpcContracts.createRole.parseArgs([roleDraft])).toEqual([roleDraft])
    expect(agentIpcContracts.updateRole.parseArgs(['local-role', 1, roleDraft])).toEqual([
      'local-role',
      1,
      roleDraft,
    ])
    expect(
      agentIpcContracts.exportRole.parseArgs([{ roleId: 'local-role', version: 1 }, '/tmp/roles']),
    ).toEqual([{ roleId: 'local-role', version: 1 }, '/tmp/roles'])
    expect(() =>
      agentIpcContracts.createRole.parseArgs([
        { ...roleDraft, toolPermissions: ['terminal.execute'] },
      ]),
    ).toThrow()
    expect(() => agentIpcContracts.previewImportRole.parseArgs(['relative/role.json'])).toThrow()
    expect(
      agentIpcContracts.restoreConversation.parseArgs([
        'conversation-1',
        'session-1',
        {
          schemaVersion: 1,
          roleRef: { roleId: 'critical-challenger', version: 1 },
          revision: 2,
          updatedAt: 1,
        },
        'a'.repeat(64),
        [{ skillId: 'grill-me', version: 1 }],
        { kind: 'acp', implementationId: 'codex-acp' },
      ]),
    ).toEqual([
      'conversation-1',
      'session-1',
      {
        schemaVersion: 1,
        roleRef: { roleId: 'critical-challenger', version: 1 },
        revision: 2,
        updatedAt: 1,
      },
      'a'.repeat(64),
      [{ skillId: 'grill-me', version: 1 }],
      { kind: 'acp', implementationId: 'codex-acp' },
    ])
    expect(
      agentIpcContracts.sendMessage.parseArgs([
        'conversation-1',
        {
          message: '评估',
          skills: [{ skillId: 'grill-me', version: 1 }],
          configuration: {
            schemaVersion: 1,
            roleRef: { roleId: 'critical-challenger', version: 1 },
            revision: 2,
            updatedAt: 1,
          },
        },
      ]),
    ).toEqual([
      'conversation-1',
      {
        message: '评估',
        skills: [{ skillId: 'grill-me', version: 1 }],
        configuration: {
          schemaVersion: 1,
          roleRef: { roleId: 'critical-challenger', version: 1 },
          revision: 2,
          updatedAt: 1,
        },
      },
    ])
    expect(() =>
      agentIpcContracts.sendMessage.parseArgs([
        'conversation-1',
        {
          message: '评估',
          skills: [
            {
              skillId: 'grill-me',
              version: 1,
              markdown: 'renderer 不得提交 Skill 内容',
            },
          ],
        },
      ]),
    ).toThrow()
    expect(() =>
      agentIpcContracts.sendMessage.parseArgs([
        'conversation-1',
        {
          message: '评估',
          configuration: {
            schemaVersion: 1,
            roleRef: { roleId: '../../escape', version: 0 },
            revision: 1,
            updatedAt: 1,
          },
        },
      ]),
    ).toThrow()
    expect(() => agentIpcContracts.sendMessage.parseArgs(['a', 'b', 'c'])).toThrow()
    expect(() => agentIpcContracts.setPermissionMode.parseArgs(['unrestricted'])).toThrow()
    const mcpError = captureError(() =>
      agentMcpIpcContracts.addServer.parseArgs([
        {
          name: 'remote',
          transport: 'http',
          url: 'https://user:secret@example.com/mcp',
          enabled: true,
        },
      ]),
    )
    expect(agentMcpIpcContracts.addServer.mapParseError?.(mcpError)).toMatchObject({
      success: false,
    })
  })

  it('binds every Browser definition to a bounded runtime parser', () => {
    expect(Object.keys(browserIpcContracts)).toEqual(Object.keys(browserIpc))
    expect(Object.keys(browserTaskIpcContracts)).toEqual(Object.keys(browserTaskIpc))
    expect(Object.keys(browserDownloadIpcContracts)).toEqual(Object.keys(browserDownloadIpc))
    expect(Object.keys(browserIpcEvents)).toHaveLength(14)

    expect(browserIpcContracts.createView.parseArgs(['tab-1'])).toEqual([
      'tab-1',
      undefined,
      undefined,
    ])
    expect(browserIpcContracts.getActiveViewId.parseArgs([])).toEqual([undefined])
    expect(browserIpcContracts.acceptPopup.parseArgs(['browser-popup-1'])).toEqual([
      'browser-popup-1',
    ])
    expect(browserIpcContracts.beginPopupAdoption.parseArgs(['browser-popup-1'])).toEqual([
      'browser-popup-1',
    ])
    expect(browserIpcContracts.listHistory.parseArgs([])).toEqual([undefined])
    expect(
      browserIpcContracts.getSessionDiagnostics.parseArgs([
        { url: 'https://example.com', profileId: 'operations' },
      ]),
    ).toEqual([{ url: 'https://example.com', profileId: 'operations' }])
    expect(() => browserIpcContracts.navigate.parseArgs(['tab-1', 'javascript:alert(1)'])).toThrow()
    expect(() => browserIpcContracts.setZoom.parseArgs(['tab-1', 4])).toThrow()
    expect(() => browserTaskIpcContracts.start.parseArgs(['tab-1', '   '])).toThrow()
    expect(() => browserDownloadIpcContracts.get.parseArgs(['id', 'extra'])).toThrow()
  })

  it('binds every Web Resources definition to a bounded runtime parser', () => {
    expect(Object.keys(webResourcesIpcContracts)).toEqual(Object.keys(webResourcesIpc))
    expect(
      webResourcesIpcContracts.createConnection.parseArgs([
        {
          workspaceRef: { kind: 'local', path: '/Users/example/project' },
          websiteName: 'Example',
          entryUrl: 'https://example.com',
          principalKind: 'company',
          principalName: 'Example Ltd.',
          accountLabel: 'Admin',
        },
      ]),
    ).toHaveLength(1)
    expect(() =>
      webResourcesIpcContracts.createConnection.parseArgs([
        {
          workspaceRef: { kind: 'local', path: '/Users/example/project' },
          websiteName: 'Unsafe',
          entryUrl: 'javascript:alert(1)',
          principalKind: 'company',
          principalName: 'Example Ltd.',
          accountLabel: 'Admin',
        },
      ]),
    ).toThrow()
  })

  it('binds every Web Affairs definition to a bounded runtime parser', () => {
    expect(Object.keys(webAffairsIpcContracts)).toEqual(Object.keys(webAffairsIpc))
    expect(
      webAffairsIpcContracts.createAffair.parseArgs([
        {
          workspaceRef: { kind: 'local', path: '/Users/example/project' },
          title: 'App 上架',
          objective: '取得审核结果',
          principalId: '11111111-1111-4111-8111-111111111111',
          accountIds: [],
          materialPaths: [],
          nodeTitles: ['提交审核'],
        },
      ]),
    ).toHaveLength(1)
    expect(() => webAffairsIpcContracts.createAffair.parseArgs([])).toThrow()
  })

  it('rejects raw channel literals at every production main/preload IPC boundary', () => {
    const productionFiles = [
      ...collectFiles(resolve(process.cwd(), 'src/main')),
      ...collectFiles(resolve(process.cwd(), 'src/preload')),
    ].filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    const rawBoundaryPattern =
      /(?:ipcMain\.(?:handle|on)|registerTrustedIpc(?:Handler|Listener)|webContents\.send|ipcRenderer\.(?:invoke|send|on|once|removeListener|removeAllListeners)|registerOwnedEditorListener)\(\s*['"]([^'"]+)['"]/gu
    const violations: string[] = []

    for (const file of productionFiles) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(rawBoundaryPattern)) {
        violations.push(`${file}:${match[1]}`)
      }
    }

    expect(violations).toEqual([])
  })

  it('keeps preload-facing contract definitions free of runtime schema dependencies', () => {
    const preloadFacingFiles = [
      'src/shared/ipc/settings.ts',
      'src/shared/ipc/dialog.ts',
      'src/shared/ipc/fs.ts',
      'src/shared/ipc/agent.ts',
      'src/shared/ipc/browser.ts',
      'src/shared/web-resources/web-resource.ts',
      'src/shared/web-affairs/web-affair.ts',
      'src/shared/ipc/terminal.ts',
      'src/shared/ipc/android.ts',
      'src/shared/ipc/data-source.ts',
      'src/shared/ipc/workspace-state.ts',
      'src/shared/ipc/git-backup.ts',
      'src/shared/ipc/hardware.ts',
      'src/shared/ipc/cad.ts',
      'src/shared/ipc/project-ops.ts',
      'src/shared/ipc/editor.ts',
      'src/shared/ipc/wechat.ts',
      'src/preload/index.ts',
      'src/preload/renderer-support-api.ts',
      'src/preload/fs-api.ts',
      'src/preload/agent-api.ts',
      'src/preload/browser-api.ts',
      'src/preload/web-resources-api.ts',
      'src/preload/web-affairs-api.ts',
      'src/preload/android-api.ts',
      'src/preload/data-source-api.ts',
      'src/preload/local-ops-api.ts',
    ]
    const source = preloadFacingFiles
      .map((file) => readFileSync(resolve(process.cwd(), file), 'utf8'))
      .join('\n')
    const allPreloadSource = collectFiles(resolve(process.cwd(), 'src/preload'))
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n')

    expect(allPreloadSource).not.toMatch(/(?:terminal|android|data-source|workbench)-contract['"]/)
    expect(source).not.toMatch(/from ['"]zod['"]/)
  })

  it('freezes the shrinking legacy preload channel inventory', () => {
    const preloadFiles = collectFiles(resolve(process.cwd(), 'src/preload')).filter((file) =>
      file.endsWith('.ts'),
    )
    const channels = new Set<string>()
    const literalCallPattern =
      /(?:ipcRenderer\.(?:invoke|send|on|once|removeListener|removeAllListeners)|registerOwnedEditorListener)\(\s*['"]([^'"]+)['"]/gu

    for (const file of preloadFiles) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(literalCallPattern)) channels.add(match[1])
    }

    expect([...channels].sort()).toEqual(legacyIpcChannels)
    expect(new Set(legacyIpcChannels).size).toBe(legacyIpcChannels.length)
    expect(new Set(legacyIpcNamespaceInventory.map((entry) => entry.namespace)).size).toBe(
      legacyIpcNamespaceInventory.length,
    )
  })

  it('records producers and actual consumers for every legacy pushed event', () => {
    const legacyChannels = new Set(legacyIpcChannels)
    for (const event of legacyIpcEventFlowInventory) {
      expect(legacyChannels.has(event.channel)).toBe(true)
      expect(event.producerFiles.length + event.consumerFiles.length).toBeGreaterThan(0)
      if (event.producerFiles.length === 0 || event.consumerFiles.length === 0) {
        expect(event.disposition).toBe('decide-remove-or-complete')
      }
      for (const file of [...event.producerFiles, ...event.consumerFiles]) {
        expect(statSync(resolve(process.cwd(), file)).isFile()).toBe(true)
      }
    }
  })

  it('keeps a machine-enumerable invoke inventory with real handler and preload evidence', () => {
    expect(ipcInvokeContractInventory.length).toBeGreaterThan(0)
    expect(new Set(ipcInvokeContractInventory.map((entry) => entry.channel)).size).toBe(
      ipcInvokeContractInventory.length,
    )
    expect([...collectDeclaredIpcChannels(resolve(process.cwd(), 'src/shared'))].sort()).toEqual(
      ipcInvokeContractInventory.map((entry) => entry.channel).sort(),
    )

    for (const entry of ipcInvokeContractInventory) {
      const definitionSource = readFileSync(resolve(process.cwd(), entry.definitionFile), 'utf8')
      expect(definitionSource).toContain(`'${entry.channel}'`)
      expect(entry.handlerFiles).not.toHaveLength(0)
      expect(entry.preloadFiles).not.toHaveLength(0)
      const handlerSource = entry.handlerFiles
        .map((file) => readFileSync(resolve(process.cwd(), file), 'utf8'))
        .join('\n')
      const preloadSource = entry.preloadFiles
        .map((file) => readFileSync(resolve(process.cwd(), file), 'utf8'))
        .join('\n')
      const handlerStem = entry.definitionName.replace(/Ipc$/u, '')
      expect(
        handlerSource.match(
          new RegExp(
            `(?:handle|registerTrustedIpcContract)\\([\\s\\S]{0,160}?${handlerStem}[\\w]*Ipc(?:Contracts)?\\.${entry.key}\\b`,
            'gu',
          ),
        ) ?? [],
        `${entry.owner}.${entry.key} handler registration count`,
      ).toHaveLength(1)
      expect(
        preloadSource.match(
          new RegExp(`invokeIpcContract\\(\\s*${entry.definitionName}\\.${entry.key}\\b`, 'gu'),
        ) ?? [],
        `${entry.owner}.${entry.key} preload invocation count`,
      ).not.toHaveLength(0)
    }
  })

  it('records every production event with producer, consumer and disposer evidence', () => {
    expect(ipcEventFlowInventory.length).toBeGreaterThan(0)
    expect(new Set(ipcEventFlowInventory.map((entry) => entry.channel)).size).toBe(
      ipcEventFlowInventory.length,
    )
    const declaredEvents = collectDeclaredIpcEvents(resolve(process.cwd(), 'src/shared'))
    expect([...declaredEvents.values()].sort()).toEqual(
      ipcEventFlowInventory.map((entry) => entry.channel).sort(),
    )
    const inventoriedReferences = new Set(
      ipcEventFlowInventory.map((entry) => `${entry.definitionName}.${entry.key}`),
    )
    expect(collectUninventoriedEventReferences(inventoriedReferences)).toEqual([])
    expect(
      collectEventReferenceViolations(
        'src/preload/rogue-helper.ts',
        `function subscribe(channel: string, listener: () => void) {
          ipcRenderer.on(channel, listener)
        }
        registerOwnedEditorListener(channel, listener)`,
        inventoriedReferences,
      ),
    ).toEqual([
      'src/preload/rogue-helper.ts:ipcRenderer.on:channel',
      'src/preload/rogue-helper.ts:registerOwnedEditorListener:channel',
    ])
    expect(
      collectEventReferenceViolations(
        'src/preload/renderer-support-api.ts',
        `function registerOwnedEditorListener(channel: string, listener: () => void) {
          ipcRenderer.on(channel, listener)
          return () => ipcRenderer.removeListener(channel, listener)
        }
        function rogue(channel: string, listener: () => void) {
          ipcRenderer.on(channel, listener)
        }`,
        inventoriedReferences,
      ),
    ).toEqual(['src/preload/renderer-support-api.ts:ipcRenderer.on:channel'])
    expect(
      collectEventReferenceViolations(
        'src/preload/rogue-bulk-dispose.ts',
        'ipcRenderer.removeAllListeners(agentIpcEvents.stream)',
        inventoriedReferences,
      ),
    ).toEqual([
      'src/preload/rogue-bulk-dispose.ts:ipcRenderer.removeAllListeners:forbidden-bulk-dispose',
    ])
    expect(
      hasExactRendererDisposer(
        createTestSource(`function subscribe() {
          const handler = () => undefined
          const otherHandler = () => undefined
          ipcRenderer.on(agentIpcEvents.stream, handler)
          return () => ipcRenderer.removeListener(agentIpcEvents.stream, otherHandler)
        }`),
        'agentIpcEvents.stream',
      ),
    ).toBe(false)
    expect(
      hasOwnedSubscriptionResultDisposer(
        createTestSource(`function subscribe() {
          const unsubscribe = adapter.onEvent(() => undefined)
          const unrelated = () => undefined
          unrelated()
          return () => undefined
        }`),
        ['onEvent'],
      ),
    ).toBe(false)
    expect(ipcEventFlowInventory.some((event) => event.payloadBoundary === 'no-payload')).toBe(true)
    expect(ipcEventFlowInventory.map((event) => event.payloadBoundary)).not.toContain(
      'typed-preload-forwarding',
    )

    for (const event of ipcEventFlowInventory) {
      const reference = `${event.definitionName}.${event.key}`
      expect(declaredEvents.get(reference), `${reference} shared definition`).toBe(event.channel)
      for (const files of [event.producerFiles, event.bridgeFiles, event.consumerFiles]) {
        expect(files).not.toHaveLength(0)
        files.forEach((file) => expect(statSync(resolve(process.cwd(), file)).isFile()).toBe(true))
      }
      expect(event.disposerFiles, `${reference} disposer inventory`).not.toHaveLength(0)
      event.disposerFiles.forEach((file) =>
        expect(statSync(resolve(process.cwd(), file)).isFile()).toBe(true),
      )

      if (event.direction === 'main-to-renderer') {
        expectBoundaryReference(event.producerFiles, reference, ['send'])
        for (const bridgeFile of event.bridgeFiles) {
          expectBoundaryReference([bridgeFile], reference, ['subscribe', 'owned-subscription'])
        }
        expectAstEvidence(event.consumerFiles, event.evidenceTerms, reference)
      } else {
        expectBoundaryReference(event.bridgeFiles, reference, ['send'])
        expectBoundaryReference(event.consumerFiles, reference, ['receive'])
        expectAstEvidence(event.producerFiles, event.evidenceTerms, reference)
      }
      expectDisposerEvidence(event, reference)
    }
  })
})

function collectFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry)
    return statSync(path).isDirectory() ? collectFiles(path) : [path]
  })
}

function collectDeclaredIpcChannels(directory: string): Set<string> {
  const channels = new Set<string>()
  const definitionFunctions = new Set(['defineIpcCall', 'defineIpcInvoke', 'defineNoArgsIpc'])

  for (const file of collectFiles(directory).filter(
    (candidate) => candidate.endsWith('.ts') && !candidate.endsWith('.test.ts'),
  )) {
    const sourceFile = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    )
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        definitionFunctions.has(node.expression.text) &&
        node.arguments[0] &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        channels.add(node.arguments[0].text)
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }

  return channels
}

function collectDeclaredIpcEvents(directory: string): Map<string, string> {
  const events = new Map<string, string>()

  for (const file of collectFiles(directory).filter(
    (candidate) => candidate.endsWith('.ts') && !candidate.endsWith('.test.ts'),
  )) {
    const sourceFile = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    )
    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text.endsWith('IpcEvents') &&
        node.initializer
      ) {
        const initializer = ts.isAsExpression(node.initializer)
          ? node.initializer.expression
          : node.initializer
        if (ts.isObjectLiteralExpression(initializer)) {
          for (const property of initializer.properties) {
            if (
              ts.isPropertyAssignment(property) &&
              ts.isIdentifier(property.name) &&
              ts.isStringLiteralLike(property.initializer)
            ) {
              events.set(`${node.name.text}.${property.name.text}`, property.initializer.text)
            }
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }

  return events
}

type EventBoundaryKind = 'subscribe' | 'unsubscribe' | 'owned-subscription' | 'send' | 'receive'

interface EventBoundaryReference {
  expressionText: string
  channelExpression: string
  kind: EventBoundaryKind
  functionOwner: string | null
  constructorName: string | null
}

function expectBoundaryReference(
  projectFiles: readonly string[],
  reference: string,
  kinds: readonly EventBoundaryKind[],
): void {
  const matches = projectFiles.flatMap((projectFile) =>
    collectEventBoundaryReferences(
      projectFile,
      readFileSync(resolve(process.cwd(), projectFile), 'utf8'),
    ).filter(
      (boundary) => boundary.channelExpression === reference && kinds.includes(boundary.kind),
    ),
  )
  expect(matches.length, `${reference} ${kinds.join('/')} AST boundary`).toBeGreaterThan(0)
}

function expectAstEvidence(
  projectFiles: readonly string[],
  evidenceTerms: readonly string[],
  reference: string,
): void {
  for (const projectFile of projectFiles) {
    const identifiers = new Set(
      collectAstIdentifiers(projectFile, readFileSync(resolve(process.cwd(), projectFile), 'utf8')),
    )
    expect(
      evidenceTerms.some((term) => identifiers.has(term)),
      `${reference} renderer API AST evidence in ${projectFile}`,
    ).toBe(true)
  }
}

function expectDisposerEvidence(
  event: (typeof ipcEventFlowInventory)[number],
  reference: string,
): void {
  for (const projectFile of event.disposerFiles) {
    if (projectFile === 'src/main/ipc/trusted-renderer-guard.ts') {
      const source = readFileSync(resolve(process.cwd(), projectFile), 'utf8')
      const sourceFile = ts.createSourceFile(projectFile, source, ts.ScriptTarget.Latest, true)
      expect(
        hasScopedListenerDisposer(sourceFile),
        `${reference} scoped listener disposer in ${projectFile}`,
      ).toBe(true)
      continue
    }
    if (event.bridgeFiles.includes(projectFile)) {
      const source = readFileSync(resolve(process.cwd(), projectFile), 'utf8')
      expect(
        hasExactRendererDisposer(
          ts.createSourceFile(projectFile, source, ts.ScriptTarget.Latest, true),
          reference,
        ),
        `${reference} exact renderer disposer in ${projectFile}`,
      ).toBe(true)
      continue
    }
    const source = readFileSync(resolve(process.cwd(), projectFile), 'utf8')
    const sourceFile = ts.createSourceFile(projectFile, source, ts.ScriptTarget.Latest, true)
    const evidenceTerms = event.disposerEvidenceTerms?.[projectFile] ?? []
    expect(
      evidenceTerms,
      `${reference} disposer evidence terms in ${projectFile}`,
    ).not.toHaveLength(0)
    expect(
      hasOwnedSubscriptionResultDisposer(sourceFile, evidenceTerms),
      `${reference} owned subscription disposer in ${projectFile}`,
    ).toBe(true)
  }
}

function hasExactRendererDisposer(sourceFile: ts.SourceFile, channelExpression: string): boolean {
  const ownedBoundary = collectEventBoundaryReferences(sourceFile.fileName, sourceFile.text).some(
    (boundary) =>
      boundary.kind === 'owned-subscription' && boundary.channelExpression === channelExpression,
  )
  if (ownedBoundary) return hasRendererListenerPair(sourceFile, 'channel', 'listener')
  return hasRendererListenerPair(sourceFile, channelExpression)
}

function hasRendererListenerPair(
  sourceFile: ts.SourceFile,
  channelExpression: string,
  listenerExpression?: string,
): boolean {
  const subscriptions: ts.CallExpression[] = []
  const collect = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      /ipcRenderer\.(?:on|once)$/u.test(node.expression.getText(sourceFile)) &&
      node.arguments[0]?.getText(sourceFile) === channelExpression &&
      (listenerExpression === undefined ||
        node.arguments[1]?.getText(sourceFile) === listenerExpression)
    ) {
      subscriptions.push(node)
    }
    ts.forEachChild(node, collect)
  }
  collect(sourceFile)

  return subscriptions.some((subscription) => {
    const listener = subscription.arguments[1]?.getText(sourceFile)
    if (!listener) return false
    const owner = findEnclosingFunctionLike(subscription) ?? sourceFile
    let matched = false
    const findRemoval = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(sourceFile) === 'ipcRenderer.removeListener' &&
        node.arguments[0]?.getText(sourceFile) === channelExpression &&
        node.arguments[1]?.getText(sourceFile) === listener
      ) {
        matched = true
      }
      ts.forEachChild(node, findRemoval)
    }
    findRemoval(owner)
    return matched
  })
}

function hasOwnedSubscriptionResultDisposer(
  sourceFile: ts.SourceFile,
  subscriptionTerms: readonly string[],
): boolean {
  const subscriptions: Array<{ declaration: ts.VariableDeclaration; variableName: string }> = []
  const collectSubscriptions = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      subscriptionTerms.includes(getCalledName(node.initializer))
    ) {
      subscriptions.push({ declaration: node, variableName: node.name.text })
    }
    ts.forEachChild(node, collectSubscriptions)
  }
  collectSubscriptions(sourceFile)

  return subscriptions.some(({ declaration, variableName }) => {
    const owner = findEnclosingFunctionLike(declaration) ?? sourceFile
    let disposed = false
    const findDisposal = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        if (ts.isIdentifier(node.expression) && node.expression.text === variableName) {
          disposed = true
        }
        if (
          getCalledName(node) === 'createIdempotentDisposer' &&
          node.arguments.some(
            (argument) => ts.isIdentifier(argument) && argument.text === variableName,
          ) &&
          hasCallableDisposerFactory(sourceFile, 'createIdempotentDisposer')
        ) {
          disposed = true
        }
      }
      ts.forEachChild(node, findDisposal)
    }
    findDisposal(owner)
    return disposed
  })
}

function hasCallableDisposerFactory(sourceFile: ts.SourceFile, factoryName: string): boolean {
  let found = false
  const visit = (node: ts.Node): void => {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === factoryName &&
      node.parameters[0] &&
      ts.isIdentifier(node.parameters[0].name)
    ) {
      const parameterName = node.parameters[0].name.text
      const findCall = (child: ts.Node): void => {
        if (
          ts.isCallExpression(child) &&
          ts.isIdentifier(child.expression) &&
          child.expression.text === parameterName
        ) {
          found = true
        }
        ts.forEachChild(child, findCall)
      }
      findCall(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

function getCalledName(node: ts.CallExpression): string {
  if (ts.isIdentifier(node.expression)) return node.expression.text
  if (ts.isPropertyAccessExpression(node.expression)) return node.expression.name.text
  return ''
}

function findEnclosingFunctionLike(node: ts.Node): ts.Node | null {
  let current: ts.Node | undefined = node.parent
  while (current) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isMethodDeclaration(current)
    ) {
      return current
    }
    current = current.parent
  }
  return null
}

function createTestSource(source: string): ts.SourceFile {
  return ts.createSourceFile('inline-test.ts', source, ts.ScriptTarget.Latest, true)
}

function hasScopedListenerDisposer(sourceFile: ts.SourceFile): boolean {
  const registrations: ts.CallExpression[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const receiver = node.expression.expression.getText(sourceFile)
      const method = node.expression.name.text
      const args = node.arguments.map((argument) => argument.getText(sourceFile))
      if (
        receiver === 'ipcMain' &&
        method === 'on' &&
        args[0] === 'channel' &&
        args[1] === 'listener'
      ) {
        registrations.push(node)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return registrations.some((registration) => {
    const owner = findEnclosingFunctionLike(registration) ?? sourceFile
    let matched = false
    const findOwnedRemoval = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(sourceFile) === 'this.disposers.push' &&
        node.arguments.some(
          (argument) =>
            (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) &&
            hasExactCall(argument, sourceFile, 'ipcMain.removeListener', 'channel', 'listener'),
        )
      ) {
        matched = true
      }
      ts.forEachChild(node, findOwnedRemoval)
    }
    findOwnedRemoval(owner)
    return matched
  })
}

function hasExactCall(
  root: ts.Node,
  sourceFile: ts.SourceFile,
  expression: string,
  ...args: string[]
): boolean {
  let matched = false
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(sourceFile) === expression &&
      args.every((argument, index) => node.arguments[index]?.getText(sourceFile) === argument)
    ) {
      matched = true
    }
    ts.forEachChild(node, visit)
  }
  visit(root)
  return matched
}

function collectAstIdentifiers(projectFile: string, source: string): string[] {
  const identifiers = new Set<string>()
  const sourceFile = ts.createSourceFile(projectFile, source, ts.ScriptTarget.Latest, true)
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) identifiers.add(node.text)
    if (
      (ts.isPropertyAccessExpression(node) || ts.isPropertyAssignment(node)) &&
      ts.isIdentifier(node.name)
    ) {
      identifiers.add(node.name.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return [...identifiers]
}

function collectUninventoriedEventReferences(inventoried: ReadonlySet<string>): string[] {
  const violations: string[] = []

  for (const file of [
    ...collectFiles(resolve(process.cwd(), 'src/main')),
    ...collectFiles(resolve(process.cwd(), 'src/preload')),
  ].filter((candidate) => candidate.endsWith('.ts') && !candidate.endsWith('.test.ts'))) {
    violations.push(
      ...collectEventReferenceViolations(
        relative(process.cwd(), file),
        readFileSync(file, 'utf8'),
        inventoried,
      ),
    )
  }

  return violations.sort()
}

function collectEventReferenceViolations(
  projectFile: string,
  source: string,
  inventoried: ReadonlySet<string>,
): string[] {
  return collectEventBoundaryReferences(projectFile, source).flatMap((boundary) => {
    if (/ipcRenderer\.removeAllListeners$/u.test(boundary.expressionText)) {
      return [`${projectFile}:${boundary.expressionText}:forbidden-bulk-dispose`]
    }
    if (
      inventoried.has(boundary.channelExpression) ||
      isApprovedDynamicChannelBoundary(projectFile, boundary)
    ) {
      return []
    }
    return [`${projectFile}:${boundary.expressionText}:${boundary.channelExpression}`]
  })
}

function collectEventBoundaryReferences(
  projectFile: string,
  source: string,
): EventBoundaryReference[] {
  const references: EventBoundaryReference[] = []
  const sourceFile = ts.createSourceFile(projectFile, source, ts.ScriptTarget.Latest, true)
  const visit = (node: ts.Node): void => {
    if (!ts.isCallExpression(node) || node.arguments.length === 0) {
      ts.forEachChild(node, visit)
      return
    }
    const expressionText = node.expression.getText(sourceFile)
    const isDirectEventBoundary =
      /ipcRenderer\.(?:on|once|send|removeListener|removeAllListeners)$/u.test(expressionText) ||
      /(?:^|\.)webContents\??\.send$/u.test(expressionText) ||
      expressionText === 'sender.send' ||
      expressionText === 'registerTrustedIpcListener' ||
      expressionText === 'ipcMain.on'
    const isChannelHelper =
      /(?:^|\.)(?:sendToOwner|sendToTabOwner)$/u.test(expressionText) ||
      expressionText === 'registerOwnedEditorListener'
    if (isDirectEventBoundary || isChannelHelper) {
      const channelArgumentIndex = /(?:^|\.)(?:sendToOwner|sendToTabOwner)$/u.test(expressionText)
        ? 1
        : 0
      const channelExpression = node.arguments[channelArgumentIndex]?.getText(sourceFile)
      references.push({
        expressionText,
        channelExpression: channelExpression ?? 'missing-channel',
        kind: classifyEventBoundary(expressionText),
        functionOwner: findEnclosingFunctionName(node),
        constructorName: findEnclosingNewExpressionName(node),
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return references
}

function classifyEventBoundary(expressionText: string): EventBoundaryKind {
  if (expressionText === 'registerOwnedEditorListener') return 'owned-subscription'
  if (/ipcRenderer\.(?:on|once)$/u.test(expressionText)) return 'subscribe'
  if (/ipcRenderer\.removeListener$/u.test(expressionText)) return 'unsubscribe'
  if (expressionText === 'registerTrustedIpcListener' || expressionText === 'ipcMain.on') {
    return 'receive'
  }
  return 'send'
}

function isApprovedDynamicChannelBoundary(
  projectFile: string,
  boundary: EventBoundaryReference,
): boolean {
  if (boundary.channelExpression !== 'channel') return false
  if (
    projectFile === 'src/main/browser/browser-manager.ts' &&
    boundary.expressionText === 'webContents.send' &&
    (boundary.functionOwner === 'sendToOwner' || boundary.functionOwner === 'sendToTabOwner')
  ) {
    return true
  }
  if (
    projectFile === 'src/main/ipc/trusted-renderer-guard.ts' &&
    boundary.expressionText === 'ipcMain.on' &&
    (boundary.functionOwner === 'on' || boundary.functionOwner === 'registerTrustedIpcListener')
  ) {
    return true
  }
  if (
    projectFile === 'src/preload/renderer-support-api.ts' &&
    (boundary.expressionText === 'ipcRenderer.on' ||
      boundary.expressionText === 'ipcRenderer.removeListener') &&
    boundary.functionOwner === 'registerOwnedEditorListener'
  ) {
    return true
  }
  if (
    projectFile === 'src/main/runtime/window-runtime.ts' &&
    /\.sendToTabOwner$/u.test(boundary.expressionText)
  ) {
    return (
      boundary.constructorName === 'BrowserTaskRuntime' ||
      boundary.constructorName === 'BrowserDownloadStore'
    )
  }
  return false
}

function findEnclosingFunctionName(node: ts.Node): string | null {
  let current: ts.Node | undefined = node.parent
  while (current) {
    if (ts.isMethodDeclaration(current) && current.name) return current.name.getText()
    if (ts.isFunctionDeclaration(current) && current.name) return current.name.text
    if (ts.isFunctionExpression(current) && current.name) return current.name.text
    current = current.parent
  }
  return null
}

function findEnclosingNewExpressionName(node: ts.Node): string | null {
  let current: ts.Node | undefined = node.parent
  while (current) {
    if (ts.isNewExpression(current)) return current.expression.getText()
    if (ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current)) return null
    current = current.parent
  }
  return null
}

function captureError(action: () => unknown): unknown {
  try {
    action()
  } catch (error) {
    return error
  }
  throw new Error('Expected action to throw')
}
