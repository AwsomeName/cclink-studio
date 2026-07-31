import { useEffect, useState } from 'react'
import type { AgentRoleSummary } from '@shared/agent-role'

let cachedRoles: AgentRoleSummary[] | null = null
let pendingRoles: Promise<AgentRoleSummary[]> | null = null

function loadRoles(): Promise<AgentRoleSummary[]> {
  if (cachedRoles) return Promise.resolve(cachedRoles)
  pendingRoles ??= window.cclinkStudio.agent.listRoles().then((roles) => {
    cachedRoles = roles
    return roles
  })
  return pendingRoles.finally(() => {
    pendingRoles = null
  })
}

export function useAgentRoles(): {
  roles: AgentRoleSummary[]
  error: string | null
  reload: () => void
} {
  const [roles, setRoles] = useState<AgentRoleSummary[]>(cachedRoles ?? [])
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let cancelled = false
    void loadRoles()
      .then((nextRoles) => {
        if (cancelled) return
        setRoles(nextRoles)
        setError(null)
      })
      .catch((cause) => {
        if (cancelled) return
        setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      cancelled = true
    }
  }, [revision])

  return {
    roles,
    error,
    reload: () => {
      cachedRoles = null
      setRevision((value) => value + 1)
    },
  }
}
