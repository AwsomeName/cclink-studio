import { isMarkdownDocumentPath } from '@shared/markdown-document'
import { useEditorStore, type EditorFileState } from '../../stores/editor-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useTabStore } from '../../stores/tab-store'
import { isWorkspaceStateRestoring } from '../../utils/workspace-state'

const AUTOSAVE_DELAY_MS = 1_500
let flushActiveController: (() => Promise<void>) | null = null

function canAutoSave(path: string, file: EditorFileState): boolean {
  return (
    !path.startsWith('virtual:') &&
    isMarkdownDocumentPath(path) &&
    file.dirty &&
    !file.loading &&
    !file.saving &&
    !file.error &&
    file.externalContent === undefined &&
    !file.diagnostics?.some((diagnostic) => diagnostic.severity === 'error')
  )
}

/** One lifecycle-bound scheduler; EditorStore remains the owner of content and file writes. */
export function startMarkdownAutosave(): () => void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const writes = new Set<Promise<unknown>>()
  let disposed = false
  const clear = (path: string): void => {
    const timer = timers.get(path)
    if (timer) clearTimeout(timer)
    timers.delete(path)
  }
  const save = (path: string): void => {
    clear(path)
    const file = useEditorStore.getState().files[path]
    if (
      disposed ||
      useSettingsStore.getState().loading ||
      !useSettingsStore.getState().settings.markdownAutoSave ||
      !file ||
      !canAutoSave(path, file)
    )
      return
    const write = useEditorStore
      .getState()
      .saveFile(path)
      .catch(() => {
        // saveFile retains the buffer and error. Retry is explicit, never a tight failure loop.
      })
    writes.add(write)
    void write.finally(() => writes.delete(write))
  }
  const reconcile = (previousFiles?: Record<string, EditorFileState>): void => {
    const files = useEditorStore.getState().files
    if (!isWorkspaceStateRestoring()) {
      // Inactive editors are unmounted. Keep their tab indicators in sync with acknowledged saves.
      const tabs = useTabStore.getState()
      for (const tab of tabs.tabs) {
        if (tab.type !== 'editor') continue
        const file = files[tab.filePath ?? `virtual:${tab.id}`]
        if (file && tab.dirty !== file.dirty) tabs.updateTabDirty(tab.id, file.dirty)
      }
    }
    const settings = useSettingsStore.getState()
    const enabled = !settings.loading && settings.settings.markdownAutoSave
    for (const path of timers.keys()) {
      if (!enabled || !files[path] || !canAutoSave(path, files[path])) clear(path)
    }
    if (!enabled || isWorkspaceStateRestoring()) return
    for (const [path, file] of Object.entries(files)) {
      if (!canAutoSave(path, file)) continue
      const previous = previousFiles?.[path]
      if (
        timers.has(path) &&
        previous?.currentContent === file.currentContent &&
        previous.sessionId === file.sessionId
      )
        continue
      clear(path)
      const sessionId = file.sessionId
      timers.set(
        path,
        setTimeout(() => {
          if (useEditorStore.getState().files[path]?.sessionId !== sessionId) {
            clear(path)
            return
          }
          save(path)
        }, AUTOSAVE_DELAY_MS),
      )
    }
  }
  const offEditor = useEditorStore.subscribe((state, previous) => {
    if (state.files !== previous.files) reconcile(previous.files)
  })
  const offSettings = useSettingsStore.subscribe((state, previous) => {
    if (
      state.loading !== previous.loading ||
      state.settings.markdownAutoSave !== previous.settings.markdownAutoSave
    )
      reconcile()
  })
  const flush = async (): Promise<void> => {
    for (const path of [...timers.keys()]) save(path)
    while (writes.size) await Promise.all([...writes])
  }
  flushActiveController = flush
  reconcile()
  return () => {
    disposed = true
    offEditor()
    offSettings()
    for (const path of timers.keys()) clear(path)
    if (flushActiveController === flush) flushActiveController = null
  }
}

export async function flushMarkdownAutosaves(): Promise<void> {
  await flushActiveController?.()
}
