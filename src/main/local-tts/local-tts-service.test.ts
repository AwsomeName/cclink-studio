import { describe, expect, it, vi } from 'vitest'
import { LocalTtsService } from './local-tts-service'
import type { TtsEngine } from './tts-engine'
import type { RuntimeResourceStatus } from '../../shared/ipc/runtime-components'
import { localTtsIpcContracts } from '../../shared/local-tts-contract'
import { speechSegments, speechText } from './tts-text'

const source = {
  kind: 'markdown' as const,
  workspaceKey: '/a',
  tabId: 't1',
  title: 'note.md',
  selection: false,
}
function fixture(healthy = true) {
  const engine: TtsEngine = {
    generate: vi.fn(async () => ({ base64: 'YXVkaW8=', duration: 1 })),
    dispose: vi.fn(),
  }
  const service = new LocalTtsService({
    resource: () => ({ health: healthy ? 'healthy' : 'not-installed' }) as RuntimeResourceStatus,
    install: async () => ({ success: true }),
    createEngine: async () => engine,
    resolveInput: async (input) => ({ text: input.text ?? '', format: 'markdown' }),
  })
  return { service, engine }
}
describe('local TTS ownership and cancellation', () => {
  it('requires actual playback events and only prefetches one next segment', async () => {
    const { service, engine } = fixture()
    await service.start({ source, text: '第一段。\n\n第二段。\n\n第三段。' })
    await vi.waitFor(() => expect(engine.generate).toHaveBeenCalledTimes(2))
    const s = service.snapshot()
    expect(s.phase).toBe('ready')
    service.report({ sessionId: s.sessionId!, audioKey: s.audioKey!, event: 'playing' })
    expect(service.snapshot().phase).toBe('playing')
    service.report({ sessionId: s.sessionId!, audioKey: s.audioKey!, event: 'ended' })
    expect(service.snapshot().index).toBe(1)
    await vi.waitFor(() => expect(engine.generate).toHaveBeenCalledTimes(3))
    service.dispose()
  })
  it('rejects old ended events after replacement and stops the worker', async () => {
    const { service, engine } = fixture()
    await service.start({ source, text: '旧的内容。' })
    await vi.waitFor(() => expect(service.snapshot().audioKey).not.toBeNull())
    const old = service.snapshot()
    await service.start({ source, text: '新的内容。\n\n另一段。' })
    service.report({ sessionId: old.sessionId!, audioKey: old.audioKey!, event: 'ended' })
    expect(service.snapshot().index).toBe(0)
    expect(service.snapshot().segments[0]).toBe('新的内容。')
    expect(engine.dispose).toHaveBeenCalled()
    service.control({ sessionId: service.snapshot().sessionId, action: 'stop' })
    expect(service.snapshot().audioKey).toBeNull()
    expect(service.getAudio(old.audioKey!)).toBeNull()
    service.dispose()
  })
  it('ignores late synthesis after stop and leaves other operations responsive', async () => {
    let complete!: (value: { base64: string; duration: number }) => void
    const { service, engine } = fixture()
    vi.mocked(engine.generate).mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
    await service.start({ source, text: '等待生成。' })
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'))
    service.control({ sessionId: service.snapshot().sessionId, action: 'stop' })
    complete({ base64: 'late', duration: 2 })
    await Promise.resolve()
    expect(service.snapshot().phase).toBe('stopped')
    expect(service.snapshot().audioKey).toBeNull()
    service.dispose()
  })
  it('pauses on workspace change and waits for actual pause acknowledgement', async () => {
    const { service } = fixture()
    await service.start({ source, text: '一段正文。' })
    await vi.waitFor(() => expect(service.snapshot().audioKey).not.toBeNull())
    const s = service.snapshot()
    service.report({ sessionId: s.sessionId!, audioKey: s.audioKey!, event: 'playing' })
    service.workspaceChanged('/b')
    expect(service.snapshot().wantPlaying).toBe(false)
    expect(service.snapshot().phase).toBe('playing')
    service.report({ sessionId: s.sessionId!, audioKey: s.audioKey!, event: 'paused' })
    expect(service.snapshot().phase).toBe('paused')
    service.dispose()
  })
  it('keeps duplicate resume idempotent while audio is already playing', async () => {
    const { service } = fixture()
    await service.start({ source, text: '第一段。\n\n第二段。' })
    await vi.waitFor(() => expect(service.snapshot().audioKey).not.toBeNull())
    const s = service.snapshot()
    service.report({ sessionId: s.sessionId!, audioKey: s.audioKey!, event: 'playing' })
    service.control({ sessionId: s.sessionId, action: 'resume' })
    expect(service.snapshot().phase).toBe('playing')
    service.report({ sessionId: s.sessionId!, audioKey: s.audioKey!, event: 'ended' })
    expect(service.snapshot().index).toBe(1)
    service.dispose()
  })
  it('advances a clip that ended concurrently with pause without resuming playback', async () => {
    const { service } = fixture()
    await service.start({ source, text: '第一段。\n\n第二段。' })
    await vi.waitFor(() => expect(service.snapshot().audioKey).not.toBeNull())
    const s = service.snapshot()
    service.report({ sessionId: s.sessionId!, audioKey: s.audioKey!, event: 'playing' })
    service.control({ sessionId: s.sessionId, action: 'pause' })
    service.report({ sessionId: s.sessionId!, audioKey: s.audioKey!, event: 'paused' })
    service.report({ sessionId: s.sessionId!, audioKey: s.audioKey!, event: 'ended' })
    expect(service.snapshot().index).toBe(1)
    expect(service.snapshot().wantPlaying).toBe(false)
    expect(service.snapshot().phase).toBe('paused')
    service.control({ sessionId: s.sessionId, action: 'resume' })
    await vi.waitFor(() => expect(service.snapshot().audioKey).not.toBeNull())
    expect(service.snapshot().audioKey).not.toBe(s.audioKey)
    service.dispose()
  })
  it('keeps completed state after a late pause and restarts from the beginning', async () => {
    const { service } = fixture()
    await service.start({ source, text: '第一段。\n\n最后一段。' })
    await vi.waitFor(() => expect(service.snapshot().audioKey).not.toBeNull())
    service.control({ sessionId: service.snapshot().sessionId, action: 'seek', value: 1 })
    await vi.waitFor(() => expect(service.snapshot().audioKey).not.toBeNull())
    const s = service.snapshot()
    service.report({ sessionId: s.sessionId!, audioKey: s.audioKey!, event: 'playing' })
    service.report({ sessionId: s.sessionId!, audioKey: s.audioKey!, event: 'ended' })
    service.control({ sessionId: s.sessionId, action: 'pause' })
    expect(service.snapshot().phase).toBe('ended')
    service.control({ sessionId: s.sessionId, action: 'resume' })
    expect(service.snapshot().index).toBe(0)
    service.dispose()
  })
  it('retains a bounded request for first-use installation without starting a worker', async () => {
    const { service, engine } = fixture(false)
    await service.start({ source, text: '尚未安装。' })
    expect(service.snapshot().phase).toBe('needs-model')
    expect(engine.generate).not.toHaveBeenCalled()
    service.dispose()
  })
})
describe('speech input boundaries', () => {
  it('keeps link labels and image descriptions but skips code fences', () => {
    const text = speechText(
      '# 标题\n\n[正文](https://secret.example/token)\n\n```sh\nrm -rf demo\n```\n\n![示意图](secret.png)',
      'markdown',
    )
    expect(text).toContain('标题')
    expect(text).toContain('正文')
    expect(text).toContain('图片：示意图')
    expect(text).not.toContain('https:')
    expect(text).not.toContain('rm -rf')
    expect(text).not.toContain('secret.png')
  })
  it('bounds unpunctuated paragraphs and rejects oversized IPC content', () => {
    const segments = speechSegments('长'.repeat(1800))
    expect(segments.every((s) => s.length <= 220)).toBe(true)
    expect(segments.join('')).toBe('长'.repeat(1800))
    expect(() =>
      localTtsIpcContracts.start.parseArgs([{ source, text: 'a'.repeat(120001) }]),
    ).toThrow()
    expect(() =>
      localTtsIpcContracts.report.parseArgs([{ sessionId: 'a', audioKey: 'b', event: 'success' }]),
    ).toThrow()
  })
})
