import type { App } from 'electron'
import { mkdirSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { APP_DISPLAY_NAME, APP_USER_DATA_DIR_NAME } from './app-metadata'

export interface UserDataPathDiagnostics {
  fixedUserDataPath: string
}

let lastUserDataPathDiagnostics: UserDataPathDiagnostics | null = null

export function getUserDataPathDiagnostics(): UserDataPathDiagnostics | null {
  return lastUserDataPathDiagnostics
}

/**
 * 固定本机数据目录，避免 dev/package/appName 差异造成状态分裂。
 *
 * 必须在任何服务读取 app.getPath('userData') 前调用。
 */
export function configureFixedUserDataPath(app: App, testUserDataPath?: string): string {
  const fixedUserDataPath =
    testUserDataPath && isAbsolute(testUserDataPath)
      ? testUserDataPath
      : join(app.getPath('appData'), APP_USER_DATA_DIR_NAME)
  mkdirSync(fixedUserDataPath, { recursive: true })
  lastUserDataPathDiagnostics = { fixedUserDataPath }

  app.setName(APP_DISPLAY_NAME)
  app.setPath('userData', fixedUserDataPath)
  return fixedUserDataPath
}
