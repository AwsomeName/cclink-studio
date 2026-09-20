import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'

const grantSchema = z.object({
  workspace: z.string(),
  link: z.string(),
  target: z.string(),
  identity: z.string(),
})
export type LinkedDirectoryGrant = z.infer<typeof grantSchema>
const fileSchema = z.object({ version: z.literal(1), grants: z.array(grantSchema).max(1000) })

/** FileService-owned persistence, outside repositories. No renderer-supplied grants. */
export class LinkedDirectoryGrants {
  private loaded?: Promise<void>
  private grants: LinkedDirectoryGrant[] = []
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly path?: string) {}

  async list(): Promise<readonly LinkedDirectoryGrant[]> {
    this.loaded ??= this.load()
    await this.loaded
    return this.grants
  }

  private async load(): Promise<void> {
    if (!this.path) return
    try {
      this.grants = fileSchema.parse(JSON.parse(await readFile(this.path, 'utf8'))).grants
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[FileService] 链接目录授权记录不可用，需要重新确认')
      }
    }
  }

  add(grant: LinkedDirectoryGrant): Promise<void> {
    const operation = this.queue.then(async () => {
      await this.list()
      const grants = this.grants.filter(
        (item) => item.workspace !== grant.workspace || item.link !== grant.link,
      )
      grants.push(grant)
      const data = fileSchema.parse({ version: 1, grants })
      if (this.path) {
        await mkdir(dirname(this.path), { recursive: true })
        const temporary = `${this.path}.${randomUUID()}.tmp`
        try {
          await writeFile(temporary, JSON.stringify(data), { mode: 0o600, flag: 'wx' })
          await rename(temporary, this.path)
        } finally {
          await unlink(temporary).catch(() => {})
        }
      }
      this.grants = grants
    })
    this.queue = operation.catch(() => {})
    return operation
  }
}
