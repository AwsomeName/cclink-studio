import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  CompanyAccountsDocument,
  CompanyAccountsRecord,
  CompanyAccountsSnapshot,
  CompanyAccountsUpdateRecordInput,
} from '@shared/company-accounts/company-accounts-types'
import { useTabStore } from '../../stores/tab-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import './company-accounts.css'

type View = 'review' | 'report' | 'delivery'
type RecordFilter = 'pending' | 'confirmed' | 'all'

function currentMonth(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function money(amountMinor: number, currency = 'CNY'): string {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amountMinor / 100)
}

function recordTypeLabel(record: CompanyAccountsRecord): string {
  const labels = {
    income: '收入',
    expense: '支出',
    internal_transfer: '内部转账',
    refund: '退款',
  }
  return labels[record.recordType]
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : '发生未知错误'
}

export function CompanyAccountsWorkbench(): React.ReactElement {
  const workspaceGeneration = useWorkspaceStore((state) => state.generation)
  const openTab = useTabStore((state) => state.openTab)
  const [month, setMonth] = useState(currentMonth)
  const [snapshot, setSnapshot] = useState<CompanyAccountsSnapshot | null>(null)
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null)
  const [draft, setDraft] = useState<CompanyAccountsUpdateRecordInput | null>(null)
  const [view, setView] = useState<View>('review')
  const [filter, setFilter] = useState<RecordFilter>('pending')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [newProjectName, setNewProjectName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [defaultCurrency, setDefaultCurrency] = useState('CNY')
  const loadRequestId = useRef(0)
  const workspaceGenerationRef = useRef(workspaceGeneration)
  const selectedRecordIdRef = useRef(selectedRecordId)
  workspaceGenerationRef.current = workspaceGeneration
  selectedRecordIdRef.current = selectedRecordId

  const selectedRecord = useMemo(
    () => snapshot?.records.find((record) => record.id === selectedRecordId) ?? null,
    [selectedRecordId, snapshot?.records],
  )

  useEffect(() => {
    if (!snapshot) return
    const visibleRecords = snapshot.records.filter(
      (record) => filter === 'all' || record.status === filter,
    )
    if (visibleRecords.some((record) => record.id === selectedRecordId)) return
    setSelectedRecordId(visibleRecords[0]?.id ?? null)
  }, [filter, selectedRecordId, snapshot?.records])

  const load = async (targetMonth = month): Promise<void> => {
    const requestId = ++loadRequestId.current
    setBusy(true)
    try {
      const result = await window.cclinkStudio.companyAccounts.getSnapshot(targetMonth)
      if (!result.success) throw new Error(result.error.message)
      if (requestId !== loadRequestId.current) return
      setSnapshot(result.data)
      setCompanyName(result.data.settings.companyName)
      setDefaultCurrency(result.data.settings.defaultCurrency)
      const currentStillExists = result.data.records.some(
        (record) => record.id === selectedRecordId,
      )
      const nextSelected = currentStillExists
        ? selectedRecordId
        : (result.data.records.find((record) => record.status === 'pending')?.id ??
          result.data.records[0]?.id ??
          null)
      setSelectedRecordId(nextSelected)
    } catch (error) {
      if (requestId === loadRequestId.current) {
        setNotice({ kind: 'error', text: errorText(error) })
      }
    } finally {
      if (requestId === loadRequestId.current) setBusy(false)
    }
  }

  useEffect(() => {
    setSnapshot(null)
    setSelectedRecordId(null)
    setDraft(null)
    setNotice(null)
    void load(month)
    // 工作空间代次变化时必须重新读取该工作空间自己的账目事实。
  }, [workspaceGeneration])

  useEffect(() => {
    if (!selectedRecord) {
      setDraft(null)
      return
    }
    setDraft({
      recordId: selectedRecord.id,
      expectedVersion: selectedRecord.version,
      date: selectedRecord.date,
      recordType: selectedRecord.recordType,
      direction: selectedRecord.direction,
      amountMinor: selectedRecord.amountMinor,
      currency: selectedRecord.currency,
      account: selectedRecord.account,
      counterparty: selectedRecord.counterparty,
      purpose: selectedRecord.purpose,
      category: selectedRecord.category,
      projectId: selectedRecord.projectId,
      documentIds: selectedRecord.supportingDocumentIds,
    })
  }, [selectedRecord?.id, selectedRecord?.version])

  const run = async (operation: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setNotice(null)
    try {
      await operation()
    } catch (error) {
      setNotice({ kind: 'error', text: errorText(error) })
    } finally {
      setBusy(false)
    }
  }

  const initialize = (): void => {
    void run(async () => {
      const result = await window.cclinkStudio.companyAccounts.initialize(month)
      if (!result.success) throw new Error(result.error.message)
      setSnapshot(result.data)
      setNotice({ kind: 'success', text: '公司账目已启用，可以直接导入本月资料。' })
    })
  }

  const restore = (): void => {
    void run(async () => {
      const selected = await window.cclinkStudio.dialog.showOpenDialog({
        title: '选择公司账目备份目录',
        selectDirectory: true,
      })
      if (selected.canceled || !selected.filePaths[0]) return
      if (snapshot?.initialized || snapshot?.error) {
        const confirmation = await window.cclinkStudio.dialog.showMessageBox({
          type: 'warning',
          title: '恢复公司账目',
          message: '恢复会用备份替换当前工作空间的公司账目。',
          detail: '当前数据会在替换失败时自动回滚。',
          buttons: ['取消', '恢复'],
          cancelId: 0,
          defaultId: 0,
        })
        if (confirmation.response !== 1) return
      }
      const result = await window.cclinkStudio.companyAccounts.restoreBackup({
        backupDirectory: selected.filePaths[0],
        month,
      })
      if (!result.success) throw new Error(result.error.message)
      setSnapshot(result.data)
      setNotice({ kind: 'success', text: '备份已恢复，并通过数据库完整性检查。' })
    })
  }

  const importFiles = (): void => {
    void run(async () => {
      const selected = await window.cclinkStudio.dialog.showOpenDialog({
        title: `导入 ${month} 流水与凭证`,
        multiSelections: true,
        filters: [
          { name: '流水与凭证', extensions: ['csv', 'pdf', 'png', 'jpg', 'jpeg', 'webp'] },
          { name: '所有文件', extensions: ['*'] },
        ],
      })
      if (selected.canceled || selected.filePaths.length === 0) return
      const result = await window.cclinkStudio.companyAccounts.importFiles({
        month,
        filePaths: selected.filePaths,
      })
      if (!result.success) throw new Error(result.error.message)
      await load(month)
      const batch = result.data
      const failureDetails = batch.failures
        .map((failure) => `${failure.fileName}：${failure.reason}`)
        .join('；')
      setNotice({
        kind: batch.failures.length > 0 ? 'error' : 'success',
        text: `导入 ${batch.importedRecords} 条流水、${batch.importedDocuments} 份文件；重复流水 ${batch.duplicateRecords} 条、重复文件 ${batch.duplicateDocuments} 份，失败 ${batch.failures.length} 项。${failureDetails ? ` ${failureDetails}` : ''}`,
      })
    })
  }

  const saveRecord = async (): Promise<CompanyAccountsSnapshot> => {
    if (!draft) throw new Error('请先选择一条记录')
    const result = await window.cclinkStudio.companyAccounts.updateRecord(draft)
    if (!result.success) throw new Error(result.error.message)
    if (result.data.month !== month) setMonth(result.data.month)
    setSnapshot(result.data)
    return result.data
  }

  const handleSave = (): void => {
    void run(async () => {
      await saveRecord()
      setNotice({ kind: 'success', text: '修改已保存，并写入修改追踪。' })
    })
  }

  const handleConfirm = (): void => {
    void run(async () => {
      const saved = await saveRecord()
      const savedRecord = saved.records.find((record) => record.id === draft?.recordId)
      if (!savedRecord) throw new Error('保存后未找到记录')
      const result = await window.cclinkStudio.companyAccounts.confirmRecord({
        recordId: savedRecord.id,
        expectedVersion: savedRecord.version,
      })
      if (!result.success) throw new Error(result.error.message)
      setSnapshot(result.data)
      setNotice({ kind: 'success', text: '已人工确认；这条记录现在计入月度与项目统计。' })
    })
  }

  const askAgent = (): void => {
    if (!draft) return
    const requestedWorkspaceGeneration = workspaceGenerationRef.current
    const requestedRecordId = draft.recordId
    void run(async () => {
      const result = await window.cclinkStudio.companyAccounts.proposeRecord(draft.recordId)
      if (!result.success) throw new Error(result.error.message)
      if (
        workspaceGenerationRef.current !== requestedWorkspaceGeneration ||
        selectedRecordIdRef.current !== requestedRecordId
      ) {
        return
      }
      const refreshed = await window.cclinkStudio.companyAccounts.getSnapshot(month)
      if (!refreshed.success) throw new Error(refreshed.error.message)
      if (workspaceGenerationRef.current !== requestedWorkspaceGeneration) {
        return
      }
      setSnapshot(refreshed.data)
      setDraft((current) =>
        current?.recordId === result.data.recordId
          ? {
              ...current,
              category: result.data.category,
              recordType: result.data.recordType,
              projectId: result.data.projectId,
            }
          : current,
      )
      setNotice({
        kind: 'success',
        text: `Agent 建议已填入表单：${result.data.reason}。仍需你保存并人工确认。`,
      })
    })
  }

  const createProject = (): void => {
    const name = newProjectName.trim()
    if (!name) return
    void run(async () => {
      const result = await window.cclinkStudio.companyAccounts.createProject(name)
      if (!result.success) throw new Error(result.error.message)
      const refreshed = await window.cclinkStudio.companyAccounts.getSnapshot(month)
      if (!refreshed.success) throw new Error(refreshed.error.message)
      setSnapshot(refreshed.data)
      setDraft((current) => (current ? { ...current, projectId: result.data.id } : current))
      setNewProjectName('')
    })
  }

  const previewDocument = (document: CompanyAccountsDocument): void => {
    openTab({
      type: document.mimeType === 'text/csv' ? 'editor' : 'file-preview',
      title: document.originalName,
      icon: document.mimeType === 'application/pdf' ? 'PDF' : '凭',
      filePath: document.storedPath,
    })
  }

  const saveSettings = async (): Promise<void> => {
    const result = await window.cclinkStudio.companyAccounts.updateSettings({
      month,
      companyName,
      defaultCurrency,
    })
    if (!result.success) throw new Error(result.error.message)
    setSnapshot(result.data)
  }

  const exportMonth = (): void => {
    void run(async () => {
      await saveSettings()
      const selected = await window.cclinkStudio.dialog.showOpenDialog({
        title: '选择代账交付包保存目录',
        selectDirectory: true,
      })
      if (selected.canceled || !selected.filePaths[0]) return
      const result = await window.cclinkStudio.companyAccounts.exportMonth({
        month,
        destinationDirectory: selected.filePaths[0],
      })
      if (!result.success) throw new Error(result.error.message)
      setNotice({
        kind: 'success',
        text: `已导出 ${result.data.recordCount} 条已确认账目和 ${result.data.documentCount} 份凭证：${result.data.directoryPath}`,
      })
    })
  }

  const handleSaveSettings = (): void => {
    void run(async () => {
      await saveSettings()
      setNotice({ kind: 'success', text: '公司名称和默认币种已保存。' })
    })
  }

  const createBackup = (): void => {
    void run(async () => {
      const selected = await window.cclinkStudio.dialog.showOpenDialog({
        title: '选择备份保存目录',
        selectDirectory: true,
      })
      if (selected.canceled || !selected.filePaths[0]) return
      const result = await window.cclinkStudio.companyAccounts.createBackup({
        destinationDirectory: selected.filePaths[0],
      })
      if (!result.success) throw new Error(result.error.message)
      setNotice({ kind: 'success', text: `完整备份已创建：${result.data.directoryPath}` })
    })
  }

  const switchMonth = (nextMonth: string): void => {
    setMonth(nextMonth)
    setSelectedRecordId(null)
    void load(nextMonth)
  }

  if (!snapshot) {
    return (
      <div className="company-accounts-loading">
        {notice?.kind === 'error' ? (
          <>
            <div className="company-accounts-notice error">账目读取失败：{notice.text}</div>
            <button
              type="button"
              className="accounts-button"
              disabled={busy}
              onClick={() => void load(month)}
            >
              重试读取
            </button>
          </>
        ) : (
          '正在读取公司账目…'
        )}
      </div>
    )
  }

  if (!snapshot.workspaceAvailable) {
    return (
      <div className="company-accounts-empty">
        <div className="company-accounts-empty-card">
          <span className="company-accounts-empty-icon">账</span>
          <h1>公司账目</h1>
          <p>请先打开一个普通本地工作空间。账目会保存在该工作空间中。</p>
        </div>
      </div>
    )
  }

  if (!snapshot.initialized) {
    return (
      <div className="company-accounts-empty">
        <div className="company-accounts-empty-card">
          <span className="company-accounts-empty-icon">账</span>
          <h1>公司账目</h1>
          <p>无需配置公司、账户或会计期间。启用后直接导入真实流水。</p>
          {snapshot.error && (
            <div className="company-accounts-notice error">账目读取失败：{snapshot.error}</div>
          )}
          {notice && <div className={`company-accounts-notice ${notice.kind}`}>{notice.text}</div>}
          <div className="company-accounts-empty-actions">
            <button
              type="button"
              className="accounts-button primary"
              disabled={busy}
              onClick={initialize}
            >
              {snapshot.error ? '重试启用' : '开始使用'}
            </button>
            <button type="button" className="accounts-button" disabled={busy} onClick={restore}>
              从备份恢复
            </button>
          </div>
        </div>
      </div>
    )
  }

  const filteredRecords = snapshot.records.filter(
    (record) => filter === 'all' || record.status === filter,
  )
  const currency = snapshot.settings.defaultCurrency

  return (
    <div className="company-accounts-workbench">
      <header className="company-accounts-header">
        <div>
          <h1>公司账目</h1>
          <p>内部经营账 · 已确认记录才进入统计</p>
        </div>
        <div className="company-accounts-header-actions">
          <label>
            <span>月份</span>
            <input
              type="month"
              value={month}
              onChange={(event) => switchMonth(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="accounts-button primary"
            disabled={busy}
            onClick={importFiles}
          >
            导入流水与凭证
          </button>
        </div>
      </header>

      {notice && <div className={`company-accounts-notice ${notice.kind}`}>{notice.text}</div>}
      {snapshot.error && <div className="company-accounts-notice error">{snapshot.error}</div>}

      <div className="company-accounts-kpis">
        <SummaryCard
          label="收入"
          value={money(snapshot.summary.incomeMinor, currency)}
          tone="income"
        />
        <SummaryCard
          label="支出"
          value={money(snapshot.summary.expenseMinor, currency)}
          tone="expense"
        />
        <SummaryCard label="净流入" value={money(snapshot.summary.netMinor, currency)} />
        <SummaryCard label="待核对" value={`${snapshot.summary.pendingCount} 条`} tone="pending" />
      </div>

      <nav className="company-accounts-nav" aria-label="公司账目功能">
        <button className={view === 'review' ? 'active' : ''} onClick={() => setView('review')}>
          分类核对
        </button>
        <button className={view === 'report' ? 'active' : ''} onClick={() => setView('report')}>
          月度与项目
        </button>
        <button className={view === 'delivery' ? 'active' : ''} onClick={() => setView('delivery')}>
          导出与备份
        </button>
      </nav>

      {view === 'review' && (
        <div className="company-accounts-review">
          <section className="company-accounts-list">
            <div className="company-accounts-list-toolbar">
              <strong>{month} 流水</strong>
              <select
                value={filter}
                onChange={(event) => setFilter(event.target.value as RecordFilter)}
              >
                <option value="pending">待核对</option>
                <option value="confirmed">已确认</option>
                <option value="all">全部</option>
              </select>
            </div>
            {filteredRecords.length === 0 ? (
              <div className="company-accounts-list-empty">
                暂无记录。可先导入银行或支付平台 CSV。
              </div>
            ) : (
              filteredRecords.map((record) => (
                <button
                  type="button"
                  key={record.id}
                  className={`company-accounts-row ${selectedRecordId === record.id ? 'selected' : ''}`}
                  onClick={() => setSelectedRecordId(record.id)}
                >
                  <span className={`record-direction ${record.direction}`}>
                    {recordTypeLabel(record)}
                  </span>
                  <span className="record-main">
                    <strong>{record.counterparty || record.purpose || '未填写交易对方'}</strong>
                    <small>
                      {record.date} · {record.account}
                    </small>
                  </span>
                  <span className="record-tail">
                    <strong>
                      {record.direction === 'expense' ? '-' : '+'}
                      {money(record.amountMinor, record.currency)}
                    </strong>
                    <small className={record.status}>
                      {record.status === 'pending' ? '待核对' : '已确认'}
                    </small>
                  </span>
                </button>
              ))
            )}
          </section>
          <section className="company-accounts-detail">
            {draft && selectedRecord ? (
              <>
                <div className="company-accounts-detail-title">
                  <div>
                    <h2>核对记录</h2>
                    <p>保存会留下修改记录；只有点“确认入账”才进入统计。</p>
                  </div>
                  <span className={`record-status ${selectedRecord.status}`}>
                    {selectedRecord.status === 'pending' ? '待核对' : '已确认'}
                  </span>
                </div>
                {selectedRecord.suggestion && (
                  <div className="company-accounts-suggestion">
                    <strong>导入规则建议（待人工确认）</strong>
                    <span>
                      {selectedRecord.suggestion.category} · {selectedRecord.suggestion.reason}
                    </span>
                    <button type="button" disabled={busy} onClick={askAgent}>
                      让 Agent 重新分析
                    </button>
                  </div>
                )}
                <div className="company-accounts-form-grid">
                  <Field label="日期">
                    <input
                      type="date"
                      value={draft.date}
                      onChange={(event) => setDraft({ ...draft, date: event.target.value })}
                    />
                  </Field>
                  <Field label="金额">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={(draft.amountMinor / 100).toFixed(2)}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          amountMinor: Math.round(Number(event.target.value) * 100),
                        })
                      }
                    />
                  </Field>
                  <Field label="记录类型">
                    <select
                      value={draft.recordType}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          recordType: event.target.value as CompanyAccountsRecord['recordType'],
                        })
                      }
                    >
                      <option value="income">收入</option>
                      <option value="expense">支出</option>
                      <option value="internal_transfer">内部转账</option>
                      <option value="refund">退款</option>
                    </select>
                  </Field>
                  <Field label="收支方向">
                    <select
                      value={draft.direction}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          direction: event.target.value as CompanyAccountsRecord['direction'],
                        })
                      }
                    >
                      <option value="income">流入</option>
                      <option value="expense">流出</option>
                    </select>
                  </Field>
                  <Field label="账户">
                    <input
                      value={draft.account}
                      onChange={(event) => setDraft({ ...draft, account: event.target.value })}
                    />
                  </Field>
                  <Field label="交易对方">
                    <input
                      value={draft.counterparty}
                      onChange={(event) => setDraft({ ...draft, counterparty: event.target.value })}
                    />
                  </Field>
                  <Field label="用途">
                    <input
                      value={draft.purpose}
                      onChange={(event) => setDraft({ ...draft, purpose: event.target.value })}
                    />
                  </Field>
                  <Field label="分类">
                    <input
                      value={draft.category}
                      onChange={(event) => setDraft({ ...draft, category: event.target.value })}
                    />
                  </Field>
                  <Field label="眼镜研发项目">
                    <select
                      value={draft.projectId ?? ''}
                      onChange={(event) =>
                        setDraft({ ...draft, projectId: event.target.value || null })
                      }
                    >
                      <option value="">不关联项目</option>
                      {snapshot.projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="币种">
                    <input
                      value={draft.currency}
                      maxLength={3}
                      onChange={(event) =>
                        setDraft({ ...draft, currency: event.target.value.toUpperCase() })
                      }
                    />
                  </Field>
                </div>
                <div className="company-accounts-new-project">
                  <input
                    placeholder="核对时按需新建项目"
                    value={newProjectName}
                    onChange={(event) => setNewProjectName(event.target.value)}
                  />
                  <button
                    type="button"
                    className="accounts-button"
                    disabled={!newProjectName.trim() || busy}
                    onClick={createProject}
                  >
                    新建并选择
                  </button>
                </div>
                <EvidencePicker
                  documents={snapshot.documents}
                  sourceIds={selectedRecord.sourceDocumentIds}
                  selectedIds={draft.documentIds}
                  onChange={(documentIds) => setDraft({ ...draft, documentIds })}
                  onPreview={previewDocument}
                />
                <div className="company-accounts-history">
                  <h3>确认与修改记录</h3>
                  {selectedRecord.history.map((event) => (
                    <div key={event.id}>
                      <span>
                        {event.eventType === 'imported'
                          ? '导入为待核对'
                          : event.eventType === 'ai_suggested'
                            ? 'Agent 提供待确认建议'
                            : event.eventType === 'updated'
                              ? '人工修改'
                              : '人工确认入账'}
                      </span>
                      <time>{new Date(event.createdAt).toLocaleString('zh-CN')}</time>
                    </div>
                  ))}
                </div>
                <div className="company-accounts-detail-actions">
                  <button
                    type="button"
                    className="accounts-button"
                    disabled={busy}
                    onClick={handleSave}
                  >
                    保存修改
                  </button>
                  <button
                    type="button"
                    className="accounts-button primary"
                    disabled={busy || selectedRecord.status === 'confirmed'}
                    onClick={handleConfirm}
                  >
                    人工确认入账
                  </button>
                </div>
              </>
            ) : (
              <div className="company-accounts-detail-empty">从左侧选择一条流水进行核对。</div>
            )}
          </section>
        </div>
      )}

      {view === 'report' && (
        <div className="company-accounts-report">
          <section className="accounts-panel">
            <h2>{month} 月度收支</h2>
            <dl className="company-accounts-ledger-summary">
              <div>
                <dt>已确认收入</dt>
                <dd>{money(snapshot.summary.incomeMinor, currency)}</dd>
              </div>
              <div>
                <dt>已确认支出</dt>
                <dd>{money(snapshot.summary.expenseMinor, currency)}</dd>
              </div>
              <div>
                <dt>支出退款</dt>
                <dd>{money(snapshot.summary.refundMinor, currency)}</dd>
              </div>
              <div>
                <dt>净流入</dt>
                <dd>{money(snapshot.summary.netMinor, currency)}</dd>
              </div>
            </dl>
            <p className="accounts-footnote">
              内部转账不计入收入或支出。所有数字只来自已确认的银行或支付流水；首版按单一默认币种统计，不做汇率换算。
            </p>
          </section>
          <section className="accounts-panel">
            <h2>眼镜项目实际支出</h2>
            {snapshot.summary.projectSpending.length === 0 ? (
              <p className="accounts-muted">本月没有已确认的项目支出。</p>
            ) : (
              snapshot.summary.projectSpending.map((project) => (
                <div className="company-accounts-project-block" key={project.projectId}>
                  <div className="company-accounts-project-row">
                    <span>{project.projectName}</span>
                    <strong>{money(project.spentMinor, currency)}</strong>
                  </div>
                  <div className="company-accounts-project-categories">
                    {project.categories.map((category) => (
                      <div key={category.category}>
                        <span>{category.category}</span>
                        <span>{money(category.spentMinor, currency)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
            <p className="accounts-footnote">
              这里是实际花出去的钱，不等于包含折旧、人工分摊等内容的完整财务成本。
            </p>
          </section>
        </div>
      )}

      {view === 'delivery' && (
        <div className="company-accounts-delivery">
          <section className="accounts-panel">
            <h2>代账交付</h2>
            <p>只导出本月已确认记录、关联凭证和月度汇总。待核对记录不会进入交付包。</p>
            <div className="company-accounts-settings-row">
              <Field label="公司名称（导出时可补）">
                <input
                  value={companyName}
                  onChange={(event) => setCompanyName(event.target.value)}
                  placeholder="可留空"
                />
              </Field>
              <Field label="默认币种">
                <input
                  value={defaultCurrency}
                  onChange={(event) => setDefaultCurrency(event.target.value.toUpperCase())}
                  maxLength={3}
                />
              </Field>
            </div>
            <div className="company-accounts-delivery-actions">
              <button
                type="button"
                className="accounts-button"
                disabled={busy}
                onClick={handleSaveSettings}
              >
                保存可选设置
              </button>
              <button
                type="button"
                className="accounts-button primary"
                disabled={busy}
                onClick={exportMonth}
              >
                导出 {month} 代账包
              </button>
            </div>
          </section>
          <section className="accounts-panel">
            <h2>备份与恢复</h2>
            <p>完整备份包含 SQLite 账目库、原始流水和全部凭证。恢复前会校验备份完整性。</p>
            <div className="company-accounts-delivery-actions">
              <button
                type="button"
                className="accounts-button"
                disabled={busy}
                onClick={createBackup}
              >
                创建完整备份
              </button>
              <button
                type="button"
                className="accounts-button danger"
                disabled={busy}
                onClick={restore}
              >
                从备份恢复
              </button>
            </div>
          </section>
          <section className="accounts-panel warning">
            <h2>账目边界</h2>
            <p>
              这是公司内部经营账工作台。正式财税申报、税务判断和法定账簿仍由持证代账或会计负责。
            </p>
          </section>
        </div>
      )}
    </div>
  )
}

function SummaryCard({
  label,
  value,
  tone = '',
}: {
  label: string
  value: string
  tone?: string
}): React.ReactElement {
  return (
    <div className={`company-accounts-kpi ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <label className="company-accounts-field">
      <span>{label}</span>
      {children}
    </label>
  )
}

function EvidencePicker({
  documents,
  sourceIds,
  selectedIds,
  onChange,
  onPreview,
}: {
  documents: CompanyAccountsDocument[]
  sourceIds: string[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
  onPreview: (document: CompanyAccountsDocument) => void
}): React.ReactElement {
  return (
    <div className="company-accounts-evidence">
      <div>
        <h3>原始流水与凭证</h3>
        <p>勾选只建立关联，不会再生成一笔收支。</p>
      </div>
      {documents.length === 0 ? (
        <span className="accounts-muted">暂无文件</span>
      ) : (
        documents.map((document) => {
          const isSource = sourceIds.includes(document.id)
          const checked = isSource || selectedIds.includes(document.id)
          return (
            <div className="company-accounts-document" key={document.id}>
              <label>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={isSource}
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? [...new Set([...selectedIds, document.id])]
                        : selectedIds.filter((id) => id !== document.id),
                    )
                  }
                />
                <span>
                  <strong>{document.originalName}</strong>
                  <small>
                    {isSource ? '收支来源 · ' : '关联凭证 · '}
                    {Math.max(1, Math.round(document.size / 1024))} KB
                  </small>
                </span>
              </label>
              <button type="button" onClick={() => onPreview(document)}>
                在 Studio 预览
              </button>
            </div>
          )
        })
      )}
    </div>
  )
}
