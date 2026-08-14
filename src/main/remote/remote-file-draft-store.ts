import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { RemoteFileDraft } from '../../shared/ipc/remote'
import type { RemoteWorkspaceRef } from '../../shared/workspace-ref'

const MAX_STORE_BYTES = 16 * 1024 * 1024
const MAX_DRAFTS = 100

export class RemoteFileDraftStore {
  private drafts = new Map<string, RemoteFileDraft>()
  private loaded = false
  private writes = Promise.resolve()

  constructor(private readonly filePath: string) {}

  async get(ref: RemoteWorkspaceRef, path: string): Promise<RemoteFileDraft | null> {
    await this.ensureLoaded()
    return this.drafts.get(key(ref, path)) ?? null
  }

  async save(draft: RemoteFileDraft): Promise<void> {
    await this.ensureLoaded()
    this.drafts.set(key(draft.ref, draft.path), { ...draft, updatedAt: Date.now() })
    this.trim()
    await this.persist()
  }

  async delete(ref: RemoteWorkspaceRef, path: string): Promise<void> {
    await this.ensureLoaded()
    if (this.drafts.delete(key(ref, path))) await this.persist()
  }

  async deletePrefix(ref: RemoteWorkspaceRef, pathPrefix: string): Promise<void> {
    await this.ensureLoaded()
    let changed = false
    for (const [draftKey, draft] of this.drafts) {
      if (sameWorkspace(draft.ref, ref) && isPathWithin(draft.path, pathPrefix)) {
        this.drafts.delete(draftKey)
        changed = true
      }
    }
    if (changed) await this.persist()
  }

  async rebasePrefix(ref: RemoteWorkspaceRef, oldPrefix: string, newPrefix: string): Promise<void> {
    await this.ensureLoaded()
    const rebased: RemoteFileDraft[] = []
    for (const [draftKey, draft] of this.drafts) {
      if (!sameWorkspace(draft.ref, ref) || !isPathWithin(draft.path, oldPrefix)) continue
      this.drafts.delete(draftKey)
      rebased.push({
        ...draft,
        path: `${newPrefix}${draft.path.slice(oldPrefix.length)}`,
        updatedAt: Date.now(),
      })
    }
    for (const draft of rebased) this.drafts.set(key(draft.ref, draft.path), draft)
    if (rebased.length) await this.persist()
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const info = await stat(this.filePath)
      if (info.size > MAX_STORE_BYTES) throw new Error('远程草稿文件超过安全大小限制')
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as { drafts?: unknown }
      if (!Array.isArray(parsed.drafts)) return
      for (const value of parsed.drafts.slice(-MAX_DRAFTS)) {
        const draft = sanitizeDraft(value)
        if (draft) this.drafts.set(key(draft.ref, draft.path), draft)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      const quarantine = `${this.filePath}.corrupt-${Date.now()}`
      await rename(this.filePath, quarantine).catch(() => undefined)
      console.warn('[CCLink Studio] 远程草稿状态损坏，已隔离:', error)
    }
  }

  private trim(): void {
    if (this.drafts.size <= MAX_DRAFTS) return
    const sorted = [...this.drafts.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt)
    for (const [draftKey] of sorted.slice(0, this.drafts.size - MAX_DRAFTS)) {
      this.drafts.delete(draftKey)
    }
  }

  private persist(): Promise<void> {
    const snapshot = JSON.stringify({ version: 1, drafts: [...this.drafts.values()] }, null, 2)
    const write = this.writes
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 })
        const temporary = join(dirname(this.filePath), `.remote-drafts.${randomUUID()}.tmp`)
        await writeFile(temporary, snapshot, { encoding: 'utf8', mode: 0o600 })
        await rename(temporary, this.filePath)
        await chmod(this.filePath, 0o600)
      })
    this.writes = write
    return write
  }
}

function sanitizeDraft(value: unknown): RemoteFileDraft | null {
  if (!value || typeof value !== 'object') return null
  const draft = value as Partial<RemoteFileDraft>
  if (
    !draft.ref ||
    draft.ref.transport !== 'cclink' ||
    typeof draft.ref.endpointId !== 'string' ||
    typeof draft.ref.workspaceId !== 'string' ||
    typeof draft.ref.path !== 'string' ||
    typeof draft.path !== 'string' ||
    typeof draft.content !== 'string' ||
    typeof draft.savedContent !== 'string' ||
    typeof draft.sha256 !== 'string' ||
    typeof draft.updatedAt !== 'number' ||
    Buffer.byteLength(draft.content, 'utf8') > 2 * 1024 * 1024 ||
    Buffer.byteLength(draft.savedContent, 'utf8') > 2 * 1024 * 1024
  )
    return null
  return draft as RemoteFileDraft
}

function key(ref: RemoteWorkspaceRef, path: string): string {
  return JSON.stringify([ref.transport, ref.endpointId, ref.workspaceId, ref.path, path])
}

function sameWorkspace(left: RemoteWorkspaceRef, right: RemoteWorkspaceRef): boolean {
  return (
    left.transport === right.transport &&
    left.endpointId === right.endpointId &&
    left.workspaceId === right.workspaceId &&
    left.path === right.path
  )
}

function isPathWithin(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}\\`)
}
