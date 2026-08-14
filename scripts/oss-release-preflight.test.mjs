import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'

import { inspectOssReleasePreflight } from './oss-release-preflight.mjs'

function fixture(version = '1.2.3') {
  const sourceDir = mkdtempSync(resolve(tmpdir(), 'cclink-oss-release-'))
  writeFileSync(resolve(sourceDir, 'package.json'), `${JSON.stringify({ version })}\n`)
  return sourceDir
}

function fakeRun(sourceDir, { sourceSha = 'source-sha', sourceClean = true } = {}) {
  return (command, args, cwd) => {
    const joined = [command, ...args].join(' ')
    if (joined === 'git rev-parse HEAD') return cwd === sourceDir ? sourceSha : 'workflow-sha'
    if (joined === 'git show-ref --verify --hash refs/tags/v1.2.3') return 'tag-object-sha'
    if (joined === 'git rev-parse v1.2.3^{commit}') return sourceSha
    if (joined === 'git status --porcelain') {
      return cwd === sourceDir && !sourceClean ? ' M file' : ''
    }
    throw new Error(`Unexpected command: ${joined}`)
  }
}

test('plan mode validates immutable tag inputs without release credentials', () => {
  const sourceDir = fixture()
  const report = inspectOssReleasePreflight({
    sourceDir,
    tag: 'v1.2.3',
    mode: 'plan',
    environment: {},
    run: fakeRun(sourceDir),
    toolsDir: '/release-tools',
  })
  assert.equal(report.ready, true)
  assert.equal(report.checks.find((item) => item.id === 'no-system-keychain')?.ok, true)
})

test('release mode remains credential-free and ready for ad-hoc packaging', () => {
  const sourceDir = fixture()
  const report = inspectOssReleasePreflight({
    sourceDir,
    tag: 'v1.2.3',
    mode: 'release',
    environment: {},
    run: fakeRun(sourceDir),
    toolsDir: '/release-tools',
  })
  assert.equal(report.ready, true)
})

test('version mismatch is fatal in plan mode', () => {
  const sourceDir = fixture('1.2.4')
  const report = inspectOssReleasePreflight({
    sourceDir,
    tag: 'v1.2.3',
    mode: 'plan',
    environment: {},
    run: fakeRun(sourceDir),
    toolsDir: '/release-tools',
  })
  assert.equal(report.ready, false)
  assert.equal(report.checks.find((item) => item.id === 'version-match')?.ok, false)
})

test('dirty source checkout is fatal', () => {
  const sourceDir = fixture()
  const report = inspectOssReleasePreflight({
    sourceDir,
    tag: 'v1.2.3',
    mode: 'plan',
    environment: {},
    run: fakeRun(sourceDir, { sourceClean: false }),
    toolsDir: '/release-tools',
  })
  assert.equal(report.ready, false)
  assert.equal(report.checks.find((item) => item.id === 'source-clean')?.ok, false)
})
