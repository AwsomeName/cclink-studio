import { afterEach, describe, expect, it, vi } from 'vitest'
import { pasteClipboardToTerminal } from './terminal-context-surface'

afterEach(() => vi.unstubAllGlobals())

describe('pasteClipboardToTerminal', () => {
  it('writes clipboard bytes without appending a submit character', async () => {
    const writePty = vi.fn().mockResolvedValue({ success: true })
    vi.stubGlobal('window', { cclinkStudio: { terminal: { writePty } } })

    await pasteClipboardToTerminal('terminal-1', async () => 'npm login')

    expect(writePty).toHaveBeenCalledWith({
      terminalSessionId: 'terminal-1',
      data: 'npm login',
    })
  })

  it('surfaces a bounded Terminal write failure', async () => {
    vi.stubGlobal('window', {
      cclinkStudio: {
        terminal: {
          writePty: vi.fn().mockResolvedValue({ success: false, error: 'session gone' }),
        },
      },
    })

    await expect(pasteClipboardToTerminal('terminal-1', async () => 'pwd')).rejects.toThrow(
      'session gone',
    )
  })
})
