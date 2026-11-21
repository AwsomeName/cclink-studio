import { useTabStore } from '../../stores/tab-store'
import { useEffect, useState } from 'react'
import type { GitTransferInput, GitTransferSnapshot } from '@shared/git'
import type { PersonalDiarySource } from '@shared/personal-diary-source'
import {
  defaultDiaryDirectory,
  defaultDiaryTimezone,
  personalDiarySourceSchema,
  personalDiarySourceSection,
} from '@shared/personal-diary-source'
import { openWorkspaceRef } from './workspace-open-controller'
import { useGitStore } from '../../stores/git-store'
import { openPersonalSpace, useFixedSpacesStore } from './fixed-spaces-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useOpenProjectsStore } from '../../stores/open-projects-store'
import { askAi } from './diary-ai'

export function PersonalDiaryGit({
  source,
  ownerPath,
  onConnected,
  onUpdated,
}: {
  ownerPath: string | null
  source: PersonalDiarySource | null
  onConnected: (value: PersonalDiarySource) => void
  /** Files changed in place (a pull); the home page re-reads diaries. */
  onUpdated?: () => void
}): React.ReactElement {
  const [url, setUrl] = useState('')
  const [branch, setBranch] = useState('')
  const [username, setUsername] = useState('')
  const [token, setToken] = useState('')
  const [keyPath, setKeyPath] = useState('')
  const [destination, setDestination] = useState('')
  const fixedOwner = useFixedSpacesStore((state) => state.spaces?.personal?.workspacePath)
  /** The fixed project switches its single directory; other projects keep the legacy link. */
  const switchesProject = Boolean(ownerPath && ownerPath === fixedOwner)
  const [directory, setDirectory] = useState(source?.directory ?? defaultDiaryDirectory)
  const [result, setResult] = useState<GitTransferSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [copyReview, setCopyReview] = useState<string[]>([])
  const [reviewError, setReviewError] = useState('')
  /** Files changed by AI conversation runs (not undone): labelled before upload (§11). */
  const [aiPaths, setAiPaths] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!source) return
    void window.cclinkStudio.workspaceState
      .listDiaryChanges(source.workspacePath)
      .then((reports) =>
        setAiPaths(
          new Set(
            reports.filter((r) => !r.undone).flatMap((r) => r.files.map((file) => file.path)),
          ),
        ),
      )
      .catch(() => {})
  }, [source, result])
  useEffect(() => {
    let alive = true
    setCopyReview([])
    setReviewError('')
    setConfirmed(false)
    if (result?.newCopy)
      void (async () => {
        const entries = await window.cclinkStudio.fs.readDir(result.workspacePath + '/' + directory)
        const tasks = await window.cclinkStudio.scheduledTasks.inspect(result.workspacePath)
        if (!tasks.success) throw Error(tasks.error?.message || '新副本任务不可读')
        const lines = [
          ...entries
            .slice(0, 30)
            .map((entry) => (entry.type === 'directory' ? '目录：' : '文件：') + entry.name),
          ...tasks.tasks.map(
            (task) =>
              task.definition.title +
              ' · 读取：' +
              JSON.stringify(task.definition.resources) +
              ' · 输出：' +
              JSON.stringify(task.definition.outputPolicy) +
              (/\/(Users|home)\//.test(task.definition.instruction)
                ? ' · 指令包含电脑绝对路径，启用前需核对'
                : ''),
          ),
        ]
        if (!tasks.tasks.length) lines.push('副本不含可接回任务定义；不会从名称生成原任务。')
        if (alive) setCopyReview(lines)
      })().catch((error) => {
        if (alive) setReviewError(String(error))
      })
    return () => {
      alive = false
    }
  }, [result, directory])
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
        ...(action === 'clone' && destination ? { destination } : {}),
        ...(action === 'update-copy' || action === 'pull'
          ? { expectedHead: result?.head, expectedTarget: result?.target }
          : {}),
      })
      if (!value.success) throw Error(`[${value.error.code}] ${value.error.message}`)
      setToken('')
      if (value.snapshot.newCopy)
        setDirectory(
          value.snapshot.diaryMapping?.directory ?? source?.directory ?? defaultDiaryDirectory,
        )
      setResult(value.snapshot)
      if (action === 'pull') onUpdated?.()
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
      if (useTabStore.getState().tabs.some((tab) => tab.dirty))
        throw Error('有未保存内容，请先保存或取消修改；副本已准备，关联未切换。')
      if (switchesProject && ownerPath) {
        // Main re-checks identity, settings revision and that old tasks are paused before binding.
        const preview = await window.cclinkStudio.workspaceState.inspectDiaryRoot(
          result.workspacePath,
        )
        await window.cclinkStudio.workspaceState.confirmDiaryRoot(ownerPath, preview)
        await openPersonalSpace()
        // The previous folder stays on disk and in 历史项目; only its tab is closed.
        const active = useWorkspaceStore.getState().activeWorkspaceRef
        if (active.kind === 'local' && active.path !== ownerPath)
          useOpenProjectsStore.getState().removeProject(ownerPath)
        await useWorkspaceStore.getState().refreshSettings()
        return
      }
      if (source) {
        const previous = await window.cclinkStudio.scheduledTasks.inspect(source.workspacePath)
        if (!previous.success) throw Error('原任务状态读取失败，保持旧关联')
        const active = previous.tasks.filter(
          (task) =>
            source.taskIds.includes(task.definition.id) &&
            (task.activation.enabled ||
              ['queued', 'running'].includes(task.latestRun?.status ?? '')),
        )
        if (active.length)
          throw Error(
            '原来源仍有启用或运行的任务，请先在原任务中暂停并核对输出位置；副本已准备，关联未切换。',
          )
      }
      const roots = await window.cclinkStudio.workspaceState.listLocalWorkspaces()
      const root = roots.find((item) => item.workspacePath === result.workspacePath)
      if (!root?.projectId) throw Error('副本尚未登记，请重新打开目录')
      const value = personalDiarySourceSchema.parse({
        version: 1,
        workspacePath: result.workspacePath,
        projectId: root.projectId,
        directory,
        timezone: result.diaryMapping?.timezone ?? source?.timezone ?? defaultDiaryTimezone,
        taskIds: [],
      })
      await window.cclinkStudio.fs.readDir(value.workspacePath + '/' + value.directory)
      const saved = await window.cclinkStudio.workspaceState.setSection(
        ownerPath,
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
        <div className="diary-git-destination">
          <span>本地目的地：{destination || '未选择（将另建独立副本）'}</span>
          <button
            disabled={busy}
            onClick={() =>
              void window.cclinkStudio.dialog
                .showOpenDialog({ selectDirectory: true, title: '选择用于拉取的空目录' })
                .then((picked) => {
                  if (!picked.canceled && picked.filePaths[0]) setDestination(picked.filePaths[0])
                })
                .catch((e) => setError(String(e)))
            }
          >
            选择空目录…
          </button>
        </div>
        <button disabled={busy || !url} onClick={() => void execute('clone')}>
          {destination ? '拉取到所选空目录' : '从 Git 拉取到新目录'}
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
          <pre>
            {result.localChanges
              ? result.localChanges
                  .split('\n')
                  .map((line) => {
                    const path = line.slice(3).replace(/^"|"$/g, '')
                    return aiPaths.has(path) ? `${line}  · AI 修改` : line
                  })
                  .join('\n')
              : '工作目录干净'}
          </pre>
          {result.diverged && (
            <div role="alert">
              <p>本地有未上传提交或历史分叉，已阻止快捷更新；本地内容不会丢失。</p>
              <button
                onClick={() =>
                  askAi(
                    `我的空间 ${result.workspacePath} 的 Git 本地与远端（${result.branch}）分叉。请先说明双方各自的改动和冲突文件，提出合并方案，等我确认后再执行；不要强制推送、重置或丢弃任何一方的内容，完成后说明改了什么。`,
                  )
                }
              >
                让 AI 帮我合并…
              </button>
            </div>
          )}
          {!result.newCopy && result.head === result.target && (
            <p role="status">本地已是远端最新版本。</p>
          )}
          {!result.newCopy && (
            <div className="diary-actions">
              <button
                className="primary"
                disabled={
                  busy ||
                  result.head === result.target ||
                  !!result.localChanges ||
                  result.diverged ||
                  result.diffTruncated
                }
                onClick={() => void execute('pull')}
              >
                拉取并更新
              </button>
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
                另存远端版本为独立副本
              </button>
            </div>
          )}
          {result.newCopy && (
            <div className="diary-source-form">
              {switchesProject ? (
                <p>
                  确认后「我的空间」改用 {result.workspacePath}
                  ：首页、文件树、会话、终端与任务都从这里打开。原目录 {source?.workspacePath}{' '}
                  的文件、未上传内容和私有任务原样保留；仓库带来的共享任务在本机默认停用，需逐项确认启用。
                </p>
              ) : (
                <label>
                  新副本的个人资料目录
                  <input
                    aria-label="副本个人资料目录"
                    value={directory}
                    onChange={(e) => setDirectory(e.target.value)}
                  />
                </label>
              )}
              {!switchesProject && (
                <p>
                  切换只改变首页来源。当前关联的 {source?.taskIds.length ?? 0}{' '}
                  项原任务需重新核对。旧目录的私有任务、运行历史、未上传文件不会跟来；旧任务仍按旧设置运行。新副本的共享任务需要在本设备重新确认，任务关联需重新选择。
                </p>
              )}
              <p>
                旧日记与计划：{source ? source.workspacePath + '/' + source.directory : '尚未关联'}
              </p>
              <p>
                新日记与计划：{result.workspacePath + '/' + directory}
                ，时区：{result.diaryMapping?.timezone ?? source?.timezone ?? defaultDiaryTimezone}
                。附件继续使用副本内的相对引用；旧电脑绝对引用须另行核对。
              </p>
              <details>
                <summary>核对副本目录与任务输出</summary>
                {copyReview.map((line, index) => (
                  <p key={index}>{line}</p>
                ))}
              </details>
              {reviewError && <p role="alert">{reviewError}</p>}
              <label>
                <input
                  type="checkbox"
                  aria-label="确认副本切换"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                已核对新目录、资料和任务路径，原关联任务已暂停
              </label>
              <button
                disabled={busy || !confirmed || !!reviewError || !copyReview.length}
                onClick={() => void connect()}
              >
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
