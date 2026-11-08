import { mkdir, mkdtemp, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AltiumPreviewJob } from '../altium/altium-preview-parser'

vi.mock('electron', () => ({ shell: {} }))
vi.mock('../altium/altium-preview', () => ({
  renderAltiumPreview: vi.fn(async (job: AltiumPreviewJob) => {
    const { parseAltiumPreview } = await import('../altium/altium-preview-parser')
    return parseAltiumPreview(job)
  }),
}))
import { renderAltiumPreview } from '../altium/altium-preview'
import { FileService } from './file-service'

let root = ''
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'studio-altium-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  vi.clearAllMocks()
})

describe('Altium preview filesystem boundary', () => {
  it('resolves relative Windows references and blocks missing, absolute and escaping links', async () => {
    const workspace = join(root, 'workspace')
    await mkdir(join(workspace, 'sheets'), { recursive: true })
    await writeFile(join(workspace, 'sheets', 'power.SchDoc'), 'placeholder')
    await writeFile(join(root, 'private.SchDoc'), 'private')
    await symlink(join(root, 'private.SchDoc'), join(workspace, 'linked.SchDoc'))
    const references = [
      'sheets\\power.SchDoc',
      'missing.SchDoc',
      '../private.SchDoc',
      'linked.SchDoc',
      '/private.SchDoc',
      'C:\\private.SchDoc',
      'library.SchLib',
    ]
    await writeFile(join(workspace, 'library.SchLib'), 'library')
    const file = join(workspace, 'board.PrjPcb')
    await writeFile(
      file,
      '[Design]\nVersion=1.0\n' +
        references.map((path, index) => `[Document${index + 1}]\nDocumentPath=${path}`).join('\n'),
    )
    const service = new FileService({ getActiveWorkspace: () => workspace })
    const result = await service.renderFile(file)
    expect(result.kind).toBe('altium-project')
    if (result.kind !== 'altium-project') throw new Error('expected project')
    expect(result.documents.map((entry) => entry.status)).toEqual([
      'ready',
      'unavailable',
      'unavailable',
      'unavailable',
      'unavailable',
      'unavailable',
      'unsupported',
    ])
    expect(result.documents.filter((entry) => entry.path)).toHaveLength(1)
    expect(result.documents[0].path).toBe(join(workspace, 'sheets', 'power.SchDoc'))
  })

  it('refuses Altium text reads and all existing text-save paths without modifying source bytes', async () => {
    const service = new FileService({ getActiveWorkspace: () => root })
    for (const name of ['a.SchDoc', 'b.PcbDoc', 'c.PrjPcb']) {
      const path = join(root, name)
      const source = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 255])
      await writeFile(path, source)
      await expect(service.readTextDocument(path)).rejects.toThrow('ALTIUM_READ_ONLY')
      await expect(service.writeFile(path, 'corrupt')).rejects.toThrow('ALTIUM_READ_ONLY')
      await expect(
        service.saveTextDocument({ filePath: path, content: 'corrupt', force: true }),
      ).rejects.toThrow('ALTIUM_READ_ONLY')
      expect(await readFile(path)).toEqual(source)
    }
  })

  it('rejects oversized files before calling the parser', async () => {
    const file = join(root, 'large.PcbDoc')
    await writeFile(file, '')
    await truncate(file, 32 * 1024 * 1024 + 1)
    await expect(
      new FileService({ getActiveWorkspace: () => root }).renderFile(file),
    ).rejects.toThrow('大小限制')
    expect(renderAltiumPreview).not.toHaveBeenCalled()
  })

  it('discards a parse result after the active workspace changes', async () => {
    const first = join(root, 'first')
    const second = join(root, 'second')
    await Promise.all([mkdir(first), mkdir(second)])
    const file = join(first, 'board.PrjPcb')
    await writeFile(file, '[Design]\nVersion=1.0')
    let active = first
    vi.mocked(renderAltiumPreview).mockImplementationOnce(async () => {
      active = second
      return { kind: 'project-references', references: [] }
    })
    await expect(
      new FileService({ getActiveWorkspace: () => active }).renderFile(file),
    ).rejects.toThrow('OUTSIDE_WORKSPACE')
  })
})
