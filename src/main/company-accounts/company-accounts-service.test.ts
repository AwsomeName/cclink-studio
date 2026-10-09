import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { CompanyAccountsService } from './company-accounts-service'

const temporaryDirectories: string[] = []

function temporaryDirectory(label: string): string {
  const path = mkdtempSync(join(tmpdir(), `cclink-accounts-${label}-`))
  temporaryDirectories.push(path)
  return path
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('CompanyAccountsService', () => {
  it('keeps first use zero-config and does not create files before the user enables accounts', () => {
    const workspace = temporaryDirectory('empty')
    const service = new CompanyAccountsService(() => workspace)

    const before = service.getSnapshot('2026-09')
    expect(before.initialized).toBe(false)
    expect(existsSync(join(workspace, '.cclink-studio', 'company-accounts'))).toBe(false)

    const after = service.initialize('2026-09')
    expect(after.initialized).toBe(true)
    expect(after.settings.defaultCurrency).toBe('CNY')
    expect(
      existsSync(join(workspace, '.cclink-studio', 'company-accounts', 'accounts.sqlite')),
    ).toBe(true)
    const database = new DatabaseSync(
      join(workspace, '.cclink-studio', 'company-accounts', 'accounts.sqlite'),
      { readOnly: true },
    )
    try {
      const tables = database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => String(row.name))
      expect(tables).toEqual([
        'documents',
        'import_batches',
        'projects',
        'record_documents',
        'record_events',
        'records',
        'settings',
      ])
      expect(database.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 })
    } finally {
      database.close()
    }
  })

  it('imports transaction CSV as pending, keeps evidence separate, requires human confirmation and avoids duplicates', async () => {
    const workspace = temporaryDirectory('flow')
    const inputDirectory = temporaryDirectory('input')
    const csvPath = join(inputDirectory, '微信流水.csv')
    const invoicePath = join(inputDirectory, '镜片发票.pdf')
    writeFileSync(
      csvPath,
      '交易时间,收支类型,金额,账户,交易对方,备注,交易单号\n' +
        '2026-09-12 10:20:00,支出,1280.50,微信支付,光学供应商,AR镜片采购,WX-001\n' +
        '2026-09-15 09:00:00,收入,3000.00,招商银行,客户A,样机款,WX-002\n',
      'utf8',
    )
    writeFileSync(invoicePath, 'fake-pdf-evidence', 'utf8')
    const service = new CompanyAccountsService(
      () => workspace,
      async () =>
        JSON.stringify({
          category: '镜片采购',
          recordType: 'expense',
          projectId: null,
          reason: '交易用途是 AR 镜片采购',
        }),
    )
    service.initialize('2026-09')

    const imported = service.importFiles({ month: '2026-09', filePaths: [csvPath, invoicePath] })
    expect(imported.importedRecords).toBe(2)
    expect(imported.importedDocuments).toBe(2)

    let snapshot = service.getSnapshot('2026-09')
    expect(snapshot.summary.pendingCount).toBe(2)
    expect(snapshot.summary.expenseMinor).toBe(0)
    expect(snapshot.documents).toHaveLength(2)
    const expense = snapshot.records.find((record) => record.direction === 'expense')!
    expect(expense.status).toBe('pending')
    expect(expense.category).toBe('器件采购')
    const proposal = await service.proposeRecord(expense.id)
    expect(proposal.category).toBe('镜片采购')
    snapshot = service.getSnapshot('2026-09')
    expect(snapshot.summary.expenseMinor).toBe(0)
    expect(snapshot.records.find((record) => record.id === expense.id)?.history[0].eventType).toBe(
      'ai_suggested',
    )
    expect(() =>
      service.updateRecord({
        recordId: expense.id,
        expectedVersion: expense.version,
        date: expense.date,
        recordType: 'expense',
        direction: 'income',
        amountMinor: expense.amountMinor,
        currency: expense.currency,
        account: expense.account,
        counterparty: expense.counterparty,
        purpose: expense.purpose,
        category: expense.category,
        projectId: null,
        documentIds: [],
      }),
    ).toThrow('支出记录的收支方向必须为流出')

    const project = service.createProject('AR 眼镜一代')
    const invoice = snapshot.documents.find((document) => document.originalName === '镜片发票.pdf')!
    snapshot = service.updateRecord({
      recordId: expense.id,
      expectedVersion: expense.version,
      date: expense.date,
      recordType: expense.recordType,
      direction: expense.direction,
      amountMinor: expense.amountMinor,
      currency: expense.currency,
      account: expense.account,
      counterparty: expense.counterparty,
      purpose: expense.purpose,
      category: expense.category,
      projectId: project.id,
      documentIds: [invoice.id],
    })
    const edited = snapshot.records.find((record) => record.id === expense.id)!
    snapshot = service.confirmRecord(edited.id, edited.version)
    expect(snapshot.summary.expenseMinor).toBe(128_050)
    expect(snapshot.summary.projectSpending).toEqual([
      {
        projectId: project.id,
        projectName: project.name,
        spentMinor: 128_050,
        categories: [{ category: '器件采购', spentMinor: 128_050 }],
      },
    ])

    const confirmed = snapshot.records.find((record) => record.id === expense.id)!
    snapshot = service.updateRecord({
      recordId: confirmed.id,
      expectedVersion: confirmed.version,
      date: confirmed.date,
      recordType: confirmed.recordType,
      direction: confirmed.direction,
      amountMinor: confirmed.amountMinor,
      currency: confirmed.currency,
      account: confirmed.account,
      counterparty: confirmed.counterparty,
      purpose: confirmed.purpose,
      category: confirmed.category,
      projectId: confirmed.projectId,
      documentIds: confirmed.supportingDocumentIds,
    })
    expect(snapshot.records.find((record) => record.id === expense.id)?.status).toBe('confirmed')
    expect(snapshot.records.find((record) => record.id === expense.id)?.version).toBe(
      confirmed.version,
    )
    snapshot = service.updateRecord({
      recordId: confirmed.id,
      expectedVersion: confirmed.version,
      date: confirmed.date,
      recordType: confirmed.recordType,
      direction: confirmed.direction,
      amountMinor: confirmed.amountMinor,
      currency: confirmed.currency,
      account: confirmed.account,
      counterparty: confirmed.counterparty,
      purpose: confirmed.purpose,
      category: '镜片采购',
      projectId: confirmed.projectId,
      documentIds: confirmed.supportingDocumentIds,
    })
    expect(snapshot.records.find((record) => record.id === expense.id)?.status).toBe('pending')
    expect(snapshot.summary.expenseMinor).toBe(0)
    const pendingAgain = snapshot.records.find((record) => record.id === expense.id)!
    snapshot = service.confirmRecord(pendingAgain.id, pendingAgain.version)
    expect(snapshot.summary.expenseMinor).toBe(128_050)

    const outputDirectory = temporaryDirectory('flow-output')
    const exported = service.exportMonth('2026-09', outputDirectory)
    expect(readFileSync(join(exported.directoryPath, '确认与修改记录.csv'), 'utf8')).toContain(
      invoice.id,
    )

    expect(() =>
      service.updateSettings({ month: '2026-09', companyName: '', defaultCurrency: 'USD' }),
    ).toThrow('已有 CNY 已确认记录')
    expect(() =>
      service.updateSettings({ month: '2026-09', companyName: '', defaultCurrency: '人民币' }),
    ).toThrow('币种应为三个英文字母')

    const duplicate = service.importFiles({ month: '2026-09', filePaths: [csvPath] })
    expect(duplicate.importedRecords).toBe(0)
    expect(duplicate.duplicateRecords).toBe(2)
    expect(service.getSnapshot('2026-09').records).toHaveLength(2)

    const income = service
      .getSnapshot('2026-09')
      .records.find((record) => record.recordType === 'income')!
    snapshot = service.updateRecord({
      recordId: income.id,
      expectedVersion: income.version,
      date: income.date,
      recordType: income.recordType,
      direction: income.direction,
      amountMinor: income.amountMinor,
      currency: 'USD',
      account: income.account,
      counterparty: income.counterparty,
      purpose: income.purpose,
      category: income.category,
      projectId: income.projectId,
      documentIds: income.supportingDocumentIds,
    })
    const usdIncome = snapshot.records.find((record) => record.id === income.id)!
    expect(() => service.confirmRecord(usdIncome.id, usdIncome.version)).toThrow(
      '首版只支持默认币种 CNY',
    )
  })

  it('exports only confirmed records and restores a complete backup', () => {
    const workspace = temporaryDirectory('backup-workspace')
    const inputDirectory = temporaryDirectory('backup-input')
    const outputDirectory = temporaryDirectory('backup-output')
    const csvPath = join(inputDirectory, 'bank.csv')
    writeFileSync(
      csvPath,
      'date,direction,amount,account,counterparty,description,transactionid\n' +
        '2026-08-03,expense,42.00,bank,shop,=2+2,T-1\n',
      'utf8',
    )
    const service = new CompanyAccountsService(() => workspace)
    service.initialize('2026-08')
    const ledgerDirectory = join(workspace, '.cclink-studio', 'company-accounts')
    expect(() => service.createBackup(ledgerDirectory)).toThrow(
      '备份目录不能位于当前账目数据目录内',
    )
    expect(() => service.exportMonth('2026-08', ledgerDirectory)).toThrow(
      '导出目录不能位于当前账目数据目录内',
    )
    service.importFiles({ month: '2026-08', filePaths: [csvPath] })
    const snapshot = service.getSnapshot('2026-08')
    service.confirmRecord(snapshot.records[0].id, snapshot.records[0].version)

    const exported = service.exportMonth('2026-08', outputDirectory)
    expect(exported.recordCount).toBe(1)
    expect(existsSync(join(exported.directoryPath, '已确认账目.csv'))).toBe(true)
    expect(readFileSync(join(exported.directoryPath, '已确认账目.csv'), 'utf8')).toContain("'=2+2")
    const secondExport = service.exportMonth('2026-08', outputDirectory)
    expect(secondExport.directoryPath).not.toBe(exported.directoryPath)

    const backup = service.createBackup(outputDirectory)
    const validBackup = service.createBackup(outputDirectory)
    expect(validBackup.directoryPath).not.toBe(backup.directoryPath)
    const backedUpDocument = readdirSync(join(backup.directoryPath, 'documents'))[0]
    writeFileSync(join(backup.directoryPath, 'documents', backedUpDocument), 'corrupted', 'utf8')
    service.createProject('临时项目')
    expect(service.getSnapshot('2026-08').projects).toHaveLength(1)
    expect(() =>
      service.restoreBackup({
        backupDirectory: backup.directoryPath,
        month: '2026-08',
      }),
    ).toThrow('备份凭证校验失败')
    expect(service.getSnapshot('2026-08').projects).toHaveLength(1)
    const restored = service.restoreBackup({
      backupDirectory: validBackup.directoryPath,
      month: '2026-08',
    })
    expect(restored.records).toHaveLength(1)
    expect(restored.records[0].status).toBe('confirmed')
    expect(restored.projects).toHaveLength(0)
  })

  it('accepts concise Chinese CSV headers used by small-business exports', () => {
    const workspace = temporaryDirectory('concise-headers-workspace')
    const inputDirectory = temporaryDirectory('concise-headers-input')
    const csvPath = join(inputDirectory, '服务支出.csv')
    writeFileSync(
      csvPath,
      '日期,收支,金额,账户,交易对方,用途,交易号\n' +
        '2026-09-20,支出,99.90,微信支付,工业设计服务商,眼镜外观设计咨询,WX-004\n' +
        '2026-09-21,支出,260.00,支付宝,CNC加工厂,镜框打样,WX-005\n',
      'utf8',
    )
    const service = new CompanyAccountsService(() => workspace)
    service.initialize('2026-09')

    const imported = service.importFiles({ month: '2026-09', filePaths: [csvPath] })
    expect(imported.failures).toEqual([])
    expect(imported.importedRecords).toBe(2)
    const records = service.getSnapshot('2026-09').records
    expect(records.find((record) => record.purpose === '眼镜外观设计咨询')).toMatchObject({
      date: '2026-09-20',
      category: '研发服务',
      amountMinor: 9_990,
      status: 'pending',
    })
    expect(records.find((record) => record.purpose === '镜框打样')?.category).toBe('研发打样')
    const wrongMonth = service.importFiles({ month: '2026-08', filePaths: [csvPath] })
    expect(wrongMonth.importedRecords).toBe(0)
    expect(wrongMonth.failures[0]?.reason).toBe('CSV 中没有 2026-08 的流水')
  })

  it('moves a corrected transaction to its new month and keeps it confirmable', () => {
    const workspace = temporaryDirectory('move-month-workspace')
    const inputDirectory = temporaryDirectory('move-month-input')
    const csvPath = join(inputDirectory, 'bank.csv')
    writeFileSync(
      csvPath,
      'date,direction,amount,account,counterparty,description,transactionid\n' +
        '2026-09-30,income,500.00,bank,customer,deposit,M-1\n',
      'utf8',
    )
    const service = new CompanyAccountsService(() => workspace)
    service.initialize('2026-09')
    service.importFiles({ month: '2026-09', filePaths: [csvPath] })
    const record = service.getSnapshot('2026-09').records[0]

    let snapshot = service.updateRecord({
      recordId: record.id,
      expectedVersion: record.version,
      date: '2026-10-01',
      recordType: record.recordType,
      direction: record.direction,
      amountMinor: record.amountMinor,
      currency: record.currency,
      account: record.account,
      counterparty: record.counterparty,
      purpose: record.purpose,
      category: record.category,
      projectId: record.projectId,
      documentIds: record.supportingDocumentIds,
    })
    expect(snapshot.month).toBe('2026-10')
    expect(snapshot.records).toHaveLength(1)
    expect(snapshot.records[0]).toMatchObject({ date: '2026-10-01', status: 'pending' })

    snapshot = service.confirmRecord(snapshot.records[0].id, snapshot.records[0].version)
    expect(snapshot.summary.incomeMinor).toBe(50_000)
    expect(service.getSnapshot('2026-09').records).toHaveLength(0)
  })

  it('does not turn an amount-only CSV into income without transaction direction evidence', () => {
    const workspace = temporaryDirectory('evidence-csv-workspace')
    const inputDirectory = temporaryDirectory('evidence-csv-input')
    const csvPath = join(inputDirectory, 'invoice-list.csv')
    writeFileSync(
      csvPath,
      '日期,金额,账户,交易对方,用途\n' + '2026-09-12,1280.50,微信支付,光学供应商,镜片发票\n',
      'utf8',
    )
    const service = new CompanyAccountsService(() => workspace)
    service.initialize('2026-09')

    const imported = service.importFiles({ month: '2026-09', filePaths: [csvPath] })
    expect(imported.importedRecords).toBe(0)
    expect(imported.importedDocuments).toBe(0)
    expect(imported.failures[0]?.reason).toBe('CSV 中未识别到有效流水')
    expect(service.getSnapshot('2026-09').records).toHaveLength(0)
  })

  it('imports a UTF-16 tab-separated statement with metadata before its header', () => {
    const workspace = temporaryDirectory('utf16-workspace')
    const inputDirectory = temporaryDirectory('utf16-input')
    const csvPath = join(inputDirectory, 'wechat.csv')
    const content =
      '微信支付账单明细\r\n导出时间：2026-10-01\r\n' +
      '日期\t收支\t金额\t账户\t交易对方\t用途\t交易号\r\n' +
      '2026-09-22\t支出\t88.60\t微信支付\t检测机构\t眼镜光学检测\tWX-TAB-1\r\n'
    writeFileSync(csvPath, Buffer.from(`\uFEFF${content}`, 'utf16le'))
    const service = new CompanyAccountsService(() => workspace)
    service.initialize('2026-09')

    const imported = service.importFiles({ month: '2026-09', filePaths: [csvPath] })
    expect(imported.failures).toEqual([])
    expect(imported.importedRecords).toBe(1)
    expect(service.getSnapshot('2026-09').records[0]).toMatchObject({
      amountMinor: 8_860,
      category: '研发服务',
      status: 'pending',
    })
  })

  it('excludes internal transfers, offsets incoming refunds and counts outgoing refunds', () => {
    const workspace = temporaryDirectory('summary-rules-workspace')
    const inputDirectory = temporaryDirectory('summary-rules-input')
    const csvPath = join(inputDirectory, 'mixed.csv')
    writeFileSync(
      csvPath,
      'date,direction,amount,account,counterparty,description,transactionid\n' +
        '2026-07-01,income,1000.00,bank,customer,sale,R-1\n' +
        '2026-07-02,expense,200.00,bank,supplier,materials,R-2\n' +
        '2026-07-03,income,20.00,bank,supplier,refund,R-3\n' +
        '2026-07-04,expense,500.00,bank,own account,internal transfer,R-4\n' +
        '2026-07-05,expense,10.00,bank,customer,customer refund,R-5\n',
      'utf8',
    )
    const service = new CompanyAccountsService(() => workspace)
    service.initialize('2026-07')
    service.importFiles({ month: '2026-07', filePaths: [csvPath] })
    let snapshot = service.getSnapshot('2026-07')
    for (const record of snapshot.records) {
      snapshot = service.confirmRecord(record.id, record.version)
    }

    expect(snapshot.summary).toMatchObject({
      incomeMinor: 100_000,
      expenseMinor: 21_000,
      refundMinor: 2_000,
      netMinor: 81_000,
      confirmedCount: 5,
      pendingCount: 0,
    })
  })
})
