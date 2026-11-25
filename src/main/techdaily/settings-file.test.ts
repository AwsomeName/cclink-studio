import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyOptions,
  defaultTechDailySettings,
  parseTechDailySettings,
  readTechDailySettings,
  writeTechDailyOptions,
} from './settings-file'

const options = {
  enabled: true,
  search_provider: 'searxng' as const,
  freshness_days: 2,
  keep_undated: false,
  results_per_query: 10,
  daily_call_limit: 60,
}

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'techdaily-settings-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('default settings', () => {
  it('is the Argus word list: 9 domains, 54 queries, taste kept', () => {
    const settings = defaultTechDailySettings()
    expect(settings.domains.map((d) => d.id)).toEqual([
      'model_cap',
      'model_arch',
      'ai_chip',
      'chip',
      'corp',
      'embodied',
      'robot',
      'ar',
      'bioai',
    ])
    expect(
      settings.domains.reduce((n, d) => n + d.queries.zh.length + d.queries.en.length, 0),
    ).toBe(54)
    expect(settings.domains.find((d) => d.id === 'corp')!.match).toContain('英伟达')
    expect(settings.taste?.blacklist_brands).toEqual(['华为', '昇腾', '鸿蒙'])
    expect(settings).toMatchObject({
      enabled: false,
      search_provider: 'deepseek',
      keep_undated: true,
    })
  })

  it('accepts a pasted Argus queries.yaml (no Studio keys)', () => {
    const argus = `freshness_days: 3
domains:
  - id: ar
    name: AR/VR
    queries:
      zh: ["智能眼镜"]
      en: ["VR headset"]
exclude_keywords: ["招聘"]
taste:
  blacklist_brands: []
  preferences: |
    - 只要产品
`
    expect(parseTechDailySettings(argus)).toMatchObject({ enabled: false, daily_call_limit: 80 })
  })

  it('reports the YAML line and schema path', () => {
    expect(() => parseTechDailySettings('domains: [\n')).toThrow(/格式错误/)
    expect(() => parseTechDailySettings('domains: []')).toThrow(/domains/)
    expect(() =>
      parseTechDailySettings(
        'domains:\n  - {id: a, name: A, queries: {zh: []}}\n  - {id: a, name: B, queries: {zh: []}}',
      ),
    ).toThrow(/不能重复/)
  })
})

describe('applyOptions', () => {
  it('changes only the scalar options and keeps comments and unknown keys', () => {
    const text =
      '# 我的注释\nenabled: false\ncustom_key: 7 # 保留\ndomains:\n  - id: a\n    name: A\n    queries: {zh: ["x"], en: []}\n'
    const next = applyOptions(text, options)
    expect(next).toContain('# 我的注释')
    expect(next).toContain('custom_key: 7 # 保留')
    expect(parseTechDailySettings(next)).toMatchObject({ ...options, custom_key: 7 })
  })
})

describe('read/write 科技日报/设置.yaml', () => {
  it('missing → defaults; first save writes the commented default file', async () => {
    const before = await readTechDailySettings(root)
    expect(before.status).toBe('missing')
    expect(before.queryCount).toBe(54)
    const after = await writeTechDailyOptions(root, options, null)
    expect(after.status).toBe('saved')
    expect(after.settings).toMatchObject(options)
    const text = await readFile(join(root, '科技日报/设置.yaml'), 'utf8')
    expect(text).toContain('# 科技日报设置')
    expect(text).toContain('Kimi MiniMax 混元')
  })

  it('refuses a stale revision and an invalid file', async () => {
    const first = await writeTechDailyOptions(root, options, null)
    await writeFile(
      join(root, '科技日报/设置.yaml'),
      (await readFile(join(root, '科技日报/设置.yaml'), 'utf8')) + '\n# 外部修改\n',
    )
    await expect(writeTechDailyOptions(root, options, first.revision)).rejects.toThrow(/已被修改/)
    await writeFile(join(root, '科技日报/设置.yaml'), 'domains: 3\n')
    const invalid = await readTechDailySettings(root)
    expect(invalid.status).toBe('invalid')
    await expect(writeTechDailyOptions(root, options, invalid.revision)).rejects.toThrow(/先修正/)
  })

  it('rejects a symlinked folder', async () => {
    await mkdir(join(root, 'elsewhere'))
    const { symlink } = await import('node:fs/promises')
    await symlink(join(root, 'elsewhere'), join(root, '科技日报'))
    expect((await readTechDailySettings(root)).status).toBe('invalid')
  })
})
