import * as https from 'https'
import { XMLParser } from 'fast-xml-parser'
import { getHostOs, getAbi, type Abi, type HostOs } from '../../src/main/android/android-platform'

/**
 * Google Android SDK 仓库 manifest 解析
 *
 * 解决两个自下载方案绕不开的问题：
 *  1. emulator 二进制没有稳定的 "latest" 链接，构建号每月变化 —— 必须从
 *     官方 manifest 解析当前 host-os/arch 对应的归档 URL。
 *  2. 系统镜像与 emulator 都受 Android SDK License 约束，license 正文同样
 *     存放在 manifest 里 —— 用它驱动安装前的「同意条款」流程。
 *
 * manifest 拿不到时退回到 pinned 兜底（仅系统镜像，URL 规则较稳定）。
 */

const REPO_BASE = 'https://dl.google.com/android/repository/'
/** 含 platform-tools / emulator / license 的主 manifest */
const MAIN_MANIFEST = `${REPO_BASE}repository2-3.xml`
/** google_apis 系统镜像 manifest */
const SYSIMG_BASE = `${REPO_BASE}sys-img/google_apis/`
const SYSIMG_MANIFEST = `${SYSIMG_BASE}sys-img2-3.xml`

/** 单个可下载归档的解析结果 */
export interface ResolvedArchive {
  /** 绝对下载 URL */
  url: string
  /** 期望文件大小（字节），可能为 0 */
  size: number
  /** 引用的 license id，可能为空 */
  licenseRef: string | null
}

/** 解析出的 license 正文 */
export interface ResolvedLicense {
  id: string
  text: string
}

// ─── 底层工具 ───────────────────────────────────────

/** 抓取文本（带重定向处理） */
function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = (currentUrl: string, redirects = 0): void => {
      if (redirects > 5) {
        reject(new Error('重定向次数过多'))
        return
      }
      https
        .get(currentUrl, { timeout: 30000 }, (res) => {
          const status = res.statusCode ?? 0
          if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
            res.resume()
            request(res.headers.location, redirects + 1)
            return
          }
          if (status !== 200) {
            res.resume()
            reject(new Error(`manifest 请求失败: HTTP ${status}`))
            return
          }
          const chunks: Buffer[] = []
          res.on('data', (c: Buffer) => chunks.push(c))
          res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
        })
        .on('error', reject)
        .on('timeout', function (this: { destroy: () => void }) {
          this.destroy()
          reject(new Error('manifest 请求超时'))
        })
    }
    request(url)
  })
}

/** fast-xml-parser 在单/多子节点时返回对象/数组，统一成数组 */
function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

function createParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true, // 去掉 sdk: / common: 等命名空间前缀
    parseAttributeValue: false,
    trimValues: true,
  })
}

/**
 * 取仓库根节点（不同 manifest 根名不同）
 *
 * - repository2-3.xml → <sdk-repository>
 * - sys-img/.../sys-img2-3.xml → <sdk-sys-img>
 *
 * 去命名空间前缀后名字仍不同，这里做兼容：优先已知名，
 * 否则取第一个含 remotePackage/license 的对象。
 */
function getRepoRoot(parsed: any): any {
  if (!parsed || typeof parsed !== 'object') return null
  const known = parsed['sdk-repository'] ?? parsed['sdk-sys-img'] ?? parsed['sdk-addon']
  if (known) return known
  for (const key of Object.keys(parsed)) {
    const val = parsed[key]
    if (val && typeof val === 'object' && (val.remotePackage || val.license)) return val
  }
  return null
}

/**
 * 从一个 remotePackage 的 archives 中挑选匹配当前 host 的归档
 *
 * 优先精确匹配 host-os + host-arch；archive 未标注 arch 时退化为只匹配 host-os。
 */
function pickArchive(remotePackage: any, baseUrl: string, hostOs: HostOs): ResolvedArchive | null {
  const archives = asArray(remotePackage?.archives?.archive)
  if (archives.length === 0) return null

  const wantArch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'

  const matchesOs = (a: any): boolean => {
    const os = a?.['host-os']
    // 旧条目可能没有 host-os（表示通用），视为匹配
    return os == null || os === hostOs
  }
  const archOf = (a: any): string | null => a?.['host-arch'] ?? null

  const osMatched = archives.filter(matchesOs)
  if (osMatched.length === 0) return null

  // 1) host-arch 精确匹配
  let chosen =
    osMatched.find((a) => archOf(a) === wantArch) ??
    // 2) 没有 host-arch 标注的通用归档
    osMatched.find((a) => archOf(a) == null) ??
    // 3) 兜底取第一个 os 匹配项
    osMatched[0]

  const complete = chosen?.complete
  const rawUrl: string | undefined = complete?.url
  if (!rawUrl) return null

  const url = rawUrl.startsWith('http') ? rawUrl : baseUrl + rawUrl
  const size = parseInt(String(complete?.size ?? '0'), 10) || 0
  const licenseRef: string | null = remotePackage?.['uses-license']?.['@_ref'] ?? null

  return { url, size, licenseRef }
}

/** 提取指定 id 的 license 正文 */
function extractLicense(root: any, licenseId: string | null): ResolvedLicense | null {
  if (!licenseId) return null
  const licenses = asArray(root?.license)
  const lic = licenses.find((l) => l?.['@_id'] === licenseId)
  if (!lic) return null
  // license 节点的文本内容（#text）即条款正文
  const text = typeof lic === 'string' ? lic : (lic['#text'] ?? '')
  return { id: licenseId, text: String(text).trim() }
}

// ─── 对外接口 ───────────────────────────────────────

/**
 * 解析 emulator 归档 + 其引用的 license
 */
export async function resolveEmulator(): Promise<{
  archive: ResolvedArchive
  license: ResolvedLicense | null
}> {
  const xml = await fetchText(MAIN_MANIFEST)
  const root = getRepoRoot(createParser().parse(xml))
  if (!root) throw new Error('无法解析主 manifest')

  const packages = asArray(root.remotePackage)
  const emulatorPkg = packages.find((p) => p?.['@_path'] === 'emulator')
  if (!emulatorPkg) throw new Error('manifest 中未找到 emulator 包')

  const archive = pickArchive(emulatorPkg, REPO_BASE, getHostOs())
  if (!archive) throw new Error(`manifest 中没有适配当前平台的 emulator 归档（${getHostOs()}/${process.arch}）`)

  const license = extractLicense(root, archive.licenseRef)
  return { archive, license }
}

/**
 * 解析指定 API 级别 + 当前 ABI 的 google_apis 系统镜像归档
 */
export async function resolveSystemImage(api: number): Promise<{
  archive: ResolvedArchive
  license: ResolvedLicense | null
}> {
  const abi = getAbi()
  try {
    const xml = await fetchText(SYSIMG_MANIFEST)
    const root = getRepoRoot(createParser().parse(xml))
    if (!root) throw new Error('无法解析系统镜像 manifest')

    const targetPath = `system-images;android-${api};google_apis;${abi}`
    const packages = asArray(root.remotePackage)
    const imgPkg = packages.find((p) => p?.['@_path'] === targetPath)
    if (!imgPkg) throw new Error(`manifest 中未找到系统镜像 ${targetPath}`)

    const archive = pickArchive(imgPkg, SYSIMG_BASE, getHostOs())
    if (!archive) throw new Error('系统镜像没有可用归档')

    const license = extractLicense(root, archive.licenseRef)
    return { archive, license }
  } catch (err) {
    // 兜底：系统镜像 URL 规则相对稳定，manifest 失败时尝试 pinned
    console.warn('[SdkRepository] 系统镜像 manifest 解析失败，使用 pinned 兜底:', err)
    return { archive: pinnedSystemImage(api, abi), license: null }
  }
}

/**
 * 系统镜像 pinned 兜底
 *
 * 注意：revision（_rNN）会随官方更新变化，仅作为 manifest 不可达时的应急。
 */
function pinnedSystemImage(api: number, abi: Abi): ResolvedArchive {
  // 已知较稳定的归档（Android 14 / API 34）
  const pins: Record<string, string> = {
    'arm64-v8a-34': `${SYSIMG_BASE}arm64-v8a-34_r12.zip`,
    'x86_64-34': `${SYSIMG_BASE}x86_64-34_r12.zip`,
  }
  const key = `${abi}-${api}`
  const url = pins[key]
  if (!url) {
    throw new Error(`没有 ${key} 的 pinned 系统镜像，且 manifest 不可达`)
  }
  return { url, size: 0, licenseRef: 'android-sdk-license' }
}
