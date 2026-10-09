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
  if (toolName === 'cad_modify_step') {
    return summarizeCadModification(params, workspaceRoot)
  }
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

function summarizeCadModification(
  params: Record<string, unknown>,
  workspaceRoot?: string,
): ToolConfirmationSummaryRow[] {
  const safeEnum = (key: string, allowed: readonly string[]): string => {
    const value = params[key]
    return typeof value === 'string' && allowed.includes(value) ? value : '参数无效'
  }
  const safeNumber = (key: string, suffix = ''): string => {
    const value = params[key]
    return typeof value === 'number' && Number.isFinite(value) ? `${value}${suffix}` : '参数无效'
  }
  const safePath = (key: string): string =>
    typeof params[key] === 'string' ? summarizePath(params[key], workspaceRoot) : '参数无效'
  const sourceHash = params.sourceHash
  const hashSummary =
    typeof sourceHash === 'string' && /^[a-f0-9]{64}$/u.test(sourceHash)
      ? `${sourceHash.slice(0, 12)}…`
      : '参数无效'
  const expected = ['expectedSizeX', 'expectedSizeY', 'expectedSizeZ'].map((key) => safeNumber(key))
  return [
    { label: '源文件', value: safePath('inputPath'), monospace: true },
    { label: '源 SHA-256', value: hashSummary, monospace: true },
    {
      label: '修改方式',
      value:
        safeEnum('operation', ['section-insert']) === 'section-insert'
          ? '截面插入（section-insert）'
          : '参数无效',
    },
    { label: '方向轴', value: safeEnum('axis', ['x', 'y', 'z']).toUpperCase() },
    { label: '移动方向', value: safeEnum('direction', ['positive', 'negative']) },
    { label: '增加距离', value: safeNumber('distanceMm', ' mm') },
    { label: '截面位置', value: safeNumber('splitPlane', ' mm') },
    { label: '固定端', value: safeEnum('fixedSide', ['min', 'max']) },
    { label: '输出文件', value: safePath('outputPath'), monospace: true },
    { label: '预期尺寸', value: `${expected.join(' × ')} mm` },
    {
      label: '核验边界',
      value: '基础核验不等于可制造；源基线 BOP 警告需专业 CAD 复核',
    },
  ]
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
