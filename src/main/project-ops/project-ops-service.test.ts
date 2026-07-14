import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({ home: '' }))

vi.mock('electron', () => ({
  app: {
    getPath: () => electronMock.home,
  },
}))

import { ProjectOpsService } from './project-ops-service'

let tempDir = ''
let workspacePath = ''

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'deepink-project-ops-'))
  electronMock.home = tempDir
  workspacePath = join(tempDir, 'project')
})

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
})

describe('ProjectOpsService', () => {
  it('returns missing accounts config without throwing', async () => {
    const service = new ProjectOpsService()

    const result = await service.getAccounts(workspacePath)

    expect(result.exists).toBe(false)
    expect(result.filePath).toBe(join(workspacePath, 'deepink-accounts.json'))
    expect(result.issues).toEqual([])
  })

  it('creates and reads the accounts template', async () => {
    const service = new ProjectOpsService()

    const created = await service.createAccountsTemplate(workspacePath)
    const loaded = await service.getAccounts(workspacePath)

    expect(created.exists).toBe(true)
    expect(loaded.config?.platforms.map((platform) => platform.id)).toContain('wechat-mp')
  })

  it('reports invalid JSON with a validation issue', async () => {
    const service = new ProjectOpsService()
    await service.createAccountsTemplate(workspacePath)
    await writeFile(join(workspacePath, 'deepink-accounts.json'), '{bad json', 'utf-8')

    const result = await service.getAccounts(workspacePath)

    expect(result.exists).toBe(true)
    expect(result.error).toBe('项目账号配置不是合法 JSON')
    expect(result.issues[0]?.path).toBe('$')
  })

  it('reads the legacy hidden accounts config when the visible config is missing', async () => {
    const service = new ProjectOpsService()
    const legacyPath = join(workspacePath, '.deepink', 'accounts.json')
    await mkdir(join(workspacePath, '.deepink'), { recursive: true })
    await writeFile(
      legacyPath,
      JSON.stringify({
        version: 1,
        platforms: [
          {
            id: 'legacy-platform',
            name: '旧平台',
            url: 'https://example.test',
          },
        ],
      }),
      'utf-8',
    )

    const result = await service.getAccounts(workspacePath)

    expect(result.exists).toBe(true)
    expect(result.filePath).toBe(legacyPath)
    expect(result.config?.platforms[0]?.id).toBe('legacy-platform')
  })

  it('creates a platform copy draft in docs', async () => {
    const service = new ProjectOpsService()
    await service.createAccountsTemplate(workspacePath)

    const result = await service.createCopyDraft(workspacePath, { platformId: 'wechat-mp' })
    const content = await readFile(result.filePath, 'utf-8')

    expect(result.filePath).toBe(join(workspacePath, 'docs', '微信公众号宣发稿.md'))
    expect(result.created).toBe(true)
    expect(content).toContain('平台：微信公众号')
  })

  it('appends publication records to docs/发布记录.md', async () => {
    const service = new ProjectOpsService()

    const result = await service.appendPublicationRecord(workspacePath, {
      platformId: 'zhihu',
      platformName: '知乎',
      account: 'DeepInk',
      contentFile: 'docs/知乎版本.md',
      url: 'https://example.test/post',
      status: 'published',
      notes: '首发',
    })
    const content = await readFile(result.filePath, 'utf-8')

    expect(result.filePath).toBe(join(workspacePath, 'docs', '发布记录.md'))
    expect(content).toContain('知乎')
    expect(content).toContain('https://example.test/post')
  })

  it('rejects workspaces outside allowed roots', async () => {
    const service = new ProjectOpsService()

    await expect(service.getAccounts('/private/outside')).rejects.toThrow('工作空间不在允许范围内')
  })
})
