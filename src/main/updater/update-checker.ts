/**
 * update-checker — 轻量更新检查器（不依赖 electron-updater，适配未签名 Mac）
 *
 * 原理：fetch 配置更新源上的 latest-mac.yml → 解析 version → 对比 app.getVersion()。
 * 有新版本则通过 startPeriodicCheck 的回调通知调用方（IPC 层 → 渲染进程状态栏）。
 *
 * 设计取舍：未签名 Mac App 的 electron-updater 全自动更新不稳定，
 * 故采用「自动检查 + 通知 + 一键下载 dmg」的半自动方案。
 */

import { app, net } from 'electron'
import { compareVersions, parseLatestMacYml, type UpdateInfo } from './update-utils'
import type { UpdateCheckResult } from '../../shared/ipc/update'
export type { UpdateCheckResult } from '../../shared/ipc/update'

/**
 * 更新源基础地址（公开 URL，无密钥）。
 * 开源版不内置 CCLink Studio 官方更新源；闭源产品构建由环境注入。
 */
const UPDATE_BASE_URL = normalizeUpdateBaseUrl(
  process.env['CCLINK_STUDIO_UPDATE_BASE_URL'] ?? process.env['DEEPINK_UPDATE_BASE_URL'],
)

/** 检查间隔：6 小时 */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/** 启动后首次检查的延迟：10 秒（给其它初始化让路） */
const FIRST_CHECK_DELAY_MS = 10_000

/**
 * 执行一次更新检查。
 * @returns 检查结果；返回 null 表示网络/解析失败（静默忽略，不打扰用户）
 */
export async function checkForUpdates(): Promise<UpdateCheckResult | null> {
  if (!UPDATE_BASE_URL) return null

  const current = app.getVersion()
  try {
    const ymlText = await fetchText(`${UPDATE_BASE_URL}/latest-mac.yml`)
    const info: UpdateInfo = parseLatestMacYml(ymlText)
    if (!info.version || !info.dmgPath) return null

    const hasUpdate = compareVersions(info.version, current) > 0
    return {
      hasUpdate,
      current,
      latest: info.version,
      downloadUrl: `${UPDATE_BASE_URL}/${info.dmgPath}`,
    }
  } catch (err) {
    console.warn('[UpdateChecker] 检查更新失败（已忽略）:', err)
    return null
  }
}

/**
 * 启动周期性检查：启动后 10s 检查一次，之后每 6 小时一次。
 * 仅当发现新版本时才回调 onResult。
 */
export function startPeriodicCheck(onResult: (r: UpdateCheckResult) => void): void {
  const run = async (): Promise<void> => {
    const r = await checkForUpdates()
    if (r && r.hasUpdate) onResult(r)
  }
  setTimeout(run, FIRST_CHECK_DELAY_MS)
  setInterval(run, CHECK_INTERVAL_MS)
}

/** 用 Electron net 模块抓取文本 */
function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = net.request(url)
    let body = ''
    request.on('response', (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`))
        return
      }
      response.on('data', (chunk: Buffer) => (body += chunk.toString()))
      response.on('end', () => resolve(body))
    })
    request.on('error', reject)
    request.end()
  })
}

function normalizeUpdateBaseUrl(value: string | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  return trimmed.replace(/\/+$/, '')
}
