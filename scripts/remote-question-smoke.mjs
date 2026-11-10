#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { openSync, closeSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { createSmokeRuntime } from './smoke-runtime.mjs'

// Real Electron UI with fixture question events, no account or remote model calls.
process.env.CCLINK_STUDIO_SMOKE_RUN_DIR = await mkdtemp(join(tmpdir(), 'studio-question-'))
process.env.CCLINK_STUDIO_SMOKE_RENDERER_PORT ??= String(44500 + Math.floor(Math.random() * 1000))
const { runDir, logFile, rendererOrigin, rootDir } = createSmokeRuntime(import.meta.url)
const userData = join(runDir, 'user-data')
await mkdir(userData)
let child
let browser
let page
try {
  const fd = openSync(logFile, 'w')
  try {
    child = spawn('bash', ['scripts/dev.sh'], {
      cwd: rootDir,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '',
        CCLINK_STUDIO_TEST_USER_DATA_PATH: userData,
        CCLINK_STUDIO_RENDERER_PORT: new URL(rendererOrigin).port,
        CLAUDE_CONFIG_DIR: join(runDir, 'claude-config'),
      },
      detached: true,
      stdio: ['ignore', fd, fd],
    })
  } finally {
    closeSync(fd)
  }
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const log = await readFile(logFile, 'utf8').catch(() => '')
    const match = log.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//)
    if (match) {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${match[1]}`)
      page = browser
        .contexts()
        .flatMap((context) => context.pages())
        .find((candidate) => candidate.url().startsWith(rendererOrigin))
      if (page) break
      await browser.close()
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  assert(page, 'Studio renderer did not start')
  await page.waitForSelector('.main-window', { timeout: 30_000 })
  await page.evaluate(async () => {
    const entry = await (await fetch('/src/main.tsx')).text()
    const reactUrl = entry.match(/from "([^"]*\/react\.js[^\"]*)"/)[1]
    const reactDomUrl = entry.match(/from "([^"]*\/react-dom_client\.js[^\"]*)"/)[1]
    const { default: React } = await import(reactUrl)
    const { default: ReactDOM } = await import(reactDomUrl)
    const { AgentPanelView } = await import('/src/components/agent-panel/agent-panel-view.tsx')
    const { useCclinkStore } = await import('/src/stores/cclink-store.ts')
    const host = document.createElement('div')
    host.style.cssText =
      'position:fixed;inset:0;z-index:99999;background:var(--bg-primary);display:flex'
    document.body.append(host)
    const question = {
      type: 'userQuestion',
      id: 'question-1',
      timestamp: 1,
      requestId: 'run-1',
      toolUseId: 'tool-1',
      questions: [
        {
          id: 'market',
          header: '市场范围',
          question: '哪个市场？',
          options: [{ label: 'A股' }, { label: '美股' }],
        },
        {
          id: 'focus',
          header: '分析重点',
          question: '分析哪些维度？',
          multiSelect: true,
          options: [{ label: '牛熊周期复盘' }, { label: '估值与历史位置' }],
        },
        {
          id: 'output',
          header: '产出形式',
          question: '以什么形式产出？',
          options: [{ label: '深度报告+图表' }],
        },
      ],
    }
    useCclinkStore.setState({
      messages: {
        'session-1': [
          question,
          { type: 'agentText', id: 'text-1', content: '请确认三个选择', timestamp: 2 },
        ],
      },
    })
    const fixture = (window.questionSmoke = { submitted: [], patch: null, fail: null })
    fixture.patch = (patch) => {
      const current = useCclinkStore.getState().messages['session-1'][0]
      useCclinkStore.getState().handleRealtimeEvent({
        type: 'conversation',
        serverId: 'agent-1',
        sessionId: 'session-1',
        phase: 'message',
        message: { ...current, ...patch },
      })
    }
    function Harness() {
      const messages = useCclinkStore((state) => state.messages['session-1'])
      const [control, setControl] = React.useState({ submitting: false })
      fixture.fail = () => setControl({ submitting: false, error: '等待远程设备响应超时，请重试' })
      const q = messages[0]
      const disabled = { state: 'disabled', reason: '隔离测试' }
      return React.createElement(AgentPanelView, {
        model: {
          runtime: 'remote',
          variant: 'center',
          timelineKey: 'question-smoke',
          header: {
            title: 'Agent',
            runtimeLabel: '远程 · 问答回归',
            status: { tone: 'ready', label: 'Agent 就绪', detail: '隔离协议夹具' },
            diagnostics: { state: 'disabled', label: '诊断', onInvoke() {} },
          },
          contextChips: [],
          notices: [],
          activities: [],
          permissions: [],
          timeline: [
            {
              kind: 'question',
              id: q.id,
              question: {
                ...q,
                title: 'Agent 需要你的选择',
                ...control,
                onSubmit(answers) {
                  fixture.submitted.push(answers)
                  setControl({ submitting: true })
                },
              },
            },
            { kind: 'status', id: 'later-text', label: '请确认三个选择' },
          ],
          empty: { title: '开始', description: '' },
          composer: {
            value: '',
            canSubmit: false,
            submitting: false,
            stopCapability: { state: 'hidden' },
            placeholder: '输入消息',
            onChange() {},
            onSubmit() {},
            actionBar: {
              kind: 'remote',
              runtimeLabel: '隔离测试',
              capabilities: {
                addContext: disabled,
                role: disabled,
                permissionMode: disabled,
                contextUsage: disabled,
                runtime: disabled,
              },
            },
          },
        },
      })
    }
    ReactDOM.createRoot(host).render(React.createElement(Harness))
  })
  const card = page.locator('.agent-question-card')
  const submit = card.getByRole('button')
  assert(await submit.isDisabled())
  await card.getByRole('checkbox', { name: '牛熊周期复盘' }).check()
  await card.getByRole('checkbox', { name: '估值与历史位置' }).check()
  await card.getByLabel('产出形式').selectOption('深度报告+图表')
  assert(await submit.isDisabled())
  assert.equal(
    await card.locator('.agent-question-hint').innerText(),
    '按选项回答时，请先完成：市场范围',
  )
  await card.getByLabel('市场范围').selectOption('A股')
  assert(await submit.isEnabled())
  await page.evaluate(() => window.questionSmoke.patch({ status: 'expired' }))
  await card.getByRole('button', { name: '提交答案并继续' }).waitFor()
  assert.equal(await card.getByLabel('市场范围').inputValue(), 'A股')
  assert(await card.getByRole('checkbox', { name: '牛熊周期复盘' }).isChecked())
  assert(await card.getByRole('checkbox', { name: '估值与历史位置' }).isChecked())
  await page.screenshot({ path: join(runDir, 'expired-with-answers.png') })
  await submit.click()
  await card.getByRole('button', { name: '等待 Agent 确认…' }).waitFor()
  assert(await submit.isDisabled())
  await page.evaluate(() => window.questionSmoke.fail())
  await card.getByText('等待远程设备响应超时，请重试').waitFor()
  assert(await submit.isEnabled())
  await submit.click()
  await page.evaluate(() =>
    window.questionSmoke.patch({ status: 'resolved', answered: true, resolution: 'new_turn' }),
  )
  await card.getByRole('button', { name: '已提交为新一轮消息' }).waitFor()
  assert(await submit.isDisabled())
  const answers = await page.evaluate(() => window.questionSmoke.submitted)
  assert.deepEqual(
    answers,
    Array.from({ length: 2 }, () => ({
      '哪个市场？': 'A股',
      '分析哪些维度？': '牛熊周期复盘, 估值与历史位置',
      '以什么形式产出？': '深度报告+图表',
    })),
  )
  await page.screenshot({ path: join(runDir, 'accepted-as-new-turn.png') })
  await writeFile(
    join(runDir, 'result.json'),
    JSON.stringify(
      {
        ok: true,
        remoteWasStubbed: true,
        checked: [
          'missing selection hint',
          'expiry preserves selections',
          'retry preserves answers',
          'confirmed new turn state',
        ],
        answers,
      },
      null,
      2,
    ),
  )
  console.log(JSON.stringify({ ok: true, remoteWasStubbed: true, runDir }))
} catch (error) {
  await page?.screenshot({ path: join(runDir, 'failure.png') }).catch(() => {})
  console.error(JSON.stringify({ ok: false, error: error.message, runDir }))
  process.exitCode = 1
} finally {
  await browser?.close().catch(() => {})
  if (child?.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000))
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {}
  }
}
