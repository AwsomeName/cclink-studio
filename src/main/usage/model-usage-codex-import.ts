import { createReadStream, existsSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ModelUsageContext } from '../../shared/model-usage'
import type { ModelUsageStore } from './model-usage-store'
import { createCodexCall } from './model-usage-collector'
import { transcriptLines, type ImportResult } from './model-usage-import'
import { codexBreakdown, object, string } from './model-usage-normalize'

/** Only threads Studio's app-server client started; Codex Desktop/CLI sessions are never read. */
export const STUDIO_CODEX_ORIGINATOR = 'cclink_studio'

export function codexHomeDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return env.CODEX_HOME || join(homedir(), '.codex')
}

export async function codexRolloutFiles(codexHome: string, threadIds?: string[]) {
  const found: string[] = []
  async function visit(path: string): Promise<void> {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue
      const next = join(path, entry.name)
      if (entry.isDirectory()) await visit(next)
      else if (
        entry.isFile() &&
        entry.name.startsWith('rollout-') &&
        entry.name.endsWith('.jsonl') &&
        (!threadIds || threadIds.some((id) => entry.name.endsWith(`-${id}.jsonl`)))
      )
        found.push(next)
    }
  }
  for (const directory of ['sessions', 'archived_sessions']) {
    const root = join(codexHome, directory)
    if (existsSync(root)) await visit(root)
  }
  return found.sort()
}

type Cursor = {
  inode: number
  offset: number
  mtime: number
  studio: boolean
  threadId: string | null
  workspace: string | null
  model: string | null
}

/**
 * Import Codex rollout token_count events for Studio-originated threads. Usage numbers only:
 * messages, tool calls, instructions and reasoning text are parsed transiently and discarded.
 */
export async function importCodexRollouts(
  store: ModelUsageStore,
  codexHome: string,
  options: {
    threadIds?: string[]
    incremental?: boolean
    accept?: (timestamp: string, threadId: string) => boolean
    contextAt?: (timestamp: string, threadId: string) => ModelUsageContext
  } = {},
): Promise<ImportResult & { skippedExternal: number }> {
  const result = {
    files: 0,
    inserted: 0,
    replayed: 0,
    invalidLines: 0,
    pendingLines: 0,
    unidentifiable: 0,
    earliest: null as string | null,
    latest: null as string | null,
    skippedExternal: 0,
  }
  for (const file of await codexRolloutFiles(codexHome, options.threadIds)) {
    const info = await stat(file)
    const cursorKey = `codex-rollout-cursor:${file}`
    const saved = store.getMeta<Cursor | null>(cursorKey, null)
    const sameFile = saved !== null && saved.inode === info.ino && saved.offset <= info.size
    if (sameFile && !saved.studio) {
      result.skippedExternal++
      continue
    }
    const resume =
      options.incremental &&
      sameFile &&
      !(saved.offset === info.size && saved.mtime !== info.mtimeMs)
    if (resume && saved.offset === info.size) continue
    const cursor: Cursor = resume
      ? { ...saved }
      : {
          inode: info.ino,
          offset: 0,
          mtime: info.mtimeMs,
          studio: false,
          threadId: null,
          workspace: null,
          model: null,
        }
    const input = createReadStream(file, { start: cursor.offset })
    let lastInvalid = false
    let decided = cursor.offset > 0
    if (decided) result.files++
    try {
      for await (const item of transcriptLines(input, cursor.offset, true)) {
        if (item.partial) {
          result.pendingLines++
          continue
        }
        if (lastInvalid) {
          result.invalidLines++
          lastInvalid = false
        }
        let line: Record<string, unknown> | null = null
        if (item.line.trim()) {
          try {
            line = object(JSON.parse(item.line))
          } catch {
            lastInvalid = true
          }
        }
        if (!decided) {
          // The first record decides ownership; nothing else of a foreign file is parsed.
          decided = true
          const meta = object(line?.payload)
          cursor.studio =
            line?.type === 'session_meta' && meta.originator === STUDIO_CODEX_ORIGINATOR
          if (!cursor.studio) break
          result.files++
          cursor.threadId = string(meta.id) ?? string(meta.session_id)
          cursor.workspace = string(meta.cwd)
        }
        cursor.offset = item.end
        if (!line) continue
        const payload = object(line.payload)
        if (line.type === 'turn_context') {
          cursor.model = string(payload.model) ?? cursor.model
          continue
        }
        if (line.type !== 'event_msg' || payload.type !== 'token_count') continue
        const usage = object(payload.info)
        const timestamp = string(line.timestamp)
        if (!Object.keys(usage).length) continue
        if (!cursor.threadId || !timestamp || !Number.isFinite(Date.parse(timestamp))) {
          result.unidentifiable++
          continue
        }
        const at = new Date(timestamp).toISOString()
        if (options.accept && !options.accept(at, cursor.threadId)) continue
        const record = createCodexCall(
          {
            provider: 'openai',
            workspace: cursor.workspace,
            ...options.contextAt?.(at, cursor.threadId),
          },
          store.originId,
          cursor.threadId,
          {
            last: codexBreakdown(usage.last_token_usage),
            total: codexBreakdown(usage.total_token_usage),
            model: cursor.model,
          },
          at,
          'codex-rollout',
        )
        if (!record) continue
        if (store.put(record)) result.inserted++
        else result.replayed++
        if (!result.earliest || at < result.earliest) result.earliest = at
        if (!result.latest || at > result.latest) result.latest = at
      }
      if (!decided) continue // empty file: decide on a later pass
      if (!cursor.studio) {
        result.skippedExternal++
        cursor.offset = 0
      }
      if (lastInvalid) result.pendingLines++
      store.setMeta(cursorKey, { ...cursor, inode: info.ino, mtime: info.mtimeMs })
    } finally {
      input.destroy()
    }
  }
  return result
}
