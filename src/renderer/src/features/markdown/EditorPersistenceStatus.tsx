import { persistEditorDrafts, useEditorStore } from '../../stores/editor-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import {
  useWorkspacePersistenceStore,
  workspaceSectionPersistenceKey,
} from '../../utils/workspace-state'
import './editor-persistence.css'

function useDraftPersistence() {
  useWorkspaceStore((state) => state.activeWorkspaceRef)
  const key = workspaceSectionPersistenceKey('editorDrafts')
  return useWorkspacePersistenceStore((state) => state.sections[key])
}

export function EditorDraftFailureBanner(): React.ReactElement | null {
  const persistence = useDraftPersistence()
  if (!persistence?.error) return null
  return (
    <div className="editor-draft-failure" role="alert">
      <span>
        草稿保留失败，最新内容仍在当前窗口：{persistence.error.message}。请重试或先保存文件。
      </span>
      <button
        type="button"
        disabled={persistence.status === 'saving'}
        onClick={() => void persistEditorDrafts().catch(() => {})}
      >
        重试保留草稿
      </button>
    </div>
  )
}

export function EditorPersistenceStatus({
  fileKey,
  autoSave = false,
  onSave,
}: {
  fileKey: string
  autoSave?: boolean
  onSave: () => void
}): React.ReactElement | null {
  const file = useEditorStore((state) => state.files[fileKey])
  const persistence = useDraftPersistence()
  if (!file || (!file.dirty && !file.saving && !file.error)) return null
  const draftLabel = persistence?.error
    ? '草稿未保留'
    : persistence?.status === 'saved'
      ? '草稿已保留'
      : '正在保留草稿'
  const label = file.saving
    ? '正在保存文件…'
    : file.externalContent !== undefined
      ? '文件有外部修改，请先处理冲突'
      : file.error
        ? `文件保存失败：${file.error}`
        : autoSave && !file.diagnostics?.some((item) => item.severity === 'error')
          ? '等待自动保存'
          : '文件未保存'
  return (
    <div className={`editor-persistence-status${file.error ? ' error' : ''}`} role="status">
      <span>
        {label} · {draftLabel}
      </span>
      {file.error && file.externalContent === undefined && (
        <button type="button" disabled={file.saving} onClick={onSave}>
          重试保存文件
        </button>
      )}
    </div>
  )
}
