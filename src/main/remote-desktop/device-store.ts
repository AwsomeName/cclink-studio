import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { SaveRemoteDesktopDeviceInput } from '../../shared/ipc/remote-desktop'

const MAX_DEVICES = 64

const deviceSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(80),
    host: z.string().min(1).max(253),
    port: z.number().int().min(5900).max(5999),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .strict()
const fileSchema = z.object({
  version: z.literal(1),
  devices: z.array(deviceSchema).max(MAX_DEVICES),
})

export type StoredDesktopDevice = z.infer<typeof deviceSchema>

/**
 * Single owner of `userData/remote-desktop/devices.json`: name, host and port of machines this
 * Studio connects to. Credentials are never written here (see CredentialService).
 */
export class RemoteDesktopDeviceStore {
  private devices: StoredDesktopDevice[] | null = null
  private tail: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly directory: string,
    private readonly now: () => number = Date.now,
  ) {}

  private get file(): string {
    return join(this.directory, 'devices.json')
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const job = this.tail.then(fn, fn)
    this.tail = job.catch(() => {})
    return job
  }

  private async load(): Promise<StoredDesktopDevice[]> {
    if (this.devices) return this.devices
    try {
      this.devices = fileSchema.parse(JSON.parse(await readFile(this.file, 'utf8'))).devices
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        // Keep the unreadable file untouched for diagnosis; start with an empty catalog in memory.
        console.warn('[RemoteDesktop] 设备列表无法读取，本次按空列表处理:', String(error))
      }
      this.devices = []
    }
    return this.devices
  }

  private async persist(devices: StoredDesktopDevice[]): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const temp = `${this.file}.${randomUUID()}.tmp`
    await writeFile(temp, JSON.stringify({ version: 1, devices }, null, 2), { mode: 0o600 })
    await rename(temp, this.file)
    this.devices = devices
  }

  list(): Promise<StoredDesktopDevice[]> {
    return this.serial(async () => [...(await this.load())])
  }

  get(id: string): Promise<StoredDesktopDevice | undefined> {
    return this.serial(async () => (await this.load()).find((device) => device.id === id))
  }

  /** Update by id, else reuse a device with the same host and port, else create one. */
  save(input: SaveRemoteDesktopDeviceInput): Promise<StoredDesktopDevice> {
    return this.serial(async () => {
      const devices = await this.load()
      const host = input.host.trim().toLowerCase()
      const existing =
        (input.id && devices.find((device) => device.id === input.id)) ||
        devices.find((device) => device.host === host && device.port === input.port)
      const at = this.now()
      const next: StoredDesktopDevice = existing
        ? { ...existing, name: input.name.trim(), host, port: input.port, updatedAt: at }
        : {
            id: randomUUID(),
            name: input.name.trim(),
            host,
            port: input.port,
            createdAt: at,
            updatedAt: at,
          }
      const others = devices.filter((device) => device.id !== next.id)
      if (!existing && others.length >= MAX_DEVICES) throw new Error('远程设备数量已达上限')
      await this.persist([...others, next])
      return next
    })
  }
}
