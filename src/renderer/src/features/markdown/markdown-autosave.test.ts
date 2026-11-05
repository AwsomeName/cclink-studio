import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FsSaveTextDocumentResult } from '@shared/ipc/fs'
import { useEditorStore } from '../../stores/editor-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useTabStore } from '../../stores/tab-store'
import { flushMarkdownAutosaves, startMarkdownAutosave } from './markdown-autosave'

const path = '/workspace/note.md'
let stop: (() => void) | undefined
const file = (content = '# Original') => ({
  savedContent: content,
  currentContent: content,
  dirty: false,
  loading: false,
  versionHash: 'old',
})

beforeEach(() => {
  vi.useFakeTimers()
  useEditorStore.setState({ files: {}, pendingUpdates: [], markdownViewStates: {} })
  useTabStore.setState({ tabs: [], activeTabId: null })
  useSettingsStore.setState({
    loading: false,
    settings: { ...useSettingsStore.getInitialState().settings, markdownAutoSave: true },
  })
  vi.stubGlobal('window', {
    cclinkStudio: {
      fs: {
        saveTextDocument: vi.fn(async (input) => ({
          status: 'saved',
          snapshot: {
            path: input.filePath,
            content: input.content,
            hash: 'new',
            modifiedAt: 2,
            size: input.content.length,
          },
        })),
      },
    },
  })
  stop = startMarkdownAutosave()
})

afterEach(() => {
  stop?.()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Markdown autosave', () => {
  it('debounces the latest content and excludes unnamed and other file types', async () => {
    useEditorStore.setState({
      files: {
        [path]: file(),
        'virtual:one': file(),
        '/workspace/a.html': file(),
        '/workspace/a.txt': file(),
      },
    })
    for (const key of Object.keys(useEditorStore.getState().files))
      useEditorStore.getState().updateContent(key, '# First')
    await vi.advanceTimersByTimeAsync(1000)
    useEditorStore.getState().updateContent(path, '# Latest')
    await vi.advanceTimersByTimeAsync(1499)
    expect(window.cclinkStudio.fs.saveTextDocument).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(window.cclinkStudio.fs.saveTextDocument).toHaveBeenCalledTimes(1)
    expect(window.cclinkStudio.fs.saveTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: path, content: '# Latest', expectedHash: 'old' }),
    )
    expect(useEditorStore.getState().files[path].dirty).toBe(false)
  })

  it('keeps later edits dirty while an earlier save is in flight', async () => {
    let finish!: (value: FsSaveTextDocumentResult) => void
    vi.mocked(window.cclinkStudio.fs.saveTextDocument).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    useEditorStore.setState({ files: { [path]: file() } })
    useEditorStore.getState().updateContent(path, '# First')
    await vi.advanceTimersByTimeAsync(1500)
    expect(useEditorStore.getState().files[path].saving).toBe(true)
    useEditorStore.getState().updateContent(path, '# Second')
    finish({
      status: 'saved',
      snapshot: { path, content: '# First', hash: 'first', modifiedAt: 2, size: 7 },
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(useEditorStore.getState().files[path].dirty).toBe(true)
    await vi.advanceTimersByTimeAsync(1500)
    expect(useEditorStore.getState().files[path].savedContent).toBe('# Second')
  })

  it('updates the dirty indicator of an inactive tab when its file is saved', async () => {
    useTabStore.setState({
      tabs: [
        {
          id: 'note',
          type: 'editor',
          title: 'note.md',
          icon: 'file',
          filePath: path,
          dirty: false,
        },
      ],
      activeTabId: null,
    })
    useEditorStore.setState({ files: { [path]: file() } })
    useEditorStore.getState().updateContent(path, '# Background edit')
    expect(useTabStore.getState().tabs[0].dirty).toBe(true)
    await vi.advanceTimersByTimeAsync(1500)
    expect(useTabStore.getState().tabs[0].dirty).toBe(false)
    expect(useTabStore.getState().activeTabId).toBeNull()
  })

  it('pauses after a write failure, retains content, and allows explicit retry', async () => {
    vi.mocked(window.cclinkStudio.fs.saveTextDocument).mockRejectedValueOnce(new Error('只读目录'))
    useEditorStore.setState({ files: { [path]: file() } })
    useEditorStore.getState().updateContent(path, '# Keep me')
    await vi.advanceTimersByTimeAsync(1500)
    expect(useEditorStore.getState().files[path]).toMatchObject({
      dirty: true,
      error: '只读目录',
      saving: false,
    })
    useEditorStore.getState().updateContent(path, '# Still here')
    await vi.advanceTimersByTimeAsync(10000)
    expect(window.cclinkStudio.fs.saveTextDocument).toHaveBeenCalledTimes(1)
    await useEditorStore.getState().saveFile(path)
    expect(useEditorStore.getState().files[path].savedContent).toBe('# Still here')
  })

  it('honors disabling and never force-writes over an external conflict', async () => {
    useEditorStore.setState({ files: { [path]: file() } })
    useEditorStore.getState().updateContent(path, '# Draft')
    useSettingsStore.setState((state) => ({
      settings: { ...state.settings, markdownAutoSave: false },
    }))
    await flushMarkdownAutosaves()
    await vi.advanceTimersByTimeAsync(2000)
    expect(window.cclinkStudio.fs.saveTextDocument).not.toHaveBeenCalled()
    vi.mocked(window.cclinkStudio.fs.saveTextDocument).mockResolvedValueOnce({
      status: 'conflict',
      current: { path, content: '# External', hash: 'external', modifiedAt: 3, size: 10 },
    })
    useSettingsStore.setState((state) => ({
      settings: { ...state.settings, markdownAutoSave: true },
    }))
    await vi.advanceTimersByTimeAsync(1500)
    expect(useEditorStore.getState().files[path]).toMatchObject({
      currentContent: '# Draft',
      externalContent: '# External',
      dirty: true,
    })
    await vi.advanceTimersByTimeAsync(10000)
    expect(window.cclinkStudio.fs.saveTextDocument).toHaveBeenCalledTimes(1)
  })
})
