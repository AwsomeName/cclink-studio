import { useEffect, useState } from 'react'
import type { AgentCapabilityStatus } from '@shared/agent-protocol'

/** Local AI readiness for diary projects, where daily drafts depend on it. */
export function AiStatusBarItem(): React.ReactElement | null {
  const [status, setStatus] = useState<AgentCapabilityStatus | null>(null)
  useEffect(() => {
    let alive = true
    const load = (): void =>
      void window.cclinkStudio.agent
        .getCapabilities()
        .then((items) => {
          if (alive) setStatus(items.find((item) => item.name === 'agent-backend') ?? null)
        })
        .catch(() => {})
    load()
    const timer = window.setInterval(load, 60_000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])
  if (!status) return null
  const ready = status.state === 'ready'
  return (
    <span
      className="status-bar-item status-bar-ai"
      title={status.reason ?? (ready ? '本机 AI 就绪' : '本机 AI 不可用')}
    >
      <span className="status-bar-text">{ready ? 'AI 就绪' : 'AI 不可用'}</span>
    </span>
  )
}
