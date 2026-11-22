import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OwnerSourceFiles, displayPath, type AskFileRead } from './source-files'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const conversation = 'owner-' + A + '-a'

describe('OwnerSourceFiles', () => {
  let home: string, files: OwnerSourceFiles, folders: { path: string; id: string }[]
  const text = '# 译码\n译码器在单个周期内完成。\n'
  beforeEach(async () => {
    home = await realpath(await mkdtemp(join(tmpdir(), 'owner-files-')))
    await mkdir(join(home, 'docs', 'ibex-review'), { recursive: true })
    await mkdir(join(home, 'notes'))
    await mkdir(join(home, '.ssh'))
    await mkdir(join(home, 'affairs', A), { recursive: true })
    await writeFile(join(home, 'docs', 'ibex-review', 'decoder.md'), text)
    await writeFile(join(home, 'notes', 'pipeline.md'), 'p')
    await writeFile(join(home, '.ssh', 'id'), 'secret')
    folders = []
    files = new OwnerSourceFiles(
      join(home, 'registry'),
      { location: async (id) => join(home, 'affairs', id) },
      {
        list: async () =>
          folders.map((f) => ({ id: f.id, label: 'notes', path: f.path, grantedAt: 1 })),
      },
      home,
    )
  })
  afterEach(() => rm(home, { recursive: true, force: true }))

  it('records a skip on timeout and only lets that exact file be granted afterwards', async () => {
    const ask = vi.fn<AskFileRead>(async () => 'timeout')
    const skipped = await files.request(A, conversation, '~/docs/ibex-review/decoder.md', ask)
    expect(skipped).toMatchObject({
      ok: false,
      outcome: 'timeout',
      label: '~/docs/ibex-review/decoder.md',
    })
    expect(ask).toHaveBeenCalledWith({
      conversationId: conversation,
      path: join(home, 'docs', 'ibex-review', 'decoder.md'),
    })
    expect(await files.grantSkipped(A, '~/notes/pipeline.md')).toMatchObject({ ok: false })
    expect(await files.grantSkipped(B, '~/docs/ibex-review/decoder.md')).toMatchObject({
      ok: false,
    })
    const granted = await files.grantSkipped(A, '~/docs/ibex-review/decoder.md')
    expect(granted).toMatchObject({ ok: true, label: '~/docs/ibex-review/decoder.md' })
    const key = granted.ok ? granted.key : ''
    const got = await files.excerpt(A, key.slice('file:'.length), '单个周期', 9)
    expect(got).toMatchObject({
      ok: true,
      repo: key,
      at: 9,
      startLine: 1,
      sha: createHash('sha256').update(text).digest('hex'),
    })
    // Once granted, a later request reads without asking again; other affairs cannot read it.
    const again = vi.fn<AskFileRead>()
    expect(await files.request(A, conversation, '~/docs/ibex-review/decoder.md', again)).toEqual(
      granted,
    )
    expect(again).not.toHaveBeenCalled()
    expect(await files.excerpt(B, key.slice('file:'.length), '')).toMatchObject({ ok: false })
  })

  it('grants on approval and uses an existing folder grant without asking', async () => {
    const approve = vi.fn<AskFileRead>(async () => 'approved')
    expect(
      await files.request(A, conversation, join(home, 'docs/ibex-review/decoder.md'), approve),
    ).toMatchObject({
      ok: true,
    })
    folders.push({ id: '33333333-3333-4333-8333-333333333333', path: join(home, 'notes') })
    const ask = vi.fn<AskFileRead>()
    expect(await files.request(A, conversation, '~/notes/pipeline.md', ask)).toMatchObject({
      ok: true,
      key: 'folder:33333333-3333-4333-8333-333333333333',
      path: 'pipeline.md',
    })
    expect(ask).not.toHaveBeenCalled()
  })

  it('refuses hidden, relative, linked, missing and affair-internal paths without asking', async () => {
    await symlink(join(home, 'docs', 'ibex-review', 'decoder.md'), join(home, 'docs', 'link.md'))
    await writeFile(join(home, 'affairs', A, 'x.md'), 'x')
    const ask = vi.fn<AskFileRead>()
    for (const path of [
      '~/.ssh/id',
      'docs/x.md',
      '~/docs/link.md',
      '~/docs/none.md',
      '~/affairs/' + A + '/x.md',
    ])
      expect(await files.request(A, conversation, path, ask)).toMatchObject({
        ok: false,
        outcome: 'invalid',
      })
    expect(ask).not.toHaveBeenCalled()
    expect(displayPath('/elsewhere/a.md', home)).toBe('/elsewhere/a.md')
  })
})
