import { defineIpcCall } from './ipc/contract'
import type { RuntimeResourceStatus } from './ipc/runtime-components'

export const TTS_MAX_TEXT = 120_000
export const TTS_VOICES = [
  { id: 3, label: '中文女声 · zf_001' },
  { id: 58, label: '中文男声 · zm_009' },
  { id: 0, label: '英文女声 · Maple' },
] as const
export interface TtsSource {
  kind: 'markdown' | 'browser' | 'message'
  workspaceKey: string | null
  tabId?: string
  conversationId?: string
  messageId?: string
  title: string
  selection: boolean
}
export interface TtsStartInput {
  source: TtsSource
  text?: string
}
export type TtsPhase =
  | 'idle'
  | 'needs-model'
  | 'loading'
  | 'generating'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'stopped'
  | 'ended'
  | 'failed'
export interface TtsSnapshot {
  revision: number
  sessionId: string | null
  generation: number
  phase: TtsPhase
  wantPlaying: boolean
  source: TtsSource | null
  segments: string[]
  index: number
  voice: number
  rate: number
  volume: number
  audioKey: string | null
  error: { code: string; message: string } | null
  resource: RuntimeResourceStatus | null
}
export type TtsResult = { ok: true } | { ok: false; error: { code: string; message: string } }
export interface TtsAudio {
  key: string
  base64: string
  duration: number
}
export interface TtsControl {
  sessionId: string | null
  action: 'pause' | 'resume' | 'stop' | 'seek' | 'rate' | 'voice' | 'volume'
  value?: number
}
export interface TtsReport {
  sessionId: string
  audioKey: string
  event: 'playing' | 'paused' | 'ended' | 'error'
}
export const localTtsIpc = {
  getSnapshot: defineIpcCall<[], TtsSnapshot>('local-tts:get-snapshot'),
  start: defineIpcCall<[TtsStartInput], TtsResult>('local-tts:start'),
  control: defineIpcCall<[TtsControl], TtsResult>('local-tts:control'),
  audio: defineIpcCall<[string], TtsAudio | null>('local-tts:audio'),
  report: defineIpcCall<[TtsReport], void>('local-tts:report'),
  install: defineIpcCall<[], TtsResult>('local-tts:install'),
} as const
export interface LocalTtsApi {
  getSnapshot(): Promise<TtsSnapshot>
  start(input: TtsStartInput): Promise<TtsResult>
  control(input: TtsControl): Promise<TtsResult>
  audio(key: string): Promise<TtsAudio | null>
  report(input: TtsReport): Promise<void>
  install(): Promise<TtsResult>
}
