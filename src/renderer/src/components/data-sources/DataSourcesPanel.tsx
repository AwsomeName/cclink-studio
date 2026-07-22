import { useEffect, useMemo, useState } from 'react'
import { useDataSourceStore, useTabStore } from '../../stores'
import type { CreateDataSourceInput } from '@shared/ipc/data-source'
import { IconDatabase, IconRefresh } from '../common/Icons'
import { workspaceRefKey } from '@shared/workspace-ref'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useContextMenuStore } from '../../features/context-actions/context-menu-store'
import {
  buildKeyboardContextMenuInput,
  isContextMenuKeyboardEvent,
} from '../../features/context-actions/context-menu-trigger'

export function DataSourcesPanel(): React.ReactElement {
  const sources = useDataSourceStore((s) => s.sources)
  const collectionsBySourceId = useDataSourceStore((s) => s.collectionsBySourceId)
  const savedQueriesBySourceId = useDataSourceStore((s) => s.savedQueriesBySourceId)
  const selectedSourceId = useDataSourceStore((s) => s.selectedSourceId)
  const loading = useDataSourceStore((s) => s.loading)
  const error = useDataSourceStore((s) => s.error)
  const loadSources = useDataSourceStore((s) => s.loadSources)
  const createSource = useDataSourceStore((s) => s.createSource)
  const selectSource = useDataSourceStore((s) => s.selectSource)
  const testConnection = useDataSourceStore((s) => s.testConnection)
  const clearError = useDataSourceStore((s) => s.clearError)
  const openTab = useTabStore((s) => s.openTab)
  const activeWorkspaceRef = useWorkspaceStore((s) => s.activeWorkspaceRef)
  const showContextMenu = useContextMenuStore((s) => s.show)
  const workspaceKey = workspaceRefKey(activeWorkspaceRef)
  const [name, setName] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [defaultCollection, setDefaultCollection] = useState('')
  const [testingId, setTestingId] = useState<string | null>(null)

  useEffect(() => {
    void loadSources()
  }, [loadSources])

  const selectedCollections = useMemo(
    () => (selectedSourceId ? (collectionsBySourceId[selectedSourceId] ?? []) : []),
    [collectionsBySourceId, selectedSourceId],
  )
  const selectedSavedQueries = useMemo(
    () => (selectedSourceId ? (savedQueriesBySourceId[selectedSourceId] ?? []) : []),
    [savedQueriesBySourceId, selectedSourceId],
  )

  const canSubmit = name.trim() && endpoint.trim() && !loading

  const handleCreate = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (!canSubmit) return
    const input: CreateDataSourceInput = {
      type: 'elasticsearch',
      scope: 'workspace',
      name: name.trim(),
      endpoint: endpoint.trim(),
      defaultCollection: defaultCollection.trim() || undefined,
      secret: apiKey.trim() ? { authType: 'apiKey', apiKey: apiKey.trim() } : { authType: 'none' },
    }
    const created = await createSource(input)
    if (created) {
      setName('')
      setEndpoint('')
      setApiKey('')
      setDefaultCollection('')
    }
  }

  const handleTest = async (sourceId: string): Promise<void> => {
    setTestingId(sourceId)
    await testConnection(sourceId)
    setTestingId(null)
  }

  const openQueryTab = (sourceId: string, collection?: string): void => {
    openTab({
      type: 'data-source-query',
      title: collection ? `查询 ${collection}` : '数据源查询',
      icon: '🗄️',
      dataSourceQuery: { sourceId, collection },
    })
  }

  const openSavedQuery = (queryId: string, sourceId: string, collection: string): void => {
    openTab({
      type: 'data-source-query',
      title: `查询 ${collection}`,
      icon: '🗄️',
      dataSourceQuery: { sourceId, collection, savedQueryId: queryId },
    })
  }

  return (
    <div className="data-source-panel">
      {error && (
        <button className="data-source-error" onClick={clearError} title="点击清除错误">
          <span>{error.code}</span>
          <small>{error.message}</small>
        </button>
      )}

      <section className="sidebar-section">
        <div className="sidebar-section-header">连接</div>
        {sources.length === 0 && !loading ? (
          <div className="data-source-empty">还没有数据源</div>
        ) : (
          sources.map((source) => (
            <button
              key={source.id}
              data-context-target="data-source"
              className={`project-panel-row ${selectedSourceId === source.id ? 'active' : ''}`}
              onClick={() => void selectSource(source.id)}
              onContextMenu={(event) => {
                event.preventDefault()
                event.stopPropagation()
                showContextMenu({
                  target: {
                    kind: 'data-source',
                    workspaceKey,
                    sourceId: source.id,
                    sourceName: source.name,
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
                      kind: 'data-source',
                      workspaceKey,
                      sourceId: source.id,
                      sourceName: source.name,
                    },
                    event.currentTarget,
                  ),
                )
              }}
              title={source.endpoint}
            >
              <IconDatabase size={14} />
              <span className="project-panel-row-main">
                <span className="project-panel-row-title">{source.name}</span>
                <span className="project-panel-row-meta">
                  {source.defaultCollection ?? source.endpoint}
                </span>
              </span>
            </button>
          ))
        )}
      </section>

      {selectedSourceId && (
        <section className="sidebar-section">
          <div className="sidebar-section-header data-source-section-header">
            <span>Index</span>
            <button
              type="button"
              onClick={() => void selectSource(selectedSourceId)}
              title="刷新 index"
              disabled={loading}
            >
              <IconRefresh size={13} />
            </button>
          </div>
          {selectedCollections.length === 0 ? (
            <div className="data-source-empty">{loading ? '加载中...' : '暂无 index'}</div>
          ) : (
            selectedCollections.map((collection) => (
              <button
                key={collection.name}
                data-context-target="data-collection"
                className="project-panel-row project-panel-row-compact"
                onClick={() => openQueryTab(selectedSourceId, collection.name)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  showContextMenu({
                    target: {
                      kind: 'data-collection',
                      workspaceKey,
                      sourceId: selectedSourceId,
                      collection: collection.name,
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
                        kind: 'data-collection',
                        workspaceKey,
                        sourceId: selectedSourceId,
                        collection: collection.name,
                      },
                      event.currentTarget,
                    ),
                  )
                }}
                title="打开查询 Tab"
              >
                <span className="project-panel-row-main">
                  <span className="project-panel-row-title">{collection.name}</span>
                  <span className="project-panel-row-meta">
                    {collection.health ?? 'unknown'} · {collection.docsCount ?? 0} docs
                  </span>
                </span>
              </button>
            ))
          )}
        </section>
      )}

      {selectedSourceId && (
        <section className="sidebar-section">
          <div className="sidebar-section-header">Saved Queries</div>
          {selectedSavedQueries.length === 0 ? (
            <div className="data-source-empty">暂无保存的查询</div>
          ) : (
            selectedSavedQueries.map((query) => (
              <button
                key={query.id}
                data-context-target="saved-query"
                className="project-panel-row project-panel-row-compact"
                onClick={() => openSavedQuery(query.id, query.sourceId, query.collection)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  showContextMenu({
                    target: {
                      kind: 'saved-query',
                      workspaceKey,
                      sourceId: query.sourceId,
                      queryId: query.id,
                      queryName: query.name,
                      collection: query.collection,
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
                        kind: 'saved-query',
                        workspaceKey,
                        sourceId: query.sourceId,
                        queryId: query.id,
                        queryName: query.name,
                        collection: query.collection,
                      },
                      event.currentTarget,
                    ),
                  )
                }}
                title="打开 Saved Query"
              >
                <span className="project-panel-row-main">
                  <span className="project-panel-row-title">{query.name}</span>
                  <span className="project-panel-row-meta">{query.collection}</span>
                </span>
              </button>
            ))
          )}
        </section>
      )}

      <section className="sidebar-section">
        <div className="sidebar-section-header">添加 Elasticsearch</div>
        <form className="data-source-form" onSubmit={(event) => void handleCreate(event)}>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="名称"
          />
          <input
            value={endpoint}
            onChange={(event) => setEndpoint(event.target.value)}
            placeholder="https://es.example.com"
          />
          <input
            value={defaultCollection}
            onChange={(event) => setDefaultCollection(event.target.value)}
            placeholder="默认 index，例如 articles-*"
          />
          <input
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="API Key，可留空"
            type="password"
          />
          <button type="submit" disabled={!canSubmit}>
            添加
          </button>
        </form>
      </section>

      {selectedSourceId && (
        <div className="data-source-actions">
          <button
            type="button"
            disabled={loading || testingId === selectedSourceId}
            onClick={() => void handleTest(selectedSourceId)}
          >
            {testingId === selectedSourceId ? '测试中...' : '测试连接'}
          </button>
        </div>
      )}
    </div>
  )
}
