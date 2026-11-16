import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TtsSnapshot } from '@shared/local-tts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const clip = { key: 's:1:0', base64: 'UklGRg==', duration: 1 }
let detach: (() => void) | undefined
const instances: Array<{ play: ReturnType<typeof vi.fn> }> = []
class TestAudio {
  paused = true
  ended = false
  play = vi.fn(async () => {
    this.paused = false
  })
  pause() {
    this.paused = true
  }
  load() {}
  removeAttribute() {}
  constructor() {
    instances.push(this)
  }
}
function setup() {
  let snapshot: TtsSnapshot = {
    revision: 1,
    sessionId: 's',
    generation: 1,
    phase: 'ready',
    wantPlaying: true,
    source: null,
    segments: ['正文'],
    index: 0,
    voice: 3,
    rate: 1,
    volume: 0.8,
    audioKey: clip.key,
    error: null,
    resource: null,
  }
  const audio = deferred<typeof clip | null>()
  const control = deferred<{ ok: true }>()
  const api = {
    getSnapshot: vi.fn(async () => ({ ...snapshot })),
    audio: vi
      .fn()
      .mockImplementationOnce(() => audio.promise)
      .mockResolvedValue(clip),
    control: vi.fn(() => control.promise),
    report: vi.fn(async () => {}),
  }
  vi.stubGlobal('window', { cclinkStudio: { localTts: api } })
  return {
    audio,
    control,
    api,
    setSnapshot: (patch: Partial<TtsSnapshot>) => {
      snapshot = { ...snapshot, ...patch, revision: snapshot.revision + 1 }
    },
  }
}
beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  instances.length = 0
  vi.stubGlobal('Audio', TestAudio)
})
afterEach(() => {
  detach?.()
  detach = undefined
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
describe('TTS audio transport races', () => {
  it('retries an audio fetch interrupted by a preference command', async () => {
    const f = setup()
    const controller = await import('./tts-controller')
    detach = controller.attachTtsTransport()
    await vi.advanceTimersByTimeAsync(0)
    expect(f.api.audio).toHaveBeenCalledTimes(1)
    const operation = controller.controlTts('rate', 1.5)
    f.audio.resolve(clip)
    await vi.advanceTimersByTimeAsync(0)
    expect(instances).toHaveLength(0)
    f.setSnapshot({ rate: 1.5 })
    f.control.resolve({ ok: true })
    await operation
    expect(f.api.audio).toHaveBeenCalledTimes(2)
    expect(instances).toHaveLength(1)
    expect(instances[0].play).toHaveBeenCalledTimes(1)
  })
  it('never plays a late audio response after stop', async () => {
    const f = setup()
    const controller = await import('./tts-controller')
    detach = controller.attachTtsTransport()
    await vi.advanceTimersByTimeAsync(0)
    const operation = controller.controlTts('stop')
    f.setSnapshot({ phase: 'stopped', wantPlaying: false, audioKey: null })
    f.control.resolve({ ok: true })
    await operation
    f.audio.resolve(clip)
    await vi.advanceTimersByTimeAsync(300)
    expect(instances).toHaveLength(0)
  })
  it('does not let an old snapshot replay audio while stop awaits its fresh snapshot', async () => {
    const f = setup()
    const controller = await import('./tts-controller')
    detach = controller.attachTtsTransport()
    f.audio.resolve(clip)
    await vi.advanceTimersByTimeAsync(0)
    expect(instances).toHaveLength(1)
    const old = deferred<TtsSnapshot>()
    const fresh = deferred<TtsSnapshot>()
    const oldValue = await f.api.getSnapshot()
    f.api.getSnapshot
      .mockImplementationOnce(() => old.promise)
      .mockImplementationOnce(() => fresh.promise)
    const oldRefresh = controller.refreshTts()
    const stop = controller.controlTts('stop')
    f.control.resolve({ ok: true })
    await vi.advanceTimersByTimeAsync(0)
    old.resolve(oldValue)
    await oldRefresh
    expect(instances).toHaveLength(1)
    fresh.resolve({
      ...oldValue,
      revision: 2,
      phase: 'stopped',
      audioKey: null,
      wantPlaying: false,
    })
    await stop
  })

  it('opens first-use setup for a native menu request without reopening after dismissal', async () => {
    const f = setup()
    f.setSnapshot({ phase: 'needs-model', wantPlaying: false, audioKey: null })
    const controller = await import('./tts-controller')
    detach = controller.attachTtsTransport()
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.useTtsStore.getState().open).toBe(true)
    controller.useTtsStore.setState({ open: false })
    await vi.advanceTimersByTimeAsync(300)
    expect(controller.useTtsStore.getState().open).toBe(false)
  })
  it('lets a new source play without waiting for an older unresolved content request', async () => {
    const f = setup()
    const stale = deferred<{ ok: false; error: { code: string; message: string } }>()
    Object.assign(f.api, {
      start: vi
        .fn()
        .mockImplementationOnce(() => stale.promise)
        .mockImplementation(async () => {
          f.setSnapshot({
            sessionId: 'new',
            generation: 2,
            audioKey: 'new:2:0',
            phase: 'ready',
            wantPlaying: true,
          })
          return { ok: true }
        }),
    })
    const controller = await import('./tts-controller')
    detach = controller.attachTtsTransport()
    f.audio.resolve(clip)
    await vi.advanceTimersByTimeAsync(0)
    const input = {
      source: { kind: 'markdown' as const, workspaceKey: null, title: 'test', selection: false },
      text: '正文',
    }
    const first = controller.startTts(input)
    await controller.startTts(input)
    expect(instances).toHaveLength(2)
    expect(instances[1].play).toHaveBeenCalledTimes(1)
    stale.resolve({ ok: false, error: { code: 'CANCELLED', message: 'cancelled' } })
    await first
    expect(controller.useTtsStore.getState().error).toBeNull()
  })
})
