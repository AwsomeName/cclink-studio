import { syncDiarySpace } from './DiarySyncStatus'
import { useEffect, useState } from 'react'
import type { DiaryImportPreview } from '@shared/ipc/workspace-state'
import type { AgentCapabilityStatus } from '@shared/agent-protocol'
import { defaultDiaryDirectory, defaultDiaryTimezone } from '@shared/personal-diary-source'
import { openPersonalSpace, useFixedSpacesStore } from './fixed-spaces-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useDiaryNavigation } from './personal-diary-navigation'
import { DiaryImportPicker, ipcMessage } from './DiaryImport'
import {
  defaultBuiltInChoice,
  ensureBuiltInDiaryTasks,
  type BuiltInTaskChoice,
} from './diary-builtin-tasks'

const stepNames = ['导入历史', '同步', 'AI', '核对并确认']
const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/**
 * First use of 我的空间 in four steps (mockups 01–04). My Space always uses its own fixed
 * folder; history is only copied in. Nothing is written until「确认并开始」.
 */
export function DiarySetupWizard({ onDone }: { onDone?: () => void }): React.ReactElement {
  const [step, setStep] = useState(0)
  const [mode, setMode] = useState<'fresh' | 'import'>('fresh')
  const [root, setRoot] = useState('')
  const [preview, setPreview] = useState<DiaryImportPreview | null>(null)
  const suggestion = useFixedSpacesStore((state) => state.spaces?.importSuggestion)
  const [url, setUrl] = useState('')
  const [ai, setAi] = useState<AgentCapabilityStatus | null>(null)
  const [probe, setProbe] = useState<{ ok: boolean; error?: string; elapsedMs: number } | null>(
    null,
  )
  const [choice, setChoice] = useState<BuiltInTaskChoice>(defaultBuiltInChoice)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ws = window.cclinkStudio.workspaceState
  const run = (action: () => Promise<void>): void => {
    setBusy(true)
    setError('')
    void action()
      .catch((e) => setError(ipcMessage(e)))
      .finally(() => setBusy(false))
  }
  useEffect(() => {
    void ws
      .describeDefaultPersonalSpace()
      .then((info) => setRoot(info.path))
      .catch(() => {})
  }, [ws])
  useEffect(() => {
    if (suggestion) setMode('import')
  }, [suggestion])
  const checkAi = async (): Promise<void> => {
    setProbe(null)
    const capabilities = await window.cclinkStudio.agent.getCapabilities()
    const backend = capabilities.find((item) => item.name === 'agent-backend') ?? null
    setAi(backend)
    // Installed is not enough: a short real generation proves login and quota.
    if (backend?.state === 'ready') setProbe(await window.cclinkStudio.agent.probeRuntime())
  }
  useEffect(() => {
    if (step === 2) run(checkAi)
  }, [step])
  const canNext = [
    Boolean(root) && (mode === 'fresh' || Boolean(preview)),
    true,
    ai?.state === 'ready' && probe?.ok === true,
    true,
  ][step]
  const confirm = (): void =>
    run(async () => {
      const fixed = await ws.initializePersonalSpace()
      // Stay open until history, tasks and sync are set up, so any failure is shown here.
      useFixedSpacesStore.setState({ spaces: fixed })
      const path = fixed.personal!.workspacePath
      // Take back what another device already shared first, so its tasks are reused, not doubled.
      if (url.trim()) await syncDiarySpace(path, true, { url: url.trim() })
      if (mode === 'import' && preview) await ws.importDiaryHistory(preview)
      const settings = (await ws.getSettings(path)).settings
      const directory = settings.diary?.directory ?? defaultDiaryDirectory
      const timezone = settings.diary?.timezone ?? defaultDiaryTimezone
      // Enabling the daily draft after today's time makes the scheduler draft today once.
      await ensureBuiltInDiaryTasks(path, directory, timezone, choice)
      if (url.trim() && mode === 'import') void syncDiarySpace(path, true)
      await openPersonalSpace()
      await useWorkspaceStore.getState().refreshSettings()
      useDiaryNavigation.getState().setPage('今天')
      onDone?.()
    })

  return (
    <section className="personal-diary-home diary-setup" aria-label="设置我的空间">
      <h2>设置「我的空间」</h2>
      <div className="diary-steps">
        {stepNames.map((name, index) => (
          <span
            key={name}
            className={index === step ? 'on' : index < step ? 'done' : ''}
            aria-current={index === step ? 'step' : undefined}
          >
            {index < step ? '✓ ' : ''}
            {index + 1} {name}
          </span>
        ))}
      </div>
      {step === 0 && (
        <div className="diary-setup-body">
          <dl className="diary-facts">
            <dt>我的空间目录</dt>
            <dd>
              {root} <span className="diary-tag">固定</span>
            </dd>
          </dl>
          <label className={`diary-option ${mode === 'fresh' ? 'on' : ''}`}>
            <input type="radio" checked={mode === 'fresh'} onChange={() => setMode('fresh')} />
            <span>
              <b>从头开始</b>
              <span className="muted">不导入，直接开始写今天的日记</span>
            </span>
          </label>
          <label className={`diary-option ${mode === 'import' ? 'on' : ''}`}>
            <input type="radio" checked={mode === 'import'} onChange={() => setMode('import')} />
            <span>
              <b>从历史目录导入</b>
              <span className="muted">
                复制旧日记进来；原目录不移动、不修改，也不会变成我的空间
              </span>
            </span>
          </label>
          {mode === 'import' && (
            <DiaryImportPicker
              preview={preview}
              onChange={setPreview}
              suggestion={suggestion}
              disabled={busy}
            />
          )}
          <p className="muted">查看本页不会创建或修改任何文件。</p>
        </div>
      )}
      {step === 1 && (
        <div className="diary-setup-body">
          <label className="diary-facts-form">
            Git 项目地址
            <input
              aria-label="Git 项目地址"
              placeholder="https://github.com/你的账号/my-diary.git"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          <p className="muted">
            建议新建一个空的私有仓库专门放日记。地址只用于我的空间，不会影响其他项目的仓库。
          </p>
          <p className="muted">
            这个地址已有日记时（另一台电脑设置过），确认后先取回，再合并本机导入的内容。不填也能本地使用，以后在「同步」中设置。
          </p>
        </div>
      )}
      {step === 2 && (
        <div className="diary-setup-body">
          <div className="diary-card">
            <b>
              本机 AI · {ai?.state === 'ready' ? '就绪' : ai ? `不可用（${ai.state}）` : '检测中…'}
            </b>
            {ai?.reason && <p className="muted">{ai.reason}</p>}
            {ai?.state === 'ready' && (
              <p
                className={probe?.ok ? 'muted' : ''}
                role={probe && !probe.ok ? 'alert' : undefined}
              >
                测试：生成一句话 ·{' '}
                {!probe
                  ? '进行中…'
                  : probe.ok
                    ? `通过 · ${Math.round(probe.elapsedMs / 1000)} 秒`
                    : `未通过：${probe.error}`}
              </p>
            )}
            <button disabled={busy} onClick={() => run(checkAi)}>
              重新检测
            </button>
          </div>
          <p className="muted">
            每日草稿和每周复盘需要本机 AI（Codex 或 Claude Code）。AI
            可以读取项目内全部日记；只有你要求时才修改已有文件，并给出改动报告。
          </p>
          {ai && ai.state !== 'ready' && (
            <p role="alert">请在 Studio 设置的 Agent 中安装并登录本机 AI 后重新检测。</p>
          )}
        </div>
      )}
      {step === 3 && (
        <div className="diary-setup-body">
          <dl className="diary-facts">
            <dt>我的空间目录</dt>
            <dd>{root}</dd>
            <dt>导入</dt>
            <dd>
              {mode === 'import' && preview
                ? `${preview.sourcePath} · ${preview.fileCount - preview.skipCount} 个文件`
                : '不导入'}
            </dd>
            <dt>同步</dt>
            <dd>{url.trim() || '稍后设置'}</dd>
            <dt>时区</dt>
            <dd>{defaultDiaryTimezone}（可在项目设置修改）</dd>
            <dt>AI</dt>
            <dd>{ai?.state === 'ready' ? '本机 AI 就绪' : '—'}</dd>
          </dl>
          <div className="diary-card">
            <b>自动整理（本设备）</b>
            <label>
              <input
                type="checkbox"
                checked={choice.daily.enable}
                onChange={(e) =>
                  setChoice({ ...choice, daily: { ...choice.daily, enable: e.target.checked } })
                }
              />
              每日起草 · 每天自动生成当天草稿（项目已有该任务时沿用原时间）
              <input
                aria-label="每日起草时间"
                type="time"
                value={choice.daily.time}
                onChange={(e) =>
                  setChoice({ ...choice, daily: { ...choice.daily, time: e.target.value } })
                }
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={choice.weekly.enable}
                onChange={(e) =>
                  setChoice({ ...choice, weekly: { ...choice.weekly, enable: e.target.checked } })
                }
              />
              周度计划 · 自动生成下周计划
              <select
                aria-label="每周复盘日"
                value={choice.weekly.weekday}
                onChange={(e) =>
                  setChoice({
                    ...choice,
                    weekly: { ...choice.weekly, weekday: Number(e.target.value) },
                  })
                }
              >
                {weekdays.map((name, index) => (
                  <option key={name} value={index}>
                    {name}
                  </option>
                ))}
              </select>
              <input
                aria-label="每周复盘时间"
                type="time"
                value={choice.weekly.time}
                onChange={(e) =>
                  setChoice({ ...choice, weekly: { ...choice.weekly, time: e.target.value } })
                }
              />
            </label>
            <p className="muted">
              创建我的空间目录、日记目录和任务。月度与年度计划任务默认停用。
              历史目录原样保留。已过起草时间时，确认后立即生成今天的草稿。
            </p>
          </div>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="diary-actions">
        {step > 0 && (
          <button disabled={busy} onClick={() => setStep(step - 1)}>
            上一步
          </button>
        )}
        {step < 3 ? (
          <button className="primary" disabled={busy || !canNext} onClick={() => setStep(step + 1)}>
            下一步
          </button>
        ) : (
          <button className="primary" disabled={busy || !root} onClick={confirm}>
            {busy ? '正在设置…' : '确认并开始'}
          </button>
        )}
      </div>
    </section>
  )
}
