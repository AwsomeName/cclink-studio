import type { IpcMainInvokeEvent } from 'electron'
import { localTtsIpcContracts } from '../../shared/local-tts-contract'
import {
  TrustedIpcRegistrationScope,
  registerTrustedIpcContract,
  type TrustedRendererGuard,
} from '../ipc/trusted-renderer-guard'
import type { CclinkStudioRuntimeState } from '../runtime/app-runtime'
import type { RuntimeService } from '../runtime/service-registry'
import { LocalTtsService } from './local-tts-service'
import { SherpaTtsEngine } from './tts-engine'

export function createLocalTtsRuntime(runtime: CclinkStudioRuntimeState): RuntimeService {
  let service: LocalTtsService | null = null
  let registrations: TrustedIpcRegistrationScope | null = null
  let cleanups: Array<() => void> = []
  return {
    name: 'local-tts',
    start: () => {
      const trusted = runtime.trustedRendererGuard
      if (!trusted) return
      registrations = new TrustedIpcRegistrationScope()
      const assert = (event: IpcMainInvokeEvent): void => {
        trusted.assert(event)
        if (event.sender.id !== runtime.mainWindow?.webContents.id)
          throw new Error('朗读仅允许主工作台调用')
      }
      const guard: TrustedRendererGuard = {
        assert,
        isTrusted: (event) =>
          trusted.isTrusted(event) && event.sender.id === runtime.mainWindow?.webContents.id,
        ipcRegistrations: registrations,
      }
      const manager = () => {
        if (!runtime.runtimeComponentManager) throw new Error('语音资源安装器暂不可用')
        return runtime.runtimeComponentManager
      }
      const current = new LocalTtsService({
        resource: () =>
          runtime.runtimeComponentManager
            ?.listRuntimeResources()
            .find((s) => s.componentId === 'kokoro-tts-model') ?? null,
        install: () => manager().installRuntimeResource('kokoro-tts-model'),
        createEngine: async () => {
          const lease = await manager().acquireRuntimeResource('kokoro-tts-model')
          if (!lease) throw new Error('语音资源缺失或损坏，请重新安装')
          try {
            return new SherpaTtsEngine(lease.root, lease.release)
          } catch (error) {
            lease.release()
            throw error
          }
        },
        resolveInput: async (input) => {
          const browser = runtime.browserManager
          if (browser && input.source.workspaceKey !== browser.getHostWorkspaceKey('main'))
            throw new Error('工作空间已切换，请重新发起朗读')
          if (input.source.kind === 'browser') {
            const tabId = input.source.tabId
            if (
              !browser ||
              !tabId ||
              browser.getViewOwnerWindowId(tabId) !== 'main' ||
              browser.getActiveViewId() !== tabId ||
              browser.getViewWorkspaceKey(tabId) !== input.source.workspaceKey
            )
              throw new Error('网页已切换，请重新发起朗读')
            return {
              text:
                input.text ??
                (await browser.readSpeechText(
                  tabId,
                  input.source.workspaceKey,
                  input.source.selection,
                )),
              format: 'plain',
            }
          }
          return { text: input.text ?? '', format: input.source.selection ? 'plain' : 'markdown' }
        },
      })
      service = current
      registerTrustedIpcContract(localTtsIpcContracts.getSnapshot, guard, () => current.snapshot())
      registerTrustedIpcContract(localTtsIpcContracts.start, guard, (_event, input) =>
        current.start(input.source.kind === 'browser' ? { source: input.source } : input),
      )
      registerTrustedIpcContract(localTtsIpcContracts.control, guard, (_event, input) =>
        current.control(input),
      )
      registerTrustedIpcContract(localTtsIpcContracts.audio, guard, (_event, key) =>
        current.getAudio(key),
      )
      registerTrustedIpcContract(localTtsIpcContracts.report, guard, (_event, input) =>
        current.report(input),
      )
      registerTrustedIpcContract(localTtsIpcContracts.install, guard, () => current.install())
      if (runtime.browserManager) {
        const browser = runtime.browserManager
        cleanups.push(browser.onMainWorkspaceChanged((key) => current.workspaceChanged(key)))
        cleanups.push(
          browser.setSpeechSelectionHandler((tabId, text) => {
            void current.start({
              source: {
                kind: 'browser',
                tabId,
                workspaceKey: browser.getViewWorkspaceKey(tabId) ?? null,
                title: browser.getTitle(tabId).slice(0, 256) || '网页选区',
                selection: true,
              },
              text,
            })
          }),
        )
      }
      const wc = runtime.mainWindow?.webContents
      if (wc) {
        const stop = () =>
          current.control({ sessionId: current.snapshot().sessionId, action: 'stop' })
        wc.on('render-process-gone', stop)
        wc.on('did-start-navigation', stop)
        cleanups.push(() => {
          wc.removeListener('render-process-gone', stop)
          wc.removeListener('did-start-navigation', stop)
        })
      }
    },
    stop: () => {
      cleanups.forEach((cleanup) => cleanup())
      cleanups = []
      registrations?.dispose()
      registrations = null
      service?.dispose()
      service = null
    },
  }
}
