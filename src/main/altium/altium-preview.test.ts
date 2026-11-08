import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ workers: [] as EventEmitter[], failStart: false }))
vi.mock('node:worker_threads', () => ({
  Worker: class extends EventEmitter {
    constructor() {
      super()
      if (state.failStart) throw new Error('worker startup failed')
      state.workers.push(this)
    }
    unref(): void {}
    async terminate(): Promise<number> {
      this.emit('exit', 1)
      return 1
    }
  },
}))

const job = { bytes: new Uint8Array(10), path: '/board.SchDoc', fileName: 'board.SchDoc' }
const result = { kind: 'project-references', references: [] }
const complete = (index: number): void => {
  state.workers[index].emit('message', { ok: true, result })
}

beforeEach(() => {
  state.workers = []
  state.failStart = false
  vi.resetModules()
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

describe('Altium parser worker lifecycle', () => {
  it('finishes a burst of tab opens with at most two running workers', async () => {
    const { renderAltiumPreview } = await import('./altium-preview')
    const requests = Array.from({ length: 10 }, () => renderAltiumPreview(job))
    const settled = Promise.all(requests)
    await vi.advanceTimersByTimeAsync(0)
    expect(state.workers).toHaveLength(2)
    for (let index = 0; index < 10; index++) {
      complete(index)
      await vi.advanceTimersByTimeAsync(0)
      expect(state.workers).toHaveLength(Math.min(index + 3, 10))
    }
    expect(await settled).toEqual(Array.from({ length: 10 }, () => result))
  })

  it('bounds queued requests and total retained input bytes', async () => {
    const { renderAltiumPreview } = await import('./altium-preview')
    const requests = Array.from({ length: 10 }, () => renderAltiumPreview(job))
    await expect(renderAltiumPreview(job)).rejects.toThrow('预览忙')
    await vi.advanceTimersByTimeAsync(0)
    for (let index = 0; index < 10; index++) {
      complete(index)
      await vi.advanceTimersByTimeAsync(0)
    }
    await Promise.all(requests)
    const large = { ...job, bytes: new Uint8Array(32 * 1024 * 1024) }
    const pair = [renderAltiumPreview(large), renderAltiumPreview(large)]
    await expect(renderAltiumPreview(job)).rejects.toThrow('预览忙')
    await vi.advanceTimersByTimeAsync(0)
    complete(10)
    complete(11)
    await Promise.all(pair)
  })

  it('times out stuck workers and queued requests, then accepts a fresh request', async () => {
    const { renderAltiumPreview } = await import('./altium-preview')
    const requests = Promise.allSettled(Array.from({ length: 3 }, () => renderAltiumPreview(job)))
    await vi.advanceTimersByTimeAsync(15_001)
    const outcomes = await requests
    expect(outcomes.every((outcome) => outcome.status === 'rejected')).toBe(true)
    const fresh = renderAltiumPreview(job)
    await vi.advanceTimersByTimeAsync(0)
    complete(2)
    await expect(fresh).resolves.toEqual(result)
  })

  it('releases admission after worker startup and runtime failures', async () => {
    const { renderAltiumPreview } = await import('./altium-preview')
    state.failStart = true
    await expect(renderAltiumPreview(job)).rejects.toThrow('startup failed')
    state.failStart = false
    const failed = renderAltiumPreview(job)
    const rejection = expect(failed).rejects.toThrow('解析进程失败')
    await vi.advanceTimersByTimeAsync(0)
    state.workers[0].emit('error', new Error('out of memory'))
    await rejection
    const fresh = renderAltiumPreview(job)
    await vi.advanceTimersByTimeAsync(0)
    complete(1)
    await expect(fresh).resolves.toEqual(result)
  })
})
