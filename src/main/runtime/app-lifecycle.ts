import type { App } from 'electron'

/** 配置 Chromium/Electron 启动参数；必须在 app.ready 前调用。 */
export function configureAppCommandLine(app: App): void {
  app.commandLine.appendSwitch('remote-debugging-port', '0')
  // 屏蔽自动化检测标记，让内嵌浏览器更像真实 Chrome。
  app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled')
}

/** 获取单实例锁；如果已有实例在运行，当前进程会退出。 */
export function ensureSingleInstance(app: App): boolean {
  const gotTheLock = app.requestSingleInstanceLock()
  if (!gotTheLock) {
    app.quit()
    return false
  }
  return true
}

/** 注册兜底异常日志，避免未捕获异常完全静默。 */
export function registerProcessErrorHandlers(): void {
  process.on('uncaughtException', (error) => {
    console.error('[CCLink Studio] 未捕获异常:', error)
  })

  process.on('unhandledRejection', (reason) => {
    console.error('[CCLink Studio] 未处理的 Promise rejection:', reason)
  })
}
