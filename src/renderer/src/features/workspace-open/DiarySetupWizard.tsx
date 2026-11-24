import {
  DiarySyncChoice,
  defaultDiarySyncChoice,
  diarySyncChoiceReady,
  resolveDiarySyncUrl,
  type DiarySyncChoiceValue,
} from './DiarySyncChoice'
import { syncDiarySpace } from './DiarySyncStatus'
import { useEffect, useState } from 'react'
import type { DiaryImportPreview } from '@shared/ipc/workspace-state'
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

const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/**
 * First use of 我的空间 on one page (mockup 01): optional history import, optional Git
 * address, daily draft time. My Space always uses its own fixed folder; history is only
 * copied in. Nothing is written until「开始使用」. AI is checked later, on the today page.
 */
export function DiarySetupWizard({ onDone }: { onDone?: () => void }): React.ReactElement {
  const [mode, setMode] = useState<'fresh' | 'import'>('fresh')
  const [root, setRoot] = useState('')
  const [preview, setPreview] = useState<DiaryImportPreview | null>(null)
  const suggestion = useFixedSpacesStore((state) => state.spaces?.importSuggestion)
  const [sync, setSync] = useState<DiarySyncChoiceValue>(defaultDiarySyncChoice)
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
  const ready =
    Boolean(root) && (mode === 'fresh' || Boolean(preview)) && diarySyncChoiceReady(sync)
  const confirm = (): void =>
    run(async () => {
      // Create the GitHub repository first: if that fails, nothing has been written yet.
      const url = (await resolveDiarySyncUrl(sync)) ?? ''
      const fixed = await ws.initializePersonalSpace()
      // Stay open until history, tasks and sync are set up, so any failure is shown here.
      useFixedSpacesStore.setState({ spaces: fixed })
      const path = fixed.personal!.workspacePath
      // Take back what another device already shared first, so its tasks are reused, not doubled.
      if (url) await syncDiarySpace(path, true, { url })
      if (mode === 'import' && preview) await ws.importDiaryHistory(preview)
      const settings = (await ws.getSettings(path)).settings
      const directory = settings.diary?.directory ?? defaultDiaryDirectory
      const timezone = settings.diary?.timezone ?? defaultDiaryTimezone
      // Enabling the daily draft after today's time makes the scheduler draft today once.
      await ensureBuiltInDiaryTasks(path, directory, timezone, choice)
      if (url && mode === 'import') void syncDiarySpace(path, true)
      await openPersonalSpace()
      await useWorkspaceStore.getState().refreshSettings()
      useDiaryNavigation.getState().setPage('今天')
      onDone?.()
    })

  return (
    <section className="personal-diary-home diary-setup" aria-label="设置我的空间">
      <h2>设置「我的空间」</h2>
      <div className="diary-setup-body">
        <dl className="diary-facts">
          <dt>目录</dt>
          <dd>
            {root} <span className="diary-tag">固定</span>
          </dd>
        </dl>
        <h3>历史日记</h3>
        <label className={`diary-option ${mode === 'fresh' ? 'on' : ''}`}>
          <input type="radio" checked={mode === 'fresh'} onChange={() => setMode('fresh')} />
          <span>
            <b>从头开始</b>
          </span>
        </label>
        <label className={`diary-option ${mode === 'import' ? 'on' : ''}`}>
          <input type="radio" checked={mode === 'import'} onChange={() => setMode('import')} />
          <span>
            <b>从历史目录导入</b>
            <span className="muted">只复制进来；原目录不移动、不修改</span>
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
        <h3>同步（可选）</h3>
        <DiarySyncChoice
          value={sync}
          onChange={(next) => {
            setSync(next)
            setError('')
          }}
          disabled={busy}
        />
        <h3>自动整理</h3>
        <label>
          <input
            type="checkbox"
            checked={choice.daily.enable}
            onChange={(e) =>
              setChoice({ ...choice, daily: { ...choice.daily, enable: e.target.checked } })
            }
          />
          每天
          <input
            aria-label="每日起草时间"
            type="time"
            value={choice.daily.time}
            onChange={(e) =>
              setChoice({ ...choice, daily: { ...choice.daily, time: e.target.value } })
            }
          />
          AI 自动起草今天的日记
        </label>
        <label>
          <input
            type="checkbox"
            checked={choice.weekly.enable}
            onChange={(e) =>
              setChoice({ ...choice, weekly: { ...choice.weekly, enable: e.target.checked } })
            }
          />
          每
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
          AI 生成下周计划
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="diary-actions">
        <button className="primary" disabled={busy || !ready} onClick={confirm}>
          {busy ? '正在设置…' : '开始使用'}
        </button>
      </div>
    </section>
  )
}
