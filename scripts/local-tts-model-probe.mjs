import { fork } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'

const root = resolve(process.argv[2] || '')
const output = resolve(process.argv[3] || '.cache/local-tts-probe')
await mkdir(output, { recursive: true })
const samples = [
  '你好，欢迎使用本地朗读。你可以一边听文档，一边整理笔记。',
  'CCLink Studio 使用 Electron 和 TypeScript。请先运行 pnpm dev，再检查 API 返回的 JSON。',
  '今天是2026年11月16日，版本号是0.1.146，完成比例为百分之八十五，金额为一千二百三十四元。',
  '阅读不必总是占据双眼。暂停之后，可以从刚才的位置继续播放。标题、段落和列表保留结构，格式符号与冗长的网址不必逐字念出。切换到新的文章时，旧的朗读应立即停止。',
]
const results = []
const worker = fork(resolve('src/main/local-tts/tts-worker.cjs'), [root], {
  stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
})
const started = performance.now()
const timeout = setTimeout(() => {
  worker.kill('SIGKILL')
  process.exitCode = 1
}, 120000)
let index = 0
worker.on('message', async (message) => {
  if (message.type === 'error') {
    console.error(message)
    worker.kill()
    process.exitCode = 1
    return
  }
  if (message.type === 'ready') {
    results.push({ phase: 'load', ...message })
    worker.send({ type: 'generate', id: String(index), text: samples[index], voice: 3 })
  }
  if (message.type === 'audio') {
    const { base64, ...metrics } = message
    assert(message.duration > 0)
    await writeFile(join(output, `sample-${index + 1}.wav`), Buffer.from(base64, 'base64'))
    results.push({ ...metrics, rtf: message.elapsedMs / 1000 / message.duration })
    console.log(JSON.stringify(results.at(-1)))
    index++
    if (index < samples.length)
      worker.send({
        type: 'generate',
        id: String(index),
        text: samples[index],
        voice: index === 3 ? 58 : 3,
      })
    else {
      worker.send({ type: 'generate', id: 'cancel', text: samples[3].repeat(4), voice: 3 })
      setTimeout(() => {
        const killAt = performance.now()
        worker.once('exit', async () => {
          results.push({
            phase: 'cancel',
            exitMs: performance.now() - killAt,
            totalMs: performance.now() - started,
          })
          await writeFile(join(output, 'metrics.json'), JSON.stringify(results, null, 2))
          console.log(JSON.stringify(results.at(-1)))
        })
        worker.kill('SIGKILL')
      }, 100)
    }
  }
})
worker.on('exit', () => clearTimeout(timeout))
worker.on('error', (error) => {
  console.error(error)
  process.exitCode = 1
  clearTimeout(timeout)
})
