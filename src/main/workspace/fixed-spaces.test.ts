import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const paths = vi.hoisted(() => ({ root: '' }))
vi.mock('electron', () => ({ app: { getPath: () => paths.root } }))
import { WorkspaceStateService } from './workspace-state-service'
import { CompanyWorkspaceService } from '../company-workspace/company-workspace-service'
let service: WorkspaceStateService
let company: CompanyWorkspaceService
beforeEach(async () => {
  paths.root = await realpath(await mkdtemp(join(tmpdir(), 'fixed-spaces-')))
  service = new WorkspaceStateService()
  await service.loadState()
  company = new CompanyWorkspaceService({
    finance: () => null,
    conversations: async () => [],
    publications: () => null,
  })
})
afterEach(async () => {
  await service.flush()
  await company.dispose()
  await rm(paths.root, { recursive: true, force: true })
})
async function original(name = '旧公司'): Promise<string> {
  const path = join(paths.root, name)
  await mkdir(path)
  await service.getSnapshot(path)
  await company.configure(
    { workspacePath: path, workspaceId: (await service.getLocalProjectId(path))! },
    { workspaceRef: { kind: 'local', path }, name, enabled: true, month: '2026-11' },
  )
  await writeFile(join(path, 'personal-note.md'), '原个人内容也留在原目录')
  return path
}
const configure = async (
  target: { workspacePath: string; workspaceId: string },
  name: string,
): Promise<void> => {
  await company.configure(target, {
    workspaceRef: { kind: 'local', path: target.workspacePath },
    name,
    enabled: true,
    month: '2026-11',
  })
}

describe('fixed personal/company spaces preserve original data', () => {
  it('allows explicit ordinary-project shortcuts without initializing or forcing a company type', async () => {
    await service.ensurePersonalSpace()
    const path = join(paths.root, '工程')
    await mkdir(path)
    await service.getSnapshot(path)
    await service.saveWorkspaceSettings({
      workspacePath: path,
      revision: null,
      settings: { version: 1, name: '工程', type: 'electronics' },
    })
    const configureSpy = vi.fn(configure)
    const linked = await service.connectCompanySpace(
      { workspacePath: path, shortcutOnly: true },
      configureSpy,
    )
    expect(linked.company?.requireCompanyData).toBe(false)
    expect(configureSpy).not.toHaveBeenCalled()
    expect(await service.resolveFixedSpace('company')).toBe(path)
    await expect(
      service.connectCompanySpace({ workspacePath: path, shortcutOnly: true }, configureSpy),
    ).resolves.toEqual(linked)
    const restarted = new WorkspaceStateService()
    await restarted.loadState()
    expect(await restarted.resolveFixedSpace('company')).toBe(path)
    expect((await restarted.getWorkspaceSettings(path)).settings.type).toBe('electronics')
    await expect(
      readFile(join(path, '.cclink-studio/company-workspace/company.sqlite')),
    ).rejects.toThrow()
  })

  it('creates nothing before first-use confirmation, then binds only the fixed folder', async () => {
    const unbound = await service.ensurePersonalSpace('', { createDefault: false })
    expect(unbound.personal).toBeNull()
    const described = await service.describeDefaultPersonalSpace()
    expect(described).toEqual({
      path: join(paths.root, 'CCLink Studio', '我的空间'),
      exists: false,
    })
    await expect(readdir(described.path)).rejects.toMatchObject({ code: 'ENOENT' })
    const fixed = await service.initializePersonalSpace()
    expect(fixed.personal).toMatchObject({
      workspacePath: described.path,
      diaryRootConfirmed: true,
    })
    expect((await service.getWorkspaceSettings(described.path)).settings).toMatchObject({
      name: '我的空间',
      type: 'diary',
      diary: { directory: '个人计划' },
    })
    await expect(service.initializePersonalSpace()).rejects.toThrow('已设置')
  })

  it('takes over an existing fixed folder left by an earlier install, refusing other project types', async () => {
    const fixedDir = join(paths.root, 'CCLink Studio', '我的空间')
    await mkdir(join(fixedDir, '个人计划', '2026', '11'), { recursive: true })
    await writeFile(join(fixedDir, '个人计划', '2026', '11', '1119_周四.md'), '旧')
    const fixed = await service.initializePersonalSpace()
    expect(fixed.personal?.workspacePath).toBe(fixedDir)
    expect(await readFile(join(fixedDir, '个人计划', '2026', '11', '1119_周四.md'), 'utf8')).toBe(
      '旧',
    )
  })

  it('drops an old binding to another project folder without touching that folder', async () => {
    const project = join(paths.root, '旧项目')
    await mkdir(project)
    await service.getSnapshot(project)
    await service.saveWorkspaceSettings({
      workspacePath: project,
      revision: null,
      settings: { version: 1, name: '旧项目', type: 'general' },
    })
    const projectId = (await service.getLocalProjectId(project))!
    // An older version bound My Space straight to this project's folder.
    await (
      service as unknown as { commitFixedSpaces: (v: unknown) => Promise<unknown> }
    ).commitFixedSpaces({
      ...service.getFixedSpaces(),
      personal: { workspacePath: project, projectId, diaryRootConfirmed: true },
    })
    const settingsBefore = await readFile(
      join(project, '.cclink-studio/workspace-settings.json'),
      'utf8',
    )
    const fixed = await service.ensurePersonalSpace('', { createDefault: false })
    expect(fixed.personal).toBeNull()
    expect(fixed.importSuggestion).toBe(project)
    expect(await readFile(join(project, '.cclink-studio/workspace-settings.json'), 'utf8')).toBe(
      settingsBefore,
    )
    const bound = await service.initializePersonalSpace()
    expect(bound.personal?.workspacePath).toBe(join(paths.root, 'CCLink Studio', '我的空间'))
    expect(bound.importSuggestion).toBeUndefined()
    expect((await service.getWorkspaceSettings(project)).settings.type).toBe('general')
  })

  it('imports history by copying only, never overwriting or touching the source', async () => {
    await service.initializePersonalSpace()
    const history = join(paths.root, '旧电脑', '000-个人计划')
    await mkdir(join(history, '2026', '11'), { recursive: true })
    await writeFile(join(history, '2026', '11', '1120_周五.md'), '旧周五')
    await writeFile(join(history, '2026', '11', '1121_周六.md'), '旧周六')
    await mkdir(join(history, '2026', '周计划'), { recursive: true })
    await writeFile(join(history, '2026', '周计划', '第47周.md'), '计划')
    await writeFile(join(history, '.DS_Store'), 'x')
    const target = join(paths.root, 'CCLink Studio', '我的空间', '个人计划')
    await mkdir(join(target, '2026', '11'), { recursive: true })
    await writeFile(join(target, '2026', '11', '1121_周六.md'), '我的空间里已有')
    const preview = await service.inspectDiaryImport(join(paths.root, '旧电脑'))
    expect(preview).toMatchObject({
      sourcePath: history,
      diaryCount: 2,
      fileCount: 3,
      skipCount: 1,
      skipped: ['2026/11/1121_周六.md'],
    })
    expect(await service.importDiaryHistory(preview)).toEqual({ copied: 2, skipped: 1 })
    expect(await readFile(join(target, '2026', '11', '1120_周五.md'), 'utf8')).toBe('旧周五')
    expect(await readFile(join(target, '2026', '11', '1121_周六.md'), 'utf8')).toBe(
      '我的空间里已有',
    )
    expect(await readFile(join(history, '2026', '11', '1121_周六.md'), 'utf8')).toBe('旧周六')
    await expect(readFile(join(target, '.DS_Store'))).rejects.toThrow()
    await expect(
      service.inspectDiaryImport(join(paths.root, 'CCLink Studio', '我的空间')),
    ).rejects.toThrow('我的空间以外')
    const empty = join(paths.root, '空目录')
    await mkdir(empty)
    await expect(service.inspectDiaryImport(empty)).rejects.toThrow('没有找到日记')
  })

  it('initializes once, keeps company lazy and survives restart', async () => {
    const [a, b] = await Promise.all([service.ensurePersonalSpace(), service.ensurePersonalSpace()])
    expect(a).toEqual(b)
    expect(a.company).toBeNull()
    await expect(
      readFile(join(paths.root, 'CCLink Studio/我的公司/.cclink-studio/project.json')),
    ).rejects.toThrow()
    const restarted = new WorkspaceStateService()
    await restarted.loadState()
    expect(await restarted.ensurePersonalSpace()).toEqual(a)
  })
  it('probes and binds mixed old company without changing any business or identity bytes', async () => {
    const path = await original()
    const files = [
      '.cclink-studio/project.json',
      '.cclink-studio/company-workspace/company.sqlite',
      'personal-note.md',
    ]
    const before = await Promise.all(files.map((file) => readFile(join(path, file))))
    const personal = await service.ensurePersonalSpace(path)
    expect(personal.personal?.workspacePath).not.toBe(path)
    const candidates = await service.listCompanySpaces()
    expect(candidates).toEqual([
      expect.objectContaining({ workspacePath: path, name: '旧公司', state: 'company' }),
    ])
    const noWrite = vi.fn(configure)
    const connected = await service.connectCompanySpace({ workspacePath: path }, noWrite)
    expect(noWrite).not.toHaveBeenCalled()
    expect(connected.company?.workspacePath).toBe(path)
    expect(await Promise.all(files.map((file) => readFile(join(path, file))))).toEqual(before)
  })
  it('does not guess among companies or treat broken company data as empty', async () => {
    const a = await original('公司甲'),
      b = await original('公司乙')
    await writeFile(join(b, '.cclink-studio/company-workspace/company.sqlite'), 'broken')
    await service.ensurePersonalSpace(b)
    expect(service.getFixedSpaces().company).toBeNull()
    expect(await service.listCompanySpaces()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ workspacePath: a, state: 'company' }),
        expect.objectContaining({ workspacePath: b, state: 'unavailable' }),
      ]),
    )
    await expect(
      service.connectCompanySpace({ workspacePath: b, initializeName: 'replacement' }, configure),
    ).rejects.toThrow()
    expect(await readFile(join(b, '.cclink-studio/company-workspace/company.sqlite'), 'utf8')).toBe(
      'broken',
    )
  })
  it('never turns the My Space folder into the company', async () => {
    const personal = await service.ensurePersonalSpace()
    const path = personal.personal!.workspacePath
    await expect(
      service.connectCompanySpace({ workspacePath: path, initializeName: '新公司' }, configure),
    ).rejects.toThrow('我的空间的目录')
    expect(service.getFixedSpaces()).toEqual(personal)
  })
  it('rejects copied identities, aliases and nested roots without rewriting identity', async () => {
    const fixed = await service.ensurePersonalSpace()
    const path = await original()
    const copy = join(paths.root, 'copy')
    await cp(path, copy, { recursive: true })
    const manifest = await readFile(join(copy, '.cclink-studio/project.json'), 'utf8')
    await expect(service.connectCompanySpace({ workspacePath: copy }, configure)).rejects.toThrow(
      '身份冲突',
    )
    expect(await readFile(join(copy, '.cclink-studio/project.json'), 'utf8')).toBe(manifest)
    const alias = join(paths.root, 'alias')
    await symlink(fixed.personal!.workspacePath, alias)
    await expect(
      service.connectCompanySpace({ workspacePath: alias, initializeName: 'alias' }, configure),
    ).rejects.toThrow('我的空间的目录')
    const nested = join(fixed.personal!.workspacePath, 'nested')
    await mkdir(nested)
    await service.getSnapshot(nested)
    await expect(
      service.connectCompanySpace({ workspacePath: nested, initializeName: 'nested' }, configure),
    ).rejects.toThrow('独立目录')
  })
  it('keeps a missing binding and resolves a relocated original without creating replacement', async () => {
    await service.ensurePersonalSpace()
    const path = await original()
    const fixed = await service.connectCompanySpace({ workspacePath: path }, configure)
    await rename(path, path + '-moved')
    await expect(service.resolveFixedSpace('company')).rejects.toThrow()
    await expect(
      service.connectCompanySpace({ initializeName: 'empty' }, configure),
    ).rejects.toThrow('原目录')
    expect(service.getFixedSpaces()).toEqual(fixed)
    const recovered = await service.connectCompanySpace(
      { workspacePath: path + '-moved' },
      configure,
    )
    expect(recovered.company?.projectId).toBe(fixed.company?.projectId)
    await expect(readFile(join(path, '.cclink-studio/project.json'))).rejects.toThrow()
  })
  it('never reinitializes a bound company whose database is missing', async () => {
    await service.ensurePersonalSpace()
    const path = await original()
    const fixed = await service.connectCompanySpace({ workspacePath: path }, configure)
    const database = join(path, '.cclink-studio/company-workspace/company.sqlite')
    const before = await readFile(database)
    await rename(database, database + '.saved')
    expect(await service.inspectCompanySpace(path)).toMatchObject({ state: 'unavailable' })
    const noWrite = vi.fn(configure)
    await expect(
      service.connectCompanySpace({ workspacePath: path, initializeName: '空公司' }, noWrite),
    ).rejects.toThrow('原公司数据库不可用')
    expect(noWrite).not.toHaveBeenCalled()
    expect(service.getFixedSpaces()).toEqual(fixed)
    await expect(readFile(database)).rejects.toThrow()
    expect(await readFile(database + '.saved')).toEqual(before)
    await rename(database + '.saved', database)
    await expect(service.resolveFixedSpace('company')).resolves.toBe(path)
  })
  it('rolls back bindings after a failed atomic write, and reuses initialized personal data', async () => {
    const fixed = await service.ensurePersonalSpace()
    const path = await original()
    const renameTarget = join(paths.root, 'workspace-state.json')
    await rename(renameTarget, renameTarget + '.saved')
    await mkdir(renameTarget)
    await expect(service.connectCompanySpace({ workspacePath: path }, configure)).rejects.toThrow()
    expect(service.getFixedSpaces()).toEqual(fixed)
    await rm(renameTarget, { recursive: true })
    await rename(renameTarget + '.saved', renameTarget)
    expect(
      (await service.connectCompanySpace({ workspacePath: path }, configure)).personal,
    ).toEqual(fixed.personal)
  })
})
