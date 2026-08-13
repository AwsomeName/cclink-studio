import { useEffect, useState } from 'react'
import type { AgentSkillSummary } from '@shared/agent-skill'

let cachedSkills: AgentSkillSummary[] | null = null
let pendingSkills: Promise<AgentSkillSummary[]> | null = null

function loadSkills(): Promise<AgentSkillSummary[]> {
  if (cachedSkills) return Promise.resolve(cachedSkills)
  pendingSkills ??= window.cclinkStudio.agent.listSkills().then((skills) => {
    cachedSkills = skills
    return skills
  })
  return pendingSkills.finally(() => {
    pendingSkills = null
  })
}

export function useAgentSkills(): {
  skills: AgentSkillSummary[]
  error: string | null
  reload: () => void
} {
  const [skills, setSkills] = useState<AgentSkillSummary[]>(cachedSkills ?? [])
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let cancelled = false
    void loadSkills()
      .then((nextSkills) => {
        if (cancelled) return
        setSkills(nextSkills)
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
    skills,
    error,
    reload: () => {
      cachedSkills = null
      setRevision((value) => value + 1)
    },
  }
}
