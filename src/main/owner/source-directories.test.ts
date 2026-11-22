import { mkdtemp, mkdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { OwnerSourceDirectories, findSourceFiles, readSourceExcerpt } from './source-directories'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

describe('OwnerSourceDirectories', () => {
  let dir: string, source: string, outside: string, picked: string | undefined
  let service: OwnerSourceDirectories
  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'owner-source-')))
    source = join(dir, 'notes')
    outside = join(dir, 'secret')
    await mkdir(join(source, 'rtl'), { recursive: true })
    await mkdir(outside)
    await mkdir(join(dir, 'affairs', A), { recursive: true })
    await mkdir(join(dir, 'affairs', B), { recursive: true })
    await writeFile(join(source, 'rtl', 'ibex_if_stage.sv'), 'module ibex_if_stage;\nendmodule\n')
    await writeFile(join(source, 'README.md'), '# 验证笔记\n')
    await writeFile(join(source, '.hidden'), 'x')
    await writeFile(join(outside, 'token.txt'), 'nope')
    picked = source
    service = new OwnerSourceDirectories(
      join(dir, 'registry'),
      { location: async (id) => join(dir, 'affairs', id) },
      async () => picked,
    )
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('grants a picked directory to one affair only and reads inside it', async () => {
    const [grant] = (await service.add(A))!
    expect(grant).toMatchObject({ label: 'notes', path: source })
    expect(grant.error).toBeUndefined()
    expect(await service.entries(A, grant.id, '')).toEqual([
      { name: 'rtl', dir: true },
      { name: 'README.md', dir: false, size: 15 },
    ])
    expect((await service.read(A, grant.id, 'rtl/ibex_if_stage.sv')).content).toMatch(
      /ibex_if_stage/,
    )
    expect(await service.list(B)).toEqual([])
    await expect(service.read(B, grant.id, 'README.md')).rejects.toThrow(/未授权/)
  })

  it('returns null on cancel and deduplicates the same directory', async () => {
    picked = undefined
    expect(await service.add(A)).toBeNull()
    picked = source
    await service.add(A)
    expect(await service.add(A)).toHaveLength(1)
  })

  it('rejects traversal, symlink escapes and binary files', async () => {
    const [grant] = (await service.add(A))!
    await expect(service.read(A, grant.id, '../secret/token.txt')).rejects.toThrow()
    await symlink(outside, join(source, 'escape'))
    await expect(service.entries(A, grant.id, 'escape')).rejects.toThrow(/链接/)
    await expect(service.read(A, grant.id, 'escape/token.txt')).rejects.toThrow(/链接/)
    expect((await service.entries(A, grant.id, '')).map((e) => e.name)).not.toContain('escape')
    await writeFile(join(source, 'blob.bin'), Buffer.from([1, 0, 2]))
    await expect(service.read(A, grant.id, 'blob.bin')).rejects.toThrow(/二进制/)
  })

  it('stops reading after revoke or when the directory is replaced', async () => {
    const [grant] = (await service.add(A))!
    await rename(source, source + '-moved')
    await mkdir(source)
    await writeFile(join(source, 'README.md'), 'impostor')
    expect((await service.list(A))[0].error).toMatch(/替换/)
    await expect(service.read(A, grant.id, 'README.md')).rejects.toThrow(/替换/)
    expect(await service.revoke(A, grant.id)).toEqual([])
    await expect(service.entries(A, grant.id, '')).rejects.toThrow(/未授权/)
  })

  it('refuses a directory that contains the affair directory', async () => {
    picked = dir
    await expect(service.add(A)).rejects.toThrow(/包含本事务目录/)
  })

  it('finds evidence files by any-language terms and reads hashed excerpts with real lines', async () => {
    const [grant] = (await service.add(A))!
    await mkdir(join(source, '设计'), { recursive: true })
    const note = '# 取指\n\n假设：取指使用两级预取缓冲。\n'
    await writeFile(join(source, '设计', '流水线笔记.md'), note)
    const all = await findSourceFiles(service, A, grant.id, [])
    expect(all).toEqual({
      ok: true,
      paths: ['README.md', 'rtl/ibex_if_stage.sv', '设计/流水线笔记.md'],
      truncated: false,
    })
    const hit = await findSourceFiles(service, A, grant.id, ['流水线', 'missing'])
    expect(hit).toMatchObject({ ok: true, paths: ['设计/流水线笔记.md'] })
    const got = await readSourceExcerpt(service, A, grant.id, '设计/流水线笔记.md', '两级预取', 7)
    expect(got).toMatchObject({
      ok: true,
      repo: 'folder:' + grant.id,
      startLine: 1,
      at: 7,
      sha: createHash('sha256').update(note).digest('hex'),
      url:
        'cclink-owner-source://' +
        grant.id +
        '/' +
        encodeURIComponent('设计') +
        '/' +
        encodeURIComponent('流水线笔记.md'),
    })
    expect(got.ok && got.text).toContain('两级预取缓冲')
    // Another affair cannot search or read the same folder, and failures come back as results.
    expect(await findSourceFiles(service, B, grant.id, [])).toMatchObject({ ok: false })
    expect(await readSourceExcerpt(service, A, grant.id, '../secret/token.txt', '')).toMatchObject({
      ok: false,
    })
    await service.revoke(A, grant.id)
    expect(await readSourceExcerpt(service, A, grant.id, 'README.md', '')).toMatchObject({
      ok: false,
    })
  })
})
