import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defineIpcInvoke, defineNoArgsIpc } from '../../shared/ipc/contract'
import { dialogIpcContracts as dialogIpc } from '../../shared/ipc/dialog-contract'
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

  it('keeps migrated channel literals in shared declarations only', () => {
    const productionFiles = [
      'src/main/ipc/window-ipc.ts',
      'src/main/identity/identity-ipc.ts',
      'src/main/ipc/official-ipc.ts',
      'src/main/ipc/dialog-ipc.ts',
      'src/main/settings/settings-ipc.ts',
      'src/preload/renderer-support-api.ts',
      'src/preload/index.ts',
    ]
    const source = productionFiles
      .map((file) => readFileSync(resolve(process.cwd(), file), 'utf8'))
      .join('\n')

    expect(source).not.toMatch(/['"](?:window|identity|official|dialog|settings):[A-Za-z]/)
  })

  it('keeps preload-facing contract definitions free of runtime schema dependencies', () => {
    const preloadFacingFiles = [
      'src/shared/ipc/settings.ts',
      'src/shared/ipc/dialog.ts',
      'src/preload/index.ts',
      'src/preload/renderer-support-api.ts',
    ]
    const source = preloadFacingFiles
      .map((file) => readFileSync(resolve(process.cwd(), file), 'utf8'))
      .join('\n')

    expect(source).not.toMatch(/(?:settings|dialog)-(?:schema|contract)/)
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
