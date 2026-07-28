import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  compareStableVersions,
  createWorkflowDispatchPayload,
  incrementPatch,
  isRetryableGitHubStatus,
  parseArgs,
  resolveRemoteTagCommit,
} from './oss-release.mjs'

const gitignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8')

test('ignores generated release preflight reports between releases', () => {
  assert.match(gitignore, /^\.build\/$/m)
})

test('parses a patch release with confirmation and wait controls', () => {
  const expected = {
    version: '',
    patch: true,
    dispatchOnly: '',
    yes: true,
    wait: false,
    help: false,
  }
  assert.deepEqual(parseArgs(['--patch', '--yes', '--no-wait']), expected)
  assert.deepEqual(parseArgs(['--', '--patch', '--yes', '--no-wait']), expected)
  assert.throws(() => parseArgs(['--patch', '--', '--yes']), /未知或不完整/)
})

test('requires exactly one release version mode', () => {
  assert.throws(() => parseArgs([]), /必须且只能提供/)
  assert.throws(() => parseArgs(['--patch', '--version', '0.2.0']), /必须且只能提供/)
  assert.throws(() => parseArgs(['--version', 'v0.2.0']), /X\.Y\.Z/)
})

test('accepts dispatch-only recovery without a version mutation', () => {
  assert.equal(parseArgs(['--dispatch-only', 'v0.1.2']).dispatchOnly, 'v0.1.2')
  assert.throws(
    () => parseArgs(['--dispatch-only', 'v0.1.2', '--patch']),
    /不能与 --version 或 --patch/,
  )
})

test('increments and compares stable versions', () => {
  assert.equal(incrementPatch('0.1.9'), '0.1.10')
  assert.equal(compareStableVersions('0.2.0', '0.1.99'), 1)
  assert.equal(compareStableVersions('1.0.0', '1.0.0'), 0)
  assert.equal(compareStableVersions('1.0.0', '2.0.0'), -1)
  assert.throws(() => incrementPatch('0.1.2-beta.1'), /不是稳定版本/)
})

test('always dispatches the default-branch workflow as a draft release', () => {
  assert.deepEqual(createWorkflowDispatchPayload('v0.1.3'), {
    ref: 'main',
    inputs: {
      tag: 'v0.1.3',
      create_draft: true,
    },
  })
  assert.throws(() => createWorkflowDispatchPayload('0.1.3'), /格式错误/)
})

test('only retries temporary GitHub API failures', () => {
  assert.equal(isRetryableGitHubStatus(429), true)
  assert.equal(isRetryableGitHubStatus(500), true)
  assert.equal(isRetryableGitHubStatus(503), true)
  assert.equal(isRetryableGitHubStatus(400), false)
  assert.equal(isRetryableGitHubStatus(401), false)
})

test('resolves annotated and lightweight remote tags without trusting local refs', () => {
  const tagObject = '1'.repeat(40)
  const commit = '2'.repeat(40)
  assert.equal(
    resolveRemoteTagCommit(
      `${tagObject}\trefs/tags/v0.1.3\n${commit}\trefs/tags/v0.1.3^{}\n`,
      'v0.1.3',
    ),
    commit,
  )
  assert.equal(resolveRemoteTagCommit(`${commit}\trefs/tags/v0.1.3\n`, 'v0.1.3'), commit)
  assert.throws(() => resolveRemoteTagCommit('', 'v0.1.3'), /不存在或引用无效/)
})
