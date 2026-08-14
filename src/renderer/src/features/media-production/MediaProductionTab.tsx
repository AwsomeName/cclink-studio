import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  MediaAspectRatio,
  MediaProject,
  MediaProjectPlatform,
  MediaProjectScene,
  MediaStoryboardProposal,
} from '@shared/media-production/media-project-types'
import type { Tab } from '../../types'
import { useCommandStore } from '../../stores/command-store'
import { useTabStore } from '../../stores/tab-store'
import { useToastStore } from '../../components/common/Toast'
import { registerMediaProjectDraft } from './media-project-draft-registry'
import './media-production.css'

const PLATFORM_LABELS: Record<MediaProjectPlatform, string> = {
  douyin: '抖音',
  xiaohongshu: '小红书',
  'wechat-video': '视频号',
  bilibili: 'B 站',
  web: '官网',
}

export function MediaProductionTab({ tab }: { tab: Tab }): React.ReactElement {
  const projectId = tab.mediaProject?.projectId
  const workspacePath = tab.workspaceRef?.kind === 'local' ? tab.workspaceRef.path : null
  const [project, setProject] = useState<MediaProject | null>(null)
  const [draft, setDraft] = useState<MediaProject | null>(null)
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [generatingStoryboard, setGeneratingStoryboard] = useState(false)
  const [storyboardProposal, setStoryboardProposal] = useState<MediaStoryboardProposal | null>(null)
  const [error, setError] = useState<string | null>(null)
  const updateTabDirty = useTabStore((state) => state.updateTabDirty)
  const updateTabTitle = useTabStore((state) => state.updateTabTitle)
  const executeCommand = useCommandStore((state) => state.executeCommand)
  const showToast = useToastStore((state) => state.show)

  useEffect(() => {
    if (!workspacePath || !projectId) {
      setError('宣发视频工程引用无效')
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    void window.cclinkStudio.mediaProjects.get(workspacePath, projectId).then((result) => {
      if (cancelled) return
      if (!result.success) {
        setError(result.error.message)
        setLoading(false)
        return
      }
      setProject(result.project)
      setDraft(result.project)
      setSelectedSceneId(result.project.scenes[0]?.id ?? null)
      setError(null)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [projectId, workspacePath])

  const save = useCallback(async (): Promise<boolean> => {
    if (!workspacePath || !project || !draft || saving) return false
    setSaving(true)
    try {
      const result = await window.cclinkStudio.mediaProjects.save({
        workspacePath,
        expectedRevision: project.revision,
        project: draft,
      })
      if (!result.success) {
        setError(result.error.message)
        showToast(result.error.message, 'error')
        return false
      }
      setProject(result.project)
      setDraft(result.project)
      updateTabDirty(tab.id, false)
      updateTabTitle(tab.id, result.project.title)
      setError(null)
      showToast('宣发视频工程已保存', 'success')
      return true
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : '宣发视频工程保存失败'
      setError(message)
      showToast(message, 'error')
      return false
    } finally {
      setSaving(false)
    }
  }, [draft, project, saving, showToast, tab.id, updateTabDirty, updateTabTitle, workspacePath])

  useEffect(() => {
    if (!project || !draft) return
    return registerMediaProjectDraft(tab.id, { save })
  }, [draft, project, save, tab.id])

  const mutate = useCallback(
    (recipe: (current: MediaProject) => MediaProject): void => {
      setDraft((current) => (current ? recipe(current) : current))
      updateTabDirty(tab.id, true)
    },
    [tab.id, updateTabDirty],
  )

  const selectedScene = useMemo(
    () => draft?.scenes.find((scene) => scene.id === selectedSceneId) ?? draft?.scenes[0] ?? null,
    [draft, selectedSceneId],
  )

  const updateScene = (changes: Partial<MediaProjectScene>): void => {
    if (!selectedScene) return
    mutate((current) => ({
      ...current,
      scenes: current.scenes.map((scene) =>
        scene.id === selectedScene.id ? { ...scene, ...changes } : scene,
      ),
    }))
  }

  const moveScene = (direction: -1 | 1): void => {
    if (!draft || !selectedScene) return
    const index = draft.scenes.findIndex((scene) => scene.id === selectedScene.id)
    const target = index + direction
    if (target < 0 || target >= draft.scenes.length) return
    mutate((current) => {
      const scenes = [...current.scenes]
      const [moved] = scenes.splice(index, 1)
      scenes.splice(target, 0, moved)
      return { ...current, scenes: scenes.map((scene, order) => ({ ...scene, order })) }
    })
  }

  const proposeStoryboard = async (): Promise<void> => {
    if (!workspacePath || !draft || generatingStoryboard) return
    setGeneratingStoryboard(true)
    setStoryboardProposal(null)
    try {
      const result = await window.cclinkStudio.mediaProjects.proposeStoryboard({
        workspacePath,
        project: draft,
      })
      if (!result.success) {
        setError(result.error.message)
        showToast(result.error.message, 'error')
        return
      }
      setStoryboardProposal(result.proposal)
      setError(null)
      showToast('智能分镜提案已生成，请审阅后应用', 'success')
    } catch (proposalError) {
      const message = proposalError instanceof Error ? proposalError.message : '智能分镜生成失败'
      setError(message)
      showToast(message, 'error')
    } finally {
      setGeneratingStoryboard(false)
    }
  }

  const applyStoryboardProposal = (): void => {
    if (!storyboardProposal) return
    mutate((current) => ({
      ...current,
      title: storyboardProposal.title,
      scenes: storyboardProposal.scenes,
    }))
    setSelectedSceneId(storyboardProposal.scenes[0]?.id ?? null)
    setStoryboardProposal(null)
    showToast('已应用智能分镜提案，保存工程后生效', 'success')
  }

  if (loading) return <div className="media-production-state">正在打开宣发视频工程…</div>
  if (!draft) {
    return (
      <div className="media-production-state error">
        <strong>无法打开宣发视频工程</strong>
        <span>{error ?? '工程内容不存在'}</span>
      </div>
    )
  }

  const totalDuration = draft.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0)

  return (
    <div className="media-production-workbench">
      <header className="media-production-header">
        <div>
          <div className="media-production-eyebrow">宣发视频 · 分镜草稿</div>
          <input
            className="media-production-title-input"
            value={draft.title}
            aria-label="工程标题"
            onChange={(event) => mutate((current) => ({ ...current, title: event.target.value }))}
          />
        </div>
        <div className="media-production-actions">
          <span>
            {draft.scenes.length} 个场景 · {totalDuration.toFixed(1)} 秒
          </span>
          <button
            type="button"
            className="secondary"
            disabled={generatingStoryboard || saving}
            title="使用当前 Agent 生成一次分镜提案，可能产生模型用量"
            onClick={() => void proposeStoryboard()}
          >
            {generatingStoryboard ? 'Agent 策划中…' : 'AI 生成分镜'}
          </button>
          <button
            type="button"
            disabled={!tab.dirty || saving}
            onClick={() => void executeCommand('workbench.save', { source: 'toolbar' })}
          >
            {saving ? '保存中…' : tab.dirty ? '保存工程' : '已保存'}
          </button>
        </div>
      </header>

      <div className="media-production-stage-bar" aria-label="制作阶段">
        <span className="done">简报</span>
        <span className="active">分镜</span>
        <span>素材</span>
        <span>成片</span>
        <span>导出</span>
      </div>

      {storyboardProposal && (
        <section className="media-storyboard-proposal" aria-label="智能分镜提案">
          <div>
            <strong>智能分镜提案</strong>
            <span>
              标题“{draft.title}”→“{storyboardProposal.title}”；{draft.scenes.length} 个场景 →{' '}
              {storyboardProposal.scenes.length} 个场景；
              {draft.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0).toFixed(1)} 秒 →{' '}
              {storyboardProposal.scenes
                .reduce((sum, scene) => sum + scene.durationSeconds, 0)
                .toFixed(1)}{' '}
              秒
            </span>
            <small>{storyboardProposal.scenes.map((scene) => scene.subtitle).join(' / ')}</small>
          </div>
          <span className="media-storyboard-proposal-actions">
            <button type="button" onClick={() => setStoryboardProposal(null)}>
              放弃
            </button>
            <button type="button" className="primary" onClick={applyStoryboardProposal}>
              应用提案
            </button>
          </span>
        </section>
      )}

      {error && <div className="media-production-inline-error">{error}</div>}

      <div className="media-production-layout">
        <aside className="media-scene-list" aria-label="场景列表">
          {draft.scenes.map((scene, index) => (
            <button
              type="button"
              key={scene.id}
              className={scene.id === selectedScene?.id ? 'active' : ''}
              onClick={() => setSelectedSceneId(scene.id)}
            >
              <span className="media-scene-number">{String(index + 1).padStart(2, '0')}</span>
              <span className="media-scene-copy">
                <strong>{scene.subtitle || '未命名场景'}</strong>
                <small>{scene.durationSeconds}s · 尚未选择素材</small>
              </span>
            </button>
          ))}
        </aside>

        <main className="media-preview-panel">
          <div
            className={`media-preview-frame ratio-${draft.brief.aspectRatio.replace(':', '-')}`}
            style={{ '--media-brand-color': draft.brief.brand.primaryColor } as React.CSSProperties}
          >
            <div className="media-preview-orb" />
            <div className="media-preview-placeholder">素材待添加</div>
            <div className="media-preview-subtitle">{selectedScene?.subtitle}</div>
          </div>
          <div className="media-preview-caption">
            场景 {selectedScene ? selectedScene.order + 1 : 0} · 预览占位
          </div>
          <div className="media-brief-grid">
            <label>
              平台
              <select
                value={draft.brief.platform}
                onChange={(event) =>
                  mutate((current) => ({
                    ...current,
                    brief: {
                      ...current.brief,
                      platform: event.target.value as MediaProjectPlatform,
                    },
                  }))
                }
              >
                {Object.entries(PLATFORM_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              画幅
              <select
                value={draft.brief.aspectRatio}
                onChange={(event) =>
                  mutate((current) => ({
                    ...current,
                    brief: {
                      ...current.brief,
                      aspectRatio: event.target.value as MediaAspectRatio,
                    },
                  }))
                }
              >
                <option value="9:16">9:16</option>
                <option value="16:9">16:9</option>
                <option value="1:1">1:1</option>
              </select>
            </label>
            <label>
              品牌色
              <input
                type="color"
                value={draft.brief.brand.primaryColor}
                onChange={(event) =>
                  mutate((current) => ({
                    ...current,
                    brief: {
                      ...current.brief,
                      brand: { ...current.brief.brand, primaryColor: event.target.value },
                    },
                  }))
                }
              />
            </label>
            <label>
              结尾 CTA
              <input
                value={draft.brief.brand.callToAction}
                placeholder="例如：立即体验"
                onChange={(event) =>
                  mutate((current) => ({
                    ...current,
                    brief: {
                      ...current.brief,
                      brand: { ...current.brief.brand, callToAction: event.target.value },
                    },
                  }))
                }
              />
            </label>
          </div>
        </main>

        {selectedScene && (
          <aside className="media-scene-inspector" aria-label="场景检查器">
            <div className="media-inspector-heading">
              <strong>场景 {selectedScene.order + 1}</strong>
              <span>
                <button type="button" onClick={() => moveScene(-1)} aria-label="场景上移">
                  ↑
                </button>
                <button type="button" onClick={() => moveScene(1)} aria-label="场景下移">
                  ↓
                </button>
              </span>
            </div>
            <label>
              时长（秒）
              <input
                type="number"
                min={1}
                max={60}
                step={0.5}
                value={selectedScene.durationSeconds}
                onChange={(event) => updateScene({ durationSeconds: Number(event.target.value) })}
              />
            </label>
            <label>
              旁白文案
              <textarea
                value={selectedScene.narration}
                onChange={(event) => updateScene({ narration: event.target.value })}
              />
            </label>
            <label>
              屏幕字幕
              <textarea
                value={selectedScene.subtitle}
                onChange={(event) => updateScene({ subtitle: event.target.value })}
              />
            </label>
            <label>
              画面说明
              <textarea
                value={selectedScene.visualDescription}
                onChange={(event) => updateScene({ visualDescription: event.target.value })}
              />
            </label>
            <label>
              素材搜索词
              <input
                value={selectedScene.searchTerms.join('，')}
                onChange={(event) =>
                  updateScene({
                    searchTerms: event.target.value
                      .split(/[，,]/)
                      .map((value) => value.trim())
                      .filter(Boolean),
                  })
                }
              />
            </label>
            <label>
              AI 生成提示词
              <textarea
                value={selectedScene.generationPrompt}
                onChange={(event) => updateScene({ generationPrompt: event.target.value })}
              />
            </label>
            <div className="media-material-status">
              <strong>素材</strong>
              <span>尚未选择 · 搜索与云生成将在下一批接入</span>
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
