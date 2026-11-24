import { useEffect, useState } from 'react'
import { useTabStore } from '../../stores/tab-store'

export type DiarySyncChoiceValue = { mode: 'none' | 'create' | 'url'; name: string; url: string }

export const defaultDiarySyncChoice: DiarySyncChoiceValue = {
  mode: 'none',
  name: 'my-space',
  url: '',
}

/** The chosen choice is complete enough to continue. */
export function diarySyncChoiceReady(value: DiarySyncChoiceValue): boolean {
  if (value.mode === 'create') return /^[A-Za-z0-9._-]{1,100}$/.test(value.name.trim())
  if (value.mode === 'url') return Boolean(value.url.trim())
  return true
}

/**
 * Turns the choice into a Git address. 「在 GitHub 新建私有仓库」 creates (or reuses a writable
 * private) repository with the saved account; failures throw so nothing else is written.
 */
export async function resolveDiarySyncUrl(value: DiarySyncChoiceValue): Promise<string | null> {
  if (value.mode === 'url') return value.url.trim() || null
  if (value.mode !== 'create') return null
  const result = await window.cclinkStudio.gitBackup.createPrivateRepository(value.name.trim())
  if (!result.success || !result.cloneUrl) {
    if (result.errorCode === 'REMOTE_CONFLICT')
      throw Error(
        `GitHub 上已有公开仓库 ${value.name.trim()}，不能用作日记同步。请换一个仓库名，或改用已有私有仓库的地址。`,
      )
    throw Error(result.error || 'GitHub 新建仓库失败')
  }
  return result.cloneUrl
}

/** Sync section of mockup docs/design/github-new-repo-2026-11-24. */
export function DiarySyncChoice({
  value,
  onChange,
  allowNone = true,
  disabled,
}: {
  value: DiarySyncChoiceValue
  onChange: (value: DiarySyncChoiceValue) => void
  allowNone?: boolean
  disabled?: boolean
}): React.ReactElement {
  const [account, setAccount] = useState<{ username: string; token: boolean } | null>(null)
  useEffect(() => {
    let disposed = false
    // Re-read when the window comes back, e.g. after saving the token in Settings.
    const load = (): void =>
      void window.cclinkStudio.gitBackup
        .getAccountStatus()
        .then((status) => {
          if (disposed) return
          const ready = status.tokenConfigured && Boolean(status.username.trim())
          setAccount({ username: status.username.trim(), token: ready })
        })
        .catch(() => !disposed && setAccount({ username: '', token: false }))
    load()
    window.addEventListener('focus', load)
    return () => {
      disposed = true
      window.removeEventListener('focus', load)
    }
  }, [])
  // With a saved GitHub account, creating a private repository is the default.
  const [defaultedFor, setDefaultedFor] = useState<boolean | null>(null)
  useEffect(() => {
    if (!account || defaultedFor === account.token) return
    setDefaultedFor(account.token)
    if (account.token && value.mode === (allowNone ? 'none' : 'url') && !value.url)
      onChange({ ...value, mode: 'create' })
    else if (!account.token && value.mode === 'create')
      onChange({ ...value, mode: allowNone ? 'none' : 'url' })
  }, [account, defaultedFor, value, onChange, allowNone])
  const set = (patch: Partial<DiarySyncChoiceValue>): void => onChange({ ...value, ...patch })
  const canCreate = Boolean(account?.token)
  return (
    <div className="diary-sync-choice" role="radiogroup" aria-label="同步方式">
      {allowNone && (
        <label className={`diary-option ${value.mode === 'none' ? 'on' : ''}`}>
          <input
            type="radio"
            checked={value.mode === 'none'}
            disabled={disabled}
            onChange={() => set({ mode: 'none' })}
          />
          <span>
            <b>不同步</b>
          </span>
        </label>
      )}
      <label
        className={`diary-option ${value.mode === 'create' ? 'on' : ''} ${canCreate ? '' : 'off'}`}
      >
        <input
          type="radio"
          checked={value.mode === 'create'}
          disabled={disabled || !canCreate}
          onChange={() => set({ mode: 'create' })}
        />
        <span>
          <b>在 GitHub 新建私有仓库</b>
          {!account ? (
            <span className="muted">正在读取已保存的 GitHub 账号…</span>
          ) : canCreate ? (
            <span className="muted">使用已保存的 GitHub 账号</span>
          ) : (
            <span className="muted">
              需要先保存 GitHub 账号和 Token ·{' '}
              <button
                type="button"
                className="diary-link"
                onClick={() =>
                  useTabStore.getState().openTab({
                    type: 'settings',
                    title: '设置',
                    icon: '⚙️',
                    settingsSection: 'connections',
                  })
                }
              >
                去设置
              </button>
            </span>
          )}
          {value.mode === 'create' && (
            <span className="diary-sync-repo">
              {account?.username} /
              <input
                aria-label="GitHub 仓库名"
                value={value.name}
                disabled={disabled}
                onChange={(e) => set({ name: e.target.value })}
              />
            </span>
          )}
        </span>
      </label>
      <label className={`diary-option ${value.mode === 'url' ? 'on' : ''}`}>
        <input
          type="radio"
          checked={value.mode === 'url'}
          disabled={disabled}
          onChange={() => set({ mode: 'url' })}
        />
        <span>
          <b>使用已有仓库地址</b>
          {value.mode === 'url' && (
            <input
              aria-label="Git 项目地址"
              placeholder="https://github.com/你的账号/my-diary.git"
              value={value.url}
              disabled={disabled}
              onChange={(e) => set({ url: e.target.value })}
            />
          )}
        </span>
      </label>
    </div>
  )
}
