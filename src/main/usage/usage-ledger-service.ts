import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export type UsageSource = 'agent-model' | 'image-generation'
export type UsageUnit = 'usd' | 'cny' | 'credit' | 'image' | 'token'
export type UsageStatus = 'succeeded' | 'failed' | 'cancelled'

export interface UsageEvent {
  id: string
  conversationId: string
  runId?: string
  source: UsageSource
  provider: string
  model?: string
  quantity: number
  unit: UsageUnit
  amount?: number
  estimated: boolean
  status: UsageStatus
  taskId?: string
  createdAt: string
}

export type UsageEventInput = Omit<UsageEvent, 'id' | 'createdAt'>

export interface UsageSummary {
  events: number
  byUnit: Partial<Record<UsageUnit, number>>
}

export class UsageLedgerService {
  private readonly filePath: string
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(filePath = join(app.getPath('userData'), 'usage-events.jsonl')) {
    this.filePath = filePath
  }

  async record(input: UsageEventInput): Promise<UsageEvent> {
    const event: UsageEvent = {
      ...input,
      id: randomUUID(),
      quantity: normalizeNumber(input.quantity),
      ...(input.amount === undefined ? {} : { amount: normalizeNumber(input.amount) }),
      createdAt: new Date().toISOString(),
    }
    const operation = this.writeQueue.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true })
      await appendFile(this.filePath, `${JSON.stringify(event)}\n`, 'utf-8')
    })
    this.writeQueue = operation.catch(() => undefined)
    await operation
    return event
  }

  async summarize(conversationId?: string): Promise<UsageSummary> {
    await this.writeQueue
    const content = await readFile(this.filePath, 'utf-8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return ''
      throw error
    })
    const events = content
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const event = JSON.parse(line) as UsageEvent
          return !conversationId || event.conversationId === conversationId ? [event] : []
        } catch {
          return []
        }
      })
    const byUnit: UsageSummary['byUnit'] = {}
    for (const event of events) {
      const value = event.amount ?? event.quantity
      byUnit[event.unit] = (byUnit[event.unit] ?? 0) + value
    }
    return { events: events.length, byUnit }
  }

  async flush(): Promise<void> {
    await this.writeQueue
  }
}

function normalizeNumber(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0
}
