import { useEffect, useRef } from 'react'
import { ConversationMarkdown } from '../../components/common/ConversationMarkdown'

// Older generated cards put the verified line only on the adjacent upstream link.
export function withLegacyAnchors(source: string) {
  return source.replace(
    /(\[本地证据\]\(\.\.\/[^)#\n]+)(\) · \[仓库原文\]\(https:\/\/[^)#\n]+)(#L\d+)\)/g,
    '$1$3$2$3)',
  )
}
export function localReference(base: string, href: string, files: string[]) {
  const match = /^((?:\.\.\/)?[^?#:\\\s]+\.md)(?:#L([1-9]\d*))?$/u.exec(href)
  if (!match) return
  try {
    const destination = new URL(match[1], new URL(encodeURI(base), 'https://owner.invalid/'))
    const name = decodeURIComponent(destination.pathname.slice(1))
    if (destination.origin === 'https://owner.invalid' && files.includes(name))
      return { name, line: match[2] ? Number(match[2]) : undefined }
  } catch {
    return
  }
}
export function EvidencePreview({ content, line }: { content: string; line?: number }) {
  const mark = useRef<HTMLElement>(null)
  const code = useRef<HTMLPreElement>(null)
  useEffect(() => {
    const pane = code.current,
      row = mark.current
    if (!pane || !row) return
    pane.scrollTop +=
      row.getBoundingClientRect().top - pane.getBoundingClientRect().top - pane.clientHeight / 2
    pane.closest('section')?.scrollIntoView({ block: 'start' })
  }, [content, line])
  const snapshot = /^(片段起始行 (\d+))\r?\n\r?\n(`{3,})text\r?\n([\s\S]*)\r?\n\3\s*$/m.exec(
    content,
  )
  if (!snapshot || !line) return <ConversationMarkdown source={content} />
  const start = Number(snapshot[2])
  return (
    <>
      <ConversationMarkdown source={content.slice(0, snapshot.index)} />
      <p>引用位置 · L{line}</p>
      <pre className="own-source-lines" ref={code}>
        {snapshot[4].split('\n').map((text, i) => {
          const number = start + i
          const row = (
            <>
              <span>{number}</span>
              {text}
            </>
          )
          return number === line ? (
            <mark key={number} ref={mark} data-source-line={number}>
              {row}
            </mark>
          ) : (
            <div key={number}>{row}</div>
          )
        })}
      </pre>
    </>
  )
}
