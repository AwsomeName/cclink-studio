import { useToastStore } from '../../../components/common/Toast'
import { useDataSourceStore } from '../../../stores/data-source-store'
import type { Command } from '../../../stores/command-store'
import { useTabStore } from '../../../stores/tab-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import type { CommandContext, ContextTarget } from '../context-target'
import { getDataSourceContextSurface } from '../data-source-context-surface'
import type { MenuContribution } from '../menu-contribution-registry'

type SourceTarget = Extract<ContextTarget, { kind: 'data-source' }>
type CollectionTarget = Extract<ContextTarget, { kind: 'data-collection' }>
type SavedQueryTarget = Extract<ContextTarget, { kind: 'saved-query' }>
type RecordTarget = Extract<ContextTarget, { kind: 'data-record' }>

function sourceTarget(context?: CommandContext): SourceTarget | null {
  return context?.target?.kind === 'data-source' ? context.target : null
}

function collectionTarget(context?: CommandContext): CollectionTarget | null {
  return context?.target?.kind === 'data-collection' ? context.target : null
}

function savedQueryTarget(context?: CommandContext): SavedQueryTarget | null {
  return context?.target?.kind === 'saved-query' ? context.target : null
}

function recordTarget(context?: CommandContext): RecordTarget | null {
  return context?.target?.kind === 'data-record' ? context.target : null
}

function resolveSource(sourceId: string) {
  return useDataSourceStore.getState().sources.find((source) => source.id === sourceId) ?? null
}

function resolveSavedQuery(target: SavedQueryTarget) {
  return (
    useDataSourceStore
      .getState()
      .savedQueriesBySourceId[target.sourceId]?.find((query) => query.id === target.queryId) ?? null
  )
}

function openQuery(input: { sourceId: string; collection?: string; savedQueryId?: string }): void {
  useTabStore.getState().openTab({
    type: 'data-source-query',
    title: input.collection ? `查询 ${input.collection}` : '数据源查询',
    icon: '🗄️',
    workspaceRef: useWorkspaceStore.getState().activeWorkspaceRef,
    dataSourceQuery: input,
  })
}

async function copyText(value: string, label: string): Promise<void> {
  await navigator.clipboard.writeText(value)
  useToastStore.getState().show(`${label}已复制`, 'success')
}

function resolveRecord(target: RecordTarget) {
  const surface = getDataSourceContextSurface(target.tabId)
  const record = surface?.getRecord(target.recordId) ?? null
  if (
    !surface ||
    !record ||
    record.sourceId !== target.sourceId ||
    record.collection !== target.collection
  ) {
    return null
  }
  return { surface, record }
}

export function createDataSourceContextCommands(): Command[] {
  return [
    {
      id: 'dataSource.select',
      label: '选择数据源',
      category: '数据源',
      contextOnly: true,
      enabled: (context) => ({
        enabled: Boolean(sourceTarget(context) && resolveSource(sourceTarget(context)!.sourceId)),
        reason: '数据源已失效',
      }),
      action: async (context) => {
        const target = sourceTarget(context)
        if (!target || !resolveSource(target.sourceId)) throw new Error('数据源已失效')
        await useDataSourceStore.getState().selectSource(target.sourceId)
      },
    },
    {
      id: 'dataSource.openQuery',
      label: '打开查询',
      category: '数据源',
      contextOnly: true,
      visible: (context) =>
        ['data-source', 'data-collection', 'saved-query'].includes(context.target?.kind ?? ''),
      enabled: (context) => {
        const source = sourceTarget(context)
        if (source)
          return { enabled: Boolean(resolveSource(source.sourceId)), reason: '数据源已失效' }
        const collection = collectionTarget(context)
        if (collection) {
          return { enabled: Boolean(resolveSource(collection.sourceId)), reason: '数据源已失效' }
        }
        const saved = savedQueryTarget(context)
        return { enabled: Boolean(saved && resolveSavedQuery(saved)), reason: 'Saved Query 已失效' }
      },
      action: (context) => {
        const source = sourceTarget(context)
        if (source) {
          const resolved = resolveSource(source.sourceId)
          if (!resolved) throw new Error('数据源已失效')
          openQuery({ sourceId: source.sourceId, collection: resolved.defaultCollection })
          return
        }
        const collection = collectionTarget(context)
        if (collection) {
          if (!resolveSource(collection.sourceId)) throw new Error('数据源已失效')
          openQuery({ sourceId: collection.sourceId, collection: collection.collection })
          return
        }
        const saved = savedQueryTarget(context)
        if (!saved || !resolveSavedQuery(saved)) throw new Error('Saved Query 已失效')
        openQuery({
          sourceId: saved.sourceId,
          collection: saved.collection,
          savedQueryId: saved.queryId,
        })
      },
    },
    {
      id: 'dataSource.testConnection',
      label: '测试连接',
      category: '数据源',
      contextOnly: true,
      enabled: (context) => {
        const target = sourceTarget(context)
        return {
          enabled: Boolean(
            target && resolveSource(target.sourceId) && !useDataSourceStore.getState().loading,
          ),
          reason: target ? '数据源正在处理其他操作' : '数据源已失效',
        }
      },
      action: async (context) => {
        const target = sourceTarget(context)
        if (!target || !resolveSource(target.sourceId)) throw new Error('数据源已失效')
        const success = await useDataSourceStore.getState().testConnection(target.sourceId)
        if (!success) throw new Error('连接测试失败，请查看数据源错误状态')
        useToastStore.getState().show('数据源连接正常', 'success')
      },
    },
    {
      id: 'dataSource.copyIdentifier',
      label: '复制标识',
      category: '数据源',
      contextOnly: true,
      risk: 'read',
      action: (context) => {
        const source = sourceTarget(context)
        if (source) return copyText(source.sourceId, '数据源标识')
        const collection = collectionTarget(context)
        if (collection) return copyText(collection.collection, 'Index 名称')
        const saved = savedQueryTarget(context)
        if (saved) return copyText(saved.queryId, 'Saved Query 标识')
        const record = recordTarget(context)
        if (record) return copyText(record.recordId, '记录标识')
        throw new Error('数据目标已失效')
      },
    },
    {
      id: 'dataSource.copyRecordJson',
      label: '复制记录 JSON',
      category: '数据源',
      contextOnly: true,
      risk: 'read',
      enabled: (context) => ({
        enabled: Boolean(recordTarget(context) && resolveRecord(recordTarget(context)!)),
        reason: '记录已失效',
      }),
      action: (context) => {
        const target = recordTarget(context)
        const resolved = target ? resolveRecord(target) : null
        if (!resolved) throw new Error('记录已失效')
        return copyText(JSON.stringify(resolved.record, null, 2), '记录 JSON')
      },
    },
    {
      id: 'dataSource.mountRecord',
      label: '挂载记录给 Agent',
      category: '数据源',
      contextOnly: true,
      risk: 'local-write',
      enabled: (context) => ({
        enabled: Boolean(recordTarget(context) && resolveRecord(recordTarget(context)!)),
        reason: '记录已失效',
      }),
      action: (context) => {
        const target = recordTarget(context)
        const resolved = target ? resolveRecord(target) : null
        if (!target || !resolved) throw new Error('记录已失效')
        resolved.surface.mountRecord(target.recordId)
      },
    },
  ]
}

export const dataSourceMenuContributions: MenuContribution[] = [
  {
    id: 'data-source.select',
    targetKinds: ['data-source'],
    group: '10.primary',
    order: 10,
    commandId: 'dataSource.select',
  },
  {
    id: 'data-source.open-query',
    targetKinds: ['data-source', 'data-collection', 'saved-query'],
    group: '10.primary',
    order: 20,
    commandId: 'dataSource.openQuery',
  },
  {
    id: 'data-source.test',
    targetKinds: ['data-source'],
    group: '20.connection',
    order: 10,
    commandId: 'dataSource.testConnection',
  },
  {
    id: 'data-record.mount',
    targetKinds: ['data-record'],
    group: '10.primary',
    order: 10,
    commandId: 'dataSource.mountRecord',
  },
  {
    id: 'data-record.copy-json',
    targetKinds: ['data-record'],
    group: '20.copy',
    order: 10,
    commandId: 'dataSource.copyRecordJson',
  },
  {
    id: 'data-source.copy-id',
    targetKinds: ['data-source', 'data-collection', 'saved-query', 'data-record'],
    group: '20.copy',
    order: 20,
    commandId: 'dataSource.copyIdentifier',
  },
]
