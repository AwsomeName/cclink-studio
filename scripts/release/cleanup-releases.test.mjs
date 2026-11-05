import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { cleanupReleases, listReleases, planRetention } from './cleanup-releases.mjs'

const DAY = 86_400_000
const NOW = Date.parse('2026-11-05T06:00:00Z')
const TAG_SHA = 'a'.repeat(40)
const SOURCE_SHA = 'b'.repeat(40)
const MAIN_SHA = 'c'.repeat(40)
function release(id, age, extra = {}) {
  return {
    id,
    tag_name: `v0.1.${id}`,
    draft: false,
    prerelease: false,
    published_at: new Date(NOW - age * DAY).toISOString(),
    ...extra,
  }
}
const tenOld = () => Array.from({ length: 10 }, (_, i) => release(i + 1, 100 + i))

test('retains the union, including the exact 90-day boundary and ten old releases', () => {
  const all = [...tenOld(), release(11, 90), release(12, 89), release(13, 200)]
  const plan = planRetention(all, 12, NOW)
  assert.deepEqual(new Set(plan.keep.map((r) => r.id)), new Set([11, 12, 1, 2, 3, 4, 5, 6, 7, 8]))
  assert.deepEqual(new Set(plan.remove.map((r) => r.id)), new Set([9, 10, 13]))
  assert.equal(planRetention(tenOld(), 1, NOW).remove.length, 0)
  const recent = Array.from({ length: 20 }, (_, i) => release(i + 1, i))
  assert.equal(planRetention(recent, 1, NOW).keep.length, 20)
  const boundary = planRetention([...recent, release(21, 90), release(22, 90 + 1 / DAY)], 1, NOW)
  assert.ok(boundary.keep.some((r) => r.id === 21))
  assert.deepEqual(
    boundary.remove.map((r) => r.id),
    [22],
  )
})

test('uses publication time rather than version number or creation date and protects latest', () => {
  const all = [...tenOld(), release(99, 200), release(100, 300)]
  all[9].created_at = new Date(NOW).toISOString()
  const plan = planRetention(all, 100, NOW)
  assert.deepEqual(
    plan.remove.map((r) => r.id),
    [99],
  )
  assert.ok(plan.keep.some((r) => r.id === 10))
})

test('drafts and prereleases neither consume the ten slots nor become candidates', () => {
  const all = [
    ...tenOld(),
    release(11, 200),
    release(12, 1, { draft: true }),
    release(13, 1, { prerelease: true }),
  ]
  const plan = planRetention(all, 1, NOW)
  assert.equal(plan.keep.length, 10)
  assert.deepEqual(
    plan.remove.map((r) => r.id),
    [11],
  )
  assert.equal(plan.excluded.length, 2)
  assert.equal(planRetention([], undefined, NOW).remove.length, 0)
})

test('invalid dates, unsafe tags, duplicate identity and missing latest abort planning', () => {
  for (const invalid of [
    release(1, 100, { published_at: 'invalid' }),
    release(1, 100, { tag_name: '../heads/main' }),
    release(1, 100, { draft: undefined }),
  ])
    assert.throws(() => planRetention([invalid], 1, NOW))
  assert.throws(() => planRetention([release(1, 100), release(1, 101)], 1, NOW))
  assert.throws(() => planRetention(tenOld(), 999, NOW), /Latest/)
})

test('reads beyond the first hundred releases and fails on an incomplete inventory', async () => {
  const first = Array.from({ length: 100 }, (_, i) => release(i + 1, i))
  const calls = []
  const all = await listReleases(async (path) => {
    calls.push(path)
    return path.endsWith('page=1') ? first : [release(101, 200)]
  })
  assert.equal(all.length, 101)
  assert.equal(calls.length, 2)
  await assert.rejects(
    listReleases(async (path) => {
      if (path.endsWith('page=1')) return first
      throw new Error('page failed')
    }),
    /page failed/,
  )
})

function fixture({
  failTag = false,
  lostTagResponse = false,
  failRelease = false,
  lostReleaseResponse = false,
  unreachable = false,
  protectOnRefresh = false,
  moveTag = false,
} = {}) {
  let releases = [...tenOld(), release(11, 200)]
  let ref = { ref: 'refs/tags/v0.1.11', object: { type: 'tag', sha: TAG_SHA } }
  let inventories = 0
  let refReads = 0
  const writes = []
  const api = async (path, options = {}) => {
    const { method = 'GET', body } = options
    if (method !== 'GET') {
      writes.push({ method, path, body })
      if (method === 'DELETE' && path === '/git/refs/tags/v0.1.11') {
        if (failTag) throw new Error('tag forbidden')
        ref = null
        if (lostTagResponse) throw new Error('tag response lost')
        return null
      }
      if (method === 'DELETE' && path === '/releases/11') {
        if (failRelease) throw new Error('release forbidden')
        releases = releases.filter((r) => r.id !== 11)
        if (lostReleaseResponse) throw new Error('release response lost')
        return null
      }
      if (method === 'POST' && path === '/git/refs') {
        assert.deepEqual(body, { ref: 'refs/tags/v0.1.11', sha: TAG_SHA })
        ref = { ref: body.ref, object: { type: 'tag', sha: body.sha } }
        return ref
      }
      throw new Error(`Unexpected write: ${path}`)
    }
    if (path.startsWith('/releases?')) {
      inventories += 1
      return structuredClone(releases)
    }
    if (path === '/releases/latest') return { id: protectOnRefresh && inventories > 1 ? 11 : 1 }
    if (path === '/git/ref/heads/main') return { ref: 'refs/heads/main', object: { sha: MAIN_SHA } }
    if (path === '/git/ref/tags/v0.1.11') {
      refReads += 1
      if (moveTag && refReads > 1) return { ...ref, object: { type: 'tag', sha: MAIN_SHA } }
      return structuredClone(ref)
    }
    if (path === `/git/tags/${TAG_SHA}`) return { object: { type: 'commit', sha: SOURCE_SHA } }
    if (path === `/compare/${SOURCE_SHA}...${MAIN_SHA}`)
      return { status: unreachable ? 'diverged' : 'ahead' }
    if (path === '/releases/11') return releases.find((r) => r.id === 11) ?? null
    throw new Error(`Unexpected read: ${path}`)
  }
  return { api, writes, getRef: () => ref, getReleases: () => releases }
}

test('dry run validates sources but makes no writes', async () => {
  const f = fixture()
  const report = await cleanupReleases({ api: f.api, now: NOW })
  assert.equal(report.candidates.length, 1)
  assert.equal(report.operations[0].status, 'planned')
  assert.deepEqual(f.writes, [])
})

test('deletes only the selected tag and release, in order, and verifies absence', async () => {
  const f = fixture()
  const report = await cleanupReleases({ api: f.api, apply: true, now: NOW })
  assert.deepEqual(
    f.writes.map(({ method, path }) => `${method} ${path}`),
    ['DELETE /git/refs/tags/v0.1.11', 'DELETE /releases/11'],
  )
  assert.equal(report.operations[0].status, 'deleted')
  assert.equal(f.getReleases().length, 10)
  assert.equal(f.getRef(), null)
})

test('a newly protected release, tag drift or unreachable source prevents deletion', async () => {
  const protectedRelease = fixture({ protectOnRefresh: true })
  const report = await cleanupReleases({ api: protectedRelease.api, apply: true, now: NOW })
  assert.equal(report.operations[0].status, 'skipped-changed-release')
  assert.deepEqual(protectedRelease.writes, [])
  for (const settings of [{ moveTag: true }, { unreachable: true }]) {
    const f = fixture(settings)
    await assert.rejects(cleanupReleases({ api: f.api, apply: true, now: NOW }))
    assert.deepEqual(f.writes, [])
  }
})

test('a rejected tag deletion leaves the release intact', async () => {
  const f = fixture({ failTag: true })
  await assert.rejects(cleanupReleases({ api: f.api, apply: true, now: NOW }), /tag forbidden/)
  assert.equal(f.writes.length, 1)
  assert.equal(f.getReleases().length, 11)
  assert.equal(f.getRef().object.sha, TAG_SHA)
})

test('release deletion failure or a lost tag response restores the exact original ref', async () => {
  for (const settings of [{ failRelease: true }, { lostTagResponse: true }]) {
    const f = fixture(settings)
    const report = {}
    await assert.rejects(cleanupReleases({ api: f.api, apply: true, now: NOW, report }))
    assert.equal(f.getReleases().length, 11)
    assert.equal(f.getRef().object.sha, TAG_SHA)
    assert.equal(report.operations[0].status, 'tag-restored-release-kept')
    assert.equal(f.writes.at(-1).method, 'POST')
  }
})

test('a lost release-delete response is reconciled from server state without recreating a tag', async () => {
  const f = fixture({ lostReleaseResponse: true })
  const report = await cleanupReleases({ api: f.api, apply: true, now: NOW })
  assert.equal(report.operations[0].status, 'deleted')
  assert.equal(f.writes.length, 2)
})

test('workflow schedules apply on main, defaults manual runs to preview and retains reports 14 days', () => {
  const workflow = readFileSync(
    new URL('../../.github/workflows/release-retention.yml', import.meta.url),
    'utf8',
  )
  assert.match(workflow, /cron: '17 20 \* \* \*'/)
  assert.match(workflow, /default: false/)
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/)
  assert.match(workflow, /github\.event_name == 'schedule' \|\| inputs\.apply/)
  assert.match(workflow, /persist-credentials: false/)
  assert.match(workflow, /retention-days: 14/)
  assert.match(workflow, /cancel-in-progress: false/)
  assert.doesNotMatch(workflow, /pull_request|actions: write|secrets\./)
})
