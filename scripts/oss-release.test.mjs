import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  compareStableVersions,
  createWorkflowDispatchPayload,
  incrementPatch,
  isRetryableGitHubStatus,
  parseArgs,
  prepareLocalReleasePackage,
  resolveRemoteTagCommit,
} from './oss-release.mjs'

const gitignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8')
const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
)
const localPackageScript = readFileSync(new URL('./package.sh', import.meta.url), 'utf8')
const releaseScript = readFileSync(new URL('./oss-release.mjs', import.meta.url), 'utf8')

test('keeps local packaging separate from the canonical formal release command', () => {
  assert.equal(packageJson.scripts['package:local'], 'bash scripts/package.sh')
  assert.equal(packageJson.scripts.package, undefined)
  assert.equal(packageJson.scripts['package:dev'], undefined)
  assert.equal(packageJson.scripts['studio:package'], undefined)
  assert.equal(packageJson.scripts.release, 'node scripts/oss-release.mjs')
  assert.equal(packageJson.scripts['release:oss'], packageJson.scripts.release)
  assert.equal(packageJson.scripts['release:arm64'], undefined)
  assert.doesNotMatch(localPackageScript, /--bump|--version\)|NEW_VERSION|writeFileSync/)
  assert.match(localPackageScript, /pnpm release/)
})

test('builds the target-version local package before committing or pushing a release', () => {
  const localPackage = releaseScript.lastIndexOf('prepareLocalReleasePackage(packagePath')
  const versionCommit = releaseScript.indexOf("git(['commit', '-m', `chore: prepare ${tag}`])")
  const atomicPush = releaseScript.indexOf(
    "git(['push', '--atomic', 'origin', 'HEAD:refs/heads/main', `refs/tags/${tag}`])",
  )

  assert.ok(localPackage > 0)
  assert.ok(versionCommit > localPackage)
  assert.ok(atomicPush > versionCommit)
})

test('uses Git transport negotiation instead of forcing HTTP/1.1', () => {
  assert.doesNotMatch(releaseScript, /http\.version=HTTP\/1\.1/)
})

test('restores package.json byte-for-byte when local release packaging fails', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cclink-release-local-package-'))
  const packagePath = join(directory, 'package.json')
  const original = '{\n  "name": "fixture",\n  "version": "1.2.3"\n}\n'
  writeFileSync(packagePath, original)

  assert.throws(
    () =>
      prepareLocalReleasePackage(packagePath, '1.2.4', () => {
        throw new Error('local package failed')
      }),
    /local package failed/,
  )
  assert.equal(readFileSync(packagePath, 'utf8'), original)
})

test('keeps the target version after local release packaging succeeds', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cclink-release-local-package-'))
  const packagePath = join(directory, 'package.json')
  writeFileSync(packagePath, '{"name":"fixture","version":"1.2.3"}\n')

  prepareLocalReleasePackage(packagePath, '1.2.4', () => undefined)

  assert.equal(JSON.parse(readFileSync(packagePath, 'utf8')).version, '1.2.4')
})

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
      failure_injection: 'none',
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
