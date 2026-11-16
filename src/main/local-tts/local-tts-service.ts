import { randomUUID } from 'node:crypto'
import type {
  TtsAudio,
  TtsControl,
  TtsReport,
  TtsResult,
  TtsSnapshot,
  TtsStartInput,
} from '../../shared/local-tts'
import { TTS_VOICES } from '../../shared/local-tts'
import type { RuntimeResourceStatus } from '../../shared/ipc/runtime-components'
import type { TtsEngine } from './tts-engine'
import { speechSegments, speechText } from './tts-text'

export interface LocalTtsDependencies {
  resource(): RuntimeResourceStatus | null
  install(): Promise<{ success: boolean; error?: string }>
  createEngine(): Promise<TtsEngine>
  resolveInput(input: TtsStartInput): Promise<{ text: string; format: 'markdown' | 'plain' }>
}
const ok: TtsResult = { ok: true }
function failure(code: string, message: string): TtsResult {
  return { ok: false, error: { code, message } }
}

export class LocalTtsService {
  private state: Omit<TtsSnapshot, 'resource'> = {
    revision: 0,
    sessionId: null,
    generation: 0,
    phase: 'idle',
    wantPlaying: false,
    source: null,
    segments: [],
    index: 0,
    voice: 3,
    rate: 1,
    volume: 0.8,
    audioKey: null,
    error: null,
  }
  private engine: TtsEngine | null = null
  private audio = new Map<number, TtsAudio>()
  private filling: number | null = null
  private disposed = false
  private installing = false

  constructor(private readonly deps: LocalTtsDependencies) {}

  snapshot(): TtsSnapshot {
    return {
      ...this.state,
      segments: [...this.state.segments],
      source: this.state.source ? { ...this.state.source } : null,
      resource: this.deps.resource(),
    }
  }

  async start(input: TtsStartInput): Promise<TtsResult> {
    if (this.disposed) return failure('UNAVAILABLE', '本地朗读服务已停止')
    this.invalidate()
    const generation = this.state.generation
    this.state = {
      ...this.state,
      sessionId: randomUUID(),
      source: input.source,
      segments: [],
      index: 0,
      phase: 'loading',
      wantPlaying: true,
      error: null,
    }
    this.changed()
    try {
      const resolved = await this.deps.resolveInput(input)
      if (generation !== this.state.generation || this.disposed)
        return failure('CANCELLED', '朗读请求已取消')
      this.state.segments = speechSegments(speechText(resolved.text, resolved.format))
      if (this.deps.resource()?.health !== 'healthy') {
        this.state.phase = 'needs-model'
        this.state.wantPlaying = false
        this.changed()
        return ok
      }
      this.state.phase = 'generating'
      this.changed()
      void this.fill()
      return ok
    } catch (error) {
      if (generation !== this.state.generation) return failure('CANCELLED', '朗读请求已取消')
      return this.fail(
        'CONTENT_UNAVAILABLE',
        error instanceof Error ? error.message : '无法读取朗读内容',
      )
    }
  }

  control(input: TtsControl): TtsResult {
    if (this.disposed) return failure('UNAVAILABLE', '本地朗读服务已停止')
    if (input.sessionId !== this.state.sessionId)
      return failure('STALE_SESSION', '朗读任务已替换，请重试')
    const value = input.value
    if (input.action === 'rate' || input.action === 'volume' || input.action === 'voice') {
      if (value === undefined || !Number.isFinite(value))
        return failure('INVALID_INPUT', '设置值无效')
      if (input.action === 'rate') {
        if (value < 0.5 || value > 2) return failure('INVALID_INPUT', '语速范围为 0.5 到 2 倍')
        this.state.rate = value
      } else if (input.action === 'volume') {
        if (value < 0 || value > 1) return failure('INVALID_INPUT', '音量范围为 0 到 100%')
        this.state.volume = value
      } else {
        if (!TTS_VOICES.some((voice) => voice.id === value))
          return failure('INVALID_INPUT', '音色不存在')
        this.state.voice = value
        if (
          this.state.segments.length &&
          !['stopped', 'ended', 'needs-model'].includes(this.state.phase)
        ) {
          this.invalidate()
          this.state.phase = this.state.wantPlaying ? 'generating' : 'paused'
          void this.fill()
        }
      }
    } else if (input.action === 'stop') {
      this.invalidate()
      this.state.wantPlaying = false
      this.state.phase = 'stopped'
      this.state.error = null
    } else if (input.action === 'pause') {
      if (!this.state.wantPlaying) return ok
      this.state.wantPlaying = false
      // Only the audio transport can confirm that a playing clip actually paused.
      if (this.state.phase !== 'playing') this.state.phase = 'paused'
    } else if (input.action === 'resume' || input.action === 'seek') {
      if (!this.state.segments.length)
        return failure('NO_CONTENT', '请先从文档、网页或对话选择朗读内容')
      if (this.deps.resource()?.health !== 'healthy') {
        this.invalidate()
        this.state.wantPlaying = false
        this.state.phase = 'needs-model'
        this.changed()
        return ok
      }
      if (input.action === 'resume' && this.state.wantPlaying) return ok
      if (input.action === 'seek') {
        if (
          value === undefined ||
          !Number.isInteger(value) ||
          value < 0 ||
          value >= this.state.segments.length
        )
          return failure('INVALID_INPUT', '段落不存在')
        this.invalidate()
        this.state.index = value
      } else if (['stopped', 'ended', 'failed'].includes(this.state.phase)) {
        this.invalidate()
        if (this.state.phase !== 'failed') this.state.index = 0
      }
      this.state.error = null
      this.state.wantPlaying = true
      this.state.phase = this.audio.has(this.state.index) ? 'ready' : 'generating'
      void this.fill()
    }
    this.changed()
    return ok
  }

  getAudio(key: string): TtsAudio | null {
    const audio = this.audio.get(this.state.index)
    return audio?.key === key ? audio : null
  }

  report(input: TtsReport): void {
    if (input.sessionId !== this.state.sessionId || input.audioKey !== this.state.audioKey) return
    if (input.event === 'playing') {
      if (!this.state.wantPlaying) return
      this.state.phase = 'playing'
    } else if (input.event === 'paused') {
      if (this.state.wantPlaying) return
      this.state.phase = 'paused'
    } else if (input.event === 'error') {
      this.fail('PLAYBACK_FAILED', '音频播放失败，请点击播放重试')
      return
    } else if (input.event === 'ended') {
      // An actual ended event remains valid if pause arrived just before it.
      // Consume the finished clip, but preserve the user's paused intent.
      if (!this.audio.has(this.state.index)) return
      this.audio.delete(this.state.index)
      if (this.state.index + 1 >= this.state.segments.length) {
        this.invalidate()
        this.state.phase = 'ended'
        this.state.wantPlaying = false
      } else {
        this.state.index += 1
        this.state.audioKey = this.audio.get(this.state.index)?.key ?? null
        this.state.phase = !this.state.wantPlaying
          ? 'paused'
          : this.state.audioKey
            ? 'ready'
            : 'generating'
        void this.fill()
      }
    }
    this.changed()
  }

  install(): TtsResult {
    if (this.disposed) return failure('UNAVAILABLE', '本地朗读服务已停止')
    if (this.installing) return ok
    this.installing = true
    void this.deps
      .install()
      .then((result) => {
        if (!result.success && !this.disposed)
          this.fail('INSTALL_FAILED', result.error ?? '语音资源安装失败，请重试')
        this.changed()
      })
      .catch(() => {
        if (!this.disposed) this.fail('INSTALL_FAILED', '语音资源安装失败，请重试')
      })
      .finally(() => {
        this.installing = false
      })
    return ok
  }

  workspaceChanged(workspaceKey: string | null): void {
    if (
      this.state.source &&
      this.state.source.workspaceKey !== workspaceKey &&
      this.state.wantPlaying
    )
      this.control({ sessionId: this.state.sessionId, action: 'pause' })
  }

  dispose(): void {
    this.disposed = true
    this.invalidate()
    this.state.wantPlaying = false
    this.state.segments = []
    this.state.source = null
    this.state.phase = 'stopped'
  }

  private async fill(): Promise<void> {
    const generation = this.state.generation
    if (this.filling === generation || this.disposed) return
    this.filling = generation
    try {
      if (!this.engine) {
        const engine = await this.deps.createEngine()
        if (this.disposed || generation !== this.state.generation) {
          engine.dispose()
          return
        }
        this.engine = engine
      }
      // One current clip + one next clip. Never synthesize an unbounded article in advance.
      while (generation === this.state.generation && !this.disposed) {
        const index = [this.state.index, this.state.index + 1].find(
          (candidate) => candidate < this.state.segments.length && !this.audio.has(candidate),
        )
        if (index === undefined) break
        const generated = await this.engine.generate(this.state.segments[index], this.state.voice)
        if (generation !== this.state.generation || this.disposed) return
        const audio = { ...generated, key: `${this.state.sessionId}:${generation}:${index}` }
        this.audio.set(index, audio)
        if (index === this.state.index) {
          this.state.audioKey = audio.key
          this.state.phase = this.state.wantPlaying ? 'ready' : 'paused'
        }
        this.changed()
      }
    } catch (error) {
      if (generation === this.state.generation && !this.disposed)
        this.fail(
          'SYNTHESIS_FAILED',
          error instanceof Error ? error.message : '语音合成失败，请重试',
        )
    } finally {
      if (this.filling === generation) this.filling = null
    }
  }

  private invalidate(): void {
    this.state.generation += 1
    this.engine?.dispose()
    this.engine = null
    this.audio.clear()
    this.state.audioKey = null
    this.filling = null
  }
  private changed(): void {
    this.state.revision += 1
  }
  private fail(code: string, message: string): TtsResult {
    this.invalidate()
    this.state.phase = 'failed'
    this.state.wantPlaying = false
    this.state.error = { code, message }
    this.changed()
    return failure(code, message)
  }
}
