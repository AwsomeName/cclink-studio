#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { lstatSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const exactBuildInputs = new Set([
  'electron-builder.yml',
  'electron.vite.config.ts',
  'package.json',
  'pnpm-lock.yaml',
  'scripts/managed-runtime-packaged-smoke.mjs',
  'scripts/package.sh',
  'scripts/source-fingerprint.mjs',
  'tsconfig.json',
  'tsconfig.node.json',
  'tsconfig.web.json',
])
const buildInputPrefixes = ['build/', 'resources/', 'src/']

function buildInputFiles() {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: projectRoot, encoding: 'utf8' },
  )
  return output
    .split('\0')
    .filter(Boolean)
    .filter(
      (path) =>
        exactBuildInputs.has(path) || buildInputPrefixes.some((prefix) => path.startsWith(prefix)),
    )
    .sort()
}

export function createSourceFingerprint() {
  const hash = createHash('sha256')
  const files = buildInputFiles()
  for (const path of files) {
    const absolutePath = resolve(projectRoot, path)
    const stats = lstatSync(absolutePath)
    const content = stats.isSymbolicLink()
      ? Buffer.from(`symlink:${readlinkSync(absolutePath)}`)
      : readFileSync(absolutePath)
    hash.update(Buffer.from(`${Buffer.byteLength(path)}:${path}:${content.length}:`))
    hash.update(content)
  }
  return { algorithm: 'sha256', value: hash.digest('hex'), fileCount: files.length }
}

export function createBuildProvenance() {
  return {
    schemaVersion: 1,
    gitHead: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: projectRoot,
      encoding: 'utf8',
    }).trim(),
    sourceFingerprint: createSourceFingerprint(),
    builtAt: new Date().toISOString(),
  }
}

export function verifyBuildProvenance(provenance) {
  const current = createBuildProvenance()
  if (
    provenance?.schemaVersion !== 1 ||
    provenance.gitHead !== current.gitHead ||
    provenance.sourceFingerprint?.value !== current.sourceFingerprint.value ||
    provenance.sourceFingerprint?.fileCount !== current.sourceFingerprint.fileCount
  ) {
    throw new Error(
      `打包产物与当前源码不一致：packaged=${JSON.stringify(provenance)} current=${JSON.stringify(current)}`,
    )
  }
  return current
}

function runCli() {
  const [command, value, destinationValue] = process.argv.slice(2)
  if (command === 'write' && value) {
    const destination = resolve(projectRoot, value)
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, `${JSON.stringify(createBuildProvenance(), null, 2)}\n`, 'utf8')
    return
  }
  if (command === 'verify-json' && value) {
    verifyBuildProvenance(JSON.parse(value))
    return
  }
  if (command === 'verify-file' && value) {
    const provenance = JSON.parse(readFileSync(resolve(projectRoot, value), 'utf8'))
    verifyBuildProvenance(provenance)
    if (destinationValue) {
      const destination = resolve(projectRoot, destinationValue)
      mkdirSync(dirname(destination), { recursive: true })
      writeFileSync(destination, `${JSON.stringify(provenance, null, 2)}\n`, 'utf8')
    }
    return
  }
  if (command === 'print') {
    process.stdout.write(`${JSON.stringify(createBuildProvenance(), null, 2)}\n`)
    return
  }
  throw new Error(
    '用法: source-fingerprint.mjs write <path> | verify-file <path> [copy-path] | verify-json <json> | print',
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli()
