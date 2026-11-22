import { useEffect, useState } from 'react'
import type { DiaryDocument } from '@shared/personal-diary-source'
import { ConversationMarkdown } from '../../components/common/ConversationMarkdown'
import { useUIStore } from '../../stores/ui-store'
import { askAi, editRule } from './diary-ai'
import { useDiaryCalendar, weekdayOf } from './diary-calendar-store'

/**
 * One day of the diary, chosen in the sidebar calendar. The Agent conversation stays open on
 * the right so the user can ask about this day or about recent spending across all diaries.
 */
export function DiaryDayView({
  read,
  openFile,
  directory,
}: {
  read: (path: string) => Promise<DiaryDocument>
  openFile: (file: { path: string; name: string }) => void
  directory: string
}): React.ReactElement {
  const { days, selected, today, select } = useDiaryCalendar()
  const entries = days[selected] ?? []
  const [index, setIndex] = useState(0)
  const [doc, setDoc] = useState<DiaryDocument | null>(null)
  const [error, setError] = useState('')
  const entry = entries[Math.min(index, entries.length - 1)]
  // Keep the conversation available beside the diary (design: Agent stays on the right).
  useEffect(() => {
    if (useUIStore.getState().agentPanelMode === 'hidden')
      useUIStore.getState().setAgentPanelMode('right', 'system')
  }, [])
  useEffect(() => setIndex(0), [selected])
  useEffect(() => {
    let alive = true
    setDoc(null)
    setError('')
    if (entry)
      void read(entry.path)
        .then((value) => {
          if (alive) setDoc(value)
        })
        .catch((e) => {
          if (alive) setError(String(e))
        })
    return () => {
      alive = false
    }
  }, [entry?.path, read])
  const dated = Object.keys(days).sort()
  const previous = [...dated].reverse().find((date) => date < selected)
  const next = dated.find((date) => date > selected)
  const [year, month, day] = selected.split('-').map(Number)
  const label = `${year} 年 ${month} 月 ${day} 日 ${weekdayOf(selected)}`
  return (
    <div className="diary-day">
      <div className="diary-day-head">
        <button disabled={!previous} onClick={() => previous && select(previous)}>
          ‹ 上一篇
        </button>
        <h3>{label}</h3>
        <button disabled={!next} onClick={() => next && select(next)}>
          下一篇 ›
        </button>
      </div>
      <div className="diary-ask">
        <span className="muted">问 AI：</span>
        <button
          onClick={() =>
            askAi(
              `请阅读 ${directory} 中 ${label} 的日记（如有），告诉我这天做了什么、有哪些未完成事项：`,
            )
          }
        >
          这天做了什么
        </button>
        <button
          onClick={() =>
            askAi(
              `请查阅 ${directory} 中最近 7 天的日记，汇总我花了多少钱：按日期列出每笔花销和合计；没有写明金额的写“待核实”，不要编造。`,
            )
          }
        >
          最近一周花了多少钱
        </button>
        <button
          onClick={() =>
            askAi(
              `请查阅 ${directory} 中 ${year} 年 ${month} 月的日记，总结这个月的主要进展、花销合计和遗留问题：`,
            )
          }
        >
          这个月总结
        </button>
      </div>
      {entries.length > 1 && (
        <div className="diary-day-tabs" role="tablist">
          {entries.map((item, i) => (
            <button
              key={item.path}
              role="tab"
              aria-selected={i === index}
              className={i === index ? 'on' : ''}
              onClick={() => setIndex(i)}
            >
              {item.name}
            </button>
          ))}
        </div>
      )}
      {!entries.length && (
        <div className="diary-card">
          <b>这天没有日记</b>
          {selected === today && (
            <p className="muted">今天的草稿会按时自动生成，也可以在项目首页现在起草。</p>
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {entry && (
        <article className="diary-preview diary-day-doc" aria-label="当天日记">
          <header>
            <strong>{entry.name}</strong>
            <button className="primary" onClick={() => openFile(entry)}>
              继续写
            </button>
            <button onClick={() => askAi(`${editRule}请修改 ${entry.path}：`)}>让 AI 修改…</button>
          </header>
          {doc ? <ConversationMarkdown source={doc.content} /> : <p className="muted">正在读取…</p>}
          {doc?.truncated && <p>正文较长，显示前 128 KB；打开原文可查看全文。</p>}
        </article>
      )}
    </div>
  )
}
