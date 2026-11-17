import { app, utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { TtsAudio } from '../../shared/local-tts'

export interface TtsEngine {
  generate(text: string, voice: number): Promise<Omit<TtsAudio, 'key'>>
  dispose(): void
}

export class SherpaTtsEngine implements TtsEngine {
  private child: UtilityProcess
  private pending: {
    id: string
    resolve: (audio: Omit<TtsAudio, 'key'>) => void
    reject: (error: Error) => void
  } | null = null
  private ready: Promise<void>
  private timer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private stage = 'starting'

  private diagnose(event: string, detail: Record<string, unknown> = {}): void {
    console.log('[LocalTTS]', {
      event,
      stage: this.stage,
      platform: process.platform,
      arch: process.arch,
      packaged: app.isPackaged,
      ...detail,
    })
  }

  constructor(root: string, onExit: () => void) {
    this.child = utilityProcess.fork(join(__dirname, 'tts-worker.cjs'), [root], {
      serviceName: 'CCLink local TTS',
      stdio: 'pipe',
    })
    // Native diagnostics can contain phonemes or input fragments. Drain without logging them.
    this.child.stdout?.resume()
    this.child.stderr?.resume()
    this.diagnose('spawn')
    this.ready = new Promise((resolveReady, rejectReady) => {
      this.timer = setTimeout(() => {
        this.diagnose('timeout', { code: 'MODEL_LOAD_TIMEOUT' })
        rejectReady(new Error('模型加载超时，请重试'))
        this.dispose()
      }, 30_000)
      this.child.on('message', (message: Record<string, unknown>) => {
        if (
          message.type === 'stage' &&
          (message.stage === 'loading-native' || message.stage === 'loading-model')
        ) {
          this.stage = message.stage
        } else if (message.type === 'ready') {
          this.stage = 'ready'
          this.diagnose('ready')
          this.clearTimer()
          resolveReady()
        } else if (message.type === 'error') {
          const messages: Record<string, string> = {
            NATIVE_MODULE_MISSING:
              '安装包缺少本机语音引擎，请更新或重新安装 Studio；重新下载模型不能修复此问题',
            NATIVE_MODULE_LOAD_FAILED: '安装包中的语音引擎加载失败，请更新或重新安装 Studio',
            MODEL_LOAD_FAILED: '本地语音模型加载失败，请检查或修复语音资源',
            SYNTHESIS_FAILED: '语音合成失败，请重试当前段落',
          }
          const code =
            typeof message.code === 'string' && Object.hasOwn(messages, message.code)
              ? message.code
              : 'SYNTHESIS_FAILED'
          this.diagnose('error', { code })
          rejectReady(new Error(messages[code]))
          this.pending?.reject(new Error(messages[code]))
          this.pending = null
          this.clearTimer()
        } else if (message.type === 'audio' && message.id === this.pending?.id) {
          const pending = this.pending!
          this.stage = 'ready'
          this.pending = null
          this.clearTimer()
          if (
            typeof message.base64 !== 'string' ||
            message.base64.length > 12_000_000 ||
            typeof message.duration !== 'number' ||
            !Number.isFinite(message.duration) ||
            message.duration <= 0
          ) {
            pending.reject(new Error('语音引擎返回了无效音频'))
            return
          }
          pending.resolve({ base64: message.base64, duration: message.duration })
        }
      })
      this.child.once('exit', (exitCode: number) => {
        this.diagnose('exit', { exitCode, expected: this.disposed })
        this.disposed = true
        this.clearTimer()
        rejectReady(new Error('本地语音进程已退出'))
        this.pending?.reject(new Error('本地语音进程已退出'))
        this.pending = null
        onExit()
      })
    })
    void this.ready.catch(() => undefined)
  }

  async generate(text: string, voice: number): Promise<Omit<TtsAudio, 'key'>> {
    await this.ready
    if (this.disposed) throw new Error('本地语音进程已停止')
    if (this.pending) throw new Error('语音引擎繁忙')
    return new Promise((resolve, reject) => {
      const id = randomUUID()
      this.pending = { id, resolve, reject }
      this.stage = 'synthesizing'
      this.timer = setTimeout(() => {
        this.diagnose('timeout', { code: 'SYNTHESIS_TIMEOUT' })
        reject(new Error('当前段落合成超时'))
        this.dispose()
      }, 90_000)
      this.child.postMessage({ type: 'generate', id, text, voice })
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.clearTimer()
    this.pending?.reject(new Error('已取消朗读'))
    this.pending = null
    this.child.kill()
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}
