import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fork } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm, copyFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { verifyPackagedTts } = require('./verify-packaged-tts.cjs')
const manifest = require('../package.json')

test('native dependency validation and actual signed-app playback gate precede release assets', async () => {
  const builder = await readFile(new URL('../electron-builder.yml', import.meta.url), 'utf8')
  assert.match(builder, /^afterPack: scripts\/verify-packaged-tts\.cjs$/m)
  const workflow = await readFile(
    new URL('../.github/workflows/release-oss.yml', import.meta.url),
    'utf8',
  )
  const smoke = workflow.indexOf('- name: Smoke packaged local TTS')
  assert(smoke > workflow.indexOf('- name: Verify signed artifacts'))
  assert(smoke < workflow.indexOf('- name: Prepare release assets'))
  assert.match(
    workflow.slice(smoke, workflow.indexOf('- name: Prepare release assets')),
    /pnpm smoke:local-tts-packaged/,
  )
})

test('every sherpa platform runtime is an explicit version-matched app dependency', () => {
  const sherpa = require('sherpa-onnx-node/package.json')
  for (const [name, version] of Object.entries(sherpa.optionalDependencies))
    assert.equal(manifest.optionalDependencies[name], version, name)
})

test('packaging rejects absent native engine, missing dylib, and version mismatch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tts-package-boundary-'))
  const modules = join(root, 'app.asar.unpacked/node_modules')
  const wrapper = join(modules, 'sherpa-onnx-node')
  const native = join(modules, 'sherpa-onnx-darwin-arm64')
  try {
    await mkdir(wrapper, { recursive: true })
    await writeFile(join(wrapper, 'package.json'), JSON.stringify({ version: '2.0.1' }))
    assert.throws(() => verifyPackagedTts(root, 'darwin', 'arm64'), /engine incomplete/)
    await mkdir(native)
    await writeFile(
      join(native, 'package.json'),
      JSON.stringify({
        name: 'sherpa-onnx-darwin-arm64',
        version: '2.0.1',
      }),
    )
    const files = [
      'sherpa-onnx.node',
      'libonnxruntime.dylib',
      'libsherpa-onnx-c-api.dylib',
      'libsherpa-onnx-cxx-api.dylib',
    ]
    for (const file of files) await writeFile(join(native, file), 'fixture')
    assert.doesNotThrow(() => verifyPackagedTts(root, 'darwin', 'arm64'))
    await rm(join(native, 'libonnxruntime.dylib'))
    assert.throws(() => verifyPackagedTts(root, 'darwin', 'arm64'), /libonnxruntime/)
    await writeFile(
      join(native, 'package.json'),
      JSON.stringify({
        name: 'sherpa-onnx-darwin-arm64',
        version: 'wrong',
      }),
    )
    assert.throws(() => verifyPackagedTts(root, 'darwin', 'arm64'), /versions differ/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('real worker reports missing native dependency before exiting, without raw exception text', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tts-missing-native-'))
  const wrapper = join(root, 'node_modules/sherpa-onnx-node')
  let child
  try {
    await mkdir(wrapper, { recursive: true })
    await writeFile(join(wrapper, 'package.json'), JSON.stringify({ main: 'index.js' }))
    await writeFile(join(wrapper, 'index.js'), '')
    const worker = join(root, 'worker.cjs')
    await copyFile(new URL('../src/main/local-tts/tts-worker.cjs', import.meta.url), worker)
    child = fork(worker, [join(root, 'private-model-path')], {
      silent: true,
      env: { ...process.env, NODE_PATH: '' },
    })
    const messages = []
    child.on('message', (message) => messages.push(message))
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill()
        reject(new Error('worker did not exit'))
      }, 5000)
      child.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.once('exit', (value) => {
        clearTimeout(timer)
        resolve(value)
      })
    })
    assert.equal(code, 1)
    assert.deepEqual(messages, [
      { type: 'stage', stage: 'loading-native' },
      { type: 'error', code: 'NATIVE_MODULE_MISSING' },
    ])
  } finally {
    child?.kill()
    await rm(root, { recursive: true, force: true })
  }
})
