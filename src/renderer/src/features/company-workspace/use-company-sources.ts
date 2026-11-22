import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CompanyAccountsSnapshot } from '@shared/company-accounts/company-accounts-types'
import type {
  WebAccount,
  WebResourceSnapshot,
  WebsiteResource,
} from '@shared/web-resources/web-resource-types'
import type { WorkspaceRef } from '@shared/workspace-ref'
import { checkWebAccountLogins } from '../web-resources/web-account-login-check'
import { observeWebResourcesChanged } from '../web-resources/web-resource-events'
import {
  formatWebResourceLoginStatus,
  getWebResourceLoginStatus,
  type WebResourceLoginObservation,
  type WebResourceLoginStatus,
} from '../web-resources/web-resource-view-model'

export interface CompanyWebAccountRow {
  account: WebAccount
  website: WebsiteResource
  status: WebResourceLoginStatus
  /** Same wording as Settings · 网站与账号. */
  label: string
}

/**
 * Read-only projection of the global web account catalog (ADR 0014). The catalog and each
 * account's browser profile stay the owners; the Company home only shows their state.
 */
export function useCompanyWebAccounts(workspaceRef: WorkspaceRef | undefined): {
  rows: CompanyWebAccountRow[]
  checking: boolean
  error: string | null
  refresh(): Promise<void>
} {
  const [snapshot, setSnapshot] = useState<WebResourceSnapshot | null>(null)
  const [observations, setObservations] = useState<Record<string, WebResourceLoginObservation>>({})
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const live = useRef(true)
  const base = useMemo(() => {
    if (!snapshot) return []
    const websites = new Map(snapshot.websites.map((item) => [item.id, item]))
    return snapshot.accounts
      .filter((account) => !account.archivedAt && !account.mergedIntoAccountId)
      .flatMap((account) => {
        const website = websites.get(account.websiteId)
        return website ? [{ account, website }] : []
      })
  }, [snapshot])
  const load = useCallback(async () => {
    if (!workspaceRef) return
    try {
      const result = await window.cclinkStudio.webResources.getSnapshot({ workspaceRef })
      if (!live.current) return
      if (!result.success) throw new Error(result.error.message)
      setSnapshot(result.data)
      setError(null)
    } catch (reason) {
      if (live.current) setError(reason instanceof Error ? reason.message : '账号目录暂不可用')
    }
  }, [workspaceRef])
  const check = useCallback(async () => {
    if (!base.length) {
      setObservations({})
      return
    }
    setChecking(true)
    try {
      const next = await checkWebAccountLogins(base)
      if (live.current) setObservations(next)
    } finally {
      if (live.current) setChecking(false)
    }
  }, [base])
  useEffect(() => {
    live.current = true
    void load()
    const unsubscribe = observeWebResourcesChanged(() => void load())
    return () => {
      live.current = false
      unsubscribe()
    }
  }, [load])
  useEffect(() => {
    void check()
  }, [check])
  const rows = useMemo(
    () =>
      base.map((row) => ({
        ...row,
        status: getWebResourceLoginStatus(
          observations[row.account.id],
          row.account.loginConfirmedAt,
        ),
        label: formatWebResourceLoginStatus(
          observations[row.account.id],
          row.account.loginConfirmedAt,
        ),
      })),
    [base, observations],
  )
  const refresh = useCallback(async () => {
    await load()
    await check()
  }, [check, load])
  return { rows, checking, error, refresh }
}

/**
 * The ledger stays owned by CompanyAccountsService; this reads the active workspace's month
 * so the home can list entries awaiting review and confirm them through the same API.
 */
export function useCompanyLedger(
  month: string,
  enabled: boolean,
): {
  ledger: CompanyAccountsSnapshot | null
  error: string | null
  reload(): Promise<void>
} {
  const [ledger, setLedger] = useState<CompanyAccountsSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const request = useRef(0)
  const reload = useCallback(async () => {
    if (!enabled) return
    const id = ++request.current
    try {
      const result = await window.cclinkStudio.companyAccounts.getSnapshot(month)
      if (id !== request.current) return
      if (!result.success) throw new Error(result.error.message)
      setLedger(result.data)
      setError(result.data.error ?? null)
    } catch (reason) {
      if (id === request.current)
        setError(reason instanceof Error ? reason.message : '账目暂不可用')
    }
  }, [enabled, month])
  useEffect(() => {
    setLedger(null)
    void reload()
    return () => {
      request.current++
    }
  }, [reload])
  return { ledger, error, reload }
}
