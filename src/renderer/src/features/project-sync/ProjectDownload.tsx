import { useEffect, useState } from 'react'
import type { GitHubPrivateRepositorySummary } from '@shared/ipc/git-backup'
import { useTabStore } from '../../stores/tab-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { openWorkspaceRef } from '../workspace-open/workspace-open-controller'
import { showWorkspaceHome } from '../workspace-open/workspace-home-navigation'
import { loadProjectSync } from './project-sync-view-state'
import './project-sync.css'

/**
 * 另一台电脑：从 GitHub 下载项目（效果稿 clone）。Lists the saved account's private
 * repositories, downloads one into a new folder and keeps syncing it with the same address.
 */
export function ProjectDownload({ onOpened }: { onOpened(): void }): React.ReactElement {
  const [repos, setRepos] = useState<GitHubPrivateRepositorySummary[] | null>(null)
  const [username, setUsername] = useState('')
  const [listError, setListError] = useState('')
  const [chosen, setChosen] = useState<GitHubPrivateRepositorySummary | null>(null)
  const [parent, setParent] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let disposed = false
    void window.cclinkStudio.gitBackup
      .listPrivateRepositories()
      .then((result) => {
        if (disposed) return
        if (!result.success) setListError(result.error || '无法读取 GitHub 仓库')
        else {
          setRepos(result.repositories ?? [])
          setUsername(result.username ?? '')
        }
      })
      .catch((e) => !disposed && setListError(String(e)))
    return () => {
      disposed = true
    }
  }, [])
  const download = async () => {
    if (!chosen) return
    setBusy(true)
    setError('')
    try {
      const result = await window.cclinkStudio.git.transfer({
        action: 'clone',
        projectSync: true,
        url: chosen.cloneUrl,
        destinationParent: parent,
        destinationName: name.trim(),
      })
      if (!result.success) throw Error(result.error.message)
      const ref = await openWorkspaceRef({ kind: 'local', path: result.snapshot.workspacePath })
      await useWorkspaceStore.getState().refreshSettings()
      await loadProjectSync(result.snapshot.workspacePath)
      showWorkspaceHome(ref)
      onOpened()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="workspace-settings-form project-download" aria-label="从 GitHub 下载项目">
      <h2>从 GitHub 下载项目</h2>
      {listError ? (
        <p role="alert">
          {listError}{' '}
          <button
            className="project-sync-link"
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
        </p>
      ) : !repos ? (
        <p>正在读取 GitHub 账号下的私有仓库…</p>
      ) : !repos.length ? (
        <p>{username} 下没有可写入的私有仓库。先在另一台电脑上为项目“设置同步”。</p>
      ) : (
        <>
          <p className="muted">使用已保存的 GitHub 账号 {username}，只列出私有仓库。</p>
          <div className="project-download-list" role="radiogroup" aria-label="私有仓库">
            {repos.map((repo) => (
              <label key={repo.fullName} className={chosen?.fullName === repo.fullName ? 'on' : ''}>
                <input
                  type="radio"
                  checked={chosen?.fullName === repo.fullName}
                  onChange={() => {
                    setChosen(repo)
                    setName(repo.name)
                  }}
                />
                <span>
                  <b>{repo.name}</b>
                  <small>
                    私有
                    {repo.updatedAt
                      ? ' · ' + new Date(repo.updatedAt).toLocaleString() + ' 更新'
                      : ''}
                    {repo.description ? ' · ' + repo.description : ''}
                  </small>
                </span>
              </label>
            ))}
          </div>
        </>
      )}
      {chosen && (
        <>
          <label>
            保存位置
            <input aria-label="项目保存位置" readOnly value={parent} />
          </label>
          <button
            disabled={busy}
            onClick={() => {
              void window.cclinkStudio.dialog
                .showOpenDialog({ selectDirectory: true, title: '选择项目的保存位置' })
                .then((r) => {
                  if (!r.canceled) setParent(r.filePaths[0] ?? '')
                })
                .catch((e) => setError(String(e)))
            }}
          >
            选择保存位置
          </button>
          <label>
            文件夹名
            <input
              aria-label="项目文件夹名"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <p className="muted">
            将下载到：{parent && name.trim() ? `${parent}/${name.trim()}` : '请选择保存位置'}
            。下载后自动开启同步，地址不用再填。
          </p>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <button
        className="primary"
        disabled={busy || !chosen || !parent || !name.trim()}
        onClick={() => void download()}
      >
        {busy ? '正在下载…' : '下载并打开'}
      </button>
    </section>
  )
}
