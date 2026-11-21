import { useEffect, useState } from 'react'
import { ConversationMarkdown } from '../../components/common/ConversationMarkdown'
import type { Affair } from './affair'
import { EvidencePreview, localReference, withLegacyAnchors } from './evidence-preview'
import { tabKey, useOwnerView, type OwnerDocTab } from './owner-view-store'

// Generated affair documents carry a short identity header; show it as file content only in Finder.
const withoutFrontMatter = (s: string) => s.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')

type Loaded =
  | { key: string; stamp: number | string; content: string }
  | { key: string; error: string }

/** One center document tab: an affair file (by affair ID + relative path) or a read-only source file. */
export function OwnerDocument({ a, tab }: { a: Affair; tab: OwnerDocTab }) {
  const key = tabKey(tab)
  const revision = a.directory?.revision ?? 0
  const stamp = tab.kind === 'affair' ? revision : 'source'
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [reload, setReload] = useState(0)
  const openTab = useOwnerView((s) => s.open)
  useEffect(() => {
    let live = true
    const request =
      tab.kind === 'affair'
        ? window.cclinkStudio.ownerDirectories.preview(a.id, tab.name)
        : window.cclinkStudio.ownerSources.read(a.id, tab.grantId, tab.rel).then((f) => f.content)
    request
      .then((content) => live && setLoaded({ key, stamp, content }))
      .catch((e) => live && setLoaded({ key, error: String(e) }))
    return () => {
      live = false
    }
    // Tab identity is captured by key; reload re-reads after an error.
  }, [a.id, key, stamp, reload])
  const heading = tab.kind === 'affair' ? tab.name : tab.label + '/' + tab.rel
  const current = loaded?.key === key ? loaded : null
  const report = a.directory?.reportFile
  return (
    <section className="own-doc" data-owner-doc={heading}>
      <small>
        {tab.kind === 'affair'
          ? (tab.name.includes('/') ? tab.name.split('/')[0] + ' / ' : '') +
            (tab.name.startsWith('资料/') ? '本地证据快照' : 'Markdown 预览')
          : '只读参考目录 · ' + tab.label}
      </small>
      <h3>{heading}</h3>
      {tab.kind === 'affair' && tab.name.startsWith('资料/') && report && (
        <button onClick={() => openTab(a.id, { kind: 'affair', name: report })}>返回报告</button>
      )}
      {!current ? (
        <p>读取中…</p>
      ) : 'error' in current ? (
        <p role="alert">
          {current.error} <button onClick={() => setReload((n) => n + 1)}>重新读取</button>
        </p>
      ) : tab.kind === 'affair' ? (
        tab.name.startsWith('资料/') ? (
          <EvidencePreview content={current.content} line={tab.line} />
        ) : (
          <ConversationMarkdown
            source={withLegacyAnchors(withoutFrontMatter(current.content))}
            resolveLocalLink={(href) => {
              const target = localReference(tab.name, href, a.directory?.files ?? [])
              return target
                ? () => openTab(a.id, { kind: 'affair', name: target.name, line: target.line })
                : undefined
            }}
          />
        )
      ) : /\.(md|markdown)$/i.test(tab.rel) ? (
        <ConversationMarkdown source={current.content} />
      ) : (
        <pre className="own-source-lines own-source-file">
          {current.content.split('\n').map((text, i) => (
            <div key={i}>
              <span>{i + 1}</span>
              {text}
            </div>
          ))}
        </pre>
      )}
    </section>
  )
}
