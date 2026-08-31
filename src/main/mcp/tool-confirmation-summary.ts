import { basename, isAbsolute, relative, sep } from 'node:path'
import type { ToolConfirmationSummaryRow } from '../../shared/agent-protocol'

const PATH_KEYS = new Set([
  'path',
  'filePath',
  'sourcePath',
  'targetPath',
  'destinationPath',
  'apkPath',
  'localPath',
  'remotePath',
])
const SAFE_IDENTIFIER_KEYS = new Set(['packageName', 'name', 'domain', 'cookieName'])
const SAFE_NUMBER_KEYS = new Set(['x', 'y', 'button', 'clickCount', 'timeout'])
const MAX_ROWS = 6

export function summarizeToolConfirmation(
  toolName: string,
  params: Record<string, unknown>,
  workspaceRoot?: string,
): ToolConfirmationSummaryRow[] {
  const rows: ToolConfirmationSummaryRow[] = []
  for (const [key, value] of Object.entries(params)) {
    if (rows.length >= MAX_ROWS) break
    if (PATH_KEYS.has(key) && typeof value === 'string') {
      rows.push({
        label: labelForKey(key),
        value: summarizePath(value, workspaceRoot),
        monospace: true,
      })
      continue
    }
    if (
      SAFE_IDENTIFIER_KEYS.has(key) &&
      typeof value === 'string' &&
      /^[A-Za-z0-9._+:-]{1,160}$/.test(value)
    ) {
      rows.push({ label: labelForKey(key), value })
      continue
    }
    if (key === 'url' && typeof value === 'string') {
      rows.push({ label: '网址', value: summarizeUrl(value), monospace: true })
      continue
    }
    if (SAFE_NUMBER_KEYS.has(key) && (typeof value === 'number' || typeof value === 'boolean')) {
      rows.push({ label: labelForKey(key), value: String(value) })
    }
  }
  if (/bash|shell|evaluate/i.test(toolName)) {
    rows.unshift({ label: '内容', value: '脚本或命令内容已隐藏' })
  } else if (/click|press|type|fill/i.test(toolName) && rows.length === 0) {
    rows.push({ label: '目标', value: '页面交互参数已隐藏' })
  }
  if (rows.length === 0) {
    rows.push({
      label: '参数',
      value:
        Object.keys(params).length === 0
          ? '无'
          : `${Object.keys(params).length} 个字段（内容已隐藏）`,
    })
  }
  return rows.slice(0, MAX_ROWS)
}

function summarizePath(value: string, workspaceRoot?: string): string {
  if (workspaceRoot && isAbsolute(value)) {
    const relativePath = relative(workspaceRoot, value)
    if (
      relativePath === '' ||
      (relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
    ) {
      return relativePath === '' ? '.' : `.${sep}${relativePath}`
    }
  }
  return `…${sep}${basename(value) || '路径已隐藏'}`
}

function summarizeUrl(value: string): string {
  try {
    const url = new URL(value)
    return `${url.protocol}//${url.host}${url.pathname}`.slice(0, 512)
  } catch {
    return '网址已隐藏'
  }
}

function labelForKey(key: string): string {
  const labels: Record<string, string> = {
    path: '路径',
    filePath: '文件',
    sourcePath: '来源',
    targetPath: '目标',
    destinationPath: '目标',
    apkPath: 'APK',
    localPath: '本机路径',
    remotePath: '设备路径',
    packageName: '应用包名',
    name: '名称',
    domain: '域名',
    cookieName: 'Cookie 名称',
    x: 'X',
    y: 'Y',
  }
  return labels[key] ?? key
}
