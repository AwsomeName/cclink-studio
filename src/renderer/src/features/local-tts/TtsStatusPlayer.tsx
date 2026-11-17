import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { TTS_VOICES, type TtsPhase } from '@shared/local-tts'
import { attachTtsTransport, controlTts, installTts, useTtsStore } from './tts-controller'
import { TtsIcon } from './TtsButton'
import { executeTtsCommand } from './tts-commands'
import { useTabStore } from '../../stores/tab-store'
import { useFloatingSurfaceRegistration } from '../../components/common/floating-surface-registry'
import { useEscapeDismiss } from '../../components/common/dismissable-layer'
import './local-tts.css'

const labels: Record<TtsPhase, string> = {
  idle: '选择内容开始朗读',
  'needs-model': '请安装语音资源',
  loading: '正在读取内容',
  generating: '正在生成语音',
  ready: '准备播放',
  playing: '播放中',
  paused: '已暂停',
  stopped: '已停止',
  ended: '朗读完成',
  failed: '朗读失败',
}

export function TtsStatusPlayer(): React.ReactElement {
  const { snapshot, open, error } = useTtsStore()
  const contentType = useTabStore(
    (state) => state.tabs.find((tab) => tab.id === state.activeTabId)?.type,
  )
  const canRead = contentType === 'editor' || contentType === 'browser'
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const [position, setPosition] = useState({ left: 12, bottom: 32 })
  const close = () => {
    useTtsStore.setState({ open: false })
    triggerRef.current?.focus()
  }
  useEffect(attachTtsTransport, [])
  useFloatingSurfaceRegistration(open)
  useEscapeDismiss(open, close)
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const rect = rootRef.current?.getBoundingClientRect()
      if (rect)
        setPosition({
          left: Math.max(8, Math.min(rect.left, window.innerWidth - 428)),
          bottom: window.innerHeight - rect.top + 8,
        })
    }
    place()
    window.addEventListener('resize', place)
    const outside = (event: PointerEvent) => {
      if (
        !rootRef.current?.contains(event.target as Node) &&
        !panelRef.current?.contains(event.target as Node)
      )
        useTtsStore.setState({ open: false })
    }
    document.addEventListener('pointerdown', outside)
    return () => {
      window.removeEventListener('resize', place)
      document.removeEventListener('pointerdown', outside)
    }
  }, [open])
  const active =
    !!snapshot?.segments.length && !['idle', 'ended', 'stopped'].includes(snapshot.phase)
  const playing = snapshot?.wantPlaying === true
  const resource = snapshot?.resource
  const installing =
    resource && ['downloading', 'verifying', 'installing', 'checking'].includes(resource.phase)
  const healthy = resource?.health === 'healthy'
  const label = error ? '朗读暂不可用' : snapshot ? labels[snapshot.phase] : '连接朗读服务'
  const toggle = () => void controlTts(playing ? 'pause' : 'resume')

  return (
    <div
      className={`tts-status-root${active ? ' active' : ''}`}
      ref={rootRef}
      data-testid="tts-status-player"
    >
      <button
        type="button"
        className="tts-status-title"
        ref={triggerRef}
        title={`${snapshot?.source?.title ?? '本地朗读'} · ${label}`}
        aria-label="展开本地朗读播放器"
        aria-expanded={open}
        aria-controls="tts-player-panel"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => useTtsStore.setState({ open: !open })}
      >
        <TtsIcon />
        <span>{active ? snapshot?.source?.title : '朗读'}</span>
      </button>
      {snapshot?.segments.length ? (
        <>
          <button
            type="button"
            onClick={toggle}
            title={playing ? '暂停朗读' : '继续朗读'}
            aria-label={playing ? '暂停朗读' : '继续朗读'}
          >
            {playing ? 'Ⅱ' : '▶'}
          </button>
          <button
            type="button"
            className="tts-secondary-control"
            onClick={() => void controlTts('seek', snapshot.index + 1)}
            disabled={snapshot.index + 1 >= snapshot.segments.length || !healthy}
            title="下一段"
            aria-label="下一段"
          >
            ▸│
          </button>
          <button
            type="button"
            onClick={() => void controlTts('stop')}
            disabled={!active}
            title="停止朗读"
            aria-label="停止朗读"
          >
            ■
          </button>
          <button
            type="button"
            className="tts-secondary-control"
            onClick={() => useTtsStore.setState({ open: true })}
            title="语速与音色"
          >
            {snapshot.rate}×
          </button>
        </>
      ) : null}
      {open &&
        createPortal(
          <section
            className="tts-player-panel"
            id="tts-player-panel"
            ref={panelRef}
            style={position}
            role="dialog"
            aria-label="本地朗读播放器"
          >
            <header>
              <TtsIcon />
              <strong>本地朗读</strong>
              <span className="tts-panel-state" role="status">
                {label}
              </span>
              <button type="button" onClick={close} aria-label="收起朗读播放器">
                ⌄
              </button>
            </header>
            <div className="tts-start-actions">
              <button
                type="button"
                className="tts-primary"
                disabled={!canRead}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void executeTtsCommand('tts.read')}
              >
                朗读当前内容
              </button>
              <button
                type="button"
                disabled={!canRead}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void executeTtsCommand('tts.readSelection')}
              >
                朗读选中内容
              </button>
            </div>
            {!canRead && <p className="tts-empty">打开 Markdown 文档或网页后开始朗读。</p>}
            {(error || snapshot?.error) && (
              <p className="tts-error" role="alert">
                {error || snapshot?.error?.message}
              </p>
            )}
            {!healthy && (
              <div className="tts-model-setup">
                <strong>中文与英文语音资源</strong>
                <p>首次下载约 348 MiB，安装后可离线朗读。文本不上传。</p>
                {installing ? (
                  <>
                    <progress max="100" value={resource.progress?.percent ?? undefined} />
                    <span role="status">
                      {resource.phase === 'downloading'
                        ? `下载中 ${resource.progress?.percent ?? 0}%`
                        : '校验并安装中…'}
                    </span>
                  </>
                ) : (
                  <button type="button" onClick={() => void installTts()} disabled={!resource}>
                    {resource?.health === 'damaged' || resource?.phase === 'failed'
                      ? '重新安装语音资源'
                      : '下载并安装'}
                  </button>
                )}
                {resource?.failure && <p className="tts-error">{resource.failure.message}</p>}
              </div>
            )}
            {snapshot?.segments.length ? (
              <>
                <div className="tts-source-info">
                  <strong>{snapshot.source?.title}</strong>
                  <span>
                    第 {snapshot.index + 1} / {snapshot.segments.length} 段
                    {snapshot.source?.selection ? ' · 选区' : ''}
                  </span>
                </div>
                <div className="tts-transcript" aria-label="朗读段落">
                  {snapshot.segments.map((text, index) => (
                    <button
                      type="button"
                      key={index}
                      aria-current={index === snapshot.index ? 'step' : undefined}
                      onClick={() => void controlTts('seek', index)}
                      disabled={!healthy}
                    >
                      <span>{index + 1}</span>
                      {text}
                    </button>
                  ))}
                </div>
                <div className="tts-panel-transport">
                  <button
                    type="button"
                    onClick={() => void controlTts('seek', snapshot.index - 1)}
                    disabled={snapshot.index === 0 || !healthy}
                  >
                    上一段
                  </button>
                  <button
                    type="button"
                    className="tts-primary"
                    onClick={toggle}
                    disabled={!healthy}
                  >
                    {playing ? '暂停' : '播放'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void controlTts('seek', snapshot.index + 1)}
                    disabled={snapshot.index + 1 >= snapshot.segments.length || !healthy}
                  >
                    下一段
                  </button>
                  <button type="button" onClick={() => void controlTts('stop')}>
                    停止
                  </button>
                </div>
              </>
            ) : (
              <p className="tts-empty">选择上方操作开始朗读；朗读选区前，请先在正文中选中文字。</p>
            )}
            <div className="tts-preferences">
              <label>
                音色
                <select
                  aria-label="朗读音色"
                  value={snapshot?.voice ?? 3}
                  onChange={(event) => void controlTts('voice', Number(event.target.value))}
                >
                  {TTS_VOICES.map((voice) => (
                    <option key={voice.id} value={voice.id}>
                      {voice.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                语速
                <select
                  aria-label="朗读语速"
                  value={snapshot?.rate ?? 1}
                  onChange={(event) => void controlTts('rate', Number(event.target.value))}
                >
                  {[0.75, 1, 1.25, 1.5, 2].map((rate) => (
                    <option key={rate} value={rate}>
                      {rate}×
                    </option>
                  ))}
                </select>
              </label>
              <label>
                音量
                <input
                  aria-label="朗读音量"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={snapshot?.volume ?? 0.8}
                  onChange={(event) => void controlTts('volume', Number(event.target.value))}
                />
              </label>
            </div>
            <footer>本机合成 · Kokoro v1.1-zh{healthy ? ' · 离线可用' : ''}</footer>
          </section>,
          document.body,
        )}
    </div>
  )
}
