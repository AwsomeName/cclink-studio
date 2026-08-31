import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, sep } from 'node:path'

export interface FileRelocationJournalMove {
  sourcePath: string
  targetPath: string
}

export interface FileRelocationJournalEntry {
  operationId: string
  workspacePath: string
  moves: FileRelocationJournalMove[]
  state: 'prepared' | 'disk-committed' | 'conflict'
  createdAt: number
  updatedAt: number
}

export type RecoverableFileRelocationJournalEntry = Omit<FileRelocationJournalEntry, 'state'> & {
  state: 'disk-committed' | 'conflict'
}

interface JournalFile {
  version: 1
  entries: FileRelocationJournalEntry[]
}

export class FileRelocationJournal {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly filePath: string,
    private readonly now: () => number = Date.now,
  ) {}

  begin(
    entry: Omit<FileRelocationJournalEntry, 'state' | 'createdAt' | 'updatedAt'>,
  ): Promise<void> {
    return this.serialize(async () => {
      const file = await this.load()
      if (file.entries.some((candidate) => candidate.operationId === entry.operationId)) {
        throw new Error('FILE_RELOCATION_JOURNAL_DUPLICATE_OPERATION')
      }
      const timestamp = this.now()
      file.entries.push({ ...entry, state: 'prepared', createdAt: timestamp, updatedAt: timestamp })
      await this.save(file)
    })
  }

  markCommitted(
    operationId: string,
    workspacePath: string,
    moves: FileRelocationJournalMove[],
  ): Promise<void> {
    return this.serialize(async () => {
      const file = await this.load()
      const entry = file.entries.find((candidate) => candidate.operationId === operationId)
      if (!entry) throw new Error('FILE_RELOCATION_JOURNAL_OPERATION_NOT_FOUND')
      if (
        entry.workspacePath !== workspacePath ||
        moves.some(
          (move) =>
            !isWithin(workspacePath, move.sourcePath) || !isWithin(workspacePath, move.targetPath),
        )
      ) {
        throw new Error('FILE_RELOCATION_JOURNAL_WORKSPACE_MISMATCH')
      }
      entry.moves = moves
      entry.state = 'disk-committed'
      entry.updatedAt = this.now()
      await this.save(file)
    })
  }

  remove(operationId: string, workspacePath: string): Promise<void> {
    return this.serialize(async () => {
      const file = await this.load()
      const entries = file.entries.filter(
        (candidate) =>
          candidate.operationId !== operationId || candidate.workspacePath !== workspacePath,
      )
      if (entries.length !== file.entries.length) await this.save({ ...file, entries })
    })
  }

  listForWorkspace(workspacePath: string): Promise<RecoverableFileRelocationJournalEntry[]> {
    return this.serialize(async () => {
      const file = await this.load()
      let changed = false
      const retained: FileRelocationJournalEntry[] = []
      const result: RecoverableFileRelocationJournalEntry[] = []
      for (const entry of file.entries) {
        if (entry.workspacePath !== workspacePath) {
          retained.push(entry)
          continue
        }
        if (entry.state === 'prepared') {
          const states = await Promise.all(
            entry.moves.map(async (move) => ({
              source: await exists(move.sourcePath),
              target: await exists(move.targetPath),
            })),
          )
          if (states.every((state) => state.source && !state.target)) {
            changed = true
            continue
          }
          entry.state = states.every((state) => !state.source && state.target)
            ? 'disk-committed'
            : 'conflict'
          entry.updatedAt = this.now()
          changed = true
        }
        retained.push(entry)
        result.push(structuredClone(entry) as RecoverableFileRelocationJournalEntry)
      }
      if (changed) await this.save({ ...file, entries: retained })
      return result
    })
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation)
    this.queue = result.catch(() => undefined)
    return result
  }

  private async load(): Promise<JournalFile> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as JournalFile
      if (parsed.version !== 1 || !Array.isArray(parsed.entries)) throw new Error('invalid journal')
      return parsed
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, entries: [] }
      throw new Error('FILE_RELOCATION_JOURNAL_DAMAGED', { cause: error })
    }
  }

  private async save(file: JournalFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 })
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`
    await writeFile(temporaryPath, JSON.stringify(file), { encoding: 'utf8', mode: 0o600 })
    try {
      await rename(temporaryPath, this.filePath)
    } finally {
      await unlink(temporaryPath).catch(() => undefined)
    }
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function isWithin(root: string, candidate: string): boolean {
  const value = relative(root, candidate)
  return value === '' || (value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value))
}
