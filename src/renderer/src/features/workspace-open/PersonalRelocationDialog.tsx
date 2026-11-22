import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DiaryRootPreview, PersonalRelocationPreview } from '@shared/ipc/workspace-state'
import { useFixedSpacesStore, openPersonalSpace } from './fixed-spaces-store'
import { useFloatingSurfaceRegistration } from '../../components/common/floating-surface-registry'
import { useEscapeDismiss } from '../../components/common/dismissable-layer'
import './fixed-spaces.css'

const ipcMessage = (error: unknown): string =>
  String(error)
    .replace(/^Error: /, '')
    .replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/i, '')

/** Shown only when main can no longer prove the bound personal folder; main owns the binding. */
export function PersonalRelocationDialog(): React.ReactElement | null {
  const request = useFixedSpacesStore((state) => state.relocate)
  const [preview, setPreview] = useState<PersonalRelocationPreview | null>(null)
  const [choice, setChoice] = useState<'' | 'candidate'>('')
  /** 改用其他目录: a different diary folder, used when the old one is gone for good. */
  const [other, setOther] = useState<DiaryRootPreview | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const close = (): void => {
    if (busy) return
    setPreview(null)
    setOther(null)
    setChoice('')
    setError('')
    useFixedSpacesStore.setState({ relocate: null })
  }
  useFloatingSurfaceRegistration(Boolean(request))
  useEscapeDismiss(Boolean(request), close)
  if (!request) return null
  const both = Boolean(preview?.previous && preview.previous.diaryCount > 0)
  async function choose(): Promise<void> {
    setError('')
    const result = await window.cclinkStudio.dialog.showOpenDialog({
      selectDirectory: true,
      title: '选择移动后的项目文件夹',
    })
    if (result.canceled || !result.filePaths[0]) return
    setPreview(null)
    setChoice('')
    try {
      setPreview(
        await window.cclinkStudio.workspaceState.inspectPersonalRelocation(result.filePaths[0]),
      )
    } catch (failure) {
      setError(ipcMessage(failure))
    }
  }
  async function relocate(): Promise<void> {
    if (!preview) return
    setBusy(true)
    try {
      await window.cclinkStudio.workspaceState.relocatePersonalSpace(preview)
      useFixedSpacesStore.setState({ relocate: null })
      setPreview(null)
      setChoice('')
      await openPersonalSpace()
    } catch (failure) {
      setError(ipcMessage(failure))
    } finally {
      setBusy(false)
    }
  }
  async function chooseOther(): Promise<void> {
    setError('')
    const result = await window.cclinkStudio.dialog.showOpenDialog({
      selectDirectory: true,
      title: '选择要改用的日记目录',
    })
    if (result.canceled || !result.filePaths[0]) return
    setPreview(null)
    try {
      setOther(await window.cclinkStudio.workspaceState.inspectDiaryRoot(result.filePaths[0]))
    } catch (failure) {
      setError(ipcMessage(failure))
    }
  }
  async function useOther(): Promise<void> {
    if (!other) return
    setBusy(true)
    try {
      await window.cclinkStudio.workspaceState.replaceUnavailablePersonalSpace(other)
      useFixedSpacesStore.setState({ relocate: null })
      setOther(null)
      await openPersonalSpace()
    } catch (failure) {
      setError(ipcMessage(failure))
    } finally {
      setBusy(false)
    }
  }
  const row = (
    label: string,
    path: string,
    detail: { directory: string; latestFile: string | null; diaryCount?: number } | null,
    note: string,
  ): React.ReactElement => (
    <div className="relocation-side">
      <strong>{label}</strong>
      <p className="fixed-space-path">{path}</p>
      <p>
        {detail
          ? `日记目录 · ${detail.directory}　日记 ${detail.diaryCount ?? 0} 篇　最近 · ${detail.latestFile ?? '暂无'}`
          : note}
      </p>
    </div>
  )
  return createPortal(
    <div className="fixed-space-overlay">
      <div
        className="fixed-space-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="personal-relocation-title"
        tabIndex={-1}
        ref={dialogRef}
      >
        <header>
          <div>
            <span>项目首页 / 资料位置</span>
            <h2 id="personal-relocation-title">重新定位日记项目</h2>
          </div>
          <button onClick={close} disabled={busy} aria-label="关闭重新定位">
            ×
          </button>
        </header>
        <p>上次使用的目录目前不可访问。选择移动后的项目文件夹，核对最近一篇日记后恢复连接。</p>
        {row(
          '上次位置',
          request.previousPath,
          preview?.previous ?? null,
          preview?.previousState === 'other' ? '此位置现有内容不属于原项目' : '目录不存在或已移动',
        )}
        {preview && row('移动后的位置', preview.candidate.workspacePath, preview.candidate, '')}
        {other && (
          <div className="relocation-side" aria-label="改用其他目录">
            <strong>改用其他目录</strong>
            <p className="fixed-space-path">{other.workspacePath}</p>
            <p>
              日记目录 · {other.directory}　日记 {other.diaryCount ?? 0} 篇　最近 ·{' '}
              {other.latestFile ?? '暂无'}
            </p>
            <p>
              「我的空间」将改用此目录。上次位置的项目若以后找回，可在历史项目中打开，其中的私有任务不会自动接回。
            </p>
            <button className="primary" disabled={busy} onClick={() => void useOther()}>
              确认改用此目录
            </button>
          </div>
        )}
        {preview && both && (
          <div className="fixed-space-candidates">
            <p>两个位置都有日记。原位置的文件不会被移动、合并或删除；请确认之后使用哪一份。</p>
            <label className={choice === 'candidate' ? 'selected' : ''}>
              <input
                type="checkbox"
                checked={choice === 'candidate'}
                onChange={(event) => setChoice(event.target.checked ? 'candidate' : '')}
              />
              使用移动后的位置（带有原项目身份）
            </label>
          </div>
        )}
        {error && (
          <p className="fixed-space-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button onClick={close} disabled={busy}>
            取消，保留原绑定
          </button>
          <button disabled={busy} onClick={() => void chooseOther()}>
            改用其他目录…
          </button>
          <button disabled={busy} onClick={() => void choose()}>
            {preview ? '重新选择…' : '选择项目文件夹'}
          </button>
          <button
            className="primary"
            disabled={busy || !preview || (both && choice !== 'candidate')}
            onClick={() => void relocate()}
          >
            {busy ? '正在恢复…' : '确认并恢复连接'}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
