/** What an AI conversation run changed in a diary project, kept so the user can review and undo. */
export interface DiaryChangeFile {
  path: string
  status: 'added' | 'modified' | 'deleted'
  /** Unified-style lines: ' ' unchanged context, '+' added, '-' removed. Bounded for display. */
  diff: string[]
  added: number
  removed: number
}

export interface DiaryChangeReport {
  id: string
  workspacePath: string
  conversationId: string
  runId: string
  createdAt: number
  files: DiaryChangeFile[]
  undone: boolean
  undoneAt?: number
}

export interface DiaryUndoResult {
  restored: string[]
  /** Files changed again after the AI run; left untouched. */
  skipped: string[]
}

const MAX_CELLS = 4_000_000
const CONTEXT = 2
const MAX_LINES = 400

/** Line diff via LCS with a size bound; large files fall back to whole replacement. */
export function diffLines(
  before: string,
  after: string,
): { diff: string[]; added: number; removed: number } {
  const lines = (text: string): string[] => (text ? text.replace(/\n$/, '').split('\n') : [])
  const a = lines(before)
  const b = lines(after)
  let ops: Array<[' ' | '+' | '-', string]>
  if ((a.length + 1) * (b.length + 1) > MAX_CELLS) {
    ops = [
      ...a.map((line) => ['-', line] as [' ' | '+' | '-', string]),
      ...b.map((line) => ['+', line] as [' ' | '+' | '-', string]),
    ]
  } else {
    const width = b.length + 1
    const table = new Uint32Array((a.length + 1) * width)
    for (let i = a.length - 1; i >= 0; i--)
      for (let j = b.length - 1; j >= 0; j--)
        table[i * width + j] =
          a[i] === b[j]
            ? table[(i + 1) * width + j + 1] + 1
            : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
    ops = []
    let i = 0
    let j = 0
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        ops.push([' ', a[i]])
        i++
        j++
      } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) ops.push(['-', a[i++]])
      else ops.push(['+', b[j++]])
    }
    while (i < a.length) ops.push(['-', a[i++]])
    while (j < b.length) ops.push(['+', b[j++]])
  }
  const keep = new Set<number>()
  ops.forEach(([kind], index) => {
    if (kind === ' ') return
    for (let k = Math.max(0, index - CONTEXT); k <= Math.min(ops.length - 1, index + CONTEXT); k++)
      keep.add(k)
  })
  const diff: string[] = []
  let last = -1
  for (const index of [...keep].sort((x, y) => x - y)) {
    if (last >= 0 && index > last + 1) diff.push('…')
    diff.push(ops[index][0] + ' ' + ops[index][1])
    last = index
    if (diff.length >= MAX_LINES) {
      diff.push('…（差异过长，已截断）')
      break
    }
  }
  return {
    diff,
    added: ops.filter(([kind]) => kind === '+').length,
    removed: ops.filter(([kind]) => kind === '-').length,
  }
}
