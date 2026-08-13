import { useEffect, useState } from 'react'
import type { AgentRoleSummary } from '@shared/agent-role'

let cachedRoles: AgentRoleSummary[] | null = null
let pendingRoles: Promise<AgentRoleSummary[]> | null = null
const AGENT_ROLES_CHANGED_EVENT = 'cclink-studio-agent-roles-changed'

export function notifyAgentRolesChanged(): void {
  cachedRoles = null
  window.dispatchEvent(new Event(AGENT_ROLES_CHANGED_EVENT))
}

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

  useEffect(() => {
    const reloadFromRegistry = (): void => {
      cachedRoles = null
      setRevision((value) => value + 1)
    }
    window.addEventListener(AGENT_ROLES_CHANGED_EVENT, reloadFromRegistry)
    return () => window.removeEventListener(AGENT_ROLES_CHANGED_EVENT, reloadFromRegistry)
  }, [])

  return {
    roles,
    error,
    reload: () => {
      cachedRoles = null
      setRevision((value) => value + 1)
    },
  }
}
