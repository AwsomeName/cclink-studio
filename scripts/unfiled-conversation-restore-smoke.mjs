#!/usr/bin/env node
// Run after building, or set ELECTRON_RENDERER_URL to an existing dev renderer.
// Only isolated profiles are started; the user's running Studio is never restarted.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright-core'
import electronPath from 'electron'

const repository = resolve(import.meta.dirname, '..')
const root = await mkdtemp(join(tmpdir(), 'studio-unfiled-restore-'))
const home = join(root, 'home')
const documents = join(root, 'documents')
await Promise.all([home, documents].map((path) => mkdir(path)))
const launcher = join(root, 'launch.cjs')
await writeFile(
  launcher,
  `const {app}=require('electron');
app.setPath('home',${JSON.stringify(home)});
app.setPath('documents',${JSON.stringify(documents)});
app.setAppPath(${JSON.stringify(repository)});
require(${JSON.stringify(join(repository, 'out/main/index.js'))});`,
)

const localId = 'local_unfiled_restore_smoke'
const ownerKey = `local:${localId}`
const workspaceId = createHash('sha256').update(`${ownerKey}\0global`).digest('hex').slice(0, 16)
const marker = 'UNFILED-RESTORE-HISTORY'
let pristineConversation
const historyConversation = (id, content) => ({
  ...pristineConversation,
  id,
  title: content ? '保留的历史对话' : '新会话',
  createdAt: 1,
  updatedAt: 1,
  runtime: {
    location: 'local',
    transport: 'local',
    backend: 'cclink-studio-agent',
    workspaceRef: { kind: 'global' },
  },
  runtimeBinding: { kind: 'claude-code' },
  messages: [
    {
      id: content ? 'user-history' : 'welcome',
      role: content ? 'user' : 'assistant',
      content: [{ type: 'text', text: content || '欢迎' }],
      timestamp: 1,
    },
  ],
  scope: { kind: 'all' },
})
const results = []

for (const scenario of ['fresh', 'history', 'missing-directory']) {
  const profile = join(root, scenario)
  await mkdir(profile)
  await writeFile(
    join(profile, 'local-identity.json'),
    JSON.stringify({
      version: 1,
      identity: {
        localId,
        deviceId: 'smoke-device',
        deviceName: 'Smoke',
        createdAt: 1,
        updatedAt: 1,
      },
    }),
  )
  await writeFile(
    join(profile, 'settings.json'),
    JSON.stringify({
      startupWorkspaceTarget: scenario === 'missing-directory' ? 'resume' : 'unfiled',
      lastWorkspacePath: scenario === 'missing-directory' ? join(home, 'missing-project') : '',
      componentSetupPageSeenVersion: 2,
      claudeRuntimeSource: 'system',
    }),
  )
  if (scenario === 'history') {
    await writeFile(
      join(profile, 'workspace-state.json'),
      JSON.stringify({
        version: 2,
        localWorkspaces: {},
        workspaces: {
          [workspaceId]: {
            version: 1,
            workspaceId,
            workspaceKey: null,
            workspacePath: null,
            ownerKey,
            updatedAt: 1,
            sections: {
              agentConversations: {
                conversations: {
                  'history-empty': historyConversation('history-empty'),
                  'history-content': historyConversation('history-content', marker),
                },
                conversationOrder: ['history-empty', 'history-content'],
                activeConversationId: 'history-content',
              },
            },
          },
        },
      }),
    )
  }

  let expectedIds
  let expectedActive
  for (let boot = 1; boot <= 3; boot += 1) {
    const app = await _electron.launch({
      executablePath: electronPath,
      args: [launcher],
      cwd: repository,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '',
        ELECTRON_RENDERER_URL: process.env.ELECTRON_RENDERER_URL || '',
        CCLINK_STUDIO_TEST_USER_DATA_PATH: profile,
        CLAUDE_CONFIG_DIR: join(root, 'claude-config'),
      },
      timeout: 30000,
    })
    try {
      const page = await app.firstWindow()
      page.on('pageerror', (error) => console.error(error.message))
      await page.waitForSelector('.main-window', { timeout: 30000 })
      if (!(await page.locator('.session-sidebar-row').first().isVisible())) {
        await page.getByRole('button', { name: '会话', exact: true }).click()
      }
      await page.locator('.session-sidebar-row').first().waitFor({ state: 'visible' })
      const snapshot = await page.evaluate(async () => {
        const identity = await window.cclinkStudio.identity.getLocalIdentity()
        const state = await window.cclinkStudio.workspaceState.get(
          null,
          `local:${identity.localId}`,
        )
        return state.sections.agentConversations
      })
      const ids = snapshot.conversationOrder
      if (scenario === 'fresh') pristineConversation = snapshot.conversations[ids[0]]
      assert.equal(ids.length, scenario === 'history' ? 2 : 1)
      expectedIds ??= ids
      expectedActive ??= snapshot.activeConversationId
      assert.deepEqual(ids, expectedIds, 'Cold start added or replaced a conversation')
      assert.equal(snapshot.activeConversationId, expectedActive)
      const visibleIds = await page
        .locator('.session-sidebar-row')
        .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-conversation-id')))
      assert.deepEqual(visibleIds.sort(), [...ids].sort())
      if (scenario === 'history') {
        assert.deepEqual([...ids].sort(), ['history-content', 'history-empty'])
        assert.equal(snapshot.activeConversationId, 'history-content')
        assert.equal(snapshot.conversations['history-content'].messages[0].content[0].text, marker)
        await page
          .locator('.agent-message.user')
          .getByText(marker, { exact: true })
          .waitFor({ state: 'visible' })
      }
      results.push({ scenario, boot, ids, activeConversationId: snapshot.activeConversationId })
      console.log(
        `PASS ${scenario} boot ${boot}: ${ids.length} conversations, same IDs and selection`,
      )
      if (boot === 3) await page.screenshot({ path: join(root, `${scenario}.png`) })
    } finally {
      await app.close()
    }
  }
}
await writeFile(join(root, 'results.json'), JSON.stringify(results, null, 2))
console.log(`Evidence: ${root}`)
