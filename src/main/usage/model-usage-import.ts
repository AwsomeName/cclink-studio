import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { createInterface } from 'node:readline'
import type { ModelUsageStore } from './model-usage-store'
import { createCall, type ModelUsageContext } from './model-usage-collector'
import { object, sanitizeUsage, string } from './model-usage-normalize'

export interface ImportResult {
  files: number
  inserted: number
  replayed: number
  invalidLines: number
  pendingLines: number
  unidentifiable: number
  earliest: string | null
  latest: string | null
}

export async function transcriptFiles(root: string, sessionId?: string): Promise<string[]> {
  const info = await stat(root)
  if (info.isFile()) return root.endsWith('.jsonl') ? [root] : []
  const found: string[] = []
  async function visit(path: string, insideSession = false): Promise<void> {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue
      const next = join(path, entry.name)
      const selected = insideSession || entry.name === sessionId
      if (entry.isDirectory()) await visit(next, selected)
      else if (
        entry.isFile() &&
        entry.name.endsWith('.jsonl') &&
        (!sessionId || selected || entry.name === `${sessionId}.jsonl`)
      )
        found.push(next)
    }
  }
  await visit(root)
  return found.sort()
}

export async function importTranscripts(
  store: ModelUsageStore,
  roots: string[],
  context: ModelUsageContext = {},
  options: { sessionId?: string; after?: string; before?: string } = {},
): Promise<ImportResult> {
  const result: ImportResult = {
    files: 0,
    inserted: 0,
    replayed: 0,
    invalidLines: 0,
    pendingLines: 0,
    unidentifiable: 0,
    earliest: null,
    latest: null,
  }
  const files = new Set<string>()
  for (const root of roots)
    for (const file of await transcriptFiles(root, options.sessionId)) files.add(file)
  for (const file of files) {
    result.files++
    // Read line by line; content exists only while extracting metadata and is never retained.
    const input = createReadStream(file, { encoding: 'utf8' })
    const lines = createInterface({ input, crlfDelay: Infinity })
    let lastInvalid = false
    try {
      for await (const line of lines) {
        if (lastInvalid) {
          result.invalidLines++
          lastInvalid = false
        }
        if (!line.trim()) continue
        let event: Record<string, unknown>
        try {
          event = object(JSON.parse(line))
        } catch {
          lastInvalid = true
          continue
        }
        if (event.type !== 'assistant') continue
        const message = object(event.message)
        const sessionId = string(event.sessionId) ?? string(event.session_id)
        const messageId = string(message.id) ?? string(event.uuid)
        const timestamp = string(event.timestamp)
        if (!sessionId || !messageId || !timestamp || !Number.isFinite(Date.parse(timestamp))) {
          result.unidentifiable++
          continue
        }
        const canonicalTime = new Date(timestamp).toISOString()
        if (
          (options.after && canonicalTime < options.after) ||
          (options.before && canonicalTime > options.before)
        )
          continue
        const synthetic = message.model === '<synthetic>' || event.isApiErrorMessage === true
        const record = createCall(
          { ...context, workspace: string(event.cwd) ?? context.workspace },
          store.originId,
          sessionId,
          messageId,
          canonicalTime,
          'claude-transcript',
        )
        record.model = synthetic ? null : string(message.model)
        record.requestId = string(event.requestId) ?? string(event.request_id)
        record.parentToolUseId = string(event.parent_tool_use_id)
        // Sidechain association is metadata only; no parent usage is added.
        if (!record.parentToolUseId && file.includes('/subagents/'))
          record.parentToolUseId = basename(file, '.jsonl')
        record.rawUsage = synthetic ? {} : sanitizeUsage(message.usage)
        record.final = !synthetic && typeof message.stop_reason === 'string'
        record.outputEvidence = record.final ? 'transcript-final' : 'unverified'
        record.thinkingEvidence = record.final ? 'transcript-final' : 'unverified'
        record.status = event.error || synthetic ? 'failed' : record.final ? 'succeeded' : 'unknown'
        if (store.put(record)) result.inserted++
        else result.replayed++
        if (!result.earliest || canonicalTime < result.earliest) result.earliest = canonicalTime
        if (!result.latest || canonicalTime > result.latest) result.latest = canonicalTime
      }
      // A writer may currently be appending the final line; don't consume or silently discard it.
      if (lastInvalid) result.pendingLines++
    } finally {
      lines.close()
      input.destroy()
    }
  }
  return result
}
