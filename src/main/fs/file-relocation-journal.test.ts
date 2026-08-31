import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileRelocationJournal } from './file-relocation-journal'

let root = ''
let workspace = ''
let journalPath = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'cclink-relocation-journal-'))
  workspace = join(root, 'workspace')
  journalPath = join(root, 'user-data', 'relocations.json')
  await mkdir(workspace)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function move(name: string) {
  return {
    sourcePath: join(workspace, `${name}-old.md`),
    targetPath: join(workspace, `${name}.md`),
  }
}

describe('FileRelocationJournal crash recovery', () => {
  it('drops a prepared record when a process exits before disk commit', async () => {
    const planned = move('before-disk')
    await writeFile(planned.sourcePath, 'draft')
    await new FileRelocationJournal(journalPath).begin({
      operationId: 'op-before',
      workspacePath: workspace,
      moves: [planned],
    })

    const restarted = new FileRelocationJournal(journalPath)
    await expect(restarted.listForWorkspace(workspace)).resolves.toEqual([])
  })

  it('promotes a prepared record when a process exits after disk commit', async () => {
    const planned = move('after-disk')
    await writeFile(planned.sourcePath, 'draft')
    await new FileRelocationJournal(journalPath).begin({
      operationId: 'op-after-disk',
      workspacePath: workspace,
      moves: [planned],
    })
    await rename(planned.sourcePath, planned.targetPath)

    const restarted = new FileRelocationJournal(journalPath)
    await expect(restarted.listForWorkspace(workspace)).resolves.toMatchObject([
      { operationId: 'op-after-disk', state: 'disk-committed', moves: [planned] },
    ])
  })

  it('retains a committed record until renderer persistence acknowledges it', async () => {
    const planned = move('after-projection')
    await writeFile(planned.sourcePath, 'draft')
    const first = new FileRelocationJournal(journalPath)
    await first.begin({
      operationId: 'op-after-projection',
      workspacePath: workspace,
      moves: [planned],
    })
    await rename(planned.sourcePath, planned.targetPath)
    await first.markCommitted('op-after-projection', workspace, [planned])

    const restarted = new FileRelocationJournal(journalPath)
    await expect(restarted.listForWorkspace(workspace)).resolves.toHaveLength(1)
    await restarted.remove('op-after-projection', workspace)
    await expect(restarted.listForWorkspace(workspace)).resolves.toEqual([])
    expect(JSON.parse(await readFile(journalPath, 'utf8')).entries).toEqual([])
  })

  it('keeps ambiguous source and target states as a conflict', async () => {
    const planned = move('ambiguous')
    await Promise.all([writeFile(planned.sourcePath, 'old'), writeFile(planned.targetPath, 'new')])
    await new FileRelocationJournal(journalPath).begin({
      operationId: 'op-conflict',
      workspacePath: workspace,
      moves: [planned],
    })

    await expect(
      new FileRelocationJournal(journalPath).listForWorkspace(workspace),
    ).resolves.toMatchObject([{ operationId: 'op-conflict', state: 'conflict' }])
  })
})
