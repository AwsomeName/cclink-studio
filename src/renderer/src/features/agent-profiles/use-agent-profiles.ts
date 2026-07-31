import { useEffect, useState } from 'react'
import type { AgentProfileSummary } from '@shared/agent-profile'

let cachedProfiles: AgentProfileSummary[] | null = null
let pendingProfiles: Promise<AgentProfileSummary[]> | null = null

function loadProfiles(): Promise<AgentProfileSummary[]> {
  if (cachedProfiles) return Promise.resolve(cachedProfiles)
  pendingProfiles ??= window.cclinkStudio.agent.listProfiles().then((profiles) => {
    cachedProfiles = profiles
    return profiles
  })
  return pendingProfiles.finally(() => {
    pendingProfiles = null
  })
}

export function useAgentProfiles(): {
  profiles: AgentProfileSummary[]
  error: string | null
} {
  const [profiles, setProfiles] = useState<AgentProfileSummary[]>(cachedProfiles ?? [])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void loadProfiles()
      .then((nextProfiles) => {
        if (cancelled) return
        setProfiles(nextProfiles)
        setError(null)
      })
      .catch((cause) => {
        if (cancelled) return
        setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { profiles, error }
}
