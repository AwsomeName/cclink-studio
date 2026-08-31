import type { FsTextDocumentSnapshot } from '@shared/ipc/fs'
import { useAgentStore } from '../../stores/agent-store'
import { useBrowserStore } from '../../stores/browser-store'
import {
  beginEditorFileRelocation,
  endEditorFileRelocation,
  useEditorStore,
} from '../../stores/editor-store'
import { useTabStore } from '../../stores/tab-store'
import { recordRendererDiagnosticLog } from '../diagnostics/renderer-diagnostic-log'
import { toLocalFileUrl } from '../../utils/html-files'
import { beginWorkspaceStateRestore, endWorkspaceStateRestore } from '../../utils/workspace-state'
import { persistRuntimeSections } from '../../utils/workspace-runtime'

export interface FileRelocationMove {
  sourcePath: string
  targetPath: string
}

export interface FileRelocationDiskResult {
  snapshot?: FsTextDocumentSnapshot
  companionMoves?: FileRelocationMove[]
}

export interface FileRelocationTransitionInput {
  workspacePath: string
  sourcePath: string
  targetPath: string
  commitDisk: () => Promise<FileRelocationDiskResult>
  applyFileSystemProjection: (moves: FileRelocationMove[]) => void
  verifyFileSystemProjection: () => Promise<boolean>
  persistFileSystemProjection: () => Promise<void>
}

export interface FileRelocationTransitionResult {
  operationId: string
  committed: true
  warnings: string[]
}

interface BrowserFileBinding {
  tabId: string
  oldUrl: string
  newUrl: string
}

interface ProjectionStage {
  name: string
  apply: () => void
}

let relocationSequence = 0
let relocationQueue: Promise<void> = Promise.resolve()

function nextOperationId(): string {
  relocationSequence += 1
  return `file-relocation-${Date.now()}-${relocationSequence}`
}

function rebasePath(
  path: string | undefined,
  sourcePath: string,
  targetPath: string,
): string | undefined {
  if (!path) return path
  if (path === sourcePath) return targetPath
  if (path.startsWith(sourcePath + '/')) return targetPath + path.slice(sourcePath.length)
  return path
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function captureBrowserFileBindings(sourcePath: string, targetPath: string): BrowserFileBinding[] {
  const browserState = useBrowserStore.getState()
  return useTabStore.getState().tabs.flatMap((tab) => {
    if (tab.type !== 'browser' || !tab.filePath) return []
    const nextPath = rebasePath(tab.filePath, sourcePath, targetPath)
    if (!nextPath || nextPath === tab.filePath) return []
    const oldUrl = toLocalFileUrl(tab.filePath)
    const browserTab = browserState.tabs[tab.id]
    if (!browserTab || browserTab.url !== oldUrl) return []
    return [{ tabId: tab.id, oldUrl, newUrl: toLocalFileUrl(nextPath) }]
  })
}

function createProjectionStages(
  input: FileRelocationTransitionInput,
  diskResult: FileRelocationDiskResult,
  moves: FileRelocationMove[],
  browserBindings: BrowserFileBinding[],
): ProjectionStage[] {
  return [
    {
      name: 'editor',
      apply: () => {
        const editor = useEditorStore.getState()
        if (diskResult.snapshot) {
          editor.relocateMarkdownFile(input.sourcePath, input.targetPath, diskResult.snapshot)
        } else {
          editor.rebaseFilePaths(input.sourcePath, input.targetPath)
        }
        for (const move of diskResult.companionMoves ?? []) {
          editor.rebaseFilePaths(move.sourcePath, move.targetPath)
        }
      },
    },
    {
      name: 'tabs',
      apply: () => {
        const tabs = useTabStore.getState()
        for (const move of moves) tabs.rebaseFilePaths(move.sourcePath, move.targetPath)
        for (const tab of useTabStore.getState().tabs) {
          if (tab.filePath === input.targetPath)
            tabs.updateTabTitle(tab.id, baseName(input.targetPath))
        }
      },
    },
    {
      name: 'agent-resources',
      apply: () => {
        const agent = useAgentStore.getState()
        for (const move of moves) {
          agent.rebaseMountedResourcePaths(move.sourcePath, move.targetPath)
        }
      },
    },
    {
      name: 'browser-state',
      apply: () => {
        const browser = useBrowserStore.getState()
        for (const binding of browserBindings) {
          const current = browser.tabs[binding.tabId]
          if (!current || current.url === binding.newUrl) continue
          browser.setUrl(binding.tabId, binding.newUrl, {
            history: current.history.map((url) => (url === binding.oldUrl ? binding.newUrl : url)),
            historyIndex: current.historyIndex,
          })
        }
      },
    },
    {
      name: 'file-tree',
      apply: () => input.applyFileSystemProjection(moves),
    },
  ]
}

function applyProjectionStages(stages: ProjectionStage[]): string[] {
  let remaining = stages
  for (let attempt = 0; attempt < 2 && remaining.length > 0; attempt += 1) {
    const failed: ProjectionStage[] = []
    for (const stage of remaining) {
      try {
        stage.apply()
      } catch (error) {
        console.error(`[FileRelocation] ${stage.name} 投影失败:`, error)
        failed.push(stage)
      }
    }
    remaining = failed
  }
  return remaining.map((stage) => stage.name)
}

async function navigateBrowserBindings(bindings: BrowserFileBinding[]): Promise<string[]> {
  const navigate = window.cclinkStudio?.browser?.navigate
  if (!navigate || bindings.length === 0) return []
  const results = await Promise.allSettled(
    bindings.map((binding) => navigate(binding.tabId, binding.newUrl)),
  )
  return results.flatMap((result, index) => {
    if (result.status === 'fulfilled') return []
    console.warn('[FileRelocation] 本地 HTML 重新导航失败:', {
      tabId: bindings[index]?.tabId,
      error: result.reason,
    })
    return [`browser-navigation:${bindings[index]?.tabId ?? 'unknown'}`]
  })
}

async function persistRelocationProjection(
  input: FileRelocationTransitionInput,
): Promise<string[]> {
  let warnings: string[] = []
  for (let attempt = 0; attempt < 2; attempt += 1) {
    warnings = []
    const [runtimePersistence, fsPersistence] = await Promise.allSettled([
      persistRuntimeSections(input.workspacePath),
      input.persistFileSystemProjection(),
    ])
    if (runtimePersistence.status === 'rejected') {
      warnings.push('persistence:runtime')
    } else if (!runtimePersistence.value.success) {
      warnings.push(
        ...runtimePersistence.value.failures.map((failure) => `persistence:${failure.section}`),
      )
    }
    if (fsPersistence.status === 'rejected') warnings.push('persistence:file-tree')
    if (warnings.length === 0) return []
  }
  return warnings
}

async function runTransition(
  input: FileRelocationTransitionInput,
): Promise<FileRelocationTransitionResult> {
  const operationId = nextOperationId()
  const browserBindings = captureBrowserFileBindings(input.sourcePath, input.targetPath)
  const editorLock = await beginEditorFileRelocation(input.sourcePath)

  try {
    await window.cclinkStudio.fs.beginFileRelocation({
      operationId,
      workspacePath: input.workspacePath,
      moves: [{ sourcePath: input.sourcePath, targetPath: input.targetPath }],
    })
    let diskResult: FileRelocationDiskResult
    try {
      diskResult = await input.commitDisk()
    } catch (error) {
      // 磁盘操作可能已部分完成；保留 prepared 记录，由重启恢复按源/目标事实判定。
      throw error
    }
    const moves = [
      { sourcePath: input.sourcePath, targetPath: input.targetPath },
      ...(diskResult.companionMoves ?? []),
    ]
    await window.cclinkStudio.fs.markFileRelocationCommitted({ operationId, moves })
    const stages = createProjectionStages(input, diskResult, moves, browserBindings)
    let failedStages: string[]
    beginWorkspaceStateRestore()
    try {
      failedStages = applyProjectionStages(stages)
    } finally {
      endWorkspaceStateRestore()
    }

    const warnings = failedStages.map((stage) => `projection:${stage}`)
    if (failedStages.length === 0) {
      warnings.push(...(await persistRelocationProjection(input)))
    }

    const [verified, browserWarnings] = await Promise.all([
      input.verifyFileSystemProjection(),
      navigateBrowserBindings(browserBindings),
    ])
    if (!verified) warnings.push('verification:file-tree')
    warnings.push(...browserWarnings)

    if (warnings.length === 0) {
      await window.cclinkStudio.fs.completeFileRelocation(operationId)
    }

    recordRendererDiagnosticLog(warnings.length > 0 ? 'warn' : 'info', [
      '[FileRelocation] completed',
      {
        operationId,
        status: warnings.length > 0 ? 'projection-pending' : 'completed',
        warnings,
      },
    ])
    return { operationId, committed: true, warnings }
  } finally {
    endEditorFileRelocation(editorLock)
  }
}

/** 重启后重放已经落盘、尚未持久化到工作台状态的路径投影。冲突记录保持待诊断。 */
export async function recoverPendingFileRelocations(
  workspacePath: string,
  refreshFileTree: () => Promise<void>,
): Promise<{ recovered: number; conflicts: number; pending: number }> {
  const entries = await window.cclinkStudio.fs.listPendingFileRelocations(workspacePath)
  let recovered = 0
  let conflicts = 0
  let pending = 0
  for (const entry of entries) {
    if (entry.state === 'conflict') {
      conflicts += 1
      recordRendererDiagnosticLog('warn', [
        '[FileRelocation] recovery conflict',
        { operationId: entry.operationId },
      ])
      continue
    }
    const [primary, ...companions] = entry.moves
    if (!primary) continue
    const browserBindings = entry.moves.flatMap((move) =>
      captureBrowserFileBindings(move.sourcePath, move.targetPath),
    )
    const stages = createProjectionStages(
      {
        workspacePath,
        sourcePath: primary.sourcePath,
        targetPath: primary.targetPath,
        commitDisk: async () => ({}),
        applyFileSystemProjection: () => undefined,
        verifyFileSystemProjection: async () => true,
        persistFileSystemProjection: async () => undefined,
      },
      { companionMoves: companions },
      entry.moves,
      browserBindings,
    ).filter((stage) => stage.name !== 'file-tree')
    beginWorkspaceStateRestore()
    let failures: string[]
    try {
      failures = applyProjectionStages(stages)
    } finally {
      endWorkspaceStateRestore()
    }
    const persistence = failures.length === 0 ? await persistRuntimeSections(workspacePath) : null
    const browserWarnings = await navigateBrowserBindings(browserBindings)
    await refreshFileTree()
    if (failures.length === 0 && persistence?.success && browserWarnings.length === 0) {
      await window.cclinkStudio.fs.completeFileRelocation(entry.operationId)
      recovered += 1
    } else {
      pending += 1
      recordRendererDiagnosticLog('warn', [
        '[FileRelocation] recovery remains pending',
        {
          operationId: entry.operationId,
          failures,
          persistence: persistence?.failures ?? [],
          browserWarnings,
        },
      ])
    }
  }
  return { recovered, conflicts, pending }
}

/** Serialize local file relocations so overlapping directory moves cannot interleave projections. */
export async function executeFileRelocationTransition(
  input: FileRelocationTransitionInput,
): Promise<FileRelocationTransitionResult> {
  const previous = relocationQueue.catch(() => undefined)
  let release!: () => void
  relocationQueue = new Promise<void>((resolve) => {
    release = resolve
  })
  await previous
  try {
    return await runTransition(input)
  } finally {
    release()
  }
}
