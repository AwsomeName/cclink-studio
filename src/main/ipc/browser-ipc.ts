import { dialog, type IpcMainInvokeEvent } from 'electron'
import type { BrowserManager } from '../browser/browser-manager'
import type { BrowserInstanceStore } from '../persistence/browser-instance-store'
import { browserIpcEvents } from '../../shared/ipc/browser'
import {
  browserDownloadIpcContracts,
  browserIpcContracts,
  browserTaskIpcContracts,
} from '../../shared/ipc/browser-contract'
import type { IpcInvokeContract } from '../../shared/ipc/contract'
import type { BrowserTaskRuntime } from '../browser/browser-task-runtime'
import type { BrowserDownloadStore } from '../browser/browser-download-store'
import type { PlaywrightBridge } from '../playwright/playwright-bridge'
import {
  registerTrustedIpcContract,
  registerTrustedIpcListener,
  type TrustedRendererGuard,
} from './trusted-renderer-guard'
import { browserBoundsSchema } from './browser-ipc-schema'

/**
 * 注册浏览器相关的 IPC 处理器
 *
 * 多视图版本：所有导航/缩放/设备模式通道都前置 tabId 参数，
 * 视图生命周期由 createView / destroyView / setActive 三个通道管理。
 */
export function registerBrowserIpc(
  browserManager: BrowserManager,
  trustedRendererGuard: TrustedRendererGuard,
  instanceStore?: BrowserInstanceStore,
  taskRuntime?: BrowserTaskRuntime,
  downloadStore?: BrowserDownloadStore,
  getPlaywrightBridge?: () => PlaywrightBridge | null | undefined,
): void {
  const handle = <Args extends unknown[], Result>(
    contract: IpcInvokeContract<Args, Result>,
    handler: (
      event: IpcMainInvokeEvent,
      ...args: NoInfer<Args>
    ) => NoInfer<Result> | Promise<NoInfer<Result>>,
  ): void => registerTrustedIpcContract(contract, trustedRendererGuard, handler)

  // 渲染进程上报 Workbench 区域坐标（作用于当前活跃视图）
  registerTrustedIpcListener(
    browserIpcEvents.workbenchBounds,
    trustedRendererGuard,
    (_event, bounds) => {
      const parsed = browserBoundsSchema.safeParse(bounds)
      if (!parsed.success) {
        console.warn('[BrowserIpc] 已丢弃非法 workbench bounds')
        return
      }
      browserManager.updateBounds(parsed.data)
    },
  )

  // ─── 视图生命周期 ───
  // opts.restore：从快照重建时传入，恢复 viewMode/zoom
  handle(browserIpcContracts.createView, async (_event, ...args) => {
    const [tabId, initialUrl, opts] = args
    await browserManager.createView(tabId, initialUrl, opts)
  })

  handle(browserIpcContracts.destroyView, (_event, tabId) => {
    browserManager.destroyView(tabId)
  })

  /** 设置活跃视图；null = 全部隐藏 */
  handle(browserIpcContracts.setActive, (_event, tabId) => {
    browserManager.setActive(tabId)
  })

  handle(browserIpcContracts.reconcileViews, (_event, options) => {
    browserManager.reconcileViews(options)
  })

  // ─── 导航 ───
  handle(browserIpcContracts.navigate, async (_event, tabId, url) => {
    await browserManager.navigate(tabId, url)
  })

  handle(browserIpcContracts.goBack, (_event, tabId) => {
    browserManager.goBack(tabId)
  })

  handle(browserIpcContracts.goForward, (_event, tabId) => {
    browserManager.goForward(tabId)
  })

  handle(browserIpcContracts.reload, (_event, tabId) => {
    browserManager.reload(tabId)
  })

  handle(browserIpcContracts.capturePage, (_event, tabId) => {
    return browserManager.capturePage(tabId)
  })

  handle(browserIpcContracts.getCurrentURL, (_event, tabId) => {
    return browserManager.getCurrentURL(tabId)
  })

  handle(browserIpcContracts.getActiveViewId, (_event, ...args) => {
    const [workspaceKey] = args
    if (workspaceKey === undefined) return browserManager.getActiveViewId()
    return browserManager.getActiveViewIdForWorkspace(workspaceKey)
  })

  handle(browserIpcContracts.getDiagnostics, async (_event, tabId) => {
    return getPlaywrightBridge?.()?.getPageDiagnostics(tabId) ?? null
  })

  handle(browserIpcContracts.getRuntimeDiagnostics, async (_event, tabId) => {
    const [visible, binding, page] = await Promise.all([
      browserManager.getRuntimeDiagnostics(tabId),
      getPlaywrightBridge?.()?.getPageBindingDiagnostics(tabId) ??
        Promise.resolve({
          playwrightTabId: null,
          playwrightUrl: null,
          playwrightTitle: null,
        }),
      getPlaywrightBridge?.()?.getPageDiagnostics(tabId) ?? Promise.resolve(null),
    ])

    return {
      requestedTabId: tabId,
      ...visible,
      ...binding,
      bindingStatus: resolveBindingStatus({
        requestedTabId: tabId,
        visibleTabId: visible.visibleTabId,
        visibleUrl: visible.visibleUrl,
        playwrightTabId: binding.playwrightTabId,
        playwrightUrl: binding.playwrightUrl,
      }),
      page,
    }
  })

  handle(browserIpcContracts.getSessionDiagnostics, (_event, request) => {
    return browserManager.getSessionDiagnostics(request.url, request.profileId)
  })

  // ─── 缩放控制 ───
  handle(browserIpcContracts.zoomIn, (_event, tabId) => {
    browserManager.zoomIn(tabId)
  })

  handle(browserIpcContracts.zoomOut, (_event, tabId) => {
    browserManager.zoomOut(tabId)
  })

  handle(browserIpcContracts.resetZoom, (_event, tabId) => {
    browserManager.resetZoom(tabId)
  })

  handle(browserIpcContracts.setZoom, (_event, tabId, factor) => {
    browserManager.setZoom(tabId, factor)
  })

  handle(browserIpcContracts.fitWidth, (_event, tabId) => {
    browserManager.setFitWidth(tabId)
  })

  // ─── 设备模式（桌面 / 移动）───
  handle(browserIpcContracts.setDeviceMode, (_event, tabId, mode) => {
    browserManager.setDeviceMode(tabId, mode)
  })

  // ─── 视图状态查询（活跃视图）───
  handle(browserIpcContracts.getViewState, () => {
    return browserManager.getViewState()
  })

  // ─── 实例快照（重启「恢复上次会话」入口） ───
  // 登录态由默认 session 持久化，无需 IPC；此处仅管理 URL/视图模式快照。

  handle(browserIpcContracts.listSnapshots, async () => {
    if (!instanceStore) return []
    return instanceStore.list()
  })

  handle(browserIpcContracts.removeSnapshot, async (_event, id) => {
    if (!instanceStore) return
    await instanceStore.remove(id)
  })

  handle(browserIpcContracts.clearSnapshots, async () => {
    if (!instanceStore) return
    await instanceStore.clear()
  })

  handle(browserIpcContracts.listHistory, async (_event, ...args) => {
    const [limit] = args
    if (!instanceStore) return []
    return instanceStore.listHistory(limit)
  })

  handle(browserIpcContracts.clearHistory, async () => {
    if (!instanceStore) return
    await instanceStore.clearHistory()
  })

  handle(browserTaskIpcContracts.start, (_event, tabId, goal) => {
    if (!taskRuntime) throw new Error('浏览器任务运行时未初始化')
    return taskRuntime.startTask({ tabId, goal })
  })

  handle(browserTaskIpcContracts.list, () => {
    if (!taskRuntime) return []
    return taskRuntime.listTasks()
  })

  handle(browserTaskIpcContracts.get, (_event, taskRunId) => {
    if (!taskRuntime) return null
    return taskRuntime.getTask(taskRunId)
  })

  handle(browserTaskIpcContracts.getActiveForTab, (_event, tabId) => {
    if (!taskRuntime) return null
    return taskRuntime.getActiveTaskForTab(tabId)
  })

  handle(browserTaskIpcContracts.pause, (_event, taskRunId) => {
    if (!taskRuntime) throw new Error('浏览器任务运行时未初始化')
    return taskRuntime.pauseTask(taskRunId)
  })

  handle(browserTaskIpcContracts.resume, (_event, taskRunId) => {
    if (!taskRuntime) throw new Error('浏览器任务运行时未初始化')
    return taskRuntime.resumeTask(taskRunId)
  })

  handle(browserTaskIpcContracts.cancel, (_event, taskRunId) => {
    if (!taskRuntime) throw new Error('浏览器任务运行时未初始化')
    return taskRuntime.cancelTask(taskRunId)
  })

  handle(browserTaskIpcContracts.finish, (_event, taskRunId) => {
    if (!taskRuntime) throw new Error('浏览器任务运行时未初始化')
    return taskRuntime.finishTask(taskRunId)
  })

  handle(browserTaskIpcContracts.listActionLogs, (_event, taskRunId) => {
    if (!taskRuntime) return []
    return taskRuntime.listActionLogs(taskRunId)
  })

  handle(browserDownloadIpcContracts.list, () => {
    if (!downloadStore) return []
    return downloadStore.listDownloads()
  })

  handle(browserDownloadIpcContracts.get, (_event, downloadId) => {
    if (!downloadStore) return null
    return downloadStore.getDownload(downloadId)
  })

  handle(browserDownloadIpcContracts.keepToWorkspace, async (_event, downloadId) => {
    if (!downloadStore) throw new Error('浏览器下载存储未初始化')
    return downloadStore.keepDownloadToWorkspace(downloadId)
  })

  handle(browserDownloadIpcContracts.saveAs, async (_event, downloadId) => {
    if (!downloadStore) throw new Error('浏览器下载存储未初始化')
    const record = downloadStore.getDownload(downloadId)
    if (!record) throw new Error(`下载记录不存在: ${downloadId}`)
    const result = await dialog.showSaveDialog({
      defaultPath: record.suggestedFilename,
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    })
    if (result.canceled || !result.filePath) return null
    return downloadStore.saveDownloadAs(downloadId, result.filePath)
  })

  handle(browserDownloadIpcContracts.discard, async (_event, downloadId) => {
    if (!downloadStore) throw new Error('浏览器下载存储未初始化')
    return downloadStore.discardDownload(downloadId)
  })

  handle(browserDownloadIpcContracts.open, async (_event, downloadId) => {
    if (!downloadStore) throw new Error('浏览器下载存储未初始化')
    await downloadStore.openDownload(downloadId)
  })

  handle(browserDownloadIpcContracts.reveal, (_event, downloadId) => {
    if (!downloadStore) throw new Error('浏览器下载存储未初始化')
    downloadStore.revealDownload(downloadId)
  })
}

function resolveBindingStatus(input: {
  requestedTabId: string
  visibleTabId: string | null
  visibleUrl: string | null
  playwrightTabId: string | null
  playwrightUrl: string | null
}): 'matched' | 'url_mismatch' | 'tab_mismatch' | 'unclaimed' | 'view_missing' {
  if (!input.visibleUrl) return 'view_missing'
  if (!input.playwrightUrl) return 'unclaimed'
  if (
    input.visibleTabId !== input.requestedTabId ||
    input.playwrightTabId !== input.requestedTabId
  ) {
    return 'tab_mismatch'
  }
  return normalizeComparableUrl(input.visibleUrl) === normalizeComparableUrl(input.playwrightUrl)
    ? 'matched'
    : 'url_mismatch'
}

function normalizeComparableUrl(value: string): string {
  try {
    const url = new URL(value)
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return value.replace(/#.*$/, '').replace(/\/$/, '')
  }
}
