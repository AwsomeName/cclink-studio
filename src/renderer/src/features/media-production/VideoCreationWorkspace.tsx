import { useCallback, useEffect, useRef, useState } from 'react'
import type { MediaAspectRatio, MediaProject } from '@shared/media-production/media-project-types'
import {
  initialNarration,
  type GenerateNarrationInput,
  type NarrationScript,
} from '@shared/media-production/narration-script'
import type { Tab } from '../../types'
import { useTabStore } from '../../stores/tab-store'
import { registerMediaProjectDraft } from './media-project-draft-registry'
import './video-creation.css'

const stages = ['稿件与口播', '分镜与素材', '声音与节奏', '预览与导出']
const descriptions = [
  '把文章变成好讲的故事',
  '逐镜组织画面 · 页面骨架',
  '配音与节奏对齐 · 页面骨架',
  '检查并输出成片 · 页面骨架',
]

function withNarration(project: MediaProject): MediaProject & { narration: NarrationScript } {
  return {
    ...project,
    narration:
      project.narration ??
      initialNarration(project.scenes.map((s) => ({ id: s.id, text: s.narration }))),
  }
}

export function VideoCreationWorkspace({
  tab,
  onLegacy,
}: {
  tab: Tab
  onLegacy: () => void
}): React.ReactElement {
  const workspacePath = tab.workspaceRef?.kind === 'local' ? tab.workspaceRef.path : null
  const projectId = tab.mediaProject?.projectId
  const [draft, setDraft] = useState<ReturnType<typeof withNarration> | null>(null)
  const [stage, setStage] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [projectionWarning, setProjectionWarning] = useState<string | null>(null)
  const [consent, setConsent] = useState<GenerateNarrationInput['mode'] | null>(null)
  const current = useRef<ReturnType<typeof withNarration> | null>(null)
  const saved = useRef<MediaProject | null>(null)
  const lock = useRef(false)
  const mounted = useRef(true)
  const contentRef = useRef<HTMLElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const updateDirty = useTabStore((s) => s.updateTabDirty)
  const updateTitle = useTabStore((s) => s.updateTabTitle)
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 })
  }, [stage])
  useEffect(() => {
    if (consent) dialogRef.current?.showModal()
  }, [consent])

  const accept = useCallback(
    (project: MediaProject) => {
      if (!mounted.current) return
      const next = withNarration(project)
      saved.current = project
      current.current = next
      setDraft(next)
      setDirty(false)
      updateDirty(tab.id, false)
      updateTitle(tab.id, project.title)
    },
    [tab.id, updateDirty, updateTitle],
  )

  useEffect(() => {
    mounted.current = true
    let cancelled = false
    if (!workspacePath || !projectId) {
      setError('视频工程引用无效')
      return
    }
    void window.cclinkStudio.mediaProjects
      .get(workspacePath, projectId)
      .then((result) => {
        if (cancelled) return
        if (result.success) accept(result.project)
        else setError(result.error.message)
      })
      .catch(() => {
        if (!cancelled) setError('无法读取视频工程，请关闭后重开')
      })
    return () => {
      cancelled = true
      mounted.current = false
    }
  }, [workspacePath, projectId, accept])

  const running = draft?.narration.generation?.status === 'running'
  useEffect(() => {
    if (!running || busy || !workspacePath || !projectId) return
    let cancelled = false
    const timer = window.setInterval(() => {
      void window.cclinkStudio.mediaProjects
        .get(workspacePath, projectId)
        .then((result) => {
          if (!cancelled && result.success) accept(result.project)
        })
        .catch(() => {
          if (!cancelled) setError('任务状态读取失败，可关闭重开后检查')
        })
    }, 1500)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [running, busy, workspacePath, projectId, accept])

  const mutate = (
    recipe: (project: ReturnType<typeof withNarration>) => ReturnType<typeof withNarration>,
  ): void => {
    if (!current.current || lock.current || running) return
    const next = recipe(current.current)
    current.current = next
    setDraft(next)
    setDirty(true)
    updateDirty(tab.id, true)
    setNotice('')
  }

  const editScript = (recipe: (script: NarrationScript) => NarrationScript): void => {
    mutate((project) => ({
      ...project,
      narration: { ...recipe(project.narration), confirmedRevision: null },
    }))
  }

  const persist = useCallback(
    async (override?: MediaProject): Promise<MediaProject | null> => {
      const snapshot = override ?? current.current
      if (!workspacePath || !snapshot || !saved.current) return null
      const result = await window.cclinkStudio.mediaProjects.save({
        workspacePath,
        expectedRevision: saved.current.revision,
        project: snapshot,
      })
      if (!result.success) throw new Error(result.error.message)
      accept(result.project)
      setProjectionWarning(result.warnings?.join('；') || null)
      return result.project
    },
    [workspacePath, accept],
  )

  const save = useCallback(async (): Promise<boolean> => {
    if (lock.current || current.current?.narration.generation?.status === 'running') return false
    lock.current = true
    setBusy(true)
    try {
      await persist()
      setError(null)
      setNotice('口播已保存，关闭重开可继续编辑。')
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败，当前编辑仍保留')
      return false
    } finally {
      lock.current = false
      if (mounted.current) setBusy(false)
    }
  }, [persist])

  useEffect(() => registerMediaProjectDraft(tab.id, { save }), [tab.id, save])

  const confirmScript = async (): Promise<void> => {
    if (lock.current || running || !current.current?.narration.segments.every((s) => s.text.trim()))
      return
    lock.current = true
    setBusy(true)
    try {
      const written = await persist()
      if (!written?.narration) return
      await persist({
        ...written,
        narration: { ...written.narration, confirmedRevision: written.narration.revision },
      })
      setError(null)
      setNotice('口播已确认并保存。下一步仅供查看页面布局，尚不生成分镜。')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '确认失败，请重试')
    } finally {
      lock.current = false
      if (mounted.current) setBusy(false)
    }
  }

  const generate = async (mode: GenerateNarrationInput['mode']): Promise<void> => {
    if (lock.current || running || !workspacePath || !projectId) return
    lock.current = true
    setBusy(true)
    setConsent(null)
    setNotice('Agent 正在生成口播候选；不会直接替换正文。')
    try {
      const written = await persist()
      if (!written) return
      const result = await window.cclinkStudio.mediaProjects.generateNarration({
        workspacePath,
        projectId,
        expectedRevision: written.revision,
        mode,
      })
      if (!mounted.current) return
      if (!result.success) throw new Error(result.error.message)
      accept(result.project)
      setProjectionWarning(result.warnings?.join('；') || null)
      setError(result.project.narration?.generation?.error ?? null)
      setNotice(
        result.project.narration?.generation?.status === 'succeeded'
          ? '候选已保存。请审阅后采用，现有正文未改变。'
          : '',
      )
    } catch (reason) {
      if (mounted.current)
        setError(reason instanceof Error ? reason.message : '口播生成失败，请检查 Agent 配置')
    } finally {
      lock.current = false
      if (mounted.current) setBusy(false)
    }
  }

  if (!draft) return <div className="media-production-state">{error ?? '正在打开视频创作…'}</div>
  const script = draft.narration
  const disabled = busy || running
  const characters = script.segments.reduce((sum, s) => sum + s.text.replace(/\s/g, '').length, 0)
  const estimate = Math.ceil(characters / 4)
  const confirmed = script.confirmedRevision === script.revision
  const proposal = script.proposal
  const proposalAdopted = proposal?.id === script.appliedProposalId
  const proposalStale = proposal && (dirty || proposal.baseNarrationRevision !== script.revision)
  const directory = `${workspacePath}/.cclink-studio/media-projects/${projectId}`

  return (
    <div className="video-creation-workspace" data-stage={stage}>
      <header className="vc-header">
        <div>
          <span className="vc-eyebrow">视频创作 / 从一篇稿件开始</span>
          <input
            aria-label="视频标题"
            value={draft.title}
            maxLength={120}
            disabled={disabled}
            onChange={(e) => mutate((p) => ({ ...p, title: e.target.value }))}
          />
          <small>
            {draft.brief.aspectRatio} · 目标 {draft.brief.targetDurationSeconds} 秒 · 口播 v
            {script.revision}
          </small>
        </div>
        <div className="vc-actions">
          <span role="status">{busy ? '处理中…' : dirty ? '未保存' : '已保存'}</span>
          <button
            disabled={disabled || dirty}
            onClick={onLegacy}
            title="保留原有素材和导出能力；与新版口播独立"
          >
            旧版工作台
          </button>
          <button className="vc-primary" disabled={disabled || !dirty} onClick={() => void save()}>
            保存口播
          </button>
        </div>
      </header>
      <nav className="vc-stages" aria-label="视频制作阶段">
        {stages.map((name, index) => (
          <button
            key={name}
            className={stage === index ? 'active' : ''}
            aria-current={stage === index ? 'step' : undefined}
            onClick={() => setStage(index)}
          >
            <b>{String(index + 1).padStart(2, '0')}</b>
            <span>
              {name}
              <small>{descriptions[index]}</small>
            </span>
          </button>
        ))}
      </nav>
      {(error || script.generation?.error) && (
        <div className="vc-error" role="alert">
          {error ?? script.generation?.error}
        </div>
      )}
      {projectionWarning && (
        <div className="vc-warning vc-notice" role="alert">
          {projectionWarning}
        </div>
      )}
      {notice && (
        <div className="vc-notice" role="status">
          {notice}
        </div>
      )}
      {running && !busy && (
        <div className="vc-notice">口播任务正在运行，可切换查看页面；完成后自动显示候选。</div>
      )}
      <main className="vc-content" ref={contentRef}>
        {stage === 0 ? (
          <>
            <div className="vc-script-layout">
              <section className="vc-card vc-source">
                <div className="vc-card-title">
                  <h2>原稿</h2>
                  <span className="vc-pill">只读快照</span>
                </div>
                <div className="vc-file">▤ {draft.source.path.split(/[\\/]/).at(-1)}</div>
                <pre>{draft.source.snapshot}</pre>
                <p className="vc-muted">不修改原文件 · AI 只参考前 60,000 字符</p>
              </section>
              <section className="vc-card vc-editor">
                <div className="vc-card-title">
                  <h2>口播稿</h2>
                  <span className={`vc-pill ${confirmed ? 'success' : ''}`}>
                    {confirmed ? '已确认' : '待确认'}
                  </span>
                </div>
                <p className="vc-muted">
                  {script.segments.length} 段 · {characters} 字符 · 估算 {estimate} 秒（每秒 4
                  字符，仅供参考）
                </p>
                {estimate > draft.brief.targetDurationSeconds && (
                  <p className="vc-warning">
                    超出目标约 {estimate - draft.brief.targetDurationSeconds}{' '}
                    秒，可精简口播。这里尚未生成声音。
                  </p>
                )}
                <fieldset disabled={disabled}>
                  {script.segments.map((segment, index) => (
                    <article className="vc-segment" key={segment.id}>
                      <div className="vc-card-title">
                        <strong>
                          {String(index + 1).padStart(2, '0')} /{' '}
                          {index === 0
                            ? '开场'
                            : index === script.segments.length - 1
                              ? '收尾'
                              : '展开'}
                        </strong>
                        <div className="vc-actions">
                          <button
                            aria-label={`上移第 ${index + 1} 段`}
                            disabled={index === 0}
                            onClick={() =>
                              editScript((s) => {
                                const segments = [...s.segments]
                                ;[segments[index - 1], segments[index]] = [
                                  segments[index],
                                  segments[index - 1],
                                ]
                                return { ...s, segments }
                              })
                            }
                          >
                            ↑
                          </button>
                          <button
                            aria-label={`下移第 ${index + 1} 段`}
                            disabled={index === script.segments.length - 1}
                            onClick={() =>
                              editScript((s) => {
                                const segments = [...s.segments]
                                ;[segments[index + 1], segments[index]] = [
                                  segments[index],
                                  segments[index + 1],
                                ]
                                return { ...s, segments }
                              })
                            }
                          >
                            ↓
                          </button>
                          <button
                            aria-label={`删除第 ${index + 1} 段`}
                            disabled={script.segments.length === 1}
                            onClick={() =>
                              editScript((s) => ({
                                ...s,
                                segments: s.segments.filter((x) => x.id !== segment.id),
                              }))
                            }
                          >
                            删除
                          </button>
                        </div>
                      </div>
                      <textarea
                        aria-label={`第 ${index + 1} 段口播`}
                        value={segment.text}
                        maxLength={4000}
                        placeholder="直接写下想讲的话，或让 AI 从左侧原稿生成初稿…"
                        onChange={(e) =>
                          editScript((s) => ({
                            ...s,
                            segments: s.segments.map((x) =>
                              x.id === segment.id ? { ...x, text: e.target.value } : x,
                            ),
                          }))
                        }
                      />
                    </article>
                  ))}
                  <button
                    className="vc-add"
                    disabled={script.segments.length >= 30}
                    onClick={() =>
                      editScript((s) => ({
                        ...s,
                        segments: [...s.segments, { id: crypto.randomUUID(), text: '' }],
                      }))
                    }
                  >
                    ＋ 添加段落
                  </button>
                </fieldset>
              </section>
              <aside className="vc-card vc-settings">
                <h2>创作设置</h2>
                <fieldset disabled={disabled}>
                  <label>
                    画面比例
                    <select
                      aria-label="画面比例"
                      value={draft.brief.aspectRatio}
                      onChange={(e) =>
                        mutate((p) => ({
                          ...p,
                          brief: { ...p.brief, aspectRatio: e.target.value as MediaAspectRatio },
                          narration: { ...p.narration, confirmedRevision: null },
                        }))
                      }
                    >
                      <option>9:16</option>
                      <option>16:9</option>
                      <option>1:1</option>
                    </select>
                  </label>
                  <label>
                    目标时长
                    <select
                      aria-label="目标时长"
                      value={draft.brief.targetDurationSeconds}
                      onChange={(e) =>
                        mutate((p) => ({
                          ...p,
                          brief: { ...p.brief, targetDurationSeconds: Number(e.target.value) },
                          narration: { ...p.narration, confirmedRevision: null },
                        }))
                      }
                    >
                      {Array.from(
                        new Set([15, 30, 45, 60, 90, 120, 180, draft.brief.targetDurationSeconds]),
                      )
                        .sort((a, b) => a - b)
                        .map((seconds) => (
                          <option key={seconds} value={seconds}>
                            {seconds} 秒
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    改写要求
                    <textarea
                      aria-label="改写要求"
                      value={script.instructions}
                      maxLength={2000}
                      placeholder="例如：第一人称、自然克制、不夸大功能，结尾邀请体验。"
                      onChange={(e) => editScript((s) => ({ ...s, instructions: e.target.value }))}
                    />
                  </label>
                  <button className="vc-primary" onClick={() => setConsent('generate')}>
                    ✦ AI 生成口播
                  </button>
                  <div className="vc-settings-actions">
                    <button disabled={!characters} onClick={() => setConsent('shorten')}>
                      精简口播
                    </button>
                    <button disabled={!characters} onClick={() => setConsent('rewrite')}>
                      按要求改写
                    </button>
                  </div>
                </fieldset>
                <p className="vc-muted">
                  使用当前 Agent 生成文字，可能产生模型用量。生成结果先作为候选，不直接替换。
                </p>
                <div className="vc-storage">
                  <strong>已在独立工程目录保存</strong>
                  <p>
                    正文在 project.json，口播可读副本在
                    script/narration.md。副本外部修改不会自动导入。
                  </p>
                  <button
                    disabled={dirty || busy}
                    onClick={() =>
                      void window.cclinkStudio.fs
                        .openPath(directory)
                        .catch(() => setError('无法打开工程目录'))
                    }
                  >
                    打开工程文件夹
                  </button>
                </div>
              </aside>
            </div>
            {proposal && (
              <section className="vc-card vc-proposal" aria-label="AI 口播候选">
                <div className="vc-card-title">
                  <h2>AI 候选 · {proposalAdopted ? '已采用' : '尚未采用'}</h2>
                  <span className="vc-pill">依据口播 v{proposal.baseNarrationRevision}</span>
                </div>
                <p>
                  {proposalAdopted
                    ? '此候选已采用。可继续编辑正文，下面保留生成时的内容供参考。'
                    : proposalStale
                      ? '正文或要求已修改。请先保存；旧版本候选不可直接采用，可参考后手工修改或重新生成。'
                      : '先检查事实、语气与长度；采用会替换当前口播，旧分镜不变。'}
                </p>
                <ol>
                  {proposal.segments.map((s) => (
                    <li key={s.id}>{s.text}</li>
                  ))}
                </ol>
                <button
                  className="vc-primary"
                  disabled={disabled || !!proposalStale || proposalAdopted}
                  onClick={() => {
                    editScript((s) => ({
                      ...s,
                      segments: proposal.segments,
                      appliedProposalId: proposal.id,
                    }))
                    setNotice('已采用候选到编辑区，请保存并确认。')
                  }}
                >
                  采用这份口播
                </button>
              </section>
            )}
          </>
        ) : (
          <VideoStageSkeleton stage={stage} script={script} />
        )}
      </main>
      <footer className="vc-footer">
        <span>
          {stage === 0
            ? '先讲好故事，再选择画面。口播文字不等于配音。'
            : '本页仅为布局骨架，未启动任何生成、上传或导出任务。'}
        </span>
        <div className="vc-actions">
          {stage === 0 ? (
            <>
              <button
                disabled={disabled || !script.segments.every((s) => s.text.trim())}
                className="vc-primary"
                onClick={() => void confirmScript()}
              >
                {confirmed ? '再次确认并保存' : '确认口播并保存'}
              </button>
              <button onClick={() => setStage(1)}>查看分镜页骨架 →</button>
            </>
          ) : (
            <>
              <button onClick={() => setStage(stage - 1)}>← 上一步</button>
              {stage < 3 && <button onClick={() => setStage(stage + 1)}>下一页骨架 →</button>}
            </>
          )}
        </div>
      </footer>
      {consent && (
        <dialog
          ref={dialogRef}
          className="vc-dialog-modal"
          aria-label="确认口播生成"
          onCancel={() => setConsent(null)}
        >
          <section className="vc-card vc-dialog">
            <h2>生成口播文字</h2>
            <p>
              将原稿前 60,000 字符、当前口播、画幅、时长和改写要求发送给当前配置的 Agent
              模型。可能产生模型用量，不生成声音或视频。
            </p>
            <p>继续会先保存当前编辑。返回结果只进入候选区，需你审阅后采用。</p>
            <div className="vc-actions">
              <button autoFocus onClick={() => setConsent(null)}>
                取消
              </button>
              <button className="vc-primary" onClick={() => void generate(consent)}>
                确认并生成
              </button>
            </div>
          </section>
        </dialog>
      )}
    </div>
  )
}

function VideoStageSkeleton({
  stage,
  script,
}: {
  stage: number
  script: NarrationScript
}): React.ReactElement {
  return (
    <section className="vc-skeleton" aria-label={`${stages[stage]}页面骨架`}>
      <div className="vc-skeleton-heading">
        <div>
          <span className="vc-eyebrow">COMING NEXT / 后续阶段</span>
          <h2>{stages[stage]}</h2>
        </div>
        <span className="vc-pill">页面骨架 · 未实现</span>
      </div>
      {stage === 1 && (
        <>
          <div className="vc-skeleton-grid">
            <aside className="vc-card">
              <h3>口播参考</h3>
              <p className="vc-muted">以下是口播段落，不是已生成的镜头。</p>
              {script.segments.map((s, i) => (
                <div className="vc-reference" key={s.id}>
                  <b>{String(i + 1).padStart(2, '0')}</b>
                  <p>{s.text || '尚未填写口播'}</p>
                </div>
              ))}
              <button disabled>生成分镜（待开发）</button>
            </aside>
            <div className="vc-card vc-empty">
              <div className="vc-frame">
                ▧<span>镜头预览</span>
                <small>还没有镜头与画面素材</small>
              </div>
            </div>
            <aside className="vc-card">
              <h3>镜头与素材</h3>
              <fieldset disabled>
                <label>
                  画面说明
                  <textarea placeholder="生成分镜后编辑画面目标" />
                </label>
                <label>
                  镜头时长
                  <input placeholder="尚未设置" />
                </label>
                <button>导入本地素材</button>
                <button>搜索素材</button>
                <button>AI 生成视频</button>
              </fieldset>
              <p className="vc-muted">素材来源、候选与采用结果将在这里展示。</p>
            </aside>
          </div>
          <div className="vc-card vc-empty-track">场景序列 · 尚无镜头</div>
        </>
      )}
      {stage === 2 && (
        <>
          <div className="vc-skeleton-grid">
            <aside className="vc-card">
              <h3>配音与音乐</h3>
              <fieldset disabled>
                <label>
                  音色
                  <select>
                    <option>尚未选择</option>
                  </select>
                </label>
                <button>AI 配音（待开发）</button>
                <button>导入旁白</button>
                <label>
                  背景音乐
                  <input placeholder="尚未添加" />
                </label>
                <button>选择音乐</button>
              </fieldset>
            </aside>
            <div className="vc-card vc-empty">
              <div className="vc-frame">
                ♫<span>声音预览</span>
                <small>尚未生成或导入音频</small>
              </div>
            </div>
            <aside className="vc-card">
              <h3>节奏检查</h3>
              <p className="vc-muted">有真实音频后才能检查时长，当前未执行对齐。</p>
              <div className="vc-reference">旁白时长：—</div>
              <div className="vc-reference">画面时长：—</div>
              <button disabled>对齐镜头（待开发）</button>
              <h3>字幕样式</h3>
              <button disabled>设置字幕</button>
            </aside>
          </div>
          <div className="vc-card vc-tracks">
            {['画面', '旁白', '音乐'].map((name) => (
              <div key={name}>
                <span>{name}</span>
                <div>尚无轨道内容</div>
              </div>
            ))}
          </div>
        </>
      )}
      {stage === 3 && (
        <>
          <div className="vc-export-grid">
            <div className="vc-card vc-empty">
              <div className="vc-frame">
                ▷<span>整片预览</span>
                <small>尚未合成视频</small>
              </div>
              <button disabled>播放预览</button>
            </div>
            <aside className="vc-card">
              <h3>导出前检查</h3>
              {['镜头素材', '音画对齐', '字幕检查'].map((name) => (
                <div className="vc-reference" key={name}>
                  <span>○ {name}</span>
                  <span className="vc-muted">尚未检查</span>
                </div>
              ))}
              <h3>输出设置</h3>
              <fieldset disabled>
                <label>
                  视频格式
                  <select>
                    <option>MP4 · 待接入</option>
                  </select>
                </label>
                <label>
                  导出目录
                  <input placeholder="工程 / exports" />
                </label>
                <button>导出视频（待开发）</button>
              </fieldset>
            </aside>
          </div>
          <div className="vc-card">
            <h3>导出记录</h3>
            <p className="vc-muted">暂无记录。本轮只交付口播文字，不提供新版成片导出。</p>
          </div>
        </>
      )}
    </section>
  )
}
