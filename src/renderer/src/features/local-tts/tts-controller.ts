import { create } from 'zustand'
import type { TtsControl, TtsSnapshot, TtsStartInput } from '@shared/local-tts'

export const useTtsStore = create<{
  snapshot: TtsSnapshot | null
  open: boolean
  error: string | null
}>(() => ({
  snapshot: null,
  open: false,
  error: null,
}))
let audio: HTMLAudioElement | null = null
let objectUrl: string | null = null
let loadedKey: string | null = null
let loadingKey: string | null = null
let transportEpoch = 0
let consumers = 0
let timer: ReturnType<typeof setTimeout> | null = null
let polling = false
let commandEpoch = 0
let pendingCommand: number | null = null
let pollEpoch = 0
const api = () => window.cclinkStudio.localTts

function releaseAudio(): void {
  transportEpoch++
  if (audio) {
    audio.onplaying = null
    audio.onpause = null
    audio.onended = null
    audio.onerror = null
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
  }
  audio = null
  loadedKey = null
  loadingKey = null
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  objectUrl = null
}

async function applyTransport(snapshot: TtsSnapshot): Promise<void> {
  if (pendingCommand !== null || !consumers) return
  if (
    !snapshot.audioKey ||
    ['stopped', 'ended', 'failed', 'idle', 'needs-model'].includes(snapshot.phase)
  ) {
    releaseAudio()
    return
  }
  const key = snapshot.audioKey
  if (loadedKey !== key) {
    if (loadingKey === key) return
    releaseAudio()
    loadingKey = key
    const epoch = transportEpoch
    const clip = await api().audio(key)
    if (epoch !== transportEpoch) return
    loadingKey = null
    if (pendingCommand !== null || !consumers || useTtsStore.getState().snapshot?.audioKey !== key)
      return
    if (!clip) return
    if (clip.base64.length > 12_000_000) throw new Error('音频数据超出限制')
    const bytes = Uint8Array.from(atob(clip.base64), (c) => c.charCodeAt(0))
    objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }))
    const element = new Audio(objectUrl)
    audio = element
    loadedKey = key
    const report = (event: 'playing' | 'paused' | 'ended' | 'error') => {
      if (audio !== element || !snapshot.sessionId) return
      void api()
        .report({ sessionId: snapshot.sessionId, audioKey: key, event })
        .then(refreshTts)
        .catch(showError)
    }
    element.onplaying = () => {
      if (!useTtsStore.getState().snapshot?.wantPlaying) {
        element.pause()
        return
      }
      report('playing')
    }
    element.onpause = () => {
      if (!element.ended) report('paused')
    }
    element.onended = () => report('ended')
    element.onerror = () => report('error')
  }
  if (!audio) return
  snapshot = useTtsStore.getState().snapshot ?? snapshot
  audio.volume = snapshot.volume
  audio.playbackRate = snapshot.rate
  audio.preservesPitch = true
  if (snapshot.wantPlaying) {
    if (audio.paused && !audio.ended)
      void audio.play().catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        if (loadedKey === key && snapshot.sessionId && useTtsStore.getState().snapshot?.wantPlaying)
          void api()
            .report({ sessionId: snapshot.sessionId, audioKey: key, event: 'error' })
            .then(refreshTts)
            .catch(showError)
      })
  } else {
    audio.pause()
    if (snapshot.phase === 'playing' && snapshot.sessionId)
      await api().report({ sessionId: snapshot.sessionId, audioKey: key, event: 'paused' })
  }
}

function showError(error: unknown): void {
  useTtsStore.setState({
    error: error instanceof Error ? error.message : '朗读操作失败',
    open: true,
  })
}

export async function refreshTts(): Promise<void> {
  const snapshot = await api().getSnapshot()
  const previous = useTtsStore.getState().snapshot
  if (previous && snapshot.revision < previous.revision) return
  const needsAttention =
    ['needs-model', 'failed'].includes(snapshot.phase) &&
    (previous?.phase !== snapshot.phase || previous?.sessionId !== snapshot.sessionId)
  useTtsStore.setState({ snapshot, ...(needsAttention ? { open: true } : {}) })
  await applyTransport(snapshot)
}

export function attachTtsTransport(): () => void {
  consumers++
  if (consumers === 1) {
    const epoch = ++pollEpoch
    const poll = async () => {
      if (!consumers || epoch !== pollEpoch) return
      if (!polling) {
        polling = true
        try {
          await refreshTts()
        } catch (error) {
          releaseAudio()
          useTtsStore.setState({
            error: error instanceof Error ? error.message : '朗读服务暂不可用',
          })
        } finally {
          polling = false
        }
      }
      if (consumers && epoch === pollEpoch) timer = setTimeout(() => void poll(), 250)
    }
    void poll()
  }
  return () => {
    consumers = Math.max(0, consumers - 1)
    if (!consumers) {
      pollEpoch++
      if (timer) clearTimeout(timer)
      timer = null
      releaseAudio()
    }
  }
}

// Keep transport muted until a post-command snapshot supersedes all older polls.
async function settleCommand(command: number): Promise<void> {
  if (pendingCommand !== command) return
  let refreshed = false
  try {
    await refreshTts()
    refreshed = true
  } catch (error) {
    if (pendingCommand === command) {
      releaseAudio()
      showError(error)
    }
  } finally {
    if (pendingCommand === command) pendingCommand = null
  }
  const snapshot = useTtsStore.getState().snapshot
  if (refreshed && command === commandEpoch && snapshot)
    await applyTransport(snapshot).catch(showError)
}

export async function startTts(input: TtsStartInput): Promise<void> {
  const command = ++commandEpoch
  pendingCommand = command
  releaseAudio()
  useTtsStore.setState({ error: null })
  try {
    const result = await api().start(input)
    if (!result.ok && result.error.code !== 'CANCELLED') throw new Error(result.error.message)
  } catch (error) {
    if (command === commandEpoch) showError(error)
  } finally {
    await settleCommand(command)
  }
}

export async function controlTts(action: TtsControl['action'], value?: number): Promise<void> {
  const snapshot = useTtsStore.getState().snapshot
  const command = ++commandEpoch
  pendingCommand = command
  if (['stop', 'seek', 'voice'].includes(action)) releaseAudio()
  else if (action === 'pause') audio?.pause()
  try {
    const result = await api().control({ sessionId: snapshot?.sessionId ?? null, action, value })
    if (!result.ok) throw new Error(result.error.message)
    useTtsStore.setState({ error: null })
  } catch (error) {
    if (command === commandEpoch) showError(error)
  } finally {
    await settleCommand(command)
  }
}

export async function installTts(): Promise<void> {
  try {
    const result = await api().install()
    if (!result.ok) throw new Error(result.error.message)
    useTtsStore.setState({ error: null })
    await refreshTts()
  } catch (error) {
    showError(error)
  }
}
