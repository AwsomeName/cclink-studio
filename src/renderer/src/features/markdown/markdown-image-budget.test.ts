import { describe, expect, it } from 'vitest'
import {
  MARKDOWN_IMAGE_AUTO_LOAD_BYTES,
  createImageLoadQueue,
  formatImageSize,
  shouldAutoLoadMarkdownImage,
} from './markdown-image-budget'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

describe('markdown image budget', () => {
  it('auto-loads images up to the size limit only', () => {
    expect(shouldAutoLoadMarkdownImage(MARKDOWN_IMAGE_AUTO_LOAD_BYTES)).toBe(true)
    expect(shouldAutoLoadMarkdownImage(MARKDOWN_IMAGE_AUTO_LOAD_BYTES + 1)).toBe(false)
  })

  it('formats sizes for the placeholder', () => {
    expect(formatImageSize(7.7 * 1024 * 1024)).toBe('7.7 MB')
    expect(formatImageSize(300 * 1024)).toBe('300 KB')
  })

  it('runs at most `limit` loads at once and starts the next when one finishes', async () => {
    const queue = createImageLoadQueue(2)
    const gates = [deferred(), deferred(), deferred()]
    const started: number[] = []
    const jobs = gates.map((gate, index) =>
      queue.enqueue(async () => {
        started.push(index)
        await gate.promise
        return index
      }),
    )
    await Promise.resolve()
    expect(started).toEqual([0, 1])
    gates[0].resolve()
    await jobs[0].promise
    await Promise.resolve()
    expect(started).toEqual([0, 1, 2])
    gates[1].resolve()
    gates[2].resolve()
    await expect(Promise.all(jobs.map((job) => job.promise))).resolves.toEqual([0, 1, 2])
  })

  it('drops a cancelled load that has not started', async () => {
    const queue = createImageLoadQueue(1)
    const gate = deferred()
    const started: string[] = []
    const first = queue.enqueue(async () => {
      started.push('first')
      await gate.promise
    })
    const second = queue.enqueue(async () => {
      started.push('second')
    })
    second.cancel()
    gate.resolve()
    await first.promise
    await Promise.resolve()
    expect(started).toEqual(['first'])
  })
})
