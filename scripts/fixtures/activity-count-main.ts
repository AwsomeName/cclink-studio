// Test-only Electron entry. The production runtime never imports this file.
import { app, BrowserWindow } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { ScheduledTaskService } from '../../src/main/scheduled-task/scheduled-task-service'
import { WorkspaceStateService } from '../../src/main/workspace/workspace-state-service'
import { registerScheduledTaskIpc } from '../../src/main/scheduled-task/scheduled-task-ipc'
import { createTrustedRendererGuard } from '../../src/main/ipc/trusted-renderer-guard'

async function main(): Promise<void> {
  const [directory, workspace, preload] = process.argv.slice(-3)
  await mkdir(join(directory, 'documents'), { recursive: true })
  app.setPath('userData', directory)
  app.setPath('documents', join(directory, 'documents'))
  await app.whenReady()
  let release: (() => void) | undefined
  let rejectRun: ((error: Error) => void) | undefined
  const gate = new Promise<void>((resolve, reject) => {
    release = resolve
    rejectRun = reject
  })
  void gate.catch(() => {})
  const workspaces = new WorkspaceStateService()
  await workspaces.loadState()
  const service = new ScheduledTaskService(workspaces, {
    userDataPath: directory,
    runExecutor: {
      async run({ runId }) {
        await gate
        const relativePath = `counter-${runId}.md`
        const contents = '# Local counter fixture\n'
        await writeFile(join(workspace, relativePath), contents)
        return {
          artifact: {
            relativePath,
            bytes: Buffer.byteLength(contents),
            sha256: createHash('sha256').update(contents).digest('hex'),
          },
        }
      },
      async cancel() {
        rejectRun?.(new Error('Counter fixture cancelled'))
      },
    },
  })
  await service.load()
  // No Agent API may be used when the constructor executor is supplied.
  await service.startRuntime(
    new Proxy(
      {},
      {
        get() {
          throw new Error('Agent must not run in counter fixture')
        },
      },
    ) as never,
  )
  const entry = pathToFileURL(join(directory, 'index.html')).href
  const window = new BrowserWindow({
    width: 400,
    height: 780,
    show: false,
    webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  const guard = createTrustedRendererGuard(window, entry)
  registerScheduledTaskIpc(service, guard, window)
  let events = 0
  service.onChanged(() => events++)
  Object.assign(globalThis, {
    activityCountFixture: {
      release: () => release?.(),
      events: () => events,
      stop: async () => {
        await service.stopRuntime()
        guard.ipcRegistrations?.dispose()
        await workspaces.flush()
      },
    },
  })
  await window.loadURL(entry)
}
void main().catch((error) => {
  console.error(error)
  app.exit(1)
})
