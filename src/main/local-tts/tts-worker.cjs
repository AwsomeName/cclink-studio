/* eslint-disable @typescript-eslint/no-require-imports -- Electron utilityProcess loads this standalone CommonJS entry. */
// Runs only in the dedicated, killable utility process, never in the main thread.
const { join } = require('node:path')
const { createRequire } = require('node:module')
const port = process.parentPort
const send = (message) => (port ? port.postMessage(message) : process.send?.(message))
const receive = (callback) =>
  port ? port.on('message', (event) => callback(event.data)) : process.on('message', callback)
const root = process.argv[2]
let tts
let stage = 'loading-native'

function wav(audio) {
  if (audio.sampleRate !== 24000 || audio.samples.length > 24000 * 180)
    throw new Error('INVALID_AUDIO')
  const buffer = Buffer.alloc(44 + audio.samples.length * 2)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(buffer.length - 8, 4)
  buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(audio.sampleRate, 24)
  buffer.writeUInt32LE(audio.sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(buffer.length - 44, 40)
  for (let i = 0; i < audio.samples.length; i++) {
    const v = Math.max(-1, Math.min(1, audio.samples[i]))
    buffer.writeInt16LE(Math.round(v * (v < 0 ? 32768 : 32767)), 44 + i * 2)
  }
  return buffer.toString('base64')
}

try {
  const started = performance.now()
  send({ type: 'stage', stage })
  // Resolve the platform addon explicitly: sherpa's JS loader otherwise swallows
  // the actual load error and reports every failure as a missing module.
  const sherpaRequire = createRequire(require.resolve('sherpa-onnx-node'))
  const platform = process.platform === 'win32' ? 'win' : process.platform
  sherpaRequire(`sherpa-onnx-${platform}-${process.arch}/sherpa-onnx.node`)
  const { OfflineTts } = require('sherpa-onnx-node')
  stage = 'loading-model'
  send({ type: 'stage', stage })
  tts = new OfflineTts({
    model: {
      kokoro: {
        model: join(root, 'model.onnx'),
        voices: join(root, 'voices.bin'),
        tokens: join(root, 'tokens.txt'),
        dataDir: join(root, 'espeak-ng-data'),
        dictDir: join(root, 'dict'),
        lexicon: [join(root, 'lexicon-zh.txt'), join(root, 'lexicon-us-en.txt')].join(','),
        lang: '',
      },
      numThreads: 2,
      provider: 'cpu',
      debug: 0,
    },
    ruleFsts: ['phone-zh.fst', 'date-zh.fst', 'number-zh.fst'].map((f) => join(root, f)).join(','),
    maxNumSentences: 1,
  })
  send({ type: 'ready', loadMs: performance.now() - started, sampleRate: tts.sampleRate })
} catch (error) {
  const code =
    stage === 'loading-native'
      ? error?.code === 'MODULE_NOT_FOUND'
        ? 'NATIVE_MODULE_MISSING'
        : 'NATIVE_MODULE_LOAD_FAILED'
      : 'MODEL_LOAD_FAILED'
  // Fixed codes only: native error messages may contain user paths or input.
  send({ type: 'error', code })
  process.exitCode = 1
  port?.close()
  if (process.connected) process.disconnect()
}

if (tts)
  receive((request) => {
    if (
      !tts ||
      request?.type !== 'generate' ||
      typeof request.text !== 'string' ||
      request.text.length < 1 ||
      request.text.length > 600 ||
      ![3, 58, 0].includes(request.voice) ||
      typeof request.id !== 'string'
    )
      return
    try {
      const started = performance.now()
      const audio = tts.generate({
        text: request.text,
        sid: request.voice,
        speed: 1,
        enableExternalBuffer: false,
      })
      if (!audio.samples.length) throw new Error('EMPTY_AUDIO')
      send({
        type: 'audio',
        id: request.id,
        base64: wav(audio),
        duration: audio.samples.length / audio.sampleRate,
        elapsedMs: performance.now() - started,
        rss: process.memoryUsage().rss,
      })
    } catch {
      send({ type: 'error', id: request.id, code: 'SYNTHESIS_FAILED' })
    }
  })
