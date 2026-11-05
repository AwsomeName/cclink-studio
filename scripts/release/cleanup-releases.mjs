import { appendFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const REPOSITORY = 'AwsomeName/cclink-studio'
const DAY = 24 * 60 * 60 * 1000
const TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const SHA = /^[0-9a-f]{40}$/

export function planRetention(releases, latestId, now = Date.now()) {
  if (!Array.isArray(releases) || !Number.isFinite(now)) throw new Error('Invalid release snapshot')
  const ids = new Set()
  const tags = new Set()
  const stable = []
  for (const release of releases) {
    if (
      !Number.isSafeInteger(release.id) ||
      typeof release.tag_name !== 'string' ||
      typeof release.draft !== 'boolean' ||
      typeof release.prerelease !== 'boolean' ||
      ids.has(release.id) ||
      tags.has(release.tag_name)
    ) {
      throw new Error('Invalid or duplicate release identity')
    }
    ids.add(release.id)
    tags.add(release.tag_name)
    if (release.draft || release.prerelease) continue
    if (!TAG.test(release.tag_name) || !Number.isFinite(Date.parse(release.published_at))) {
      throw new Error(`Invalid stable release: ${release.id}`)
    }
    stable.push(release)
  }
  if (stable.length && !stable.some((release) => release.id === latestId)) {
    throw new Error('Latest stable release is missing from the snapshot')
  }
  stable.sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at) || b.id - a.id)
  const newest = new Set(stable.slice(0, 10).map((release) => release.id))
  const cutoff = now - 90 * DAY
  const keep = stable.filter(
    (release) =>
      newest.has(release.id) ||
      release.id === latestId ||
      Date.parse(release.published_at) >= cutoff,
  )
  const retained = new Set(keep.map((release) => release.id))
  return {
    cutoff: new Date(cutoff).toISOString(),
    keep,
    remove: stable.filter((release) => !retained.has(release.id)).reverse(),
    excluded: releases.filter((release) => release.draft || release.prerelease),
  }
}

export async function listReleases(api) {
  const releases = []
  for (let page = 1; page <= 100; page += 1) {
    const batch = await api(`/releases?per_page=100&page=${page}`)
    if (!Array.isArray(batch)) throw new Error('Invalid release page')
    releases.push(...batch)
    if (batch.length < 100) return releases
  }
  throw new Error('Release pagination limit reached; refusing a partial inventory')
}

async function snapshot(api, now) {
  const releases = await listReleases(api)
  const latest = await api('/releases/latest', { allowMissing: true })
  return planRetention(releases, latest?.id, now)
}

function assertTagRef(ref, tag) {
  if (
    ref?.ref !== `refs/tags/${tag}` ||
    !SHA.test(ref?.object?.sha ?? '') ||
    !['tag', 'commit'].includes(ref?.object?.type)
  ) {
    throw new Error(`Invalid or missing tag reference: ${tag}`)
  }
}

async function requireReachableSource(api, ref, mainSha) {
  let object = ref.object
  for (let depth = 0; object.type === 'tag' && depth < 8; depth += 1) {
    object = (await api(`/git/tags/${object.sha}`)).object
    if (!SHA.test(object?.sha ?? '')) throw new Error('Invalid annotated tag object')
  }
  if (object.type !== 'commit') throw new Error('Tag does not resolve to a source commit')
  const comparison = await api(`/compare/${object.sha}...${mainSha}`)
  if (!['ahead', 'identical'].includes(comparison.status)) {
    throw new Error(`Source is not reachable from main: ${ref.ref}`)
  }
}

export async function cleanupReleases({ api, apply = false, now = Date.now(), report = {} }) {
  Object.assign(report, {
    repository: REPOSITORY,
    mode: apply ? 'apply' : 'dry-run',
    operations: [],
  })
  const plan = await snapshot(api, now)
  Object.assign(report, {
    cutoff: plan.cutoff,
    retained: plan.keep.map((release) => release.tag_name),
    excluded: plan.excluded.map((release) => release.tag_name),
    candidates: plan.remove.map((release) => ({ id: release.id, tag: release.tag_name })),
  })
  console.log(
    JSON.stringify({ mode: report.mode, cutoff: plan.cutoff, candidates: report.candidates }),
  )
  if (!plan.remove.length) return report
  const main = await api('/git/ref/heads/main')
  if (main?.ref !== 'refs/heads/main' || !SHA.test(main?.object?.sha ?? '')) {
    throw new Error('Invalid main reference')
  }
  for (const release of plan.remove) {
    const tag = release.tag_name
    const readRef = `/git/ref/tags/${tag}`
    const deleteRef = `/git/refs/tags/${tag}`
    const original = await api(readRef)
    assertTagRef(original, tag)
    await requireReachableSource(api, original, main.object.sha)
    const operation = { tag, releaseId: release.id, tagSha: original.object.sha, status: 'planned' }
    report.operations.push(operation)
    if (!apply) continue

    // Re-evaluate the complete union immediately before each destructive operation.
    const currentPlan = await snapshot(api, now)
    const current = currentPlan.remove.find((item) => item.id === release.id)
    if (!current || current.tag_name !== tag || current.published_at !== release.published_at) {
      operation.status = 'skipped-changed-release'
      continue
    }
    const currentRef = await api(readRef)
    assertTagRef(currentRef, tag)
    if (currentRef.object.sha !== original.object.sha) throw new Error(`Tag changed: ${tag}`)
    console.log(JSON.stringify({ deleting: operation }))

    // Delete the tag first: if release deletion fails, its exact ref can be restored.
    // Release assets cannot be reconstructed after deletion, so never delete them first.
    try {
      await api(deleteRef, { method: 'DELETE' })
      operation.status = 'tag-deleted'
      await api(`/releases/${release.id}`, { method: 'DELETE' })
    } catch (error) {
      const stillExists = await api(`/releases/${release.id}`, { allowMissing: true })
      if (stillExists) {
        const ref = await api(readRef, { allowMissing: true })
        if (!ref) {
          await api('/git/refs', {
            method: 'POST',
            body: { ref: original.ref, sha: original.object.sha },
          })
        } else if (ref.object?.sha !== original.object.sha) {
          throw new Error(
            `Release deletion failed and tag changed; manual recovery required: ${tag}`,
          )
        }
        operation.status = 'tag-restored-release-kept'
        throw error
      }
    }
    if (
      (await api(`/releases/${release.id}`, { allowMissing: true })) ||
      (await api(readRef, { allowMissing: true }))
    ) {
      throw new Error(`Deletion could not be verified: ${tag}`)
    }
    operation.status = 'deleted'
    console.log(JSON.stringify({ deleted: operation }))
  }
  return report
}

export function createGitHubApi(token) {
  return async (path, { method = 'GET', body, allowMissing = false } = {}) => {
    const response = await fetch(`https://api.github.com/repos/${REPOSITORY}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
      redirect: 'error',
    })
    if (allowMissing && response.status === 404) return null
    if (!response.ok) throw new Error(`GitHub API ${response.status}: ${method} ${path}`)
    return response.status === 204 ? null : response.json()
  }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.some((arg) => arg !== '--apply') || args.length > 1)
    throw new Error('Usage: cleanup-releases.mjs [--apply]')
  const apply = args.includes('--apply')
  if (
    apply &&
    (process.env.GITHUB_ACTIONS !== 'true' ||
      process.env.GITHUB_REPOSITORY !== REPOSITORY ||
      process.env.GITHUB_REF !== 'refs/heads/main' ||
      !process.env.GH_TOKEN)
  ) {
    throw new Error('Apply is restricted to this repository’s main-branch GitHub Actions workflow')
  }
  const report = { startedAt: new Date().toISOString() }
  try {
    await cleanupReleases({ api: createGitHubApi(process.env.GH_TOKEN), apply, report })
    report.status = 'success'
  } catch (error) {
    report.status = 'failed'
    report.error = error.message
    process.exitCode = 1
  } finally {
    report.finishedAt = new Date().toISOString()
    writeFileSync('release-retention-report.json', `${JSON.stringify(report, null, 2)}\n`)
    console.log(JSON.stringify(report))
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `## Release retention\n\nStatus: ${report.status}; mode: ${report.mode}\n\n` +
          `Retained: ${report.retained?.length ?? 0}; candidates: ${report.candidates?.length ?? 0}; ` +
          `deleted: ${report.operations?.filter((item) => item.status === 'deleted').length ?? 0}\n\n` +
          `\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`,
      )
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
