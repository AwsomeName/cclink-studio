#!/usr/bin/env node
// Real Electron/UI/IPC/stdio, deterministic native fixture, no model requests.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright-core'
import electronPath from 'electron'

const repository = resolve(import.meta.dirname, '..')
const root = await mkdtemp(join(tmpdir(), 'studio-codex-policy-ui-'))
const profile = join(root, 'profile')
const home = join(root, 'home')
const documents = join(root, 'documents')
const workspace = join(home, 'workspace')
const bin = join(root, 'bin')
await Promise.all(
  [profile, home, documents, workspace, bin].map((path) => mkdir(path, { recursive: true })),
)
await writeFile(
  join(profile, 'settings.json'),
  JSON.stringify({ componentSetupPageSeenVersion: 99, permissionMode: 'auto' }),
)
await writeFile(
  join(bin, 'codex'),
  `#!/usr/bin/env node
const {createInterface}=require('node:readline');
const send=(value)=>process.stdout.write(JSON.stringify(value)+'\\n');
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line); if(!m.id)return;
 const p=m.params||{}; let result={};
 if(m.method==='initialize')result={userAgent:'cclink_studio/0.169.0-alpha.11.1 (fixture)'};
 if(m.method==='account/read')result={account:{type:'chatgpt'},requiresOpenaiAuth:true};
 if(m.method==='config/read')result={config:{}};
 if(m.method.startsWith('thread/'))result={thread:{id:'fixture-thread'},cwd:p.cwd,modelProvider:'openai',approvalPolicy:'untrusted',approvalsReviewer:m.method==='thread/resume'?'guardian':'user',runtimeWorkspaceRoots:[p.cwd],sandbox:{type:p.sandbox==='read-only'?'readOnly':'workspaceWrite',networkAccess:m.method==='thread/resume',writableRoots:[],excludeTmpdirEnvVar:true,excludeSlashTmp:true},secret:'SECRET_NATIVE_PAYLOAD'};
 if(m.method==='mcpServerStatus/list')result={data:[{name:'cclink_studio',tools:{}}]};
 if(m.method==='turn/start')result={turn:{id:'fixture-turn'}};
 send({id:m.id,result});
 if(m.method==='turn/start')setTimeout(()=>{
  send({method:'item/agentMessage/delta',params:{threadId:'fixture-thread',itemId:'reply',delta:'POLICY_FIRST_TURN_OK'}});
  send({method:'turn/completed',params:{threadId:'fixture-thread',turn:{id:'fixture-turn',status:'completed'}}});
 },40);
});
`,
  { mode: 0o700 },
)
const launcher = join(root, 'launch.cjs')
await writeFile(
  launcher,
  `const {app}=require('electron');app.setPath('home',${JSON.stringify(home)});app.setPath('documents',${JSON.stringify(documents)});app.setAppPath(${JSON.stringify(repository)});require(${JSON.stringify(join(repository, 'out/main/index.js'))});`,
)
let app
let page
try {
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    CCLINK_STUDIO_TEST_USER_DATA_PATH: profile,
  }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  delete env.CCLINK_STUDIO_EXPERIMENTAL_AGENT_BACKEND
  app = await _electron.launch({
    executablePath: electronPath,
    args: [launcher],
    cwd: repository,
    env,
  })
  page = await app.firstWindow()
  page.setDefaultTimeout(20000)
  await page.waitForSelector('.main-window')
  await page.evaluate(() => {
    window.__policySmoke = []
    window.cclinkStudio.agent.onRunStatus((event) => window.__policySmoke.push(event))
  })
  await app.evaluate(({ dialog }, workspace) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [workspace] })
  }, workspace)
  await page.getByRole('button', { name: '打开工作空间', exact: true }).click()
  await page.getByRole('button', { name: /本地文件夹/ }).click()
  // A newly opened empty workspace already owns a fresh conversation.
  await page.locator('[data-agent-landmark="composer"] textarea:visible').last().waitFor()
  async function send(text, status) {
    const before = await page.evaluate(() => window.__policySmoke.length)
    await page.locator('[data-agent-landmark="composer"] textarea:visible').last().fill(text)
    await page.locator('[data-agent-action="send"]:visible').last().click()
    await page.waitForFunction(
      ({ before, status }) =>
        window.__policySmoke.slice(before).some((event) => event.status === status),
      { before, status },
    )
    return page.evaluate(() => window.__policySmoke.at(-1))
  }
  const first = await send('诊断测试第一轮', 'succeeded')
  const failed = await send('诊断测试恢复会话', 'failed')
  assert.equal(failed.conversationId, first.conversationId)
  await page.getByRole('button', { name: '复制完整诊断日志', exact: true }).last().click()
  let report = ''
  for (let attempt = 0; attempt < 60; attempt++) {
    report = await app.evaluate(({ clipboard }) => clipboard.readText())
    if (report.includes('CODEX_PERMISSION_BOUNDARY_MISMATCH')) break
    await page.waitForTimeout(250)
  }
  for (const expected of [
    'Codex 版本：0.169.0-alpha.11.1',
    '会话操作：thread/resume',
    '请求权限：',
    '返回权限：',
    '"approvalsReviewer":"guardian"',
    '权限不匹配项：approvalsReviewer, sandbox.networkAccess',
    '已发送模型请求：否',
    '恢复标识一致：是',
    'CODEX_READY',
  ])
    assert(report.includes(expected), `Missing report fact: ${expected}`)
  assert(!report.includes('SECRET_NATIVE_PAYLOAD'))
  await writeFile(join(root, 'copied-report.md'), report)
  await page.screenshot({ path: join(root, 'permission-failure.png') })
  console.log(
    JSON.stringify({
      success: true,
      root,
      result:
        'same-session resume rejected; copied UI report contains request, response, mismatch, runtime version and separate successful global probe',
    }),
  )
} catch (error) {
  await page?.screenshot({ path: join(root, 'failure.png') }).catch(() => {})
  console.error('Codex permission UI smoke failed', root, error)
  process.exitCode = 1
} finally {
  await app?.close()
}
