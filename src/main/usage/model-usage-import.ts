import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
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
  options: {
    sessionId?: string
    after?: string
    before?: string
    incremental?: boolean
    files?: string[]
    contextAt?: (timestamp: string) => ModelUsageContext
    accept?: (timestamp: string, file: string) => boolean
  } = {},
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
  if (options.files) for (const file of options.files) files.add(file)
  else
    for (const root of roots)
      for (const file of await transcriptFiles(root, options.sessionId)) files.add(file)
  for (const file of files) {
    const info = await stat(file)
    const cursorKey = `transcript-cursor:${file}`
    const cursor = options.incremental
      ? store.getMeta(cursorKey, { inode: 0, offset: 0, mtime: 0 })
      : null
    const start =
      cursor &&
      cursor.inode === info.ino &&
      cursor.offset <= info.size &&
      !(cursor.offset === info.size && cursor.mtime !== info.mtimeMs)
        ? cursor.offset
        : 0
    if (options.incremental && start === info.size) continue
    result.files++
    // Read line by line; content exists only while extracting metadata and is never retained.
    const input = createReadStream(file, { start })
    let offset = start
    const lines = transcriptLines(input, start, Boolean(options.incremental))
    let lastInvalid = false
    try {
      for await (const item of lines) {
        const { line } = item
        if (item.partial) {
          result.pendingLines++
          continue
        }
        offset = item.end
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
        if (options.accept && !options.accept(canonicalTime, file)) continue
        if (
          (options.after && canonicalTime < options.after) ||
          (options.before && canonicalTime > options.before)
        )
          continue
        const synthetic = message.model === '<synthetic>' || event.isApiErrorMessage === true
        const record = createCall(
          {
            ...context,
            ...options.contextAt?.(canonicalTime),
            workspace: string(event.cwd) ?? context.workspace,
          },
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
      if (options.incremental)
        store.setMeta(cursorKey, { inode: info.ino, offset, mtime: info.mtimeMs })
    } finally {
      input.destroy()
    }
  }
  return result
}

async function* transcriptLines(
  input: ReturnType<typeof createReadStream>,
  start: number,
  incremental: boolean,
) {
  let pending = Buffer.alloc(0)
  let offset = start
  for await (const chunk of input) {
    pending = Buffer.concat([pending, Buffer.from(chunk)])
    let newline: number
    while ((newline = pending.indexOf(10)) >= 0) {
      const line = pending.subarray(0, newline).toString('utf8').replace(/\r$/, '')
      offset += newline + 1
      pending = pending.subarray(newline + 1)
      yield { line, end: offset, partial: false }
    }
    if (pending.length > 32 * 1024 * 1024) throw new Error('TRANSCRIPT_LINE_TOO_LARGE')
  }
  if (pending.length)
    yield { line: pending.toString('utf8'), end: offset + pending.length, partial: incremental }
}
