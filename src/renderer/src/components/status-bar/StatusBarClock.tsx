import { useEffect, useState } from 'react'

const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const pad = (value: number): string => String(value).padStart(2, '0')

export function StatusBarClock(): React.ReactElement {
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

  const monthDay = `${pad(now.getMonth() + 1)}/${pad(now.getDate())}`
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`
  const full = `${now.getFullYear()}/${monthDay} ${weekdays[now.getDay()]} · ${time}`
  const description = `本机时间：${full}（${Intl.DateTimeFormat().resolvedOptions().timeZone}）`

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
