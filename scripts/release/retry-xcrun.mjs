import { spawnSync } from 'node:child_process'
import { setTimeout } from 'node:timers/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const backoffMs = [10_000, 30_000, 60_000]

function isStapler(args) {
  return args[0] === 'stapler' && ['staple', 'validate'].includes(args[1])
}

function execute(args, capture) {
  // Absolute path prevents recursion through the release-only PATH adapter.
  return spawnSync(
    '/usr/bin/xcrun',
    args,
    capture ? { encoding: 'utf8', timeout: 45_000, maxBuffer: 1024 * 1024 } : { stdio: 'inherit' },
  )
}

export async function runXcrun(
  args,
  {
    run = execute,
    sleep = setTimeout,
    stdout = (text) => process.stdout.write(text),
    stderr = (text) => process.stderr.write(text),
  } = {},
) {
  const capture = isStapler(args)
  for (let attempt = 0; ; attempt++) {
    const result = run(args, capture)
    if (result.stdout) stdout(result.stdout)
    if (result.stderr) stderr(result.stderr)
    if (result.error) stderr(`${result.error.message}\n`)
    const networkLost = /NSURLErrorDomain\s+Code=-1005\b/.test(
      `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    )
    if (
      !capture ||
      result.status !== 68 ||
      result.error ||
      !networkLost ||
      attempt >= backoffMs.length
    )
      return result.status ?? 1
    stderr(
      `[release stapler] Apple connection lost; retry ${attempt + 2}/4 in ${backoffMs[attempt] / 1000}s\n`,
    )
    await sleep(backoffMs[attempt])
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runXcrun(process.argv.slice(2))
}
