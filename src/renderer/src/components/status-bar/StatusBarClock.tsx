import { useEffect, useState } from 'react'

import { useSettingsStore } from '../../stores/settings-store'

export function StatusBarClock(): React.ReactElement {
  const clockTimeZone = useSettingsStore((state) => state.settings.clockTimeZone)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const refresh = (): void => {
      clearTimeout(timer)
      const current = new Date()
      setNow(current)
      // Read the wall clock on every tick, including a delayed tick after sleep.
      timer = setTimeout(refresh, 60_000 - (current.getTime() % 60_000))
    }
    const handleVisibility = (): void => {
      if (document.visibilityState === 'visible') refresh()
    }

    refresh()
    window.addEventListener('focus', refresh)
    window.addEventListener('pageshow', refresh)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('pageshow', refresh)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: clockTimeZone === 'system' ? undefined : clockTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const { year, month, day, weekday, hour, minute } = Object.fromEntries(
    formatter.formatToParts(now).map(({ type, value }) => [type, value]),
  )
  const monthDay = `${month}/${day}`
  const time = `${hour}:${minute}`
  const full = `${year}/${monthDay} ${weekday} · ${time}`
  const source = clockTimeZone === 'system' ? '本机时间' : '状态栏时间'
  const description = `${source}：${full}（${formatter.resolvedOptions().timeZone}）`

  return (
    <time
      className="status-bar-clock"
      dateTime={now.toISOString()}
      title={description}
      aria-label={description}
      tabIndex={0}
    >
      <span className="status-bar-clock-full" aria-hidden="true">
        {full}
      </span>
      <span className="status-bar-clock-compact" aria-hidden="true">
        {monthDay} · {time}
      </span>
    </time>
  )
}
