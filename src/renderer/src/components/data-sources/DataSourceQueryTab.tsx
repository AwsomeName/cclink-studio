import { useEffect, useMemo, useState } from 'react'
import type { DataQuerySnapshot, NormalizedRecord } from '@shared/ipc/data-source'
import type { AgentMountedResource, Tab } from '../../types'
import { useAgentStore, useDataSourceStore } from '../../stores'
import { workspaceRefKey } from '@shared/workspace-ref'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useContextMenuStore } from '../../features/context-actions/context-menu-store'
import {
  buildKeyboardContextMenuInput,
  isContextMenuKeyboardEvent,
} from '../../features/context-actions/context-menu-trigger'
import { registerDataSourceContextSurface } from '../../features/context-actions/data-source-context-surface'

const DEFAULT_QUERY = JSON.stringify({ query: { match_all: {} }, size: 20 }, null, 2)

export function DataSourceQueryTab({ tab }: { tab: Tab }): React.ReactElement {
  const sources = useDataSourceStore((s) => s.sources)
  const savedQueriesBySourceId = useDataSourceStore((s) => s.savedQueriesBySourceId)
  const loadSources = useDataSourceStore((s) => s.loadSources)
  const loadSavedQueries = useDataSourceStore((s) => s.loadSavedQueries)
  const saveQuery = useDataSourceStore((s) => s.saveQuery)
  const activeConversationId = useAgentStore((s) => s.activeConversationId)
  const addMountedResource = useAgentStore((s) => s.addMountedResource)
  const activeWorkspaceRef = useWorkspaceStore((s) => s.activeWorkspaceRef)
  const showContextMenu = useContextMenuStore((s) => s.show)
  const workspaceKey = workspaceRefKey(tab.workspaceRef ?? activeWorkspaceRef)
  const sourceId = tab.dataSourceQuery?.sourceId ?? ''
  const source = sources.find((item) => item.id === sourceId)
  const collection = tab.dataSourceQuery?.collection ?? source?.defaultCollection ?? ''
  const [queryText, setQueryText] = useState(DEFAULT_QUERY)
  const [queryName, setQueryName] = useState('')
  const [currentSavedQueryId, setCurrentSavedQueryId] = useState(
    tab.dataSourceQuery?.savedQueryId ?? null,
  )
  const [snapshot, setSnapshot] = useState<DataQuerySnapshot | null>(null)
  const [selectedRecord, setSelectedRecord] = useState<NormalizedRecord | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const records = snapshot?.records ?? []
  const sourceLabel = useMemo(() => source?.name ?? sourceId, [source?.name, sourceId])
  const savedQuery = useMemo(() => {
    if (!currentSavedQueryId) return undefined
    return (savedQueriesBySourceId[sourceId] ?? []).find(
      (query) => query.id === currentSavedQueryId,
    )
  }, [currentSavedQueryId, savedQueriesBySourceId, sourceId])

  useEffect(() => {
    setCurrentSavedQueryId(tab.dataSourceQuery?.savedQueryId ?? null)
  }, [tab.dataSourceQuery?.savedQueryId])

  useEffect(() => {
    if (sourceId) void loadSavedQueries(sourceId)
  }, [loadSavedQueries, sourceId])

  useEffect(() => {
    if (!savedQuery) return
    setQueryName(savedQuery.name)
    setQueryText(JSON.stringify(savedQuery.query, null, 2))
  }, [savedQuery])

  const runQuery = async (): Promise<void> => {
    setRunning(true)
    setError(null)
    setSelectedRecord(null)
    try {
      if (sources.length === 0) await loadSources()
      const parsed = JSON.parse(queryText) as unknown
      const result = await window.cclinkStudio.dataSource.runQuery({
        sourceId,
        collection,
        query: parsed,
      })
      if (!result.success) {
        setError(`${result.error.code}: ${result.error.message}`)
        return
      }
      setSnapshot(result.data)
      setNotice(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  const saveCurrentQuery = async (): Promise<void> => {
    setError(null)
    setNotice(null)
    try {
      const parsed = JSON.parse(queryText) as unknown
      const saved = await saveQuery({
        id: currentSavedQueryId ?? undefined,
        sourceId,
        name: queryName.trim() || `${collection} 查询`,
        collection,
        query: parsed,
      })
      if (saved) {
        setQueryName(saved.name)
        setCurrentSavedQueryId(saved.id)
        setNotice('查询已保存')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const copyText = async (text: string, message: string): Promise<void> => {
    await navigator.clipboard.writeText(text)
    setNotice(message)
  }

  const mountQueryResult = (): void => {
    if (!snapshot) return
    const resource: AgentMountedResource = {
      id: `data-query:${snapshot.id}`,
      kind: 'data-query',
      label: `${sourceLabel} / ${snapshot.collection}`,
      detail: `total ${snapshot.total}, returned ${snapshot.returned}, ${snapshot.truncated ? '已截断' : '完整返回'}`,
      ref: {
        type: 'data-query',
        sourceId: snapshot.sourceId,
        collection: snapshot.collection,
        queryId: snapshot.id,
        executedAt: snapshot.executedAt,
        total: snapshot.total,
        returned: snapshot.returned,
        truncated: snapshot.truncated,
      },
    }
    addMountedResource(resource, activeConversationId)
    setNotice('查询结果已挂载给 Agent')
  }

  const mountRecord = (record: NormalizedRecord): void => {
    const resource: AgentMountedResource = {
      id: `data-record:${record.sourceId}:${record.collection}:${record.id}`,
      kind: 'data-record',
      label: record.title ?? record.id,
      detail: record.sourceUrl ?? record.collection,
      ref: {
        type: 'data-record',
        sourceId: record.sourceId,
        collection: record.collection,
        recordId: record.id,
        sourceUrl: record.sourceUrl,
        publishedAt: record.publishedAt,
        collectedAt: record.collectedAt,
      },
    }
    addMountedResource(resource, activeConversationId)
    setNotice('记录已挂载给 Agent')
  }

  const mountSelectedRecord = (): void => {
    if (selectedRecord) mountRecord(selectedRecord)
  }

  useEffect(
    () =>
      registerDataSourceContextSurface(tab.id, {
        getRecord: (recordId) => records.find((record) => record.id === recordId) ?? null,
        mountRecord: (recordId) => {
          const record = records.find((item) => item.id === recordId)
          if (record) mountRecord(record)
        },
      }),
    [activeConversationId, addMountedResource, records, tab.id],
  )

  const downloadText = (filename: string, content: string, type: string): void => {
    const blob = new Blob([content], { type })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const exportJson = (): void => {
    if (!snapshot) return
    downloadText(
      `${snapshot.collection}-query-result.json`,
      JSON.stringify(snapshot, null, 2),
      'application/json',
    )
  }

  const exportCsv = (): void => {
    if (!snapshot) return
    const headers = ['id', 'title', 'content', 'sourceUrl', 'publishedAt', 'collectedAt', 'score']
    const escape = (value: unknown): string => {
      const text = value === undefined || value === null ? '' : String(value)
      return `"${text.replaceAll('"', '""')}"`
    }
    const rows = snapshot.records.map((record) =>
      headers
        .map((header) => escape((record as unknown as Record<string, unknown>)[header]))
        .join(','),
    )
    downloadText(
      `${snapshot.collection}-query-result.csv`,
      [headers.join(','), ...rows].join('\n'),
      'text/csv',
    )
  }

  return (
    <div className="data-source-query-tab">
      <div className="data-source-query-toolbar">
        <div>
          <strong>{sourceLabel}</strong>
          <span>{collection || '未选择 index'}</span>
        </div>
        <div className="data-source-query-actions">
          <input
            value={queryName}
            onChange={(event) => setQueryName(event.target.value)}
            placeholder="Saved Query 名称"
          />
          <button
            type="button"
            onClick={() => void saveCurrentQuery()}
            disabled={!sourceId || !collection}
          >
            保存
          </button>
          <button
            type="button"
            onClick={() => void runQuery()}
            disabled={!sourceId || !collection || running}
          >
            {running ? '查询中...' : '运行查询'}
          </button>
        </div>
      </div>

      <div className="data-source-query-body">
        <textarea
          value={queryText}
          onChange={(event) => setQueryText(event.target.value)}
          spellCheck={false}
          aria-label="Elasticsearch DSL"
        />

        <div className="data-source-result-pane">
          {error && (
            <button
              className="data-source-query-error"
              onClick={() => void copyText(error, '错误已复制')}
              title="点击复制错误"
            >
              {error}
            </button>
          )}
          {notice && <div className="data-source-query-notice">{notice}</div>}
          {snapshot && (
            <div className="data-source-result-summary">
              <span>total {snapshot.total}</span>
              <span>returned {snapshot.returned}</span>
              <span>{snapshot.truncated ? '已截断' : '完整返回'}</span>
              <button type="button" onClick={mountQueryResult}>
                挂载结果
              </button>
              <button type="button" onClick={exportJson}>
                JSON
              </button>
              <button type="button" onClick={exportCsv}>
                CSV
              </button>
            </div>
          )}
          {records.length > 0 ? (
            <div className="data-source-result-table">
              {records.map((record) => (
                <button
                  key={record.id}
                  data-context-target="data-record"
                  type="button"
                  onClick={() => setSelectedRecord(record)}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    showContextMenu({
                      target: {
                        kind: 'data-record',
                        workspaceKey,
                        tabId: tab.id,
                        sourceId: record.sourceId,
                        collection: record.collection,
                        recordId: record.id,
                      },
                      x: event.clientX,
                      y: event.clientY,
                      focusReturn: event.currentTarget,
                    })
                  }}
                  onKeyDown={(event) => {
                    if (!isContextMenuKeyboardEvent(event.nativeEvent)) return
                    event.preventDefault()
                    event.stopPropagation()
                    showContextMenu(
                      buildKeyboardContextMenuInput(
                        {
                          kind: 'data-record',
                          workspaceKey,
                          tabId: tab.id,
                          sourceId: record.sourceId,
                          collection: record.collection,
                          recordId: record.id,
                        },
                        event.currentTarget,
                      ),
                    )
                  }}
                >
                  <span>{record.title ?? record.id}</span>
                  <small>
                    {record.sourceUrl ??
                      record.collectedAt ??
                      record.publishedAt ??
                      record.collection}
                  </small>
                </button>
              ))}
            </div>
          ) : (
            <div className="data-source-result-empty">运行查询后显示结果</div>
          )}
        </div>

        <div className="data-source-record-preview-shell">
          <div className="data-source-record-preview-toolbar">
            <span>JSON</span>
            <button type="button" disabled={!selectedRecord} onClick={mountSelectedRecord}>
              挂载记录
            </button>
            <button
              type="button"
              disabled={!selectedRecord}
              onClick={() =>
                selectedRecord
                  ? void copyText(JSON.stringify(selectedRecord, null, 2), '记录 JSON 已复制')
                  : undefined
              }
            >
              复制
            </button>
          </div>
          <pre className="data-source-record-preview">
            {selectedRecord ? JSON.stringify(selectedRecord, null, 2) : '选择一条记录查看 JSON'}
          </pre>
        </div>
      </div>
    </div>
  )
}
