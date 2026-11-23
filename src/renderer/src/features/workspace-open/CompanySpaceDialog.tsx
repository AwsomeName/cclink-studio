import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CompanySpaceCandidate } from '@shared/ipc/workspace-state'
import { useFixedSpacesStore, openPersonalSpace, openBoundCompany } from './fixed-spaces-store'
import { openCompanyWorkspace } from '../company-workspace/company-workspace-commands'
import { isWorkspaceRuntimeTransitionCurrent } from '../../utils/workspace-transition'
import { useFloatingSurfaceRegistration } from '../../components/common/floating-surface-registry'
import { useEscapeDismiss } from '../../components/common/dismissable-layer'
import './fixed-spaces.css'

export function CompanySpaceDialog(): React.ReactElement | null {
  const request = useFixedSpacesStore((state) => state.setup)
  const spaces = useFixedSpacesStore((state) => state.spaces)
  const [candidates, setCandidates] = useState<CompanySpaceCandidate[]>([])
  const [selected, setSelected] = useState('')
  const [name, setName] = useState('我的公司')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [activationPending, setActivationPending] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const close = (): void => {
    if (!busy) useFixedSpacesStore.setState({ setup: null })
  }
  useFloatingSurfaceRegistration(Boolean(request))
  useEscapeDismiss(Boolean(request), close)
  useEffect(() => {
    if (!request) return
    let disposed = false
    const previousFocus = document.activeElement as HTMLElement | null
    setError(request.error || '')
    setSelected('')
    setCandidates([])
    setConfirmed(false)
    setActivationPending(false)
    setLoading(true)
    void window.cclinkStudio.workspaceState
      .listCompanySpaces()
      .then((items) => {
        if (disposed) return
        setCandidates(items)
        const usable = items.filter((item) => item.state === 'company')
        if (usable.length === 1) setSelected(usable[0].workspacePath)
        else if (items.length === 0 && !useFixedSpacesStore.getState().spaces?.company)
          setSelected('__new__')
      })
      .catch((failure) => {
        if (!disposed) setError(String(failure))
      })
      .finally(() => {
        if (!disposed) setLoading(false)
      })
    dialogRef.current?.focus()
    return () => {
      disposed = true
      previousFocus?.focus()
    }
  }, [request])
  if (!request) return null
  const candidate = candidates.find((item) => item.workspacePath === selected)
  const replacingPersonal = Boolean(
    candidate?.projectId && candidate.projectId === spaces?.personal?.projectId,
  )
  const changingCompany = Boolean(
    spaces?.company && candidate?.projectId !== spaces.company.projectId,
  )
  const needsConfirmation = changingCompany
  const activate = async (): Promise<void> => {
    if (!(await openBoundCompany(request.section))) return
    openCompanyWorkspace(request.section)
    if (useFixedSpacesStore.getState().setup === request)
      useFixedSpacesStore.setState({ setup: null })
  }
  const connect = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      // The binding may already be saved while restoring its workspace failed. A retry is
      // a fresh user navigation request, not a second binding write with the stale generation.
      if (activationPending) {
        await activate()
        return
      }
      if (!isWorkspaceRuntimeTransitionCurrent(request.generation))
        throw new Error('工作空间已切换，请关闭此面板后重新进入我的公司')
      const next = await window.cclinkStudio.workspaceState.connectCompanySpace({
        ...(selected && selected !== '__new__' ? { workspacePath: selected } : {}),
        ...(candidate?.state !== 'company' ? { initializeName: name.trim() } : {}),
      })
      useFixedSpacesStore.setState({ spaces: next })
      setActivationPending(true)
      if (isWorkspaceRuntimeTransitionCurrent(request.generation)) await activate()
      else if (useFixedSpacesStore.getState().setup === request)
        useFixedSpacesStore.setState({ setup: null })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }
  const locate = async (): Promise<void> => {
    setError('')
    try {
      const picked = await window.cclinkStudio.dialog.showOpenDialog({
        title: '选择原公司资料目录',
        selectDirectory: true,
      })
      if (picked.canceled || !picked.filePaths[0]) return
      const item = await window.cclinkStudio.workspaceState.inspectCompanySpace(picked.filePaths[0])
      setCandidates((items) => [
        ...items.filter((value) => value.workspacePath !== item.workspacePath),
        item,
      ])
      setSelected(item.workspacePath)
      setConfirmed(false)
    } catch (failure) {
      setError(String(failure))
    }
  }
  return createPortal(
    <div className="fixed-space-overlay">
      <div
        className="fixed-space-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="company-space-title"
        tabIndex={-1}
        ref={dialogRef}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return
          const controls = [
            ...event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled),input:not(:disabled)',
            ),
          ]
          const first = controls[0],
            last = controls.at(-1)
          if (
            event.shiftKey &&
            (document.activeElement === first || document.activeElement === event.currentTarget)
          ) {
            event.preventDefault()
            last?.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first?.focus()
          }
        }}
      >
        <header>
          <div>
            <span>公司项目</span>
            <h2 id="company-space-title">
              {request.error ? '找回原公司资料' : '连接已有公司，或开始新公司'}
            </h2>
          </div>
          <button onClick={close} disabled={busy} aria-label="关闭公司设置">
            ×
          </button>
        </header>
        <p>
          只关联入口，不移动、不合并或覆盖资料。原目录里的笔记、账目、会话与发布记录继续留在原处。
        </p>
        {spaces?.company && (
          <p className="fixed-space-path">原公司：{spaces.company.workspacePath}</p>
        )}
        {loading && <p role="status">正在只读检查已登记的公司…</p>}
        <div className="fixed-space-candidates">
          {candidates.map((item) => (
            <label
              key={item.workspacePath}
              className={selected === item.workspacePath ? 'selected' : ''}
            >
              <input
                type="radio"
                name="company-space"
                checked={selected === item.workspacePath}
                disabled={busy || activationPending || item.state === 'unavailable'}
                onChange={() => {
                  setSelected(item.workspacePath)
                  setConfirmed(false)
                }}
              />
              <span>
                <strong>
                  {item.name ||
                    (item.relatedData === 'ledger'
                      ? '已有账目 · 尚未启用公司'
                      : item.relatedData === 'manuscripts'
                        ? '已有原稿 · 尚未启用公司'
                        : '已选目录')}
                  {item.state === 'company' && !item.enabled ? ' · 已停用，资料保留' : ''}
                </strong>
                <small>{item.workspacePath}</small>
                {item.error && <small role="status">无法核验：{item.error}</small>}
              </span>
            </label>
          ))}
          {!spaces?.company && (
            <label className={selected === '__new__' ? 'selected' : ''}>
              <input
                type="radio"
                name="company-space"
                checked={selected === '__new__'}
                disabled={busy || activationPending}
                onChange={() => {
                  setSelected('__new__')
                  setConfirmed(false)
                }}
              />
              <span>
                <strong>启用一份新公司</strong>
                <small>独立目录：~/CCLink Studio/我的公司；原有资料保持原位</small>
              </span>
            </label>
          )}
        </div>
        <button onClick={() => void locate()} disabled={busy || loading || activationPending}>
          定位原目录／选择其他公司
        </button>
        {(selected === '__new__' || candidate?.state === 'empty') && (
          <label className="fixed-space-name">
            公司名称
            <input
              aria-label="新公司名称"
              value={name}
              maxLength={128}
              disabled={busy || activationPending}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        )}
        <p>“我的空间”使用独立目录；旧目录中混有个人资料时，本次保留整个目录，不自动拆分。</p>
        {replacingPersonal && (
          <p className="fixed-space-error" role="alert">
            这是我的空间的目录，不能用作公司。请选择其他目录或新建公司。
          </p>
        )}
        {needsConfirmation && (
          <label className="fixed-space-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy || activationPending}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            确认打开所选公司资料；原公司的资料及后台任务保持原归属。
          </label>
        )}
        {error && (
          <p className="fixed-space-error" role="alert">
            {activationPending && '关联已保存，进入工作空间失败。修复后可重试进入；不会重复关联。'}
            {error}
          </p>
        )}
        <footer>
          <button onClick={close} disabled={busy}>
            取消
          </button>
          <button
            disabled={busy}
            onClick={() => {
              void openPersonalSpace()
                .then(close)
                .catch((failure) => setError(String(failure)))
            }}
          >
            返回我的空间
          </button>
          <button
            className="primary"
            disabled={
              busy ||
              loading ||
              (!activationPending &&
                (!selected ||
                  replacingPersonal ||
                  (needsConfirmation && !confirmed) ||
                  candidate?.state === 'unavailable' ||
                  (candidate?.state !== 'company' && !name.trim())))
            }
            onClick={() => void connect()}
          >
            {busy
              ? '正在连接…'
              : activationPending
                ? '重试进入公司'
                : candidate?.state === 'company'
                  ? '使用这份公司资料'
                  : selected === '__new__'
                    ? '启用新公司'
                    : candidate?.state === 'empty'
                      ? '在原目录启用公司'
                      : '选择公司资料'}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
