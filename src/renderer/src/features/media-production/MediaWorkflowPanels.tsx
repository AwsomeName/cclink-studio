import { useEffect, useState } from 'react'
import type { MediaProject, MediaProjectAsset } from '@shared/media-production/media-project-types'

export type MediaWorkflowStage = 'script' | 'scenes' | 'audio' | 'export'
export const MEDIA_WORKFLOW_STAGES: {
  id: MediaWorkflowStage
  label: string
  description: string
}[] = [
  { id: 'script', label: '稿件与口播', description: '整理要讲的故事' },
  { id: 'scenes', label: '分镜与素材', description: '为每句话选择画面' },
  { id: 'audio', label: '声音', description: '旁白与背景音乐' },
  { id: 'export', label: '预览与导出', description: '检查并生成成片' },
]

type MutateProject = (recipe: (current: MediaProject) => MediaProject) => void

export function MediaScriptPanel({
  draft,
  mutate,
  selectScene,
}: {
  draft: MediaProject
  mutate: MutateProject
  selectScene: (id: string) => void
}): React.ReactElement {
  return (
    <section className="media-workflow-page" aria-label="稿件与口播编辑">
      <div className="media-section-heading">
        <div>
          <h2>先把故事讲清楚</h2>
          <p>逐段整理口播，再为它选择画面。口播文字不会自动变成声音。</p>
        </div>
        <span className="media-status-badge">目标 {draft.brief.targetDurationSeconds} 秒</span>
      </div>
      <details className="media-source-card">
        <summary>查看原稿快照 · {draft.source.path.split(/[\\/]/).at(-1)}</summary>
        <p>{draft.source.path}</p>
        <pre>{draft.source.snapshot}</pre>
      </details>
      <div className="media-script-cards">
        {draft.scenes.map((scene, index) => {
          const estimatedSeconds = Math.ceil(scene.narration.replace(/\s/g, '').length / 4)
          return (
            <article className="media-script-card" key={scene.id}>
              <div className="media-section-heading">
                <strong>
                  {String(index + 1).padStart(2, '0')} ·{' '}
                  {index === 0 ? '开场' : index === draft.scenes.length - 1 ? '结尾' : '展开'}
                </strong>
                <button type="button" onClick={() => selectScene(scene.id)}>
                  选择这一段的画面 →
                </button>
              </div>
              <label>
                第 {index + 1} 段口播
                <textarea
                  aria-label={`第 ${index + 1} 段口播`}
                  value={scene.narration}
                  maxLength={4000}
                  onChange={(event) => {
                    const narration = event.target.value
                    mutate((current) => ({
                      ...current,
                      scenes: current.scenes.map((item) =>
                        item.id === scene.id ? { ...item, narration } : item,
                      ),
                    }))
                  }}
                />
              </label>
              <div className="media-script-meta">
                <span>
                  画面 {scene.durationSeconds} 秒 · 口播估算约 {estimatedSeconds} 秒（按每秒 4
                  字，仅供参考）
                </span>
                {estimatedSeconds > scene.durationSeconds * 1.5 && (
                  <span className="media-attention">建议精简口播或增加镜头时长</span>
                )}
              </div>
              <label>
                第 {index + 1} 段字幕
                <input
                  aria-label={`第 ${index + 1} 段字幕`}
                  value={scene.subtitle}
                  maxLength={1000}
                  onChange={(event) => {
                    const subtitle = event.target.value
                    mutate((current) => ({
                      ...current,
                      scenes: current.scenes.map((item) =>
                        item.id === scene.id ? { ...item, subtitle } : item,
                      ),
                    }))
                  }}
                />
              </label>
            </article>
          )
        })}
      </div>
    </section>
  )
}

export function MediaAudioPanel({
  draft,
  mutate,
  importAudio,
}: {
  draft: MediaProject
  mutate: MutateProject
  importAudio: (target: 'narration' | 'music') => Promise<void>
}): React.ReactElement {
  const settings = draft.renderSettings ?? {
    logoAssetId: null,
    musicAssetId: null,
    narrationAssetId: null,
    musicVolume: 0.18,
    transition: 'cut' as const,
  }
  const audioAssets = (draft.assets ?? []).filter((asset) => asset.kind === 'audio')
  return (
    <section className="media-workflow-page" aria-label="声音设置">
      <div className="media-section-heading">
        <div>
          <h2>让声音带着画面走</h2>
          <p>导入整条旁白，按声音在分镜中调整时长，再加入背景音乐。</p>
        </div>
      </div>
      <div className="media-audio-grid">
        {(['narration', 'music'] as const).map((target) => {
          const field = target === 'narration' ? 'narrationAssetId' : 'musicAssetId'
          const label = target === 'narration' ? '旁白音频' : '背景音乐'
          const selected = audioAssets.find((asset) => asset.id === settings[field])
          return (
            <article className="media-audio-card" key={target}>
              <div className="media-section-heading">
                <h3>{label}</h3>
                <span className="media-status-badge">{selected ? '已添加' : '未添加 · 可选'}</span>
              </div>
              <p>
                {target === 'narration'
                  ? '从第 0 秒开始播放，不循环；超出成片时长的部分会被截断，不足部分留白。'
                  : '循环铺满成片，支持手动调低音量与开头、结尾淡入淡出。'}
              </p>
              <label>
                {label}
                <select
                  aria-label={label}
                  value={settings[field] ?? ''}
                  onChange={(event) => {
                    const id = event.target.value || null
                    mutate((current) => ({
                      ...current,
                      renderSettings: { ...settings, [field]: id },
                    }))
                  }}
                >
                  <option value="">不添加</option>
                  {audioAssets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.fileName}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={() => void importAudio(target)}>
                导入{label}
              </button>
              {selected && <MediaAudioPreview asset={selected} />}
              {target === 'music' && (
                <label>
                  背景音量 · {Math.round(settings.musicVolume * 100)}%
                  <input
                    aria-label="背景音量"
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    disabled={!selected}
                    value={settings.musicVolume}
                    onChange={(event) => {
                      const musicVolume = Number(event.target.value)
                      mutate((current) => ({
                        ...current,
                        renderSettings: { ...settings, musicVolume },
                      }))
                    }}
                  />
                </label>
              )}
            </article>
          )
        })}
      </div>
      <div className="media-capability-note">
        <strong>当前声音能力</strong>
        <p>
          已支持旁白和音乐导入、试听与混音导出。AI
          配音、按语音自动对齐镜头、自动压低背景音乐尚未接入。
        </p>
        <p>镜头素材原声暂不带入成片；不添加旁白和音乐时将导出静音视频。</p>
      </div>
    </section>
  )
}

function MediaAudioPreview({ asset }: { asset: MediaProjectAsset }): React.ReactElement {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setUrl(null)
    setError(null)
    void window.cclinkStudio.fs
      .renderFile(asset.path)
      .then((result) => {
        if (cancelled) return
        if (result.kind === 'media' && result.playable && result.content && result.mimeType) {
          setUrl(`data:${result.mimeType};base64,${result.content}`)
        } else setError('此音频暂不能在页面试听，可导出后检查')
      })
      .catch(() => {
        if (!cancelled) setError('音频读取失败，请重新导入')
      })
    return () => {
      cancelled = true
    }
  }, [asset.path])
  return url ? (
    <audio key={url} controls src={url} aria-label={`试听 ${asset.fileName}`} />
  ) : (
    <p>{error ?? '正在加载试听…'}</p>
  )
}
