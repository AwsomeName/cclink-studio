import { mkdtemp, mkdir, copyFile, writeFile, readFile } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import electronPath from 'electron'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const kit = join(root, 'promotion')
const run = await mkdtemp(join(tmpdir(), 'cclink-promotion-'))
const workspaceRoot = await mkdtemp(join(homedir(), '.cclink-promotion-'))
const workspace = join(workspaceRoot, '创作工作空间')
const profile = join(run, 'profile')
await mkdir(workspace)
await mkdir(profile)
for (const file of ['从资料到初稿.md', '写作提纲.md', '参考笔记.md']) {
  await copyFile(join(kit, 'demo-materials', file), join(workspace, file))
}
await writeFile(join(profile, 'settings.json'), JSON.stringify({
  lastWorkspacePath: workspace,
  recentWorkspacePaths: [workspace],
  componentSetupPageSeenVersion: 2,
  theme: 'light',
}))
await writeFile(join(profile, 'workspace-state.json'), JSON.stringify({
  version: 2,
  workspaces: {},
  localWorkspaces: { promotion: {
    workspaceKey: workspace, workspacePath: workspace,
    ownerKey: null, updatedAt: Date.now(), storage: 'fallback', projectId: null,
  } },
}))
const env = { ...process.env, CCLINK_STUDIO_TEST_USER_DATA_PATH: profile }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const child = spawn(electronPath, [join(root, 'out/main/index.js')], {
  cwd: root, env, stdio: ['ignore', 'ignore', 'pipe'],
})
child.stderr.on('data', () => {})
await writeFile(join(run, 'capture-session.json'), JSON.stringify({
  pid: child.pid, run, workspaceRoot, workspace, profile,
  executable: electronPath,
  version: JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version,
}, null, 2))
console.log(JSON.stringify({ pid: child.pid, run, workspace, executable: electronPath }))
child.on('exit', (code) => process.exit(code ?? 0))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill('SIGTERM'))
