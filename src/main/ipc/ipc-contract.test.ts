import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { agentIpcContracts, agentMcpIpcContracts } from '../../shared/ipc/agent-contract'
import { agentIpc, agentMcpIpc } from '../../shared/ipc/agent'
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
import { dialogIpcContracts as dialogIpc } from '../../shared/ipc/dialog-contract'
import { fsIpcContracts } from '../../shared/ipc/fs-contract'
import { fsIpc } from '../../shared/ipc/fs'
import { settingsIpcContracts as settingsIpc } from '../../shared/ipc/settings-contract'

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
    expect(
      fsIpcContracts.saveTextDocument.parseArgs([
        { filePath: '/workspace/note.md', content: '# Note', force: true },
      ]),
    ).toEqual([{ filePath: '/workspace/note.md', content: '# Note', force: true }])
    expect(() => fsIpcContracts.readFile.parseArgs(['/workspace/bad\0path'])).toThrow()
    expect(() => fsIpcContracts.rename.parseArgs(['/workspace/old.md'])).toThrow()
    expect(() => fsIpcContracts.watchDirStop.parseArgs(['not-a-uuid'])).toThrow()
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
    expect(agentIpcContracts.getStatus.parseArgs([])).toEqual([undefined])
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
    expect(Object.keys(browserIpcEvents)).toHaveLength(8)

    expect(browserIpcContracts.createView.parseArgs(['tab-1'])).toEqual([
      'tab-1',
      undefined,
      undefined,
    ])
    expect(browserIpcContracts.getActiveViewId.parseArgs([])).toEqual([undefined])
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

  it('keeps migrated channel literals in shared declarations only', () => {
    const productionFiles = [
      'src/main/ipc/window-ipc.ts',
      'src/main/identity/identity-ipc.ts',
      'src/main/ipc/official-ipc.ts',
      'src/main/ipc/dialog-ipc.ts',
      'src/main/settings/settings-ipc.ts',
      'src/main/fs/fs-ipc.ts',
      'src/main/ipc/agent-ipc.ts',
      'src/main/agent/agent-bridge.ts',
      'src/main/mcp/permission.ts',
      'src/main/ipc/browser-ipc.ts',
      'src/main/browser/browser-manager.ts',
      'src/main/browser/browser-task-runtime.ts',
      'src/main/browser/browser-download-store.ts',
      'src/preload/renderer-support-api.ts',
      'src/preload/fs-api.ts',
      'src/preload/agent-api.ts',
      'src/preload/browser-api.ts',
      'src/preload/index.ts',
    ]
    const source = productionFiles
      .map((file) => readFileSync(resolve(process.cwd(), file), 'utf8'))
      .join('\n')

    expect(source).not.toMatch(
      /['"](?:window|identity|official|dialog|settings|fs|agent|mcp|browser|browserTask|browserActionLog|browserDownload|workbench):[A-Za-z]/,
    )
  })

  it('keeps preload-facing contract definitions free of runtime schema dependencies', () => {
    const preloadFacingFiles = [
      'src/shared/ipc/settings.ts',
      'src/shared/ipc/dialog.ts',
      'src/shared/ipc/fs.ts',
      'src/shared/ipc/agent.ts',
      'src/shared/ipc/browser.ts',
      'src/preload/index.ts',
      'src/preload/renderer-support-api.ts',
      'src/preload/fs-api.ts',
      'src/preload/agent-api.ts',
      'src/preload/browser-api.ts',
    ]
    const source = preloadFacingFiles
      .map((file) => readFileSync(resolve(process.cwd(), file), 'utf8'))
      .join('\n')

    expect(source).not.toMatch(/(?:settings|dialog|fs|agent|browser)-(?:schema|contract)/)
    expect(source).not.toMatch(/from ['"]zod['"]/)
  })
})

function captureError(action: () => unknown): unknown {
  try {
    action()
  } catch (error) {
    return error
  }
  throw new Error('Expected action to throw')
}
