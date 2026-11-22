import { shiftMonth, useDiaryCalendar } from './diary-calendar-store'
import { useDiaryNavigation } from './personal-diary-navigation'
import { showWorkspaceHome } from './workspace-home-navigation'
import { useWorkspaceStore } from '../../stores/workspace-store'

/** Bottom-left month calendar for My Space: days with diaries are marked; a click opens the day. */
export function DiaryCalendar(): React.ReactElement | null {
  const { days, today, month, selected, setMonth, select } = useDiaryCalendar()
  const page = useDiaryNavigation((state) => state.page)
  if (!month) return null
  const [year, monthNumber] = month.split('-').map(Number)
  const first = new Date(Date.UTC(year, monthNumber - 1, 1))
  const count = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  const lead = (first.getUTCDay() + 6) % 7 // Monday first
  const cells: Array<string | null> = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`),
  ]
  const monthCount = Object.keys(days).filter((key) => key.startsWith(month)).length
  const open = (date: string): void => {
    select(date)
    useDiaryNavigation.getState().setPage('日记')
    showWorkspaceHome(useWorkspaceStore.getState().activeWorkspaceRef)
  }
  return (
    <div className="diary-calendar" aria-label="日记日历">
      <div className="diary-calendar-head">
        <button aria-label="上个月" onClick={() => setMonth(shiftMonth(month, -1))}>
          ‹
        </button>
        <button className="diary-calendar-title" onClick={() => open(today)} title="回到今天">
          {year} 年 {monthNumber} 月
        </button>
        <button aria-label="下个月" onClick={() => setMonth(shiftMonth(month, 1))}>
          ›
        </button>
      </div>
      <div className="diary-calendar-grid" role="grid">
        {['一', '二', '三', '四', '五', '六', '日'].map((name) => (
          <span key={name} className="diary-calendar-weekday">
            {name}
          </span>
        ))}
        {cells.map((date, index) =>
          date ? (
            <button
              key={date}
              role="gridcell"
              aria-label={`${date}${days[date] ? ' 有日记' : ''}`}
              aria-selected={page === '日记' && date === selected}
              className={[
                'diary-calendar-day',
                days[date] ? 'has' : '',
                date === today ? 'today' : '',
                page === '日记' && date === selected ? 'selected' : '',
              ].join(' ')}
              onClick={() => open(date)}
            >
              {Number(date.slice(8))}
            </button>
          ) : (
            <span key={`blank-${index}`} />
          ),
        )}
      </div>
      <div className="diary-calendar-foot">本月 {monthCount} 篇</div>
    </div>
  )
}
