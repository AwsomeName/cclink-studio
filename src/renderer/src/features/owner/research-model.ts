export * from '@shared/owner/research'
import type { Research } from '@shared/owner/research'
export const freshResearch = (): Research => ({
  plan: null,
  phase: 'draft',
  chat: [],
  log: [],
  docs: [],
  report: null,
})
