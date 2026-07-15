/**
 * update-utils — latest-mac.yml 最小解析 + 语义化版本比较
 *
 * 不引入 js-yaml 依赖，仅提取更新检查需要的 version 与 .dmg 文件名。
 */

/** 从 latest-mac.yml 解析出的更新信息 */
export interface UpdateInfo {
  /** 最新版本号，如 "0.1.2" */
  version: string
  /** latest-mac.yml 里 files[].url 中以 .dmg 结尾的相对文件名 */
  dmgPath: string
}

/**
 * 解析 electron-builder 生成的 latest-mac.yml（节选）：
 *   version: 0.1.2
 *   files:
 *     - url: CCLink-Studio-0.1.2-arm64-mac.zip
 *       ...
 *     - url: CCLink-Studio-0.1.2-arm64.dmg
 *       ...
 */
export function parseLatestMacYml(yml: string): UpdateInfo {
  const versionMatch = yml.match(/^version:\s*(.+)$/m)
  const version = versionMatch ? versionMatch[1].trim() : ''

  // 找到以 .dmg 结尾的 url 行（相对文件名）
  const dmgMatch = yml.match(/url:\s*([^\s]+\.dmg)\b/m)
  const dmgPath = dmgMatch ? dmgMatch[1].trim() : ''

  return { version, dmgPath }
}

/**
 * 语义化版本比较：返回 >0 表示 a 更新，<0 表示 a 更旧，0 表示相等。
 * 忽略 -beta 等预发布后缀，只比 x.y.z 数字段。
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('-')[0].split('.')
  const pb = b.split('-')[0].split('.')
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const na = parseInt(pa[i] ?? '0', 10)
    const nb = parseInt(pb[i] ?? '0', 10)
    if (na !== nb) return na - nb
  }
  return 0
}
