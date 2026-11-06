import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { runXcrun } from './retry-xcrun.mjs'

const transient = {
  status: 68,
  stderr: 'Error Domain=NSURLErrorDomain Code=-1005 "The network connection was lost."',
}
const success = { status: 0, stdout: 'The staple and validate action worked!\n' }
function fixture(results) {
  const calls = [],
    delays = [],
    output = []
  return {
    calls,
    delays,
    output,
    options: {
      run: (args, capture) => {
        calls.push({ args, capture })
        return results.shift()
      },
      sleep: async (ms) => {
        delays.push(ms)
      },
      stdout: (text) => output.push(text),
      stderr: (text) => output.push(text),
    },
  }
}

for (const operation of ['staple', 'validate']) {
  test(`${operation} retries only the known network loss and preserves arguments with spaces`, async () => {
    const f = fixture([transient, transient, success])
    const args = ['stapler', operation, '-v', '/tmp/CCLink Studio 开源版.app']
    assert.equal(await runXcrun(args, f.options), 0)
    assert.equal(f.calls.length, 3)
    assert(f.calls.every((call) => call.capture && call.args === args))
    assert.deepEqual(f.delays, [10_000, 30_000])
    assert(f.output.includes(success.stdout))
    assert.equal(f.output.filter((text) => text === transient.stderr).length, 2)
  })
}

test('persistent network failure stops after four attempts and preserves failure', async () => {
  const f = fixture(Array(4).fill(transient))
  assert.equal(await runXcrun(['stapler', 'staple', 'app.app'], f.options), 68)
  assert.equal(f.calls.length, 4)
  assert.deepEqual(f.delays, [10_000, 30_000, 60_000])
})

for (const result of [
  { status: 68, stderr: 'Ticket invalid or application modified' },
  { status: 65, stderr: transient.stderr },
  { status: 0, stdout: transient.stderr },
  { status: null, error: new Error('spawn timed out'), stderr: transient.stderr },
]) {
  test(`does not retry an unproven transient failure: ${result.status}`, async () => {
    const f = fixture([result])
    assert.equal(await runXcrun(['stapler', 'validate', 'file.dmg'], f.options), result.status ?? 1)
    assert.equal(f.calls.length, 1)
    assert.deepEqual(f.delays, [])
  })
}

for (const args of [
  ['notarytool', 'submit', 'app.zip', '--wait'],
  ['--find', 'stapler'],
  ['stapler', 'unknown', 'file.dmg'],
]) {
  test(`passes through ${args.join(' ')} without capture or retry`, async () => {
    const f = fixture([transient])
    assert.equal(await runXcrun(args, f.options), 68)
    assert.deepEqual(f.calls, [{ args, capture: false }])
    assert.deepEqual(f.delays, [])
  })
}

test('runs a real child process without shell interpolation and returns its exit status', async () => {
  const args = ['stapler', 'validate', '/tmp/space ; $(not-a-command).dmg']
  const output = []
  const status = await runXcrun(args, {
    run: (forwarded, capture) => {
      assert.equal(capture, true)
      return spawnSync(
        process.execPath,
        [
          '-e',
          'process.stdout.write(JSON.stringify(process.argv.slice(1)));process.exitCode=65',
          ...forwarded,
        ],
        { encoding: 'utf8' },
      )
    },
    stdout: (text) => output.push(text),
    stderr: () => {},
    sleep: async () => assert.fail('permanent child failure must not retry'),
  })
  assert.equal(status, 65)
  assert.deepEqual(JSON.parse(output.join('')), args)
})
