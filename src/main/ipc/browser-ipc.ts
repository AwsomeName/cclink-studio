import { dialog, type IpcMainInvokeEvent } from 'electron'
import type { BrowserManager } from '../browser/browser-manager'
import type { BrowserInstanceStore } from '../persistence/browser-instance-store'
import type {
  BrowserCreateViewOptions,
  BrowserReconcileViewsOptions,
  BrowserSessionDiagnosticRequest,
} from '../../shared/ipc/browser'
import type { BrowserTaskRuntime } from '../browser/browser-task-runtime'
import type { BrowserDownloadStore } from '../browser/browser-download-store'
import type { PlaywrightBridge } from '../playwright/playwright-bridge'
import {
  registerTrustedIpcHandler,
  registerTrustedIpcListener,
  type TrustedRendererGuard,
} from './trusted-renderer-guard'
import {
  browserBoundsSchema,
  browserCreateViewOptionsSchema,
  browserHistoryLimitSchema,
  browserIdentifierSchema,
  browserOptionalIdentifierSchema,
  browserReconcileViewsSchema,
  browserSessionDiagnosticRequestSchema,
  browserTaskGoalSchema,
  browserUrlSchema,
  browserViewModeSchema,
  browserWorkspaceKeySchema,
  browserZoomFactorSchema,
} from './browser-ipc-schema'

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
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: Args) => Result,
  ): void => registerTrustedIpcHandler(channel, trustedRendererGuard, handler)

  // 渲染进程上报 Workbench 区域坐标（作用于当前活跃视图）
  registerTrustedIpcListener('workbench:bounds', trustedRendererGuard, (_event, bounds) => {
    const parsed = browserBoundsSchema.safeParse(bounds)
    if (!parsed.success) {
      console.warn('[BrowserIpc] 已丢弃非法 workbench bounds')
      return
    }
    browserManager.updateBounds(parsed.data)
  })

  // ─── 视图生命周期 ───
  // opts.restore：从快照重建时传入，恢复 viewMode/zoom
  handle(
    'browser:createView',
    (_event, tabId: string, initialUrl?: string, opts?: BrowserCreateViewOptions) => {
      browserManager.createView(
        browserIdentifierSchema.parse(tabId),
        initialUrl === undefined ? undefined : browserUrlSchema.parse(initialUrl),
        opts === undefined ? undefined : browserCreateViewOptionsSchema.parse(opts),
      )
    },
  )

  handle('browser:destroyView', (_event, tabId: string) => {
    browserManager.destroyView(browserIdentifierSchema.parse(tabId))
  })

  /** 设置活跃视图；null = 全部隐藏 */
  handle('browser:setActive', (_event, tabId: string | null) => {
    browserManager.setActive(browserOptionalIdentifierSchema.parse(tabId))
  })

  handle('browser:reconcileViews', (_event, options: BrowserReconcileViewsOptions) => {
    browserManager.reconcileViews(browserReconcileViewsSchema.parse(options))
  })

  // ─── 导航 ───
  handle('browser:navigate', async (_event, tabId: string, url: string) => {
    await browserManager.navigate(browserIdentifierSchema.parse(tabId), browserUrlSchema.parse(url))
  })

  handle('browser:goBack', (_event, tabId: string) => {
    browserManager.goBack(browserIdentifierSchema.parse(tabId))
  })

  handle('browser:goForward', (_event, tabId: string) => {
    browserManager.goForward(browserIdentifierSchema.parse(tabId))
  })

  handle('browser:reload', (_event, tabId: string) => {
    browserManager.reload(browserIdentifierSchema.parse(tabId))
  })

  handle('browser:capturePage', (_event, tabId: string) => {
    return browserManager.capturePage(browserIdentifierSchema.parse(tabId))
  })

  handle('browser:getCurrentURL', (_event, tabId: string) => {
    return browserManager.getCurrentURL(browserIdentifierSchema.parse(tabId))
  })

  handle('browser:getActiveViewId', (_event, workspaceKey?: string | null) => {
    if (workspaceKey === undefined) return browserManager.getActiveViewId()
    return browserManager.getActiveViewIdForWorkspace(browserWorkspaceKeySchema.parse(workspaceKey))
  })

  handle('browser:getDiagnostics', async (_event, tabId: string) => {
    return getPlaywrightBridge?.()?.getPageDiagnostics(browserIdentifierSchema.parse(tabId)) ?? null
  })

  handle('browser:getRuntimeDiagnostics', async (_event, tabId: string) => {
    const parsedTabId = browserIdentifierSchema.parse(tabId)
    const [visible, binding, page] = await Promise.all([
      browserManager.getRuntimeDiagnostics(parsedTabId),
      getPlaywrightBridge?.()?.getPageBindingDiagnostics(parsedTabId) ??
        Promise.resolve({
          playwrightTabId: null,
          playwrightUrl: null,
          playwrightTitle: null,
        }),
      getPlaywrightBridge?.()?.getPageDiagnostics(parsedTabId) ?? Promise.resolve(null),
    ])

    return {
      requestedTabId: parsedTabId,
      ...visible,
      ...binding,
      bindingStatus: resolveBindingStatus({
        requestedTabId: parsedTabId,
        visibleTabId: visible.visibleTabId,
        visibleUrl: visible.visibleUrl,
        playwrightTabId: binding.playwrightTabId,
        playwrightUrl: binding.playwrightUrl,
      }),
      page,
    }
  })

  handle('browser:getSessionDiagnostics', (_event, request: BrowserSessionDiagnosticRequest) => {
    const parsed = browserSessionDiagnosticRequestSchema.parse(request)
    return browserManager.getSessionDiagnostics(parsed.url, parsed.profileId)
  })

  // ─── 缩放控制 ───
  handle('browser:zoomIn', (_event, tabId: string) => {
    browserManager.zoomIn(browserIdentifierSchema.parse(tabId))
  })

  handle('browser:zoomOut', (_event, tabId: string) => {
    browserManager.zoomOut(browserIdentifierSchema.parse(tabId))
  })

  handle('browser:resetZoom', (_event, tabId: string) => {
    browserManager.resetZoom(browserIdentifierSchema.parse(tabId))
  })

  handle('browser:setZoom', (_event, tabId: string, factor: number) => {
    browserManager.setZoom(
      browserIdentifierSchema.parse(tabId),
      browserZoomFactorSchema.parse(factor),
    )
  })

  handle('browser:fitWidth', (_event, tabId: string) => {
    browserManager.setFitWidth(browserIdentifierSchema.parse(tabId))
  })

  // ─── 设备模式（桌面 / 移动）───
  handle('browser:setDeviceMode', (_event, tabId: string, mode) => {
    browserManager.setDeviceMode(
      browserIdentifierSchema.parse(tabId),
      browserViewModeSchema.parse(mode),
    )
  })

  // ─── 视图状态查询（活跃视图）───
  handle('browser:getViewState', () => {
    return browserManager.getViewState()
  })

  // ─── 实例快照（重启「恢复上次会话」入口） ───
  // 登录态由默认 session 持久化，无需 IPC；此处仅管理 URL/视图模式快照。

  handle('browser:listSnapshots', async () => {
    if (!instanceStore) return []
    return instanceStore.list()
  })

  handle('browser:removeSnapshot', async (_event, id: string) => {
    if (!instanceStore) return
    await instanceStore.remove(browserIdentifierSchema.parse(id))
  })

  handle('browser:clearSnapshots', async () => {
    if (!instanceStore) return
    await instanceStore.clear()
  })

  handle('browser:listHistory', async (_event, limit?: number) => {
    if (!instanceStore) return []
    return instanceStore.listHistory(browserHistoryLimitSchema.parse(limit))
  })

  handle('browser:clearHistory', async () => {
    if (!instanceStore) return
    await instanceStore.clearHistory()
  })

  handle('browserTask:start', (_event, tabId: string, goal: string) => {
    if (!taskRuntime) throw new Error('浏览器任务运行时未初始化')
    return taskRuntime.startTask({
      tabId: browserIdentifierSchema.parse(tabId),
      goal: browserTaskGoalSchema.parse(goal),
    })
  })

  handle('browserTask:list', () => {
    if (!taskRuntime) return []
    return taskRuntime.listTasks()
  })

  handle('browserTask:get', (_event, taskRunId: string) => {
    if (!taskRuntime) return null
    return taskRuntime.getTask(browserIdentifierSchema.parse(taskRunId))
  })

  handle('browserTask:getActiveForTab', (_event, tabId: string) => {
    if (!taskRuntime) return null
    return taskRuntime.getActiveTaskForTab(browserIdentifierSchema.parse(tabId))
  })

  handle('browserTask:pause', (_event, taskRunId: string) => {
    if (!taskRuntime) throw new Error('浏览器任务运行时未初始化')
    return taskRuntime.pauseTask(browserIdentifierSchema.parse(taskRunId))
  })

  handle('browserTask:resume', (_event, taskRunId: string) => {
    if (!taskRuntime) throw new Error('浏览器任务运行时未初始化')
    return taskRuntime.resumeTask(browserIdentifierSchema.parse(taskRunId))
  })

  handle('browserTask:cancel', (_event, taskRunId: string) => {
    if (!taskRuntime) throw new Error('浏览器任务运行时未初始化')
    return taskRuntime.cancelTask(browserIdentifierSchema.parse(taskRunId))
  })

  handle('browserTask:finish', (_event, taskRunId: string) => {
    if (!taskRuntime) throw new Error('浏览器任务运行时未初始化')
    return taskRuntime.finishTask(browserIdentifierSchema.parse(taskRunId))
  })

  handle('browserTask:listActionLogs', (_event, taskRunId: string) => {
    if (!taskRuntime) return []
    return taskRuntime.listActionLogs(browserIdentifierSchema.parse(taskRunId))
  })

  handle('browserDownload:list', () => {
    if (!downloadStore) return []
    return downloadStore.listDownloads()
  })

  handle('browserDownload:get', (_event, downloadId: string) => {
    if (!downloadStore) return null
    return downloadStore.getDownload(browserIdentifierSchema.parse(downloadId))
  })

  handle('browserDownload:keepToWorkspace', async (_event, downloadId: string) => {
    if (!downloadStore) throw new Error('浏览器下载存储未初始化')
    return downloadStore.keepDownloadToWorkspace(browserIdentifierSchema.parse(downloadId))
  })

  handle('browserDownload:saveAs', async (_event, downloadId: string) => {
    if (!downloadStore) throw new Error('浏览器下载存储未初始化')
    const parsedDownloadId = browserIdentifierSchema.parse(downloadId)
    const record = downloadStore.getDownload(parsedDownloadId)
    if (!record) throw new Error(`下载记录不存在: ${downloadId}`)
    const result = await dialog.showSaveDialog({
      defaultPath: record.suggestedFilename,
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    })
    if (result.canceled || !result.filePath) return null
    return downloadStore.saveDownloadAs(parsedDownloadId, result.filePath)
  })

  handle('browserDownload:discard', async (_event, downloadId: string) => {
    if (!downloadStore) throw new Error('浏览器下载存储未初始化')
    return downloadStore.discardDownload(browserIdentifierSchema.parse(downloadId))
  })

  handle('browserDownload:open', async (_event, downloadId: string) => {
    if (!downloadStore) throw new Error('浏览器下载存储未初始化')
    await downloadStore.openDownload(browserIdentifierSchema.parse(downloadId))
  })

  handle('browserDownload:reveal', (_event, downloadId: string) => {
    if (!downloadStore) throw new Error('浏览器下载存储未初始化')
    downloadStore.revealDownload(browserIdentifierSchema.parse(downloadId))
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
