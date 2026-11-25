/**
 * Local Markdown images are read in the main process and shipped to the editor as data URLs, so
 * every loaded image costs a file read, a Base64 copy over IPC and a decode. The budget keeps a
 * document with many or very large pictures from freezing the window: images load only near the
 * viewport, at most a couple at a time, and one above the size limit waits for the user.
 */
export const MARKDOWN_IMAGE_AUTO_LOAD_BYTES = 5 * 1024 * 1024
export const MARKDOWN_IMAGE_CONCURRENCY = 2
/** Start loading a little before an image scrolls into view. */
export const MARKDOWN_IMAGE_VIEWPORT_MARGIN = '600px 0px'

export function shouldAutoLoadMarkdownImage(sizeBytes: number): boolean {
  return sizeBytes <= MARKDOWN_IMAGE_AUTO_LOAD_BYTES
}

export function formatImageSize(sizeBytes: number): string {
  return sizeBytes >= 1024 * 1024
    ? `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(sizeBytes / 1024))} KB`
}

export interface ImageLoadQueue {
  /** Runs `task` once a slot is free; the returned cancel drops it if it has not started. */
  enqueue<T>(task: () => Promise<T>): { promise: Promise<T>; cancel: () => void }
}

export function createImageLoadQueue(limit = MARKDOWN_IMAGE_CONCURRENCY): ImageLoadQueue {
  let running = 0
  const waiting: Array<() => void> = []
  const next = (): void => {
    while (running < limit && waiting.length > 0) waiting.shift()?.()
  }
  return {
    enqueue<T>(task: () => Promise<T>) {
      let cancelled = false
      let start!: () => void
      const promise = new Promise<T>((resolve, reject) => {
        start = () => {
          if (cancelled) return
          running += 1
          task()
            .then(resolve, reject)
            .finally(() => {
              running -= 1
              next()
            })
        }
      })
      waiting.push(start)
      next()
      return {
        promise,
        cancel: () => {
          cancelled = true
          const index = waiting.indexOf(start)
          if (index >= 0) waiting.splice(index, 1)
        },
      }
    },
  }
}

/** One queue per window: every open Markdown editor shares the same loading slots. */
export const markdownImageLoadQueue = createImageLoadQueue()
