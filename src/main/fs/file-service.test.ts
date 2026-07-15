import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({ home: '' }))

vi.mock('electron', () => ({
  app: {
    getPath: () => electronMock.home,
  },
}))

import { FileService } from './file-service'

let tempDir = ''

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'deepink-fs-'))
  electronMock.home = tempDir
})

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
})

describe('FileService', () => {
  it('reads markdown as UTF-8 text', async () => {
    const service = new FileService()
    const filePath = join(tempDir, 'README.md')
    await writeFile(filePath, '# DeepInk', 'utf-8')

    await expect(service.readFile(filePath)).resolves.toEqual({
      content: '# DeepInk',
      encoding: 'utf-8',
    })
  })

  it.each(['.3mf', '.stl', '.glb'])('reads model file %s as base64', async (extension) => {
    const service = new FileService()
    const filePath = join(tempDir, `model${extension}`)
    const content = Buffer.from([0x00, 0xff, 0x10, 0x20])
    await mkdir(tempDir, { recursive: true })
    await writeFile(filePath, content)

    await expect(service.readFile(filePath)).resolves.toEqual({
      content: content.toString('base64'),
      encoding: 'base64',
    })
  })
})
