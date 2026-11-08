import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import type { AltiumPreviewJob, ParsedAltiumPreview } from './altium-preview-parser'

// Only in-flight resources are owned here. No document, workspace or persistent cache owner.
let activeJobs = 0
let pendingBytes = 0
const waiting: Array<() => void> = []

async function acquireParser(byteLength: number): Promise<() => void> {
  if (waiting.length >= 8 || pendingBytes + byteLength > 64 * 1024 * 1024) {
    throw new Error('Altium 预览忙，请等待当前图纸加载后重试')
  }
  pendingBytes += byteLength
  try {
    await new Promise<void>((resolve, reject) => {
      if (activeJobs < 2) {
        activeJobs++
        resolve()
        return
      }
      const ready = (): void => {
        clearTimeout(timer)
        activeJobs++
        resolve()
      }
      const timer = setTimeout(() => {
        waiting.splice(waiting.indexOf(ready), 1)
        reject(new Error('Altium 预览排队超过 15 秒，请重试'))
      }, 15_000)
      waiting.push(ready)
    })
  } catch (error) {
    pendingBytes -= byteLength
    throw error
  }
  return () => {
    activeJobs--
    pendingBytes -= byteLength
    waiting.shift()?.()
  }
}

export async function renderAltiumPreview(job: AltiumPreviewJob): Promise<ParsedAltiumPreview> {
  const release = await acquireParser(job.bytes.byteLength)
  try {
    return await new Promise<ParsedAltiumPreview>((resolve, reject) => {
      const worker = new Worker(join(__dirname, 'altium-preview-worker.js'), {
        workerData: job,
        resourceLimits: { maxOldGenerationSizeMb: 256, stackSizeMb: 8 },
      })
      worker.unref()
      let settled = false
      const finish = (error?: Error, result?: ParsedAltiumPreview): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        void worker.terminate().then(
          () => {
            if (error) reject(error)
            else resolve(result!)
          },
          () => reject(error ?? new Error('Altium 解析进程无法释放')),
        )
      }
      const timer = setTimeout(() => finish(new Error('Altium 预览超过 15 秒，已停止解析')), 15_000)
      worker.once(
        'message',
        (message: { ok: boolean; result?: ParsedAltiumPreview; message?: string }) => {
          if (message.ok && message.result) finish(undefined, message.result)
          else finish(new Error(message.message ?? 'Altium 解析失败'))
        },
      )
      worker.once('error', () => finish(new Error('Altium 解析进程失败或超出内存限制')))
      worker.once('exit', () => finish(new Error('Altium 解析进程意外结束')))
    })
  } finally {
    release()
  }
}
