import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { auditClaudeNativeScheduling } from './verify-claude-native-scheduling.mjs'

test('accepts the pinned SDK native scheduling surface', async () => {
  const result = await auditClaudeNativeScheduling()
  assert.equal(result.sdkVersion, '0.3.211')
  assert.deepEqual(result.deniedTools, [
    'CronCreate',
    'CronDelete',
    'CronList',
    'RemoteTrigger',
    'ScheduleWakeup',
  ])
})

test('fails when an SDK fixture adds a new scheduling tool', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'claude-scheduling-audit-'))
  const fixturePath = join(directory, 'sdk-tools.d.ts')
  try {
    const current = await readFile(
      join(process.cwd(), 'node_modules/@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts'),
      'utf8',
    )
    await writeFile(fixturePath, `${current}\nexport interface RoutineCreateInput {}\n`, 'utf8')
    await assert.rejects(
      auditClaudeNativeScheduling({ sdkToolsPath: fixturePath }),
      /RoutineCreate/,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
