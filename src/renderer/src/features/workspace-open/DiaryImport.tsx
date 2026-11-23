import { useState } from 'react'
import type { DiaryImportPreview } from '@shared/ipc/workspace-state'
import { useWorkspaceStore } from '../../stores/workspace-store'

export const ipcMessage = (error: unknown): string =>
  String(error)
    .replace(/^Error: /, '')
    .replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/i, '')

/** Picks a history folder and shows, read-only, what would be copied into My Space. */
export function DiaryImportPicker({
  preview,
  onChange,
  suggestion,
  disabled,
}: {
  preview: DiaryImportPreview | null
  onChange: (preview: DiaryImportPreview | null) => void
  /** An older My Space folder: reviewed like any picked folder, never adopted. */
  suggestion?: string
  disabled?: boolean
}): React.ReactElement {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const inspect = (path: string): void => {
    setBusy(true)
    setError('')
    void window.cclinkStudio.workspaceState
      .inspectDiaryImport(path)
      .then(onChange)
      .catch((e) => {
        onChange(null)
        setError(ipcMessage(e))
      })
      .finally(() => setBusy(false))
  }
  const choose = (defaultPath?: string): void => {
    void window.cclinkStudio.dialog
      .showOpenDialog({ selectDirectory: true, title: '选择历史日记目录', defaultPath })
      .then((picked) => {
        if (!picked.canceled && picked.filePaths[0]) inspect(picked.filePaths[0])
      })
  }
  return (
    <div className="diary-import">
      <p>
        <button disabled={disabled || busy} onClick={() => choose()}>
          {busy ? '正在读取…' : '选择文件夹…'}
        </button>
        {suggestion && !preview && (
          <button
            className="diary-link"
            disabled={disabled || busy}
            onClick={() => choose(suggestion)}
          >
            从上次使用的目录选择：{suggestion}
          </button>
        )}
      </p>
      {preview && (
        <dl className="diary-facts" aria-label="导入核对">
          <dt>来源</dt>
          <dd>{preview.sourcePath}</dd>
          <dt>日记</dt>
          <dd>
            {preview.diaryCount} 篇 · 最近 {preview.latestFile ?? '暂无'}
          </dd>
          <dt>将复制</dt>
          <dd>{preview.fileCount - preview.skipCount} 个文件 → 我的空间</dd>
          {preview.skipCount > 0 && (
            <>
              <dt>跳过</dt>
              <dd>
                {preview.skipCount} 个同名文件（我的空间里已有，保留现有内容）：
                {preview.skipped.slice(0, 3).join('、')}
                {preview.skipCount > 3 ? ' 等' : ''}
              </dd>
            </>
          )}
          <dt>原目录</dt>
          <dd>只读取，不移动、不修改，也不会变成我的空间</dd>
        </dl>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  )
}

/** 项目设置 › 从历史导入: the same review, then copy. */
export function DiaryImportPage({ onDone }: { onDone: () => void }): React.ReactElement {
  const [preview, setPreview] = useState<DiaryImportPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState('')
  const run = (): void => {
    if (!preview) return
    setBusy(true)
    setError('')
    void window.cclinkStudio.workspaceState
      .importDiaryHistory(preview)
      .then(async (done) => {
        setPreview(null)
        setResult(
          `已复制 ${done.copied} 个文件` +
            (done.skipped ? `，跳过 ${done.skipped} 个同名文件` : ''),
        )
        await useWorkspaceStore.getState().refreshSettings()
      })
      .catch((e) => setError(ipcMessage(e)))
      .finally(() => setBusy(false))
  }
  return (
    <div className="diary-setup-body" aria-label="从历史导入">
      <p className="muted">
        从旧电脑、旧项目或备份里复制日记进来。可以多次导入；同名文件不覆盖，原目录不改动。
      </p>
      <DiaryImportPicker
        preview={preview}
        onChange={(next) => {
          setResult('')
          setPreview(next)
        }}
        disabled={busy}
      />
      {result && <p role="status">{result}</p>}
      {error && <p role="alert">{error}</p>}
      <div className="diary-actions">
        <button disabled={busy} onClick={onDone}>
          {result ? '返回今天' : '取消'}
        </button>
        <button className="primary" disabled={busy || !preview} onClick={run}>
          {busy
            ? '正在复制…'
            : preview
              ? `复制 ${preview.fileCount - preview.skipCount} 个文件`
              : '复制'}
        </button>
      </div>
    </div>
  )
}
