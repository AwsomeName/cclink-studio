#!/usr/bin/env node

import { readFile, rm } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import { createSmokeRuntime } from './smoke-runtime.mjs'

const { logFile, rendererOrigin, runRestart } = createSmokeRuntime(import.meta.url)
const conversationId = `cclink-agent-smoke-${Date.now()}`
const workspacePath = process.cwd()
let browser
let started = false

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function readLog() {
  return readFile(logFile, 'utf8').catch(() => '')
}

async function waitForCdpPort(timeoutMs = 45_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const log = await readLog()
    const match =
      log.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//) ||
      log.match(/\[CCLink Studio\] CDP .*?:\s*(\d+)/)
    if (match) return match[1]
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`CDP port not found in ${logFile}`)
}

async function findRendererPage() {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 20_000) {
    const page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => candidate.url().startsWith(`${rendererOrigin}/`))
    if (page) return page
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Renderer page ${rendererOrigin}/ not found`)
}

async function runTurn(page, input) {
  return page.evaluate(
    ({ id, runId, message, workspace, sessionId, fingerprint }) =>
      new Promise((resolve, reject) => {
        const events = []
        let settled = false
        const finish = (callback, value) => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          offStream()
          offComplete()
          offError()
          callback(value)
        }
        const belongsToRun = (event) =>
          event.conversationId === id && (!event.runId || event.runId === runId)
        const offStream = window.cclinkStudio.agent.onStreamEvent((event) => {
          if (belongsToRun(event)) events.push(event)
        })
        const offComplete = window.cclinkStudio.agent.onComplete((result) => {
          if (belongsToRun(result)) finish(resolve, { events, result })
        })
        const offError = window.cclinkStudio.agent.onError((error) => {
          if (belongsToRun(error))
            finish(reject, new Error(`${error.code || 'error'}: ${error.message}`))
        })
        const timeout = setTimeout(
          () => finish(reject, new Error(`cclink-agent turn timed out: ${runId}`)),
          180_000,
        )
        window.cclinkStudio.agent
          .sendMessage(id, {
            message,
            runId,
            workspaceRef: { kind: 'local', path: workspace },
            ...(sessionId
              ? { sessionId, sessionCompatibilityFingerprint: fingerprint }
              : { sessionId: null }),
          })
          .then((accepted) => {
            if (!accepted.success) {
              finish(reject, new Error(accepted.error || 'Agent request rejected'))
            }
          })
          .catch((error) => finish(reject, error))
      }),
    input,
  )
}

async function main() {
  assert(
    process.env.CCLINK_STUDIO_EXPERIMENTAL_AGENT_BACKEND === 'cclink-agent',
    'set CCLINK_STUDIO_EXPERIMENTAL_AGENT_BACKEND=cclink-agent',
  )
  assert(process.env.CCLINK_AGENT_CLI_PATH, 'set CCLINK_AGENT_CLI_PATH to the chatcc executable')
  runRestart('stop')
  await rm(logFile, { force: true })
  runRestart('start')
  started = true
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${await waitForCdpPort()}`)
  const page = await findRendererPage()
  await page.waitForSelector('.main-window', { timeout: 30_000 })
  assert(
    !(await page.locator('body').innerText()).includes('登录后继续'),
    'unexpected CCLink login wall',
  )

  const first = await runTurn(page, {
    id: conversationId,
    runId: `${conversationId}-1`,
    message: '记住校验词是“海盐蓝”，先只回复“已记住”。不要使用任何工具。',
    workspace: workspacePath,
    sessionId: null,
    fingerprint: null,
  })
  const firstStatus = await page.evaluate(
    (id) => window.cclinkStudio.agent.getStatus(id),
    conversationId,
  )
  assert(firstStatus.sessionId, 'first turn did not persist runtime session id')
  assert(
    first.events.some(
      (event) => event.protocol === 'studio-agent-event-v1' && event.event?.type === 'text-delta',
    ),
    'first turn did not deliver text deltas',
  )

  const second = await runTurn(page, {
    id: conversationId,
    runId: `${conversationId}-2`,
    message: '我刚才让你记住的校验词是什么？只回复校验词。不要使用任何工具。',
    workspace: workspacePath,
    sessionId: firstStatus.sessionId,
    fingerprint: firstStatus.sessionCompatibilityFingerprint,
  })
  assert(String(second.result?.result || '').includes('海盐蓝'), 'second turn lost session context')
  const secondRun = await page.evaluate(
    ({ id, runId }) => window.cclinkStudio.agent.getRunStatus(id, runId),
    { id: conversationId, runId: `${conversationId}-2` },
  )
  assert(
    secondRun?.status === 'succeeded',
    `second run status is ${secondRun?.status || 'missing'}`,
  )

  console.log(
    JSON.stringify(
      {
        success: true,
        ccLinkLoginRequired: false,
        streamedFirstTurn: true,
        sessionIdPersisted: true,
        secondTurnContinued: true,
        firstDeltaEvents: first.events.filter((event) => event.event?.type === 'text-delta').length,
        secondDeltaEvents: second.events.filter((event) => event.event?.type === 'text-delta')
          .length,
        secondRunStatus: secondRun.status,
      },
      null,
      2,
    ),
  )
}

main()
  .catch((error) => {
    console.error(`[cclink-agent-smoke] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
  .finally(async () => {
    await browser?.close().catch(() => undefined)
    if (started) {
      try {
        runRestart('stop')
      } catch {}
    }
  })
