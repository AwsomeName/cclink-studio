import { useEffect, useState } from 'react'
import { MarkdownEditor } from '../../components/workbench/MarkdownEditor'
import { FoldedTabCreateActions } from '../../components/workbench/TabBar'
import { useUIStore } from '../../stores/ui-store'
import { askAi, editRule } from './diary-ai'
import { useDiaryCalendar } from './diary-calendar-store'

const short = (date: string): string => `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`

/**
 * One day of the diary, chosen in the calendar or the 日记 list. Laid out exactly like the today
 * page (docs/design/diary-day-view-2026-11-24): the day's file opens right here, editable.
 */
export function DiaryDayView(): React.ReactElement {
  const { days, selected, today, select } = useDiaryCalendar()
  const entries = days[selected] ?? []
  const [index, setIndex] = useState(0)
  useEffect(() => setIndex(0), [selected])
  // Keep the conversation available beside the diary.
  useEffect(() => {
    if (useUIStore.getState().agentPanelMode === 'hidden')
      useUIStore.getState().setAgentPanelMode('right', 'system')
  }, [])
  const entry = entries[Math.min(index, entries.length - 1)]
  const dated = Object.keys(days).sort()
  const previous = [...dated].reverse().find((date) => date < selected)
  const next = dated.find((date) => date > selected)
  const lead = (
    <span className="diary-day-nav" aria-label="切换日期">
      <button
        type="button"
        disabled={!previous}
        aria-label="上一篇"
        onClick={() => previous && select(previous)}
      >
        ‹ {previous ? short(previous) : ''}
      </button>
      {entry ? (
        <DiaryFilePicker
          files={entries}
          current={entry.path}
          onPick={(path) =>
            setIndex(
              Math.max(
                0,
                entries.findIndex((item) => item.path === path),
              ),
            )
          }
          label="当天的日记"
        />
      ) : (
        <b>{short(selected)} 没有日记</b>
      )}
      <button
        type="button"
        disabled={!next}
        aria-label="下一篇"
        onClick={() => next && select(next)}
      >
        {next ? short(next) : ''} ›
      </button>
    </span>
  )
  const extra = entry ? (
    <span className="diary-today-actions">
      <button
        className="diary-header-action"
        onClick={() => askAi(`${editRule}请修改 ${entry.path}：`)}
      >
        让 AI 修改…
      </button>
      <FoldedTabCreateActions />
    </span>
  ) : null
  return (
    <div className="diary-today">
      <article className="diary-today-entry" aria-label="当天日记">
        {entry ? (
          <div className="diary-today-editor">
            <MarkdownEditor
              key={entry.path}
              filePath={entry.path}
              tabId={'day:' + entry.path}
              compact
              toolbarLead={lead}
              toolbarExtra={extra}
            />
          </div>
        ) : (
          <div className="diary-day-empty">
            <div className="diary-day-empty-bar">{lead}</div>
            <p className="muted">
              这天没有日记。
              {selected === today && ' 今天的日记在「今天」页里。'}
            </p>
          </div>
        )}
      </article>
    </div>
  )
}

/** The day's file; a dropdown when the same day has several (no separate switch row). */
export function DiaryFilePicker({
  files,
  current,
  onPick,
  label,
}: {
  files: { path: string; name: string }[]
  current: string
  onPick: (path: string) => void
  label: string
}): React.ReactElement {
  const name = files.find((file) => file.path === current)?.name ?? ''
  if (files.length < 2) return <b>{name}</b>
  return (
    <select
      className="diary-file-picker"
      aria-label={label}
      value={current}
      onChange={(event) => onPick(event.target.value)}
    >
      {files.map((file) => (
        <option key={file.path} value={file.path}>
          {file.name}
        </option>
      ))}
    </select>
  )
}
