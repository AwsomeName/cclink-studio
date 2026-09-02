import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({
  home: '',
  trashItem: vi.fn(async () => {}),
  showItemInFolder: vi.fn(),
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => electronMock.home,
  },
  shell: {
    trashItem: electronMock.trashItem,
    showItemInFolder: electronMock.showItemInFolder,
  },
}))

import { FileService } from './file-service'

let tempDir = ''

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'cclink-studio-fs-'))
  electronMock.home = tempDir
  electronMock.trashItem.mockClear()
  electronMock.showItemInFolder.mockClear()
})

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
})

function createFileService(): FileService {
  return new FileService({ getActiveWorkspace: () => tempDir })
}

describe('FileService', () => {
  it('searches deep workspace paths, skips ignored directories and symlinks, and reports truncation', async () => {
    const workspace = join(tempDir, 'workspace')
    const outside = join(tempDir, 'outside')
    const deep = join(workspace, 'one', 'two', 'three', 'four', 'five')
    await Promise.all([mkdir(deep, { recursive: true }), mkdir(outside)])
    await Promise.all([
      writeFile(join(deep, 'deep-canary.txt'), 'deep'),
      mkdir(join(workspace, 'node_modules')),
      writeFile(join(outside, 'outside-canary.txt'), 'outside'),
    ])
    await writeFile(join(workspace, 'node_modules', 'ignored-canary.txt'), 'ignored')
    await symlink(outside, join(workspace, 'linked-outside'))
    const service = new FileService({ getActiveWorkspace: () => workspace })

    const deepResult = await service.searchWorkspace({
      workspaceKey: workspace,
      generation: 3,
      requestId: '4eab7167-728c-4a62-b55a-70b7eab0640d',
      query: 'canary',
    })
    expect(deepResult.results.map((entry) => entry.name)).toEqual(['deep-canary.txt'])
    expect(deepResult).toMatchObject({ generation: 3, truncated: false })

    await Promise.all([
      writeFile(join(workspace, 'canary-a.txt'), 'a'),
      writeFile(join(workspace, 'canary-b.txt'), 'b'),
    ])
    const limited = await service.searchWorkspace({
      workspaceKey: workspace,
      generation: 4,
      requestId: '0d91f44f-24f4-45f2-833f-0a729caf3465',
      query: 'canary',
      maxResults: 1,
    })
    expect(limited.results).toHaveLength(1)
    expect(limited.truncated).toBe(true)
  })

  it('rejects a search bound to another or switched workspace', async () => {
    const workspaceA = join(tempDir, 'workspace-a')
    const workspaceB = join(tempDir, 'workspace-b')
    await Promise.all([mkdir(workspaceA), mkdir(workspaceB)])
    let activeWorkspace = workspaceA
    const service = new FileService({ getActiveWorkspace: () => activeWorkspace })

    await expect(
      service.searchWorkspace({
        workspaceKey: workspaceB,
        generation: 1,
        requestId: 'fab51b8d-9ab7-43bd-8ddf-1836f7aa4b68',
        query: 'x',
      }),
    ).rejects.toThrow('STALE_WORKSPACE')
    activeWorkspace = workspaceB
    await expect(
      service.searchWorkspace({
        workspaceKey: workspaceA,
        generation: 1,
        requestId: '3475c868-9078-423d-98e6-e4b614993012',
        query: 'x',
      }),
    ).rejects.toThrow('STALE_WORKSPACE')
  })

  it('persists relocation intent before disk changes and recovers it after service restart', async () => {
    const workspace = join(tempDir, 'workspace')
    const journalPath = join(tempDir, 'user-data', 'relocations.json')
    await mkdir(workspace)
    const sourcePath = join(workspace, 'old.md')
    const targetPath = join(workspace, 'new.md')
    await writeFile(sourcePath, 'draft')
    const input = {
      operationId: 'file-relocation-100-1',
      workspacePath: workspace,
      moves: [{ sourcePath, targetPath }],
    }
    const first = new FileService({
      getActiveWorkspace: () => workspace,
      relocationJournalPath: journalPath,
    })
    await first.beginFileRelocation(input)
    await rename(sourcePath, targetPath)

    const restarted = new FileService({
      getActiveWorkspace: () => workspace,
      relocationJournalPath: journalPath,
    })
    await expect(restarted.listPendingFileRelocations(workspace)).resolves.toMatchObject([
      { operationId: input.operationId, state: 'disk-committed', moves: input.moves },
    ])
    await restarted.removeFileRelocation(input.operationId)
    await expect(restarted.listPendingFileRelocations(workspace)).resolves.toEqual([])
  })

  it('enforces the active workspace for existing and not-yet-created paths', async () => {
    const workspaceA = join(tempDir, 'workspace-a')
    const workspaceB = join(tempDir, 'workspace-b')
    await Promise.all([mkdir(workspaceA), mkdir(workspaceB)])
    const fileA = join(workspaceA, 'a.txt')
    const fileB = join(workspaceB, 'b.txt')
    await Promise.all([writeFile(fileA, 'a'), writeFile(fileB, 'b')])
    const service = new FileService({ getActiveWorkspace: () => workspaceA })

    await expect(service.readFile(fileA)).resolves.toMatchObject({ content: 'a' })
    await expect(service.readFile(fileB)).rejects.toThrow('OUTSIDE_WORKSPACE')
    await expect(service.writeFile(join(workspaceB, 'new.txt'), 'escape')).rejects.toThrow(
      'OUTSIDE_WORKSPACE',
    )
  })

  it('rejects symlink escapes and final-component symlinks', async () => {
    const workspace = join(tempDir, 'workspace')
    const outside = join(tempDir, 'outside')
    await Promise.all([mkdir(workspace), mkdir(outside)])
    const outsideFile = join(outside, 'secret.txt')
    const insideFile = join(workspace, 'inside.txt')
    await Promise.all([writeFile(outsideFile, 'secret'), writeFile(insideFile, 'inside')])
    const outsideLink = join(workspace, 'outside-link.txt')
    const insideLink = join(workspace, 'inside-link.txt')
    const outsideDirectoryLink = join(workspace, 'outside-directory')
    await Promise.all([
      symlink(outsideFile, outsideLink),
      symlink(insideFile, insideLink),
      symlink(outside, outsideDirectoryLink),
    ])
    const service = new FileService({ getActiveWorkspace: () => workspace })

    await expect(service.readFile(outsideLink)).rejects.toThrow('OUTSIDE_WORKSPACE')
    await expect(
      service.writeFile(join(outsideDirectoryLink, 'new.txt'), 'escape'),
    ).rejects.toThrow('OUTSIDE_WORKSPACE')
    await expect(service.readFile(insideLink)).rejects.toThrow()
  })

  it('binds short-lived picker capabilities to one renderer and exact path', async () => {
    const workspace = join(tempDir, 'workspace')
    const outside = join(tempDir, 'outside')
    await Promise.all([mkdir(workspace), mkdir(outside)])
    const selected = join(outside, 'selected.txt')
    const sibling = join(outside, 'sibling.txt')
    await Promise.all([writeFile(selected, 'selected'), writeFile(sibling, 'sibling')])
    let now = 1_000
    const service = new FileService({ getActiveWorkspace: () => workspace, now: () => now })
    service.registerPickerSelection(7, [selected], 'file-read')

    await expect(
      service.withAccess({ rendererId: 7 }, () => service.readFile(selected)),
    ).resolves.toMatchObject({ content: 'selected' })
    await expect(
      service.withAccess({ rendererId: 7 }, () => service.writeFile(selected, 'changed')),
    ).rejects.toThrow('OUTSIDE_WORKSPACE')
    await expect(
      service.withAccess({ rendererId: 8 }, () => service.readFile(selected)),
    ).rejects.toThrow('OUTSIDE_WORKSPACE')
    await expect(
      service.withAccess({ rendererId: 7 }, () => service.readFile(sibling)),
    ).rejects.toThrow('OUTSIDE_WORKSPACE')

    service.registerPickerSelection(7, [selected], 'file-write')
    await expect(
      service.withAccess({ rendererId: 7 }, () => service.writeFile(selected, 'changed')),
    ).resolves.toBeUndefined()
    await expect(readFile(selected, 'utf-8')).resolves.toBe('changed')

    now += 2 * 60 * 1000 + 1
    await expect(
      service.withAccess({ rendererId: 7 }, () => service.readFile(selected)),
    ).rejects.toThrow('OUTSIDE_WORKSPACE')
  })

  it('keeps a Run bound to its startup workspace after the visible workspace switches', async () => {
    const workspaceA = join(tempDir, 'workspace-a')
    const workspaceB = join(tempDir, 'workspace-b')
    await Promise.all([mkdir(workspaceA), mkdir(workspaceB)])
    const fileA = join(workspaceA, 'a.txt')
    const fileB = join(workspaceB, 'b.txt')
    await Promise.all([writeFile(fileA, 'a'), writeFile(fileB, 'b')])
    let activeWorkspace = workspaceA
    const service = new FileService({ getActiveWorkspace: () => activeWorkspace })

    await service.withAccess(
      {
        trustedWorkspace: {
          kind: 'local',
          rootPath: workspaceA,
        },
      },
      async () => {
        activeWorkspace = workspaceB
        await expect(service.readFile(fileA)).resolves.toMatchObject({ content: 'a' })
        await expect(service.readFile(fileB)).rejects.toThrow('OUTSIDE_WORKSPACE')
        await expect(service.rename(fileA, join(workspaceB, 'moved.txt'))).rejects.toThrow(
          'OUTSIDE_WORKSPACE',
        )
      },
    )
  })

  it('requires a picker workspace capability before activation', async () => {
    const workspace = join(tempDir, 'selected-workspace')
    await mkdir(workspace)
    const filePath = join(workspace, 'README.md')
    await writeFile(filePath, '# Selected')
    const service = new FileService({ getActiveWorkspace: () => null })

    expect(service.canActivateWorkspace(7, workspace)).toBe(false)
    service.registerPickerSelection(7, [workspace], 'workspace')
    expect(service.canActivateWorkspace(7, workspace)).toBe(true)
    const nestedWorkspace = join(workspace, 'nested')
    await mkdir(nestedWorkspace)
    expect(service.canActivateWorkspace(7, nestedWorkspace)).toBe(true)
    expect(service.canActivateWorkspace(8, workspace)).toBe(false)
    await expect(
      service.withAccess({ rendererId: 7 }, () => service.readDir(workspace)),
    ).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ name: 'README.md' })]))
    await expect(
      service.withAccess({ rendererId: 7 }, () => service.readFile(filePath)),
    ).rejects.toThrow('OUTSIDE_WORKSPACE')
    await expect(
      service.withAccess({ rendererId: 7 }, () => service.writeFile(filePath, 'changed')),
    ).rejects.toThrow('OUTSIDE_WORKSPACE')
    expect(service.consumeWorkspaceActivation(7, workspace)).toBe(true)
    expect(service.consumeWorkspaceActivation(7, workspace)).toBe(true)
  })

  it('reactivates a local project after switching away and its picker grant expires', async () => {
    const workspace = join(tempDir, 'selected-workspace')
    await mkdir(workspace)
    let now = 1_000
    let activeWorkspace: string | null = null
    const service = new FileService({ getActiveWorkspace: () => activeWorkspace, now: () => now })

    service.registerPickerSelection(7, [workspace], 'workspace')
    expect(service.consumeWorkspaceActivation(7, workspace)).toBe(true)
    activeWorkspace = workspace

    // Switching to a remote/global workspace clears the active local root. The
    // already-open project must not fall back to the expiring picker grant.
    activeWorkspace = null

    now += 10 * 60 * 1000
    expect(service.canActivateWorkspace(7, workspace)).toBe(true)
    expect(service.consumeWorkspaceActivation(7, workspace)).toBe(true)
    expect(service.canActivateWorkspace(8, workspace)).toBe(false)

    service.releaseRendererCapabilities(7)
    expect(service.canActivateWorkspace(7, workspace)).toBe(false)
  })

  it('does not keep an unused picker project grant after its expiry', async () => {
    const workspace = join(tempDir, 'unopened-workspace')
    await mkdir(workspace)
    let now = 1_000
    const service = new FileService({ getActiveWorkspace: () => null, now: () => now })

    service.registerPickerSelection(7, [workspace], 'workspace')
    now += 10 * 60 * 1000

    expect(service.canActivateWorkspace(7, workspace)).toBe(false)
    expect(service.consumeWorkspaceActivation(7, workspace)).toBe(false)
  })

  it('creates files exclusively without truncating an existing target', async () => {
    const service = createFileService()
    const nestedPath = join(tempDir, 'notes', 'new.md')

    await service.createFile(nestedPath)
    await expect(readFile(nestedPath, 'utf-8')).resolves.toBe('')
    await writeFile(nestedPath, '# Existing content', 'utf-8')

    await expect(service.createFile(nestedPath)).rejects.toThrow('EEXIST')
    await expect(readFile(nestedPath, 'utf-8')).resolves.toBe('# Existing content')
  })

  it('moves files without overwriting an existing target', async () => {
    const service = createFileService()
    const sourceDir = join(tempDir, 'source')
    const targetDir = join(tempDir, 'target')
    await mkdir(sourceDir)
    await mkdir(targetDir)
    const sourcePath = join(sourceDir, 'note.md')
    const targetPath = join(targetDir, 'note.md')
    await writeFile(sourcePath, 'source', 'utf-8')

    await service.move(sourcePath, targetPath)

    await expect(readFile(targetPath, 'utf-8')).resolves.toBe('source')
    await writeFile(sourcePath, 'new source', 'utf-8')
    await expect(service.move(sourcePath, targetPath)).rejects.toThrow('EEXIST')
    await expect(readFile(targetPath, 'utf-8')).resolves.toBe('source')
    await expect(readFile(sourcePath, 'utf-8')).resolves.toBe('new source')
  })

  it('renames files without overwriting an existing target', async () => {
    const service = createFileService()
    const sourcePath = join(tempDir, 'source.txt')
    const targetPath = join(tempDir, 'target.txt')
    await writeFile(sourcePath, 'source', 'utf-8')
    await writeFile(targetPath, 'target', 'utf-8')

    await expect(service.rename(sourcePath, targetPath)).rejects.toThrow('EEXIST')
    await expect(readFile(sourcePath, 'utf-8')).resolves.toBe('source')
    await expect(readFile(targetPath, 'utf-8')).resolves.toBe('target')
  })

  it('copies files and directories without overwriting existing entries', async () => {
    const service = createFileService()
    const sourceFile = join(tempDir, 'note.txt')
    const sourceDir = join(tempDir, '资料')
    const targetDir = join(tempDir, 'archive')
    await writeFile(sourceFile, 'source', 'utf-8')
    await mkdir(sourceDir)
    await writeFile(join(sourceDir, 'nested.txt'), 'nested', 'utf-8')
    await mkdir(targetDir)

    const firstFileCopy = await service.copyEntry({
      sourceWorkspacePath: tempDir,
      sourcePath: sourceFile,
      targetWorkspacePath: tempDir,
      targetDirectory: tempDir,
    })
    const secondFileCopy = await service.copyEntry({
      sourceWorkspacePath: tempDir,
      sourcePath: sourceFile,
      targetWorkspacePath: tempDir,
      targetDirectory: tempDir,
    })
    const directoryCopy = await service.copyEntry({
      sourceWorkspacePath: tempDir,
      sourcePath: sourceDir,
      targetWorkspacePath: tempDir,
      targetDirectory: targetDir,
    })

    expect(firstFileCopy.destinationPath).toBe(join(tempDir, 'note 副本.txt'))
    expect(secondFileCopy.destinationPath).toBe(join(tempDir, 'note 副本 2.txt'))
    await expect(readFile(firstFileCopy.destinationPath, 'utf-8')).resolves.toBe('source')
    await expect(
      readFile(join(directoryCopy.destinationPath, 'nested.txt'), 'utf-8'),
    ).resolves.toBe('nested')
  })

  it('rejects copying a directory into itself or a descendant', async () => {
    const service = createFileService()
    const sourceDir = join(tempDir, 'docs')
    const childDir = join(sourceDir, 'archive')
    await mkdir(childDir, { recursive: true })

    await expect(
      service.copyEntry({
        sourceWorkspacePath: tempDir,
        sourcePath: sourceDir,
        targetWorkspacePath: tempDir,
        targetDirectory: childDir,
      }),
    ).rejects.toThrow('不能复制到自身或其子目录')
  })

  it('copies Markdown with its visible asset directory as an independent document', async () => {
    const service = createFileService()
    const sourcePath = join(tempDir, 'notes.md')
    const imagePath = join(tempDir, 'diagram.png')
    await writeFile(sourcePath, '# Notes\n', 'utf-8')
    await writeFile(imagePath, Buffer.from([1, 2, 3]))
    const asset = await service.importDocumentAsset(sourcePath, imagePath)
    await service.saveTextDocument({
      filePath: sourcePath,
      content: `![diagram](${asset.relativePath})\n`,
      force: true,
    })

    const result = await service.copyEntry({
      sourceWorkspacePath: tempDir,
      sourcePath,
      targetWorkspacePath: tempDir,
      targetDirectory: tempDir,
    })

    expect(result.destinationPath).toBe(join(tempDir, 'notes 副本.md'))
    const copiedContent = await readFile(result.destinationPath, 'utf-8')
    const copiedImageReference = copiedContent.match(/!\[diagram\]\(([^)]+)\)/)?.[1]
    expect(copiedImageReference).toBeDefined()
    expect(decodeURI(copiedImageReference!)).toBe('notes 副本.assets/diagram.png')
    await expect(readFile(join(tempDir, 'notes 副本.assets', 'diagram.png'))).resolves.toEqual(
      Buffer.from([1, 2, 3]),
    )
  })

  it('avoids an existing Markdown companion asset directory when choosing a copy name', async () => {
    const service = createFileService()
    const sourcePath = join(tempDir, 'notes.md')
    const imagePath = join(tempDir, 'diagram.png')
    const occupiedAssetDir = join(tempDir, 'notes 副本.assets')
    await writeFile(sourcePath, '# Notes\n', 'utf-8')
    await writeFile(imagePath, Buffer.from([1, 2, 3]))
    const asset = await service.importDocumentAsset(sourcePath, imagePath)
    await service.saveTextDocument({
      filePath: sourcePath,
      content: `![diagram](${asset.relativePath})\n`,
      force: true,
    })
    await mkdir(occupiedAssetDir)
    await writeFile(join(occupiedAssetDir, 'keep.txt'), 'existing', 'utf-8')

    const result = await service.copyEntry({
      sourceWorkspacePath: tempDir,
      sourcePath,
      targetWorkspacePath: tempDir,
      targetDirectory: tempDir,
    })

    expect(result.destinationPath).toBe(join(tempDir, 'notes 副本 2.md'))
    expect(await readFile(result.destinationPath, 'utf-8')).toContain(
      'notes%20%E5%89%AF%E6%9C%AC%202.assets/diagram.png',
    )
    await expect(readFile(join(occupiedAssetDir, 'keep.txt'), 'utf-8')).resolves.toBe('existing')
    await expect(readFile(join(tempDir, 'notes 副本 2.assets', 'diagram.png'))).resolves.toEqual(
      Buffer.from([1, 2, 3]),
    )
  })

  it('reads markdown as UTF-8 text', async () => {
    const service = createFileService()
    const filePath = join(tempDir, 'README.md')
    await writeFile(filePath, '# CCLink Studio', 'utf-8')

    await expect(service.readFile(filePath)).resolves.toEqual({
      content: '# CCLink Studio',
      encoding: 'utf-8',
    })
  })

  it('reads text documents with stable version fingerprints', async () => {
    const service = createFileService()
    const filePath = join(tempDir, 'README.md')
    await writeFile(filePath, '# CCLink Studio', 'utf-8')

    const first = await service.readTextDocument(filePath)
    const second = await service.readTextDocument(filePath)

    expect(first).toMatchObject({
      path: filePath,
      content: '# CCLink Studio',
      size: Buffer.byteLength('# CCLink Studio'),
    })
    expect(first.hash).toHaveLength(64)
    expect(second.hash).toBe(first.hash)
  })

  it('atomically saves text documents and reports external conflicts', async () => {
    const service = createFileService()
    const filePath = join(tempDir, 'README.md')
    await writeFile(filePath, 'version one', 'utf-8')
    const opened = await service.readTextDocument(filePath)

    await writeFile(filePath, 'external edit', 'utf-8')
    await expect(
      service.saveTextDocument({
        filePath,
        content: 'studio edit',
        expectedHash: opened.hash,
      }),
    ).resolves.toMatchObject({
      status: 'conflict',
      current: { content: 'external edit' },
    })
    await expect(readFile(filePath, 'utf-8')).resolves.toBe('external edit')

    await expect(
      service.saveTextDocument({
        filePath,
        content: 'studio edit',
        expectedHash: opened.hash,
        force: true,
      }),
    ).resolves.toMatchObject({
      status: 'saved',
      snapshot: { content: 'studio edit' },
    })
    await expect(readFile(filePath, 'utf-8')).resolves.toBe('studio edit')
  })

  it('copies and writes images into a non-overwriting document asset directory', async () => {
    const service = createFileService()
    const documentPath = join(tempDir, 'notes.md')
    const sourcePath = join(tempDir, 'diagram.png')
    await writeFile(documentPath, '# Notes', 'utf-8')
    await writeFile(sourcePath, Buffer.from([1, 2, 3]))

    const imported = await service.importDocumentAsset(documentPath, sourcePath)
    const pasted = await service.saveDocumentAsset({
      documentPath,
      fileName: 'diagram.png',
      mimeType: 'image/png',
      content: Buffer.from([4, 5, 6]).toString('base64'),
      encoding: 'base64',
    })

    expect(imported.relativePath).toBe('notes.assets/diagram.png')
    expect(pasted.relativePath).toBe('notes.assets/diagram-1.png')
    await expect(readFile(imported.path)).resolves.toEqual(Buffer.from([1, 2, 3]))
    await expect(readFile(pasted.path)).resolves.toEqual(Buffer.from([4, 5, 6]))
    await expect(stat(join(tempDir, 'notes.assets', 'manifest.json'))).resolves.toBeDefined()
  })

  it('inserts generated Markdown illustrations with version and anchor protection', async () => {
    const service = createFileService()
    const documentPath = join(tempDir, 'article.md')
    await writeFile(documentPath, '# Article\n\nFirst paragraph.\n\n## Details\n\nBody.\n', 'utf-8')
    const snapshot = await service.preflightMarkdownIllustrations({
      documentPath,
      illustrations: [
        { anchorText: '# Article', placement: 'after' },
        { anchorText: '## Details', placement: 'after' },
      ],
    })

    const result = await service.applyMarkdownIllustrations({
      documentPath,
      expectedHash: snapshot.hash,
      illustrations: [
        {
          fileName: 'cover',
          mimeType: 'image/png',
          content: Buffer.from([1, 2, 3]),
          alt: 'Cover',
          anchorText: '# Article',
          placement: 'after',
        },
        {
          fileName: 'details',
          mimeType: 'image/webp',
          content: Buffer.from([4, 5, 6]),
          alt: 'Details',
          anchorText: '## Details',
          placement: 'after',
        },
      ],
    })

    expect(result.assets.map((asset) => asset.relativePath)).toEqual([
      'article.assets/cover.png',
      'article.assets/details.webp',
    ])
    const content = await readFile(documentPath, 'utf-8')
    expect(content).toContain('![Cover](<article.assets/cover.png>)')
    expect(content).toContain('![Details](<article.assets/details.webp>)')
    expect(content).toContain('<!-- cclink-document:')
  })

  it('rejects stale or ambiguous Markdown illustration anchors before writing assets', async () => {
    const service = createFileService()
    const documentPath = join(tempDir, 'article.md')
    await writeFile(documentPath, 'Repeated\n\nRepeated\n', 'utf-8')

    await expect(
      service.preflightMarkdownIllustrations({
        documentPath,
        illustrations: [{ anchorText: 'Repeated', placement: 'after' }],
      }),
    ).rejects.toThrow('锚点不唯一')

    const snapshot = await service.readTextDocument(documentPath)
    await writeFile(documentPath, 'Changed\n', 'utf-8')
    await expect(
      service.applyMarkdownIllustrations({
        documentPath,
        expectedHash: snapshot.hash,
        illustrations: [
          {
            fileName: 'image.png',
            mimeType: 'image/png',
            content: Buffer.from([1]),
            alt: 'Image',
            placement: 'end',
          },
        ],
      }),
    ).rejects.toThrow('文档已发生变化')
    await expect(stat(join(tempDir, 'article.assets'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('writes a controlled declaration and migrates legacy hidden Markdown assets safely', async () => {
    const service = createFileService()
    const documentPath = join(tempDir, 'notes.md')
    const legacyDir = join(tempDir, '.assets', 'notes')
    await mkdir(legacyDir, { recursive: true })
    await writeFile(join(legacyDir, 'old.png'), Buffer.from([1, 2, 3]))
    await writeFile(documentPath, '![old](.assets/notes/old.png)\n', 'utf-8')

    const saved = await service.saveTextDocument({
      filePath: documentPath,
      content: '![old](.assets/notes/old.png)\n',
      force: true,
    })

    expect(saved.status).toBe('saved')
    const content = await readFile(documentPath, 'utf-8')
    expect(content).toContain('<!-- cclink-document:')
    expect(content).toContain('![old](notes.assets/old.png)')
    await expect(readFile(join(tempDir, 'notes.assets', 'old.png'))).resolves.toEqual(
      Buffer.from([1, 2, 3]),
    )
    await expect(stat(legacyDir)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('inspects missing, modified, and orphan Markdown resources', async () => {
    const service = createFileService()
    const documentPath = join(tempDir, 'notes.md')
    const sourcePath = join(tempDir, 'diagram.png')
    await writeFile(documentPath, '# Notes\n', 'utf-8')
    await writeFile(sourcePath, Buffer.from([1, 2, 3]))
    const asset = await service.importDocumentAsset(documentPath, sourcePath)
    await service.saveTextDocument({
      filePath: documentPath,
      content: `![diagram](${asset.relativePath})\n![missing](notes.assets/missing.png)\n`,
      force: true,
    })
    await writeFile(asset.path, Buffer.from([9, 9, 9]))
    await writeFile(join(tempDir, 'notes.assets', 'orphan.png'), Buffer.from([4]))

    const inspection = await service.inspectMarkdownDocument(documentPath)

    expect(inspection.manifestStatus).toBe('current')
    expect(inspection.missingAssets).toEqual(['notes.assets/missing.png'])
    expect(inspection.modifiedAssets).toEqual(['diagram.png'])
    expect(inspection.orphanAssets).toEqual(['orphan.png'])
  })

  it('saves a Markdown resource group under a new visible name', async () => {
    const service = createFileService()
    const sourcePath = join(tempDir, 'notes.md')
    const targetPath = join(tempDir, 'archive', 'renamed.md')
    const imagePath = join(tempDir, 'diagram.png')
    await writeFile(sourcePath, '# Notes\n', 'utf-8')
    await writeFile(imagePath, Buffer.from([1, 2, 3]))
    const asset = await service.importDocumentAsset(sourcePath, imagePath)

    const result = await service.saveMarkdownDocumentAs({
      sourcePath,
      targetPath,
      content: `![diagram](${asset.relativePath})\n`,
    })

    expect(result.copiedAssets).toBe(1)
    expect(await readFile(targetPath, 'utf-8')).toContain('renamed.assets/diagram.png')
    await expect(
      readFile(join(tempDir, 'archive', 'renamed.assets', 'diagram.png')),
    ).resolves.toEqual(Buffer.from([1, 2, 3]))
  })

  it('merges legacy and visible assets before Save As without overwriting collisions', async () => {
    const service = createFileService()
    const sourcePath = join(tempDir, 'notes.md')
    const targetPath = join(tempDir, 'copy.md')
    const legacyDir = join(tempDir, '.assets', 'notes')
    const imagePath = join(tempDir, 'diagram.png')
    await mkdir(legacyDir, { recursive: true })
    await writeFile(sourcePath, '# Notes\n', 'utf-8')
    await writeFile(join(legacyDir, 'diagram.png'), Buffer.from([1]))
    await writeFile(imagePath, Buffer.from([2]))
    const visibleAsset = await service.importDocumentAsset(sourcePath, imagePath)

    const result = await service.saveMarkdownDocumentAs({
      sourcePath,
      targetPath,
      content: [
        '![legacy](.assets/notes/diagram.png)',
        `![visible](${visibleAsset.relativePath})`,
      ].join('\n'),
    })

    expect(result.copiedAssets).toBe(2)
    const targetContent = await readFile(targetPath, 'utf-8')
    expect(targetContent).toContain('![legacy](copy.assets/diagram-1.png)')
    expect(targetContent).toContain('![visible](copy.assets/diagram.png)')
    await expect(readFile(join(tempDir, 'copy.assets', 'diagram.png'))).resolves.toEqual(
      Buffer.from([2]),
    )
    await expect(readFile(join(tempDir, 'copy.assets', 'diagram-1.png'))).resolves.toEqual(
      Buffer.from([1]),
    )
  })

  it('relocates a Markdown file and its visible resource directory together', async () => {
    const service = createFileService()
    const sourcePath = join(tempDir, 'notes.md')
    const targetPath = join(tempDir, 'renamed.md')
    const imagePath = join(tempDir, 'diagram.png')
    await writeFile(sourcePath, '# Notes\n', 'utf-8')
    await writeFile(imagePath, Buffer.from([1, 2, 3]))
    const asset = await service.importDocumentAsset(sourcePath, imagePath)
    await service.saveTextDocument({
      filePath: sourcePath,
      content: `![diagram](${asset.relativePath})\n`,
      force: true,
    })

    const result = await service.relocateMarkdownDocument({ sourcePath, targetPath })

    expect(result.newAssetDir).toBe(join(tempDir, 'renamed.assets'))
    expect(await readFile(targetPath, 'utf-8')).toContain('renamed.assets/diagram.png')
    await expect(stat(sourcePath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(tempDir, 'renamed.assets', 'diagram.png'))).resolves.toEqual(
      Buffer.from([1, 2, 3]),
    )
  })

  it('relocates encoded Chinese Markdown asset references', async () => {
    const service = createFileService()
    const sourcePath = join(tempDir, '旧文档.md')
    const targetPath = join(tempDir, '新文档.md')
    const imagePath = join(tempDir, '配图.png')
    await writeFile(sourcePath, '# Notes\n', 'utf-8')
    await writeFile(imagePath, Buffer.from([1, 2, 3]))
    const asset = await service.importDocumentAsset(sourcePath, imagePath)
    await service.saveTextDocument({
      filePath: sourcePath,
      content: `![diagram](${asset.relativePath})\n`,
      force: true,
    })

    await service.relocateMarkdownDocument({ sourcePath, targetPath })

    expect(await readFile(targetPath, 'utf-8')).toContain(
      '%E6%96%B0%E6%96%87%E6%A1%A3.assets/%E9%85%8D%E5%9B%BE.png',
    )
    await expect(readFile(join(tempDir, '新文档.assets', '配图.png'))).resolves.toEqual(
      Buffer.from([1, 2, 3]),
    )
  })

  it('exports a standard ZIP that expands to Markdown and visible resources', async () => {
    const service = createFileService()
    const documentPath = join(tempDir, 'notes.md')
    const imagePath = join(tempDir, 'diagram.png')
    const zipPath = join(tempDir, 'notes-export.zip')
    await writeFile(documentPath, '# Notes\n', 'utf-8')
    await writeFile(imagePath, Buffer.from([1, 2, 3]))
    const asset = await service.importDocumentAsset(documentPath, imagePath)
    await service.saveTextDocument({
      filePath: documentPath,
      content: `![diagram](${asset.relativePath})\n`,
      force: true,
    })

    const exported = await service.exportMarkdownDocumentZip({
      documentPath,
      targetPath: zipPath,
    })
    const extracted = await service.extractZip(zipPath)

    expect(exported.entries).toBe(3)
    expect(await readdir(join(extracted.targetDir, 'notes'))).toEqual(['notes.assets', 'notes.md'])
    await expect(
      readFile(join(extracted.targetDir, 'notes', 'notes.assets', 'diagram.png')),
    ).resolves.toEqual(Buffer.from([1, 2, 3]))
  })

  it('refuses ZIP export when existing local references are outside the managed asset directory', async () => {
    const service = createFileService()
    const documentPath = join(tempDir, 'notes.md')
    const externalPath = join(tempDir, 'external.png')
    const zipPath = join(tempDir, 'notes.zip')
    await writeFile(documentPath, '![external](external.png)\n', 'utf-8')
    await writeFile(externalPath, Buffer.from([1, 2, 3]))

    const inspection = await service.inspectMarkdownDocument(documentPath)

    expect(inspection.unmanagedLocalAssets).toEqual(['external.png'])
    await expect(
      service.exportMarkdownDocumentZip({ documentPath, targetPath: zipPath }),
    ).rejects.toThrow('本地引用不在 notes.assets 中')
    await expect(stat(zipPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('moves Markdown and its resources to the system trash when requested', async () => {
    const service = createFileService()
    const documentPath = join(tempDir, 'notes.md')
    const assetDir = join(tempDir, 'notes.assets')
    await mkdir(assetDir)
    await writeFile(documentPath, '# Notes\n', 'utf-8')
    await writeFile(join(assetDir, 'image.png'), Buffer.from([1]))

    const result = await service.trashMarkdownDocument({
      workspacePath: tempDir,
      documentPath,
      includeAssets: true,
    })

    expect(result).toEqual({ trashedPaths: [documentPath, assetDir], failedPaths: [] })
    expect(electronMock.trashItem.mock.calls).toEqual([[documentPath], [assetDir]])
  })

  it('trashes only descendants of the declared workspace and protects its root', async () => {
    const service = createFileService()
    const workspacePath = join(tempDir, 'workspace')
    const targetPath = join(workspacePath, 'note.txt')
    const outsidePath = join(tempDir, 'outside.txt')
    await mkdir(workspacePath)
    await writeFile(targetPath, 'note', 'utf-8')
    await writeFile(outsidePath, 'outside', 'utf-8')

    await expect(service.trashPath({ workspacePath, targetPath })).resolves.toEqual({
      trashedPath: targetPath,
    })
    await expect(service.trashPath({ workspacePath, targetPath: workspacePath })).rejects.toThrow(
      '不能从文件树删除工作区根目录',
    )
    await expect(service.trashPath({ workspacePath, targetPath: outsidePath })).rejects.toThrow(
      '目标路径不属于当前工作区',
    )
    expect(electronMock.trashItem).toHaveBeenCalledTimes(1)
  })

  it('reveals only paths associated with the declared workspace', async () => {
    const service = createFileService()
    const workspacePath = join(tempDir, 'workspace')
    const targetPath = join(workspacePath, 'note.txt')

    await service.revealPath({ workspacePath, targetPath })
    expect(electronMock.showItemInFolder).toHaveBeenCalledWith(targetPath)
    await expect(
      service.revealPath({ workspacePath, targetPath: join(tempDir, 'outside.txt') }),
    ).rejects.toThrow('目标路径不属于当前工作区')
  })

  it('checks directories without throwing for missing paths', async () => {
    const service = createFileService()
    const dirPath = join(tempDir, 'workspace')
    const filePath = join(tempDir, 'note.txt')
    await mkdir(dirPath)
    await writeFile(filePath, 'note', 'utf-8')

    await expect(service.isDirectory(dirPath)).resolves.toBe(true)
    await expect(service.isDirectory(filePath)).resolves.toBe(false)
    await expect(service.isDirectory(join(tempDir, 'missing'))).resolves.toBe(false)
  })

  it.each([
    '.3mf',
    '.stl',
    '.glb',
    '.doc',
    '.docx',
    '.xls',
    '.xlsx',
    '.ppt',
    '.pptx',
    '.odt',
    '.ods',
    '.odp',
    '.pages',
    '.numbers',
    '.key',
    '.mp4',
    '.mov',
    '.webm',
    '.m4v',
    '.mp3',
    '.wav',
    '.zip',
    '.tar',
    '.7z',
    '.rar',
    '.pdf',
    '.png',
  ])('reads binary file %s as base64', async (extension) => {
    const service = createFileService()
    const filePath = join(tempDir, `asset${extension}`)
    const content = Buffer.from([0x00, 0xff, 0x10, 0x20])
    await mkdir(tempDir, { recursive: true })
    await writeFile(filePath, content)

    await expect(service.readFile(filePath)).resolves.toEqual({
      content: content.toString('base64'),
      encoding: 'base64',
    })
  })

  it('renders image files as image previews', async () => {
    const service = createFileService()
    const filePath = join(tempDir, 'pixel.png')
    const content = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    await writeFile(filePath, content)

    await expect(service.renderFile(filePath)).resolves.toMatchObject({
      kind: 'image',
      content: content.toString('base64'),
      encoding: 'base64',
      mimeType: 'image/png',
      fileName: 'pixel.png',
    })
  })

  it('renders pdf files as pdf previews', async () => {
    const service = createFileService()
    const filePath = join(tempDir, 'brief.pdf')
    const content = Buffer.from('%PDF-1.7\n', 'utf-8')
    await writeFile(filePath, content)

    await expect(service.renderFile(filePath)).resolves.toMatchObject({
      kind: 'pdf',
      content: content.toString('base64'),
      encoding: 'base64',
      mimeType: 'application/pdf',
      fileName: 'brief.pdf',
    })
  })

  it('renders native media files as playable previews', async () => {
    const service = createFileService()
    const filePath = join(tempDir, 'clip.mp4')
    const content = Buffer.from([0x00, 0x00, 0x00, 0x18])
    await writeFile(filePath, content)

    await expect(service.renderFile(filePath)).resolves.toMatchObject({
      kind: 'media',
      mediaKind: 'video',
      playable: true,
      content: content.toString('base64'),
      encoding: 'base64',
      mimeType: 'video/mp4',
      fileName: 'clip.mp4',
    })
  })

  it('does not inline videos larger than 300MB', async () => {
    const service = createFileService()
    const filePath = join(tempDir, 'large.mp4')
    await writeFile(filePath, Buffer.alloc(0))
    await truncate(filePath, 300 * 1024 * 1024 + 1)

    await expect(service.renderFile(filePath)).resolves.toMatchObject({
      kind: 'media',
      mediaKind: 'video',
      playable: false,
      mimeType: 'video/mp4',
      fileName: 'large.mp4',
    })
  })

  it('renders docx files as read-only office previews', async () => {
    const service = createFileService()
    const filePath = join(tempDir, 'note.docx')
    await writeFile(
      filePath,
      createStoredZip([
        {
          name: 'word/document.xml',
          content: Buffer.from(
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
              '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
              '<w:body>' +
              '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>标题</w:t></w:r></w:p>' +
              '<w:p><w:r><w:t>第一段正文</w:t></w:r></w:p>' +
              '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>列表项</w:t></w:r></w:p>' +
              '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
              '</w:body>' +
              '</w:document>',
            'utf-8',
          ),
        },
      ]),
    )

    await expect(service.renderFile(filePath)).resolves.toMatchObject({
      kind: 'office-preview',
      officeKind: 'word',
      fileName: 'note.docx',
      blocks: [
        { type: 'heading', level: 1, text: '标题' },
        { type: 'paragraph', text: '第一段正文' },
        { type: 'list-item', text: '列表项' },
        { type: 'table', rows: [['A1', 'B1']] },
      ],
    })
  })

  it('renders pptx files as read-only office previews', async () => {
    const service = createFileService()
    const filePath = join(tempDir, 'deck.pptx')
    await writeFile(
      filePath,
      createStoredZip([
        {
          name: 'ppt/slides/slide2.xml',
          content: Buffer.from(
            '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
              '<p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>第二页标题</a:t></a:r></a:p><a:p><a:r><a:t>第二页要点</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>' +
              '</p:sld>',
            'utf-8',
          ),
        },
        {
          name: 'ppt/slides/slide1.xml',
          content: Buffer.from(
            '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
              '<p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>第一页标题</a:t></a:r></a:p><a:p><a:r><a:t>第一页要点</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>' +
              '</p:sld>',
            'utf-8',
          ),
        },
      ]),
    )

    await expect(service.renderFile(filePath)).resolves.toMatchObject({
      kind: 'office-preview',
      officeKind: 'presentation',
      fileName: 'deck.pptx',
      blocks: [
        { type: 'slide', index: 1, title: '第一页标题', lines: ['第一页要点'] },
        { type: 'slide', index: 2, title: '第二页标题', lines: ['第二页要点'] },
      ],
    })
  })

  it.each(['.doc', '.xls', '.xlsx', '.ppt', '.odt', '.ods', '.odp'])(
    'renders office file %s as unsupported until S-level WYSIWYG is designed',
    async (extension) => {
      const service = createFileService()
      const filePath = join(tempDir, `office${extension}`)
      await writeFile(filePath, Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))

      await expect(service.renderFile(filePath)).resolves.toMatchObject({
        kind: 'unsupported',
        fileName: `office${extension}`,
      })
    },
  )

  it('renders legacy doc files as unsupported instead of text garbage', async () => {
    const service = createFileService()
    const filePath = join(tempDir, 'legacy.doc')
    await writeFile(filePath, Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))

    await expect(service.renderFile(filePath)).resolves.toMatchObject({
      kind: 'unsupported',
      fileName: 'legacy.doc',
    })
  })

  it('renders zip files as unsupported preview with extract guidance', async () => {
    const service = createFileService()
    const filePath = join(tempDir, 'assets.zip')
    await writeFile(
      filePath,
      createStoredZip([
        {
          name: 'images/',
          content: Buffer.from(''),
        },
        {
          name: 'images/a.png',
          content: Buffer.from([1, 2, 3]),
        },
      ]),
    )

    await expect(service.renderFile(filePath)).resolves.toMatchObject({
      kind: 'unsupported',
      fileName: 'assets.zip',
      reason: expect.stringContaining('右键'),
    })
  })

  it('extracts zip files to a same-name sibling directory', async () => {
    const service = createFileService()
    const filePath = join(tempDir, 'assets.zip')
    await writeFile(
      filePath,
      createStoredZip([
        {
          name: 'images/',
          content: Buffer.from(''),
        },
        {
          name: 'images/a.png',
          content: Buffer.from([1, 2, 3]),
        },
      ]),
    )

    await expect(service.extractZip(filePath)).resolves.toEqual({
      targetDir: join(tempDir, 'assets'),
      extracted: 1,
    })
    await expect(readFile(join(tempDir, 'assets/images/a.png'))).resolves.toEqual(
      Buffer.from([1, 2, 3]),
    )
  })

  it('extracts zip files to a numbered directory when the target exists', async () => {
    const service = createFileService()
    const filePath = join(tempDir, 'assets.zip')
    await mkdir(join(tempDir, 'assets'))
    await writeFile(
      filePath,
      createStoredZip([
        {
          name: 'a.txt',
          content: Buffer.from('hello', 'utf-8'),
        },
      ]),
    )

    await expect(service.extractZip(filePath)).resolves.toEqual({
      targetDir: join(tempDir, 'assets-1'),
      extracted: 1,
    })
    await expect(readFile(join(tempDir, 'assets-1/a.txt'), 'utf-8')).resolves.toBe('hello')
  })

  it('rejects zip slip entries during extraction', async () => {
    const service = createFileService()
    const filePath = join(tempDir, 'evil.zip')
    await writeFile(
      filePath,
      createStoredZip([
        {
          name: '../evil.txt',
          content: Buffer.from('nope', 'utf-8'),
        },
      ]),
    )

    await expect(service.extractZip(filePath)).rejects.toThrow(/非法路径|invalid relative path/)
  })

  it.each(['.pages', '.numbers', '.key', '.tar', '.7z', '.rar'])(
    'renders unsupported recognized file %s without text garbage',
    async (extension) => {
      const service = createFileService()
      const filePath = join(tempDir, `asset${extension}`)
      await writeFile(filePath, Buffer.from([0x00, 0xff, 0x10, 0x20]))

      await expect(service.renderFile(filePath)).resolves.toMatchObject({
        kind: 'unsupported',
        fileName: `asset${extension}`,
      })
    },
  )
})

function createStoredZip(entries: Array<{ name: string; content: Buffer }>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf-8')
    const crc = crc32(entry.content)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(entry.content.length, 18)
    local.writeUInt32LE(entry.content.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, name, entry.content)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(entry.content.length, 20)
    central.writeUInt32LE(entry.content.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)

    offset += local.length + name.length + entry.content.length
  }

  const centralStart = offset
  const centralDirectory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(centralStart, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...locals, centralDirectory, end])
}

function crc32(input: Buffer): number {
  let crc = 0xffffffff
  for (const byte of input) {
    crc ^= byte
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}
