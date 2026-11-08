import { parentPort, workerData } from 'node:worker_threads'
import { parseAltiumPreview, type AltiumPreviewJob } from './altium-preview-parser'

try {
  parentPort?.postMessage({ ok: true, result: parseAltiumPreview(workerData as AltiumPreviewJob) })
} catch (error) {
  parentPort?.postMessage({
    ok: false,
    message: error instanceof Error ? error.message.slice(0, 800) : 'Altium 解析失败',
  })
} finally {
  parentPort?.close()
}
