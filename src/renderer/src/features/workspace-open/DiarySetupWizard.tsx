import { useEffect, useState } from 'react'
import type { DiaryRootPreview } from '@shared/ipc/workspace-state'
import type { AgentCapabilityStatus } from '@shared/agent-protocol'
import { defaultDiaryTimezone, diaryDateParts } from '@shared/personal-diary-source'
import { openPersonalSpace, useFixedSpacesStore } from './fixed-spaces-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useOpenProjectsStore } from '../../stores/open-projects-store'
import { useDiaryNavigation } from './personal-diary-navigation'
import {
  defaultBuiltInChoice,
  ensureBuiltInDiaryTasks,
  findDailyDraft,
  type BuiltInTaskChoice,
} from './diary-builtin-tasks'

const ipcMessage = (error: unknown): string =>
  String(error)
    .replace(/^Error: /, '')
    .replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/i, '')

const stepNames = ['选择目录', '同步', 'AI', '核对并确认']
const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/**
 * First use of 我的空间 in four steps. Nothing is written until「确认并开始」; a clone is the
 * only earlier side effect and only lands in an empty folder the user picked.
 */
export function DiarySetupWizard({
  owner,
  onDone,
}: {
  /** Set when an older install already bound an (unconfirmed) default folder. */
  owner: string | null
  onDone?: () => void
}): React.ReactElement {
  const [step, setStep] = useState(0)
  const [mode, setMode] = useState<'default' | 'existing'>('default')
  const [defaultInfo, setDefaultInfo] = useState<{ path: string; exists: boolean } | null>(null)
  const [preview, setPreview] = useState<DiaryRootPreview | null>(null)
  const [sync, setSync] = useState<'repository' | 'clone' | 'later'>('later')
  const [url, setUrl] = useState('')
  const [branch, setBranch] = useState('')
  const [username, setUsername] = useState('')
  const [token, setToken] = useState('')
  const [destination, setDestination] = useState('')
  const [ai, setAi] = useState<AgentCapabilityStatus | null>(null)
  const [choice, setChoice] = useState<BuiltInTaskChoice>(defaultBuiltInChoice)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ws = window.cclinkStudio.workspaceState
  const run = (action: () => Promise<void>): void => {
    setBusy(true)
    setError('')
    void action()
      .catch((e) => setError(ipcMessage(e)))
      .finally(() => setBusy(false))
  }
  useEffect(() => {
    void ws
      .describeDefaultPersonalSpace()
      .then(setDefaultInfo)
      .catch(() => {})
  }, [ws])
  // An existing default folder (older installs) is reviewed like any existing folder.
  useEffect(() => {
    if (mode !== 'default' || !defaultInfo?.exists) {
      if (mode === 'default') setPreview(null)
      return
    }
    void ws
      .inspectDiaryRoot(defaultInfo.path)
      .then(setPreview)
      .catch((e) => setError(ipcMessage(e)))
  }, [mode, defaultInfo, ws])
  useEffect(() => {
    if (preview?.isGitRepository) setSync('repository')
    else if (sync === 'repository') setSync('later')
  }, [preview?.isGitRepository])
  const checkAi = async (): Promise<void> => {
    const capabilities = await window.cclinkStudio.agent.getCapabilities()
    setAi(capabilities.find((item) => item.name === 'agent-backend') ?? null)
  }
  useEffect(() => {
    if (step === 2) run(checkAi)
  }, [step])
  const chooseExisting = (): void =>
    run(async () => {
      const picked = await window.cclinkStudio.dialog.showOpenDialog({
        selectDirectory: true,
        title: '选择已有的日记项目目录',
      })
      if (picked.canceled || !picked.filePaths[0]) return
      setMode('existing')
      setPreview(await ws.inspectDiaryRoot(picked.filePaths[0]))
    })
  const chooseDestination = (): void =>
    run(async () => {
      const picked = await window.cclinkStudio.dialog.showOpenDialog({
        selectDirectory: true,
        title: '选择用于克隆的空目录',
      })
      if (!picked.canceled && picked.filePaths[0]) setDestination(picked.filePaths[0])
    })
  const clone = (): void =>
    run(async () => {
      const result = await window.cclinkStudio.git.transfer({
        action: 'clone',
        url,
        branch,
        username,
        token: token || undefined,
        destination,
      })
      setToken('')
      if (!result.success) throw Error(result.error.message)
      setMode('existing')
      setPreview(await ws.inspectDiaryRoot(result.snapshot.workspacePath))
      setSync('repository')
    })
  const rootPath = mode === 'default' ? (defaultInfo?.path ?? '') : (preview?.workspacePath ?? '')
  const canNext = [
    mode === 'default' ? Boolean(defaultInfo) : Boolean(preview),
    sync !== 'clone',
    ai?.state === 'ready',
    true,
  ][step]
  const confirm = (): void =>
    run(async () => {
      let fixed
      if (owner) {
        const target = preview ?? (await ws.inspectDiaryRoot(owner))
        fixed = await ws.confirmDiaryRoot(owner, target)
      } else
        fixed = await ws.initializePersonalSpace(mode === 'default' && !preview ? null : preview)
      // Stay open until tasks and today's draft are set up, so any failure is shown here.
      useFixedSpacesStore.setState({ spaces: fixed })
      const root = fixed.personal!.workspacePath
      const settings = (await ws.getSettings(root)).settings
      const directory = settings.diary?.directory ?? preview?.directory ?? '个人计划'
      const timezone = settings.diary?.timezone ?? defaultDiaryTimezone
      await ensureBuiltInDiaryTasks(root, directory, timezone, choice)
      // Past today's draft time: generate now instead of waiting for tomorrow.
      const now = diaryDateParts(timezone, new Date())
      const clock = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date())
      if (choice.daily.enable && clock >= choice.daily.time && now) {
        const listed = await window.cclinkStudio.scheduledTasks.list(root)
        const daily = listed.success ? findDailyDraft(listed.tasks) : undefined
        if (daily)
          await window.cclinkStudio.scheduledTasks.runNow({
            workspacePath: root,
            taskId: daily.definition.id,
          })
      }
      await openPersonalSpace()
      const active = useWorkspaceStore.getState().activeWorkspaceRef
      if (owner && owner !== root && active.kind === 'local' && active.path !== owner)
        useOpenProjectsStore.getState().removeProject(owner)
      await useWorkspaceStore.getState().refreshSettings()
      useDiaryNavigation.getState().setPage('今天')
      onDone?.()
    })

  return (
    <section className="personal-diary-home diary-setup" aria-label="设置我的空间">
      <h2>设置「我的空间」</h2>
      <div className="diary-steps">
        {stepNames.map((name, index) => (
          <span
            key={name}
            className={index === step ? 'on' : index < step ? 'done' : ''}
            aria-current={index === step ? 'step' : undefined}
          >
            {index < step ? '✓ ' : ''}
            {index + 1} {name}
          </span>
        ))}
      </div>
      {step === 0 && (
        <div className="diary-setup-body">
          <label className={`diary-option ${mode === 'default' ? 'on' : ''}`}>
            <input type="radio" checked={mode === 'default'} onChange={() => setMode('default')} />
            <span>
              <b>使用默认目录</b>
              <span className="muted">
                {defaultInfo?.path}
                {defaultInfo && !defaultInfo.exists ? ' · 确认后才创建' : ''}
              </span>
            </span>
          </label>
          <label className={`diary-option ${mode === 'existing' ? 'on' : ''}`}>
            <input type="radio" checked={mode === 'existing'} onChange={chooseExisting} />
            <span>
              <b>选择已有目录</b>
              <button disabled={busy} onClick={chooseExisting}>
                选择文件夹…
              </button>
            </span>
          </label>
          {preview && (
            <dl className="diary-facts">
              <dt>项目目录</dt>
              <dd>{preview.workspacePath}</dd>
              <dt>日记目录</dt>
              <dd>{preview.directory}</dd>
              <dt>日记</dt>
              <dd>
                {preview.diaryCount ?? 0} 篇 · 最近 {preview.latestFile ?? '暂无'}
              </dd>
              <dt>Git</dt>
              <dd>{preview.isGitRepository ? '已是 Git 仓库' : '不是 Git 仓库'}</dd>
            </dl>
          )}
          <p className="muted">查看本页不会创建或修改任何文件。</p>
        </div>
      )}
      {step === 1 && (
        <div className="diary-setup-body">
          {preview?.isGitRepository && (
            <label className={`diary-option ${sync === 'repository' ? 'on' : ''}`}>
              <input
                type="radio"
                checked={sync === 'repository'}
                onChange={() => setSync('repository')}
              />
              <span>
                <b>使用该目录已有的 Git 仓库</b>
                <span className="muted">远端与分支自动读取；更新和上传在项目设置的 Git 中审阅</span>
              </span>
            </label>
          )}
          <label className={`diary-option ${sync === 'clone' ? 'on' : ''}`}>
            <input type="radio" checked={sync === 'clone'} onChange={() => setSync('clone')} />
            <span>
              <b>从已有仓库克隆到空目录</b>
              <span className="muted">新电脑使用；克隆完成后核对日记、附件和任务</span>
            </span>
          </label>
          {sync === 'clone' && (
            <div className="diary-facts-form">
              <label>
                仓库地址
                <input aria-label="仓库地址" value={url} onChange={(e) => setUrl(e.target.value)} />
              </label>
              <label>
                分支
                <input
                  aria-label="Git 分支"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                />
              </label>
              <label>
                HTTPS 用户名
                <input
                  aria-label="Git 用户名"
                  value={username}
                  autoComplete="off"
                  onChange={(e) => setUsername(e.target.value)}
                />
              </label>
              <label>
                HTTPS Token（仅本次使用，不保存）
                <input
                  aria-label="Git Token"
                  type="password"
                  value={token}
                  autoComplete="off"
                  onChange={(e) => setToken(e.target.value)}
                />
              </label>
              <p>
                本地目的地：{destination || '未选择'}{' '}
                <button disabled={busy} onClick={chooseDestination}>
                  选择空目录…
                </button>
              </p>
              <button disabled={busy || !url || !destination} onClick={clone}>
                {busy ? '正在克隆…' : '克隆到所选空目录'}
              </button>
            </div>
          )}
          <label className={`diary-option ${sync === 'later' ? 'on' : ''}`}>
            <input type="radio" checked={sync === 'later'} onChange={() => setSync('later')} />
            <span>
              <b>稍后连接</b>
              <span className="muted">本地照常使用，以后在项目设置中连接</span>
            </span>
          </label>
        </div>
      )}
      {step === 2 && (
        <div className="diary-setup-body">
          <div className="diary-card">
            <b>
              本机 AI · {ai?.state === 'ready' ? '就绪' : ai ? `不可用（${ai.state}）` : '检测中…'}
            </b>
            {ai?.reason && <p className="muted">{ai.reason}</p>}
            <button disabled={busy} onClick={() => run(checkAi)}>
              重新检测
            </button>
          </div>
          <p className="muted">
            每日草稿和每周复盘需要本机 AI（Codex 或 Claude Code）。AI
            可以读取项目内全部日记；只有你要求时才修改已有文件，并给出改动报告。
          </p>
          {ai && ai.state !== 'ready' && (
            <p role="alert">请在 Studio 设置的 Agent 中安装并登录本机 AI 后重新检测。</p>
          )}
        </div>
      )}
      {step === 3 && (
        <div className="diary-setup-body">
          <dl className="diary-facts">
            <dt>项目目录</dt>
            <dd>{rootPath}</dd>
            <dt>日记目录</dt>
            <dd>{preview?.directory ?? '个人计划'}</dd>
            <dt>同步</dt>
            <dd>{sync === 'later' ? '稍后连接' : '使用 Git 仓库'}</dd>
            <dt>时区</dt>
            <dd>{defaultDiaryTimezone}（已有项目沿用其设置；可在项目设置修改）</dd>
            <dt>AI</dt>
            <dd>{ai?.state === 'ready' ? '本机 AI 就绪' : '—'}</dd>
          </dl>
          <div className="diary-card">
            <b>自动整理（本设备）</b>
            <label>
              <input
                type="checkbox"
                checked={choice.daily.enable}
                onChange={(e) =>
                  setChoice({ ...choice, daily: { ...choice.daily, enable: e.target.checked } })
                }
              />
              每日起草 · 每天自动生成当天草稿（项目已有该任务时沿用原时间）
              <input
                aria-label="每日起草时间"
                type="time"
                value={choice.daily.time}
                onChange={(e) =>
                  setChoice({ ...choice, daily: { ...choice.daily, time: e.target.value } })
                }
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={choice.weekly.enable}
                onChange={(e) =>
                  setChoice({ ...choice, weekly: { ...choice.weekly, enable: e.target.checked } })
                }
              />
              每周复盘 · 自动生成复盘与下周计划
              <select
                aria-label="每周复盘日"
                value={choice.weekly.weekday}
                onChange={(e) =>
                  setChoice({
                    ...choice,
                    weekly: { ...choice.weekly, weekday: Number(e.target.value) },
                  })
                }
              >
                {weekdays.map((name, index) => (
                  <option key={name} value={index}>
                    {name}
                  </option>
                ))}
              </select>
              <input
                aria-label="每周复盘时间"
                type="time"
                value={choice.weekly.time}
                onChange={(e) =>
                  setChoice({ ...choice, weekly: { ...choice.weekly, time: e.target.value } })
                }
              />
            </label>
            <p className="muted">
              将新建：缺失的项目设置与日记目录、「每日起草」「每周复盘」两个共享任务（已有则沿用）。
              不会改动已有日记、附件、计划和仓库历史，也不会上传。已过起草时间时，确认后立即生成今天的草稿。
            </p>
          </div>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="diary-actions">
        {step > 0 && (
          <button disabled={busy} onClick={() => setStep(step - 1)}>
            上一步
          </button>
        )}
        {step < 3 ? (
          <button className="primary" disabled={busy || !canNext} onClick={() => setStep(step + 1)}>
            下一步
          </button>
        ) : (
          <button className="primary" disabled={busy || !rootPath} onClick={confirm}>
            {busy ? '正在设置…' : '确认并开始'}
          </button>
        )}
      </div>
    </section>
  )
}
