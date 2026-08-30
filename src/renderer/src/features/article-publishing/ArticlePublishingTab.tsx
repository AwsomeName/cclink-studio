import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  ArticlePublishingAsset,
  ArticlePublishingSourcePreview,
} from '@shared/article-publishing/article-publishing-types'
import { CSDN_ARTICLE_PUBLISHING_PLAN } from '@shared/article-publishing/article-publishing-plan'
import type { WebAffair } from '@shared/web-affairs/web-affair-types'
import type { WebResourceSnapshot } from '@shared/web-resources/web-resource-types'
import type { Tab } from '../../types'
import { useAgentStore } from '../../stores/agent-store'
import { useTabStore } from '../../stores/tab-store'
import { useUIStore } from '../../stores/ui-store'
import { createConversationRuntimeForWorkspace } from '../agent-conversations/view-model'
import { resolveAndOpenWebResourceTab } from '../web-resources/web-resource-tab'
import { notifyWebResourcesChanged } from '../web-resources/web-resource-events'
import { copyTextToClipboard } from '../../utils/clipboard'
import {
  createArticleMarkdownOpenDialogOptions,
  formatArticlePublishingAccountOption,
  getArticlePublishingFileDetails,
} from './article-publishing-tab'
import './article-publishing.css'

const CHECKPOINT_LABELS: Record<string, string> = {
  pending: '等待',
  running: '执行中',
  'waiting-platform': '等待平台',
  verifying: '核验中',
  completed: '已完成',
  'retryable-failed': '可重试失败',
  'result-unknown': '结果未知',
  'needs-reconcile': '待对账',
  'waiting-human': '待人工',
  failed: '失败',
}

const EXECUTION_LABELS: Record<string, string> = {
  draft: '尚未开始',
  preparing: '正在启动',
  running: '执行中',
  'checking-runtime': '待核验',
  'waiting-human': '待人工处理',
  interrupted: '已中断，可恢复',
  cancelled: '已终止',
  failed: '失败，可重试',
  published: '已发布',
  'result-unknown': '网页动作结果未知，只能核验',
}

export function ArticlePublishingTab({ tab }: { tab: Tab }): React.ReactElement {
  const workspaceRef = tab.workspaceRef
  const affairId = tab.articlePublishing?.affairId ?? null
  const updateBinding = useTabStore((state) => state.updateTabArticlePublishing)
  const updateTitle = useTabStore((state) => state.updateTabTitle)
  const [preview, setPreview] = useState<ArticlePublishingSourcePreview | null>(null)
  const [resources, setResources] = useState<WebResourceSnapshot | null>(null)
  const [affair, setAffair] = useState<WebAffair | null>(null)
  const [accountId, setAccountId] = useState('')
  const [accountLabelDraft, setAccountLabelDraft] = useState('')
  const [savingAccountLabel, setSavingAccountLabel] = useState(false)
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [tags, setTags] = useState('')
  const [category, setCategory] = useState('')
  const [coverAssetId, setCoverAssetId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)

  const reload = useCallback(async (): Promise<void> => {
    if (!workspaceRef || !affairId) return
    const result = await window.cclinkStudio.webAffairs.getSnapshot({ workspaceRef })
    if (!result.success) throw new Error(result.error.message)
    const next = result.data.affairs.find((item) => item.id === affairId)
    if (!next?.articlePublishing) throw new Error('文章发布事务不存在')
    setAffair(next)
    setError(null)
  }, [affairId, workspaceRef])

  useEffect(() => {
    if (!workspaceRef) return
    void window.cclinkStudio.webResources.getSnapshot({ workspaceRef }).then((result) => {
      if (result.success) setResources(result.data)
    })
  }, [workspaceRef])

  useEffect(() => {
    if (!affairId) return
    void reload().catch((reason) =>
      setError(reason instanceof Error ? reason.message : String(reason)),
    )
    return window.cclinkStudio.webAffairs.onChanged(({ affairId: changedId }) => {
      if (changedId !== affairId) return
      void reload().catch((reason) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      )
    })
  }, [affairId, reload])

  const csdnAccounts = useMemo(() => {
    if (!resources) return []
    const websites = new Map(resources.websites.map((website) => [website.id, website]))
    return resources.accounts.flatMap((account) => {
      const website = websites.get(account.websiteId)
      let hostname = ''
      try {
        hostname = website ? new URL(website.origin).hostname.toLowerCase() : ''
      } catch {
        return []
      }
      return !account.archivedAt &&
        !account.mergedIntoAccountId &&
        (hostname === 'csdn.net' || hostname.endsWith('.csdn.net'))
        ? [{ account, website: website! }]
        : []
    })
  }, [resources])

  const selectedCsdnAccount = useMemo(
    () => csdnAccounts.find(({ account }) => account.id === accountId)?.account ?? null,
    [accountId, csdnAccounts],
  )

  useEffect(() => {
    setAccountLabelDraft(selectedCsdnAccount?.label ?? '')
  }, [selectedCsdnAccount])

  if (!workspaceRef || workspaceRef.kind !== 'local') {
    return <div className="article-publishing-state">文章发布只支持当前本地工作空间。</div>
  }

  const selectMarkdown = async (): Promise<void> => {
    const selected = await window.cclinkStudio.dialog.showOpenDialog(
      createArticleMarkdownOpenDialogOptions(workspaceRef),
    )
    const markdownPath = selected.filePaths[0]
    if (selected.canceled || !markdownPath) return
    setBusy(true)
    setError(null)
    try {
      const result = await window.cclinkStudio.articlePublishing.inspectSource({
        workspaceRef,
        markdownPath,
      })
      if (!result.success) throw new Error(result.error.message)
      setPreview(result.data)
      setTitle(result.data.title)
      setSummary(result.data.summary)
      setNotice(`已识别 ${result.data.assets.length} 个去重图片资源`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const updateAccountLabel = async (): Promise<void> => {
    if (!selectedCsdnAccount) return
    const label = accountLabelDraft.trim()
    if (!label) {
      setError('请输入账号手机号或平台用户名')
      return
    }
    setSavingAccountLabel(true)
    setError(null)
    try {
      const result = await window.cclinkStudio.webResources.updateAccount({
        accountId: selectedCsdnAccount.id,
        label,
      })
      if (!result.success) throw new Error(result.error.message)
      setResources((current) =>
        current
          ? {
              ...current,
              revision: current.revision + 1,
              accounts: current.accounts.map((account) =>
                account.id === result.data.id ? result.data : account,
              ),
            }
          : current,
      )
      notifyWebResourcesChanged()
      setNotice('账号名称已更新，其他账号入口也会同步显示。')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSavingAccountLabel(false)
    }
  }

  const executeTask = async (targetAffair: WebAffair): Promise<void> => {
    const taskId = targetAffair.id
    const publishing = targetAffair.articlePublishing
    if (!taskId || !publishing) return
    const nextConversationId = `article-publishing-${taskId}`
    const agent = useAgentStore.getState()
    agent.createConversation({
      id: nextConversationId,
      runtime: createConversationRuntimeForWorkspace(workspaceRef),
      activate: true,
    })
    agent.renameConversation(nextConversationId, `发布文章 · ${targetAffair.title} · CSDN`)
    useUIStore.getState().setAgentPanelMode('right', 'user')
    setConversationId(nextConversationId)

    const result = await window.cclinkStudio.articlePublishing.startTask({
      workspaceRef,
      affairId: taskId,
    })
    if (!result.success) {
      await reload().catch(() => undefined)
      throw new Error(result.error.message)
    }
    setAffair(result.data.affair)
    setNotice(
      result.data.resumed
        ? 'main 已恢复原 Attempt，并绑定新一代 Agent/Browser Runtime。'
        : 'main 已创建发布 Attempt，并绑定可见网页与专属 Agent。',
    )
  }

  const startTask = async (): Promise<void> => {
    if (!affair) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await executeTask(affair)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      console.error('[ArticlePublishing] 启动发布失败', { taskId: affair.id, message })
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  const saveTask = async (startAfterSave: boolean): Promise<void> => {
    if (!preview || !accountId) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = await window.cclinkStudio.articlePublishing.createTask({
        workspaceRef,
        markdownPath: preview.source.markdownPath,
        accountId,
        fields: {
          title,
          summary,
          tags: tags
            .split(/[,，]/u)
            .map((item) => item.trim())
            .filter(Boolean),
          category,
          ...(coverAssetId ? { coverAssetId } : {}),
        },
      })
      if (!result.success) throw new Error(result.error.message)
      const persisted = await window.cclinkStudio.webAffairs.getSnapshot({ workspaceRef })
      if (!persisted.success)
        throw new Error(`发布任务已写入，但持久化复核失败：${persisted.error.message}`)
      if (!persisted.data.affairs.some((item) => item.id === result.data.id)) {
        throw new Error('发布任务未通过持久化复核，请查看关键日志')
      }
      updateBinding(tab.id, { affairId: result.data.id })
      updateTitle(tab.id, `发布 · ${result.data.title}`)
      setAffair(result.data)
      if (startAfterSave) await executeTask(result.data)
      else
        setNotice(
          '发布事务已保存到本机并通过复核；可在下方点击“开始执行”，关闭 Tab 或重启后也可从历史恢复。',
        )
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      console.error('[ArticlePublishing] 保存或启动发布失败', {
        markdownPath: preview.source.markdownPath,
        accountId,
        startAfterSave,
        message,
      })
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  const openWebsite = async (): Promise<void> => {
    const account = affair?.articlePublishing?.accountId
    if (!account) return
    try {
      await resolveAndOpenWebResourceTab(account, workspaceRef)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const copyDiagnostics = async (): Promise<void> => {
    if (!affair?.articlePublishing) return
    const publishing = affair.articlePublishing
    const mainLogs = await window.cclinkStudio.diagnostics.getMainLogSnapshot().catch(() => '')
    await copyTextToClipboard(
      JSON.stringify(
        {
          taskId: affair.id,
          attemptId: publishing.execution.currentAttemptId,
          adapter: `${publishing.adapterId}@${publishing.adapterVersion}`,
          status: publishing.execution.status,
          executionGeneration: publishing.execution.currentGeneration,
          launchOperationId: publishing.execution.currentLaunchOperationId?.slice(0, 16),
          runtimeCheck: publishing.execution.runtimeCheck,
          runtimeBindings: affair.attempts
            .find((attempt) => attempt.id === publishing.execution.currentAttemptId)
            ?.runtimeBindings.map((binding) => ({
              kind: binding.kind,
              status: binding.status,
              generation: binding.executionGeneration,
              launchOperationId: binding.launchOperationId.slice(0, 16),
              lastObservedAt: binding.lastObservedAt,
              endedAt: binding.endedAt,
              terminalReason: binding.terminalReason,
            })),
          sideEffects: publishing.sideEffects.map((effect) => ({
            kind: effect.kind,
            targetId: effect.targetId,
            generation: effect.executionGeneration,
            status: effect.status,
            reservedAt: effect.reservedAt,
            dispatchedAt: effect.dispatchedAt,
            observedAt: effect.observedAt,
          })),
          sourceHash: publishing.source.contentHash,
          assets: publishing.assets.map((asset) => ({
            id: asset.id,
            hash: asset.contentHash,
            status: asset.status,
            attempts: asset.uploadAttempts.length,
          })),
          checkpoints: publishing.checkpoints,
          mainLogs,
        },
        null,
        2,
      ),
    )
    setNotice('已复制发布事务与框架关键日志。')
  }

  const manageRuntime = async (operation: 'check' | 'continue' | 'terminate'): Promise<void> => {
    if (!affair?.articlePublishing) return
    const execution = affair.articlePublishing.execution
    const attemptId = execution.currentAttemptId
    const launchOperationId = execution.currentLaunchOperationId
    if (!attemptId || !launchOperationId) return
    setBusy(true)
    setError(null)
    try {
      const input = {
        workspaceRef,
        affairId: affair.id,
        attemptId,
        executionGeneration: execution.currentGeneration,
        launchOperationId,
      }
      const result =
        operation === 'check'
          ? await window.cclinkStudio.articlePublishing.checkRuntime(input)
          : operation === 'continue'
            ? await window.cclinkStudio.articlePublishing.continueRuntime(input)
            : await window.cclinkStudio.articlePublishing.terminateRuntime(input)
      if (!result.success) throw new Error(result.error.message)
      setAffair(result.data)
      setNotice(
        operation === 'terminate'
          ? '当前发布运行已终止；若网页动作结果未知，系统只允许核验，不会重复执行。'
          : operation === 'continue'
            ? '主进程已核验 Runtime 并继续等待。'
            : '主进程已重新核验 Agent、BrowserTask、Tab 与 CDP 状态。',
      )
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  if (!affairId) {
    return (
      <div className="article-publishing-page">
        <header className="article-publishing-header">
          <div>
            <span>文章发布</span>
            <h1>新建 CSDN 发布任务</h1>
          </div>
        </header>
        {error ? <div className="article-publishing-alert error">{error}</div> : null}
        {notice ? <div className="article-publishing-alert">{notice}</div> : null}
        <section className="article-publishing-card">
          <h2>1. 文章</h2>
          <button type="button" onClick={() => void selectMarkdown()} disabled={busy}>
            {preview ? '重新选择 Markdown' : '选择 Markdown…'}
          </button>
          {preview ? (
            <SourcePreview preview={preview} workspacePath={workspaceRef.path} />
          ) : (
            <p>从当前工作空间选择一篇 Markdown。</p>
          )}
        </section>
        <section className="article-publishing-card">
          <h2>2. 发布目标</h2>
          <label>
            网站
            <input value="CSDN" disabled />
          </label>
          <label>
            已保存账号
            <select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
              <option value="">请选择 CSDN 账号</option>
              {csdnAccounts.map(({ account }) => (
                <option key={account.id} value={account.id}>
                  {formatArticlePublishingAccountOption(account.label)}
                </option>
              ))}
            </select>
          </label>
          {selectedCsdnAccount ? (
            <div className="article-publishing-account-identity">
              <label>
                账号标识
                <input
                  value={accountLabelDraft}
                  maxLength={160}
                  placeholder="手机号或平台用户名"
                  onChange={(event) => setAccountLabelDraft(event.target.value)}
                />
              </label>
              <button
                type="button"
                disabled={
                  savingAccountLabel ||
                  !accountLabelDraft.trim() ||
                  accountLabelDraft.trim() === selectedCsdnAccount.label
                }
                onClick={() => void updateAccountLabel()}
              >
                {savingAccountLabel ? '更新中…' : '更新账号名称'}
              </button>
              <small>建议填写手机号或 CSDN 用户名，不要使用网页标题。</small>
            </div>
          ) : null}
          {resources && csdnAccounts.length === 0 ? (
            <p className="article-publishing-warning">
              “网站与账号”中还没有 Origin 为 csdn.net 的可用账号。
            </p>
          ) : null}
        </section>
        <section className="article-publishing-card">
          <h2>3. CSDN 发布设置</h2>
          <label>
            标题
            <input
              value={title}
              maxLength={160}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            摘要
            <textarea
              value={summary}
              maxLength={1_000}
              onChange={(event) => setSummary(event.target.value)}
            />
          </label>
          <label>
            标签
            <input
              value={tags}
              placeholder="TypeScript, Electron"
              onChange={(event) => setTags(event.target.value)}
            />
          </label>
          <label>
            分类
            <input value={category} onChange={(event) => setCategory(event.target.value)} />
          </label>
          <label>
            封面
            <select value={coverAssetId} onChange={(event) => setCoverAssetId(event.target.value)}>
              <option value="">暂不选择</option>
              {preview?.assets
                .filter((asset) => asset.kind === 'local')
                .map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.displayPath}
                  </option>
                ))}
            </select>
          </label>
        </section>
        <section className="article-publishing-card">
          <h2>4. 执行计划</h2>
          <p>开始后会打开正确账号的可见网页和专属 Agent，并按以下顺序执行。</p>
          <div className="article-publishing-checkpoints">
            {CSDN_ARTICLE_PUBLISHING_PLAN.map((step, index) => (
              <div className="article-publishing-checkpoint pending" key={step.stepId}>
                <span>{index + 1}</span>
                <strong>{step.label}</strong>
                <em>等待</em>
                <small>
                  {step.resumePolicy === 'manual-only' ? '敏感边界可暂停' : '可中断恢复'}
                </small>
              </div>
            ))}
          </div>
        </section>
        <div className="article-publishing-footer">
          <span>可仅保存草稿，也可一次完成保存并启动。</span>
          <button
            type="button"
            disabled={
              busy || !preview || !accountId || !title.trim() || Boolean(preview?.blockers.length)
            }
            onClick={() => void saveTask(false)}
          >
            {busy ? '处理中…' : '仅保存草稿'}
          </button>
          <button
            type="button"
            className="primary"
            disabled={
              busy || !preview || !accountId || !title.trim() || Boolean(preview?.blockers.length)
            }
            onClick={() => void saveTask(true)}
          >
            {busy ? '启动中…' : '保存并开始执行'}
          </button>
        </div>
      </div>
    )
  }

  if (!affair?.articlePublishing) {
    return <div className="article-publishing-state">{error ?? '正在读取发布事务…'}</div>
  }
  const publishing = affair.articlePublishing
  const canStart = ['draft', 'waiting-human', 'interrupted', 'failed', 'result-unknown'].includes(
    publishing.execution.status,
  )
  const savedWebsite = resources?.websites.find((website) => website.id === publishing.websiteId)
  const savedAccount = resources?.accounts.find((account) => account.id === publishing.accountId)
  const sourceDetails = getArticlePublishingFileDetails(
    publishing.source.markdownPath,
    workspaceRef.path,
  )
  const coverAsset = publishing.fields.coverAssetId
    ? publishing.assets.find((asset) => asset.id === publishing.fields.coverAssetId)
    : null
  return (
    <div className="article-publishing-page">
      <header className="article-publishing-header">
        <div>
          <span>CSDN · 持久发布事务</span>
          <h1>{affair.title}</h1>
          <p>{publishing.source.markdownPath}</p>
        </div>
        <div className="article-publishing-actions">
          <button type="button" onClick={() => void openWebsite()}>
            打开网页
          </button>
          <button
            type="button"
            disabled={!conversationId}
            onClick={() => {
              if (!conversationId) return
              useAgentStore.getState().switchConversation(conversationId)
              useUIStore.getState().setAgentPanelMode('right', 'user')
            }}
          >
            打开 Agent
          </button>
          <button type="button" onClick={() => void copyDiagnostics()}>
            复制完整诊断日志
          </button>
        </div>
      </header>
      {error ? <div className="article-publishing-alert error">{error}</div> : null}
      {notice ? <div className="article-publishing-alert">{notice}</div> : null}
      {publishing.execution.status === 'checking-runtime' && publishing.execution.runtimeCheck ? (
        <div className="article-publishing-alert error">
          待核验：{publishing.execution.runtimeCheck.reason}
        </div>
      ) : null}
      <section className="article-publishing-card">
        <h2>已保存配置</h2>
        <div className="article-publishing-config-grid">
          <div className="article-publishing-config-item wide">
            <span>Markdown 文件</span>
            <strong>{sourceDetails.fileName}</strong>
            <code>{sourceDetails.workspaceRelativePath ?? '不在当前工作空间内'}</code>
            <small title={sourceDetails.absolutePath}>{sourceDetails.absolutePath}</small>
          </div>
          <div className="article-publishing-config-item">
            <span>网站</span>
            <strong>{savedWebsite?.name ?? 'CSDN'}</strong>
            <small>{savedWebsite?.origin ?? 'https://www.csdn.net'}</small>
          </div>
          <div className="article-publishing-config-item">
            <span>账号</span>
            <strong>{savedAccount?.label ?? '账号信息加载中或已失效'}</strong>
            <small>ID {publishing.accountId}</small>
          </div>
          <div className="article-publishing-config-item wide">
            <span>发布标题</span>
            <strong>{publishing.fields.title}</strong>
          </div>
          <div className="article-publishing-config-item wide">
            <span>摘要</span>
            <p>{publishing.fields.summary || '未填写'}</p>
          </div>
          <div className="article-publishing-config-item">
            <span>标签</span>
            <strong>{publishing.fields.tags.join('、') || '未填写'}</strong>
          </div>
          <div className="article-publishing-config-item">
            <span>分类</span>
            <strong>{publishing.fields.category || '未填写'}</strong>
          </div>
          <div className="article-publishing-config-item wide">
            <span>封面</span>
            <strong>{coverAsset?.displayPath ?? '未选择'}</strong>
          </div>
        </div>
      </section>
      <section className="article-publishing-card">
        <h2>正文图片（{publishing.assets.length}）</h2>
        <ArticleAssetList assets={publishing.assets} workspacePath={workspaceRef.path} />
      </section>
      <section className="article-publishing-card">
        <h2>执行计划</h2>
        <div className="article-publishing-checkpoints">
          {publishing.checkpoints.map((checkpoint, index) => (
            <div
              className={`article-publishing-checkpoint ${checkpoint.status}`}
              key={checkpoint.stepId}
            >
              <span>{index + 1}</span>
              <strong>{checkpoint.label}</strong>
              <em>{CHECKPOINT_LABELS[checkpoint.status]}</em>
              <small>
                {checkpoint.attemptCount > 0
                  ? `执行 ${checkpoint.attemptCount} 次`
                  : checkpoint.resumePolicy}
              </small>
            </div>
          ))}
        </div>
      </section>
      <div className="article-publishing-footer">
        <span>
          Attempt：{publishing.execution.currentAttemptId?.slice(0, 8) ?? '尚未开始'} ·{' '}
          {EXECUTION_LABELS[publishing.execution.status] ?? publishing.execution.status}
        </span>
        {['running', 'checking-runtime'].includes(publishing.execution.status) ? (
          <button type="button" disabled={busy} onClick={() => void manageRuntime('check')}>
            检查运行状态
          </button>
        ) : null}
        {publishing.execution.status === 'checking-runtime' ? (
          <button type="button" disabled={busy} onClick={() => void manageRuntime('continue')}>
            继续等待
          </button>
        ) : null}
        {['preparing', 'running', 'checking-runtime'].includes(publishing.execution.status) ? (
          <button type="button" disabled={busy} onClick={() => void manageRuntime('terminate')}>
            终止任务
          </button>
        ) : null}
        <button
          type="button"
          className="primary"
          disabled={busy || !canStart}
          onClick={() => void startTask()}
        >
          {busy
            ? '启动中…'
            : publishing.execution.status === 'waiting-human'
              ? '交还 Agent 并继续'
              : publishing.execution.status === 'interrupted'
                ? '从中断处继续'
                : publishing.execution.status === 'result-unknown'
                  ? publishing.publication.status === 'result-unknown'
                    ? '核验发布结果'
                    : '核验未知网页动作'
                  : '开始执行'}
        </button>
      </div>
    </div>
  )
}

function SourcePreview({
  preview,
  workspacePath,
}: {
  preview: ArticlePublishingSourcePreview
  workspacePath: string
}): React.ReactElement {
  const sourceDetails = getArticlePublishingFileDetails(preview.source.markdownPath, workspacePath)
  return (
    <div className="article-publishing-source-preview">
      <strong>{preview.title}</strong>
      <span>文件名：{sourceDetails.fileName}</span>
      <code>工作空间位置：{sourceDetails.workspaceRelativePath}</code>
      <code>完整路径：{sourceDetails.absolutePath}</code>
      <span>
        哈希 {preview.source.contentHash.slice(0, 12)} · {(preview.source.size / 1024).toFixed(1)}{' '}
        KB
      </span>
      <strong>正文图片（{preview.assets.length} 个去重资源）</strong>
      <ArticleAssetList assets={preview.assets} workspacePath={workspacePath} />
      {preview.blockers.map((blocker) => (
        <p className="article-publishing-error" key={blocker}>
          {blocker}
        </p>
      ))}
      {preview.warnings.map((warning) => (
        <p className="article-publishing-warning" key={warning}>
          {warning}
        </p>
      ))}
    </div>
  )
}

function ArticleAssetList({
  assets,
  workspacePath,
}: {
  assets: ArticlePublishingAsset[]
  workspacePath: string
}): React.ReactElement {
  if (assets.length === 0) return <p>正文没有图片。</p>
  return (
    <div className="article-publishing-assets">
      {assets.map((asset) => {
        const details = getArticlePublishingFileDetails(asset.sourcePath, workspacePath)
        return (
          <div key={asset.id} className={`article-publishing-asset ${asset.status}`}>
            <strong>{asset.kind === 'local' ? details.fileName : asset.displayPath}</strong>
            <span>
              {asset.kind === 'remote'
                ? '外链保留'
                : (CHECKPOINT_LABELS[asset.status] ?? asset.status)}
            </span>
            {asset.kind === 'local' ? (
              <dl>
                <dt>Markdown 引用路径</dt>
                <dd>{asset.displayPath}</dd>
                <dt>工作空间位置</dt>
                <dd>{details.workspaceRelativePath ?? '不在当前工作空间内'}</dd>
                <dt>完整路径</dt>
                <dd title={details.absolutePath}>{details.absolutePath}</dd>
                <dt>文件信息</dt>
                <dd>
                  {asset.mediaType ?? '未知类型'}
                  {typeof asset.size === 'number' ? ` · ${(asset.size / 1024).toFixed(1)} KB` : ''}
                  {' · '}
                  {asset.uploadAttempts.length}/3 次上传尝试
                </dd>
                <dt>正文位置</dt>
                <dd>
                  {asset.occurrences.map((occurrence, index) => (
                    <span key={`${occurrence.start}:${occurrence.end}`}>
                      引用 {index + 1}：{occurrence.alt || '无替代文本'}（字符 {occurrence.start}–
                      {occurrence.end}）
                    </span>
                  ))}
                </dd>
              </dl>
            ) : (
              <small title={asset.sourcePath}>{asset.sourcePath}</small>
            )}
          </div>
        )
      })}
    </div>
  )
}
