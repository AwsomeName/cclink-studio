import { useEffect, useState } from 'react'
import type { GitTransferInput, GitTransferSnapshot } from '@shared/git'
import type { PersonalDiarySource } from '@shared/personal-diary-source'
import {
  personalDiarySourceSchema,
  personalDiarySourceSection,
} from '@shared/personal-diary-source'
import { openWorkspaceRef } from './workspace-open-controller'
import { useGitStore } from '../../stores/git-store'

export function PersonalDiaryGit({
  source,
  onConnected,
}: {
  source: PersonalDiarySource | null
  onConnected: (value: PersonalDiarySource) => void
}): React.ReactElement {
  const [url, setUrl] = useState('')
  const [branch, setBranch] = useState('')
  const [username, setUsername] = useState('')
  const [token, setToken] = useState('')
  const [keyPath, setKeyPath] = useState('')
  const [directory, setDirectory] = useState(source?.directory ?? '000-个人计划')
  const [result, setResult] = useState<GitTransferSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  useEffect(() => {
    let alive = true
    if (source) setBusy(true)
    if (source)
      void window.cclinkStudio.git
        .transfer({ action: 'inspect', workspacePath: source.workspacePath })
        .then((value) => {
          if (!value.success) throw Error(`[${value.error.code}] ${value.error.message}`)
          if (alive) {
            setResult(value.snapshot)
            setUrl(value.snapshot.remoteUrl)
            setBranch(value.snapshot.branch)
          }
        })
        .catch((e) => {
          if (alive) setError(String(e))
        })
        .finally(() => {
          if (alive) setBusy(false)
        })
    return () => {
      alive = false
    }
  }, [source])
  const execute = async (action: GitTransferInput['action']): Promise<void> => {
    setBusy(true)
    setError('')
    setConfirmed(false)
    try {
      const value = await window.cclinkStudio.git.transfer({
        action,
        workspacePath: source?.workspacePath,
        url,
        branch,
        username,
        token: token || undefined,
        sshKeyPath: keyPath || undefined,
        ...(action === 'update-copy'
          ? { expectedHead: result?.head, expectedTarget: result?.target }
          : {}),
      })
      if (!value.success) throw Error(`[${value.error.code}] ${value.error.message}`)
      setToken('')
      setResult(value.snapshot)
    } catch (e) {
      setError(String(e))
      setToken('')
    } finally {
      setBusy(false)
    }
  }
  const connect = async (): Promise<void> => {
    if (!result?.newCopy || !confirmed) return
    setBusy(true)
    setError('')
    try {
      const roots = await window.cclinkStudio.workspaceState.listLocalWorkspaces()
      const root = roots.find((item) => item.workspacePath === result.workspacePath)
      if (!root?.projectId) throw Error('副本尚未登记，请重新打开目录')
      const value = personalDiarySourceSchema.parse({
        version: 1,
        workspacePath: result.workspacePath,
        projectId: root.projectId,
        directory,
        timezone: source?.timezone ?? 'Asia/Shanghai',
        taskIds: [],
      })
      await window.cclinkStudio.fs.readDir(value.workspacePath + '/' + value.directory)
      const saved = await window.cclinkStudio.workspaceState.setSection(
        null,
        personalDiarySourceSection,
        value,
      )
      if (!saved.success) throw Error(saved.error)
      onConnected(value)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="diary-git" aria-label="日记 Git">
      <h3>从 Git 获取资料与更新</h3>
      <p>
        整个仓库拉取到新的本机目录。检查更新只下载 Git
        对象；应用更新另建副本，原目录及未上传内容保留。
      </p>
      {source && <p>当前资料：{source.workspacePath}</p>}
      <div className="diary-source-form">
        <label>
          仓库地址
          <input
            aria-label="仓库地址"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://host/repository.git 或 git@host:repository.git"
          />
        </label>
        <label>
          分支（首次拉取留空使用默认分支）
          <input aria-label="Git 分支" value={branch} onChange={(e) => setBranch(e.target.value)} />
        </label>
        <details>
          <summary>本次操作的认证</summary>
          <p>
            HTTPS 账号与 Token 仅用于本次操作，用后清除；SSH 使用明确指定的私钥及已有
            known_hosts，禁止系统钥匙串。
          </p>
          <label>
            HTTPS 用户名
            <input
              aria-label="Git 用户名"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label>
            HTTPS Token
            <input
              type="password"
              aria-label="Git Token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label>
            SSH 私钥路径
            <input
              aria-label="SSH 私钥路径"
              value={keyPath}
              onChange={(e) => setKeyPath(e.target.value)}
            />
          </label>
        </details>
        <button disabled={busy || !url} onClick={() => void execute('clone')}>
          从 Git 拉取到新目录
        </button>
      </div>
      {source && (
        <button disabled={busy} onClick={() => void execute('fetch')}>
          检查远程更新
        </button>
      )}
      {busy && <p role="status">Git 正在处理，请等待；不会切换或改写原资料。</p>}
      {error && <p role="alert">{error}</p>}
      {result && (
        <div className="diary-git-result">
          <h3>{result.newCopy ? '新副本已拉取，尚未替换资料来源' : '仓库与更新预览'}</h3>
          <p>
            目录：{result.workspacePath}
            <br />
            远程：{result.remoteUrl}
            <br />
            分支：{result.branch}
            <br />
            本地 {result.head.slice(0, 8)} → 远程 {result.target.slice(0, 8)}
          </p>
          <p>
            读取时间：{new Date(result.checkedAt).toLocaleString()}
            。只有点击“检查远程更新”后，结果才包含本次远程检查。
          </p>
          <h4>远程文件变化（A 新增 / M 修改 / D 删除）</h4>
          <pre>{result.changes || '没有已知文件变化'}</pre>
          <details>
            <summary>展开正文差异</summary>
            <pre>{result.diff || '没有文本差异'}</pre>
            {result.diffTruncated && <p>差异过长，显示前 128 KB；请在原仓库核对全文后再切换。</p>}
          </details>
          <h4>当前本地改动</h4>
          <pre>{result.localChanges || '工作目录干净'}</pre>
          {result.diverged && (
            <p role="alert">本地有未上传提交或历史分叉，已阻止快捷更新；请在原仓库处理分支。</p>
          )}
          {!result.newCopy && (
            <button
              disabled={
                busy ||
                result.head === result.target ||
                !!result.localChanges ||
                result.diverged ||
                result.diffTruncated
              }
              onClick={() => void execute('update-copy')}
            >
              将已审阅更新拉取为新副本
            </button>
          )}
          {result.newCopy && (
            <div className="diary-source-form">
              <label>
                新副本的个人资料目录
                <input
                  aria-label="副本个人资料目录"
                  value={directory}
                  onChange={(e) => setDirectory(e.target.value)}
                />
              </label>
              <p>
                切换只改变首页来源。当前关联的 {source?.taskIds.length ?? 0}{' '}
                项原任务需重新核对。旧目录的私有任务、运行历史、未上传文件不会跟来；旧任务仍按旧设置运行。新副本的共享任务需要在本设备重新确认，任务关联需重新选择。
              </p>
              <label>
                <input
                  type="checkbox"
                  aria-label="确认副本切换"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                已核对目录和未上传资料，保留旧任务设置
              </label>
              <button disabled={busy || !confirmed} onClick={() => void connect()}>
                确认改用此副本
              </button>
            </div>
          )}
        </div>
      )}
      {source && (
        <button
          onClick={() => {
            void (async () => {
              try {
                await openWorkspaceRef({ kind: 'local', path: source.workspacePath })
                await useGitStore.getState().loadWorkspace(source.workspacePath)
                useGitStore.getState().openOperationDialog('changes')
              } catch (e) {
                setError(String(e))
              }
            })()
          }}
        >
          打开原仓库变更与提交
        </button>
      )}
    </section>
  )
}
