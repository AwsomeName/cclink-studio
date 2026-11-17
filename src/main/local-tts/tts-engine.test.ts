import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { utilityProcess } from 'electron'
import { SherpaTtsEngine } from './tts-engine'

vi.mock('electron', () => ({ app: { isPackaged: true }, utilityProcess: { fork: vi.fn() } }))

describe('packaged TTS engine failures', () => {
  let child: EventEmitter & {
    kill: ReturnType<typeof vi.fn>
    postMessage: ReturnType<typeof vi.fn>
  }
  let engine: SherpaTtsEngine
  let release: ReturnType<typeof vi.fn>
  beforeEach(() => {
    vi.useFakeTimers()
    child = Object.assign(new EventEmitter(), { kill: vi.fn(), postMessage: vi.fn() })
    vi.mocked(utilityProcess.fork).mockReturnValue(
      child as unknown as ReturnType<typeof utilityProcess.fork>,
    )
    vi.spyOn(console, 'log').mockImplementation(() => {})
    release = vi.fn()
    engine = new SherpaTtsEngine('/private/model-fixture', release)
  })
  afterEach(() => {
    engine.dispose()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })
  it('preserves the missing native dependency error after process exit', async () => {
    const generated = engine.generate('private document text', 3)
    child.emit('message', { type: 'stage', stage: 'loading-native' })
    child.emit('message', { type: 'error', code: 'NATIVE_MODULE_MISSING', detail: 'private text' })
    child.emit('exit', 1)
    await expect(generated).rejects.toThrow('安装包缺少本机语音引擎')
    expect(release).toHaveBeenCalledTimes(1)
    const logs = JSON.stringify(vi.mocked(console.log).mock.calls)
    expect(logs).toContain('NATIVE_MODULE_MISSING')
    expect(logs).toContain('loading-native')
    expect(logs).toContain('"exitCode":1')
    expect(logs).not.toContain('private')
  })
  it('distinguishes a native library load failure from a model failure', async () => {
    const generated = engine.generate('fixture', 3)
    child.emit('message', { type: 'error', code: 'NATIVE_MODULE_LOAD_FAILED' })
    await expect(generated).rejects.toThrow('安装包中的语音引擎加载失败')
  })
  it('reports unexpected exit while loading the model without recording paths or text', async () => {
    const generated = engine.generate('private document text', 3)
    child.emit('message', { type: 'stage', stage: 'loading-model' })
    child.emit('exit', 9)
    await expect(generated).rejects.toThrow('进程已退出')
    expect(console.log).toHaveBeenLastCalledWith(
      '[LocalTTS]',
      expect.objectContaining({
        event: 'exit',
        stage: 'loading-model',
        exitCode: 9,
        expected: false,
        packaged: true,
      }),
    )
  })
})
