import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
}))

import { UsageLedgerService } from './usage-ledger-service'

let tempDir = ''

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'cclink-usage-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('UsageLedgerService', () => {
  it('persists and summarizes mixed usage units without enforcing a budget', async () => {
    const filePath = join(tempDir, 'usage.jsonl')
    const service = new UsageLedgerService(filePath)
    await service.record({
      conversationId: 'conversation-1',
      source: 'agent-model',
      provider: 'claude-code',
      quantity: 1,
      unit: 'usd',
      amount: 0.25,
      estimated: false,
      status: 'succeeded',
    })
    await service.record({
      conversationId: 'conversation-1',
      source: 'image-generation',
      provider: 'meshy',
      model: 'nano-banana',
      quantity: 1,
      unit: 'credit',
      amount: 3,
      estimated: false,
      status: 'succeeded',
    })

    await expect(service.summarize('conversation-1')).resolves.toEqual({
      events: 2,
      byUnit: { usd: 0.25, credit: 3 },
    })
    expect((await readFile(filePath, 'utf-8')).trim().split('\n')).toHaveLength(2)
  })
})
