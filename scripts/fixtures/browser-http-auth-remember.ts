import { app, BrowserWindow, webContents } from 'electron'
import { writeFile } from 'node:fs/promises'
import { CredentialService } from '../../src/main/credentials/credential-service'
import {
  PlaintextCredentialStore,
  type CredentialFileState,
} from '../../src/main/credentials/plaintext-credential-store'
import { BrowserManager } from '../../src/main/browser/browser-manager'
import { BrowserAuthProcessService } from '../../src/main/browser/browser-auth-process-service'
import {
  configureBrowserHttpAuthChildApp,
  runBrowserHttpAuthChild,
} from '../../src/main/browser/browser-http-auth-child'
import { parseBrowserHttpAuthChildOptions } from '../../src/shared/ipc/browser-http-auth'

const childOptions = parseBrowserHttpAuthChildOptions(process.argv)
const phase = process.env.CCLINK_BASIC_SMOKE_PHASE!
const password = phase === 'save' ? ' smoke-password ' : ' changed-password '

if (childOptions) {
  configureBrowserHttpAuthChildApp(app, childOptions)
  app.on('browser-window-created', (_event, window) => {
    window.webContents.once(
      'did-finish-load',
      () =>
        void (async () => {
          if (phase === 'restore' || phase === 'restore-new') {
            process.stderr.write('Unexpected authentication dialog after restart\n')
            app.exit(1)
            return
          }
          if (phase === 'save' && process.env.CCLINK_BASIC_SMOKE_SCREENSHOT) {
            await writeFile(
              process.env.CCLINK_BASIC_SMOKE_SCREENSHOT,
              (await window.webContents.capturePage()).toPNG(),
            )
          }
          await window.webContents.executeJavaScript(`
        document.querySelector('#username').value = 'smoke-user';
        document.querySelector('#password').value = ${JSON.stringify(password)};
        const remember = document.querySelector('#remember');
        if (${JSON.stringify(['save', 'replace', 'slow-save', 'cancel-save'].includes(phase))}) remember.click();
        const consent = document.querySelector('#allow-insecure');
        if (consent) consent.click();
        if (document.querySelector('#submit').getBoundingClientRect().bottom > innerHeight) throw new Error('Login button outside visible window');
        if (document.querySelector('#submit').disabled) throw new Error('Submit unexpectedly disabled');
        document.querySelector('#submit').click();
      `)
          if (phase === 'cancel-save') {
            await new Promise((resolve) => setTimeout(resolve, 200))
            await window.webContents.executeJavaScript(`
              if (document.querySelector('#cancel').disabled) throw new Error('Cancel disabled during save');
              document.querySelector('#cancel').click();
            `)
          }
        })().catch((error) => {
          process.stderr.write(`${error.message}\n`)
          app.exit(1)
        }),
    )
  })
  void app.whenReady().then(() => runBrowserHttpAuthChild(childOptions))
} else {
  app.setPath('userData', process.env.CCLINK_BASIC_SMOKE_DATA!)
  app.commandLine.appendSwitch('host-resolver-rules', 'MAP basic.test 127.0.0.1')
  app.commandLine.appendSwitch('no-proxy-server')
  void app
    .whenReady()
    .then(run)
    .catch((error) => {
      process.stderr.write(`${error.stack ?? error}\n`)
      app.exit(1)
    })
}

async function run(): Promise<void> {
  let pendingWrite = Promise.resolve()
  class DelayedCredentialStore extends PlaintextCredentialStore {
    override save(state: CredentialFileState): Promise<void> {
      pendingWrite = (async () => {
        if (Object.keys(state.records).length > 0) {
          if (phase === 'slow-save') await new Promise((resolve) => setTimeout(resolve, 11_000))
          if (phase === 'cancel-save') await new Promise((resolve) => setTimeout(resolve, 1_000))
        }
        await super.save(state)
      })()
      return pendingWrite
    }
  }
  const credentials = new CredentialService(new DelayedCredentialStore())
  await credentials.load()
  if (['clear', 'slow-save', 'cancel-save'].includes(phase)) {
    for (const metadata of credentials.listMetadata())
      await credentials.removeCredential(metadata.id)
  }
  const window = new BrowserWindow({ show: false, width: 900, height: 800 })
  const manager = new BrowserManager(window)
  const service = new BrowserAuthProcessService(window, manager, credentials)
  let challenges = 0
  manager.attachBrowserHttpAuthRequestHandler((request, callback) => {
    challenges++
    service.openHttpBasic(request, callback)
  })
  const profileId = phase.startsWith('isolated') ? 'basic-smoke-b' : 'basic-smoke-a'
  manager.reconcileViews({
    workspaceKey: '/fixture',
    views: [{ tabId: 'basic', profileId }],
    activeTabId: 'basic',
  })
  await manager.createView('basic', undefined, { profileId, workspaceKey: '/fixture' })
  await manager.navigate('basic', process.env.CCLINK_BASIC_SMOKE_URL!).catch((error) => {
    if (phase !== 'cancel-save') throw error
  })
  await pendingWrite
  const page = webContents
    .getAllWebContents()
    .find((content) => content.getURL() === process.env.CCLINK_BASIC_SMOKE_URL)
  if (
    phase !== 'cancel-save' &&
    (!page ||
      (await page.executeJavaScript("document.querySelector('main')?.textContent")) !==
        'Authenticated')
  )
    throw new Error('Protected content was not reached')
  const diagnostic = await manager.getRuntimeDiagnostics('basic')
  if (diagnostic.httpAuth?.outcome !== (phase === 'cancel-save' ? 'cancelled' : 'authenticated'))
    throw new Error(`Navigation not authenticated: ${JSON.stringify(diagnostic.httpAuth)}`)
  const expected = phase === 'replace' ? 2 : 1
  if (challenges !== expected) throw new Error(`Expected ${expected} challenges, got ${challenges}`)
  if (credentials.listMetadata().length !== (phase === 'clear' ? 0 : 1))
    throw new Error('Unexpected saved record count')
  service.destroy()
  manager.destroy()
  window.destroy()
  process.stdout.write(
    `BASIC_REMEMBER_RESULT=${JSON.stringify({ phase, ok: true, challenges, outcome: diagnostic.httpAuth?.outcome })}\n`,
    () => app.exit(0),
  )
}
