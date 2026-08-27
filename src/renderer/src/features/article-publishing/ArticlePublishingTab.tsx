import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ArticlePublishingSourcePreview } from '@shared/article-publishing/article-publishing-types'
import type { WebAffair } from '@shared/web-affairs/web-affair-types'
import type { WebResourceSnapshot } from '@shared/web-resources/web-resource-types'
import type { Tab } from '../../types'
import { useAgentStore } from '../../stores/agent-store'
import { useTabStore } from '../../stores/tab-store'
import { useUIStore } from '../../stores/ui-store'
import { createConversationRuntimeForWorkspace } from '../agent-conversations/view-model'
import { createConversationRunController } from '../agent-conversations/conversation-run-controller'
import { resolveAndOpenWebResourceTab } from '../web-resources/web-resource-tab'
import { copyTextToClipboard } from '../../utils/clipboard'
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

export function ArticlePublishingTab({ tab }: { tab: Tab }): React.ReactElement {
  const workspaceRef = tab.workspaceRef
  const affairId = tab.articlePublishing?.affairId ?? null
  const updateBinding = useTabStore((state) => state.updateTabArticlePublishing)
  const updateTitle = useTabStore((state) => state.updateTabTitle)
  const activateTab = useTabStore((state) => state.activateTab)
  const [preview, setPreview] = useState<ArticlePublishingSourcePreview | null>(null)
  const [resources, setResources] = useState<WebResourceSnapshot | null>(null)
  const [affair, setAffair] = useState<WebAffair | null>(null)
  const [accountId, setAccountId] = useState('')
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

  if (!workspaceRef || workspaceRef.kind !== 'local') {
    return <div className="article-publishing-state">文章发布只支持当前本地工作空间。</div>
  }

  const selectMarkdown = async (): Promise<void> => {
    const selected = await window.cclinkStudio.dialog.showOpenDialog({
      title: '选择要发布的 Markdown',
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
    })
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

  const saveTask = async (): Promise<void> => {
    if (!preview || !accountId) return
    setBusy(true)
    setError(null)
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
      updateBinding(tab.id, { affairId: result.data.id })
      updateTitle(tab.id, `发布 · ${result.data.title}`)
      setAffair(result.data)
      setNotice('发布事务已保存；关闭 Tab 后可以从历史恢复。')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const startTask = async (): Promise<void> => {
    const taskId = affair?.id
    const publishing = affair?.articlePublishing
    if (!taskId || !publishing) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = await window.cclinkStudio.articlePublishing.startTask({
        workspaceRef,
        affairId: taskId,
      })
      if (!result.success) throw new Error(result.error.message)
      await resolveAndOpenWebResourceTab(publishing.accountId, workspaceRef)
      activateTab(tab.id)
      const agent = useAgentStore.getState()
      const nextConversationId = agent.createConversation({
        runtime: createConversationRuntimeForWorkspace(workspaceRef),
        activate: true,
      })
      agent.renameConversation(nextConversationId, `发布文章 · ${affair.title} · CSDN`)
      useUIStore.getState().setAgentPanelMode('right', 'user')
      setConversationId(nextConversationId)
      const sent = await createConversationRunController({
        conversationId: nextConversationId,
      }).send(result.data.agentPrompt)
      if (sent.status === 'failed') throw new Error(sent.error)
      setAffair(result.data.affair)
      setNotice(
        result.data.resumed
          ? '已恢复原发布 Attempt，并创建新的 Agent Run 从待对账检查点继续。'
          : '发布 Attempt、可见网页和专属 Agent 已启动。',
      )
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
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
          {preview ? <SourcePreview preview={preview} /> : <p>从当前工作空间选择一篇 Markdown。</p>}
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
              {csdnAccounts.map(({ account, website }) => (
                <option key={account.id} value={account.id}>
                  {website.name} · {account.label}
                </option>
              ))}
            </select>
          </label>
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
        <div className="article-publishing-footer">
          <button
            type="button"
            className="primary"
            disabled={
              busy || !preview || !accountId || !title.trim() || Boolean(preview?.blockers.length)
            }
            onClick={() => void saveTask()}
          >
            {busy ? '保存中…' : '保存发布任务'}
          </button>
        </div>
      </div>
    )
  }

  if (!affair?.articlePublishing) {
    return <div className="article-publishing-state">{error ?? '正在读取发布事务…'}</div>
  }
  const publishing = affair.articlePublishing
  const canStart = ['draft', 'interrupted', 'failed'].includes(publishing.execution.status)
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
      <section className="article-publishing-card">
        <h2>正文图片</h2>
        {publishing.assets.length === 0 ? (
          <p>正文没有图片。</p>
        ) : (
          <div className="article-publishing-assets">
            {publishing.assets.map((asset) => (
              <div key={asset.id} className={`article-publishing-asset ${asset.status}`}>
                <strong>{asset.displayPath}</strong>
                <span>
                  {asset.kind === 'remote'
                    ? '外链保留'
                    : (CHECKPOINT_LABELS[asset.status] ?? asset.status)}
                </span>
                <small>
                  {asset.kind === 'local'
                    ? `${asset.uploadAttempts.length}/3 次 · ${asset.occurrences.length} 个位置`
                    : asset.platformUrl}
                </small>
              </div>
            ))}
          </div>
        )}
      </section>
      <div className="article-publishing-footer">
        <span>
          Attempt：{publishing.execution.currentAttemptId?.slice(0, 8) ?? '尚未开始'} ·{' '}
          {publishing.execution.status}
        </span>
        <button
          type="button"
          className="primary"
          disabled={busy || !canStart}
          onClick={() => void startTask()}
        >
          {busy
            ? '启动中…'
            : publishing.execution.status === 'interrupted'
              ? '从中断处继续'
              : '开始执行'}
        </button>
      </div>
    </div>
  )
}

function SourcePreview({
  preview,
}: {
  preview: ArticlePublishingSourcePreview
}): React.ReactElement {
  return (
    <div className="article-publishing-source-preview">
      <strong>{preview.title}</strong>
      <code>{preview.source.markdownPath}</code>
      <span>
        哈希 {preview.source.contentHash.slice(0, 12)} · {(preview.source.size / 1024).toFixed(1)}{' '}
        KB
      </span>
      <span>{preview.assets.length} 个去重图片资源</span>
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
