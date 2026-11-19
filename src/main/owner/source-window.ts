// Search hints locate a later read. Only the returned snapshot can verify a citation.
export function sourceWindow(raw: string, anchor: string) {
  const lines = raw.split('\n')
  const target = /^@L([1-9]\d{0,6})$/i.exec(anchor)
  const normalize = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()
  const needle = normalize(anchor)
  let hits: number[] = []
  let line = 0
  let matched = true
  if (target) {
    line = Number(target[1]) - 1
    if (line >= lines.length) throw Error('定位行超出文件末尾：' + lines.length + ' 行')
  } else if (needle) {
    const position = raw.toLowerCase().indexOf(anchor.toLowerCase())
    const key = needle.split(/[^\p{L}\p{N}_]+/u).sort((a, b) => b.length - a.length)[0]
    const find = (term: string) => lines.flatMap((s, i) => (normalize(s).includes(term) ? [i] : []))
    hits = find(needle)
    matched = position >= 0 || hits.length > 0
    if (!matched && key?.length >= 3) hits = find(key)
    line =
      position >= 0 ? raw.slice(0, position).split('\n').length - 1 : matched ? (hits[0] ?? 0) : 0
  }
  const offset = lines.slice(0, line).reduce((n, s) => n + s.length + 1, 0)
  const inline = target ? 0 : Math.max(0, lines[line].toLowerCase().indexOf(anchor.toLowerCase()))
  const context = Math.max(0, offset + inline - 1500)
  let start = context ? raw.lastIndexOf('\n', context - 1) + 1 : 0
  if (offset + inline - start >= 8800) start = context
  const selected = hits.length > 12 ? [...hits.slice(0, 5), ...hits.slice(-7)] : hits
  return {
    text: raw.slice(start, start + 9000),
    startLine: raw.slice(0, start).split('\n').length,
    ...(anchor ? { matchedAnchor: matched } : {}),
    ...(selected.length > 0
      ? { locations: selected.map((i) => '@L' + (i + 1) + ' ' + lines[i].trim().slice(0, 135)) }
      : {}),
  }
}
