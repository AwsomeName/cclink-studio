import { useEffect, useRef, useState } from 'react'
import type { BrowserTabState } from '../../stores/browser-store'
import type { Tab } from '../../types'
import { useTabStore } from '../../stores/tab-store'
import { notifyWebResourcesChanged } from '../../features/web-resources/web-resource-events'
import { copyTextToClipboard } from '../../utils/clipboard'
import {
  IconArrowLeft,
  IconChevronDown,
  IconClose,
  IconGlobe,
  IconUser,
  IconArrowRight,
  IconFitWidth,
  IconMobile,
  IconMonitor,
  IconRefresh,
  IconZoomIn,
  IconZoomOut,
} from '../common/Icons'
import { BrowserHistoryMenu } from './BrowserHistoryMenu'
import { useBrowserFindStore } from '../../features/browser/browser-find-store'
import { useToastStore } from '../common/Toast'
import {
  closeBrowserFind,
  runBrowserFind,
  stopBrowserFindSelection,
} from '../../features/browser/browser-find-controller'
import { useEscapeDismiss } from '../common/dismissable-layer'
import { getBrowserTabMode } from '../../features/browser/browser-tab-mode'
import './browser-toolbar.css'

interface BrowserToolbarProps {
  tabId: string
  tab: Tab
  browserState: BrowserTabState | undefined
  autoFocusAddress?: boolean
  onAddressFocusHandled?: (tabId: string) => void
  onUrlInputChange: (tabId: string, value: string) => void
  onNavigate: (value: string) => void
  onOpenUrl: (url: string) => void
}

export function shouldNavigateBrowserAddress(input: {
  key: string
  nativeIsComposing: boolean
  compositionActive: boolean
}): boolean {
  return input.key === 'Enter' && !input.nativeIsComposing && !input.compositionActive
}

export function shouldQueueBrowserAddressNavigation(input: {
  key: string
  nativeIsComposing: boolean
  compositionActive: boolean
}): boolean {
  return input.key === 'Enter' && (input.nativeIsComposing || input.compositionActive)
}

const MIN_BROWSER_ZOOM_PERCENT = 30
const MAX_BROWSER_ZOOM_PERCENT = 300

export function normalizeBrowserZoomPercent(value: string): number | null {
  const normalized = value.trim().replace(/%$/, '').trim()
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null
  const percent = Number(normalized)
  if (!Number.isFinite(percent)) return null
  return Math.min(MAX_BROWSER_ZOOM_PERCENT, Math.max(MIN_BROWSER_ZOOM_PERCENT, Math.round(percent)))
}

export function inferWebResourceDisplayName(
  browserState: Pick<BrowserTabState, 'title' | 'url' | 'urlInput'> | undefined,
): string {
  const title = browserState?.title?.trim()
  if (title && title !== '浏览器' && title !== '新标签页') return title.slice(0, 160)
  for (const candidate of [browserState?.url, browserState?.urlInput]) {
    if (!candidate?.trim()) continue
    try {
      const url = new URL(candidate)
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return url.hostname.replace(/^www\./, '').slice(0, 160)
      }
    } catch {
      // 地址尚未形成有效网页时不猜测名称。
    }
  }
  return ''
}

export function getBrowserEnvironmentLabel(
  tab: Pick<Tab, 'title' | 'browserProfile' | 'webResourceRef' | 'webResourceDraftRef'>,
  accountLabel?: string | null,
): string {
  const mode = getBrowserTabMode(tab)
  if (mode === 'ordinary') return '默认环境'
  if (mode === 'account-draft') return '普通浏览器 · 登录可保存'
  if (mode === 'account') return `账号 · ${accountLabel?.trim() || tab.title}`
  return '环境异常'
}

export function BrowserToolbar({
  tabId,
  tab,
  browserState,
  autoFocusAddress = false,
  onAddressFocusHandled,
  onUrlInputChange,
  onNavigate,
  onOpenUrl,
}: BrowserToolbarProps): React.ReactElement {
  const [expandedPanel, setExpandedPanel] = useState<'save' | 'options' | null>(null)
  const panelTriggerRef = useRef<HTMLButtonElement | null>(null)
  const moreButtonRef = useRef<HTMLButtonElement>(null)
  const zoomInputRef = useRef<HTMLInputElement>(null)
  const [displayName, setDisplayName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [duplicateAccountId, setDuplicateAccountId] = useState<string | null>(null)
  const [accountLabel, setAccountLabel] = useState<string | null>(null)
  const zoomPercent = Math.round((browserState?.zoomFactor ?? 1) * 100)
  const [zoomDraft, setZoomDraft] = useState(String(zoomPercent))
  const [editingZoom, setEditingZoom] = useState(false)
  const findSession = useBrowserFindStore((state) => state.sessions[tabId])
  const setFindQuery = useBrowserFindStore((state) => state.setQuery)
  const showToast = useToastStore((state) => state.show)
  const findInputRef = useRef<HTMLInputElement>(null)
  const urlInputRef = useRef<HTMLInputElement>(null)
  const urlCompositionActiveRef = useRef(false)
  const navigateAfterCompositionRef = useRef(false)
  const cancelZoomCommitRef = useRef(false)
  const zoomEditedRef = useRef(false)
  const draftId = tab.webResourceDraftRef?.draftId
  const environmentLabel = getBrowserEnvironmentLabel(tab, accountLabel)

  const closePanel = (): void => {
    if (saving) return
    setExpandedPanel(null)
    const trigger = panelTriggerRef.current
    const visibleTrigger = trigger?.getClientRects().length ? trigger : moreButtonRef.current
    visibleTrigger?.focus({ preventScroll: true })
  }
  useEscapeDismiss(expandedPanel !== null, () => {
    // Escape dismisses the expansion before the input receives its own key event.
    // Discard an unsubmitted percentage before restoring focus triggers blur.
    cancelZoomCommitRef.current = true
    setZoomDraft(String(zoomPercent))
    setEditingZoom(false)
    closePanel()
  })

  const toggleOptions = (trigger: HTMLButtonElement, focusZoom = false): void => {
    if (saving) return
    panelTriggerRef.current = trigger
    setExpandedPanel((current) => (current === 'options' ? null : 'options'))
    if (focusZoom && expandedPanel !== 'options') {
      requestAnimationFrame(() => {
        zoomInputRef.current?.focus()
        zoomInputRef.current?.select()
      })
    }
  }
  const addressProtocol = /^https:/i.test(browserState?.url ?? '')
    ? 'HTTPS'
    : /^http:/i.test(browserState?.url ?? '')
      ? 'HTTP'
      : null

  useEffect(() => {
    setExpandedPanel(null)
    setDisplayName('')
    setSaveError(null)
    setDuplicateAccountId(null)
  }, [tabId])

  useEffect(() => {
    const accountId = tab.webResourceRef?.accountId
    if (!accountId || !tab.workspaceRef) {
      setAccountLabel(null)
      return
    }
    let cancelled = false
    void window.cclinkStudio.webResources
      .getSnapshot({ workspaceRef: tab.workspaceRef })
      .then((result) => {
        if (cancelled) return
        setAccountLabel(
          result.success
            ? (result.data.accounts.find((account) => account.id === accountId)?.label ?? null)
            : null,
        )
      })
      .catch(() => {
        if (!cancelled) setAccountLabel(null)
      })
    return () => {
      cancelled = true
    }
  }, [tab.webResourceRef?.accountId, tab.workspaceRef])

  useEffect(() => {
    if (!findSession?.open) return
    requestAnimationFrame(() => {
      findInputRef.current?.focus()
      findInputRef.current?.select()
    })
    if (findSession.query.trim()) {
      void runBrowserFind(tabId, { forward: true, findNext: false }, findSession.query)
    }
  }, [findSession?.open])

  useEffect(() => {
    if (!autoFocusAddress || findSession?.open) return
    let cancelled = false
    let animationFrame = 0

    void window.cclinkStudio.window
      .focusRenderer()
      .catch((error) => {
        console.warn('[BrowserToolbar] 新标签页焦点切回工作台失败:', error)
      })
      .then(() => {
        if (cancelled) return
        animationFrame = requestAnimationFrame(() => {
          if (cancelled) return
          urlInputRef.current?.focus()
          urlInputRef.current?.select()
          if (browserState?.ready) onAddressFocusHandled?.(tabId)
        })
      })

    return () => {
      cancelled = true
      cancelAnimationFrame(animationFrame)
    }
  }, [autoFocusAddress, browserState?.ready, findSession?.open, onAddressFocusHandled, tabId])

  useEffect(() => {
    if (!editingZoom) setZoomDraft(String(zoomPercent))
  }, [editingZoom, zoomPercent])

  const commitZoom = (): void => {
    const shouldCommit = zoomEditedRef.current && !cancelZoomCommitRef.current
    zoomEditedRef.current = false
    cancelZoomCommitRef.current = false
    setEditingZoom(false)
    if (!shouldCommit) {
      setZoomDraft(String(zoomPercent))
      return
    }
    const percent = normalizeBrowserZoomPercent(zoomDraft)
    if (percent === null) {
      setZoomDraft(String(zoomPercent))
      return
    }
    setZoomDraft(String(percent))
    void window.cclinkStudio.browser.setZoom(tabId, percent / 100)
  }

  const updateFindQuery = (value: string): void => {
    setFindQuery(tabId, value)
    if (value.trim()) void runBrowserFind(tabId, { forward: true, findNext: false }, value)
    else void stopBrowserFindSelection(tabId)
  }

  const saveDraft = async (duplicateResolution?: 'save-another'): Promise<void> => {
    if (!draftId || tab.workspaceRef?.kind !== 'local') return
    const normalizedDisplayName = displayName.trim()
    if (!normalizedDisplayName) {
      setSaveError('请输入账号显示名称')
      showToast('请输入账号显示名称后再保存', 'error')
      console.warn('[WebResources] 保存未开始：账号显示名称为空', { tabId })
      return
    }
    setSaving(true)
    setSaveError(null)
    setDuplicateAccountId(null)
    console.info('[WebResources] 开始保存网站账号', { tabId, duplicateResolution })
    try {
      const result = await window.cclinkStudio.webResources.saveDraft({
        workspaceRef: tab.workspaceRef,
        draftId,
        tabId,
        displayName: normalizedDisplayName,
        duplicateResolution,
      })
      if (!result.success) {
        setSaveError(result.error.message)
        setDuplicateAccountId(result.error.context?.existingAccountId ?? null)
        showToast(result.error.message, 'error')
        console.warn('[WebResources] 网站账号保存被拒绝', {
          tabId,
          code: result.error.code,
        })
        return
      }
      useTabStore.getState().bindWebResourceDraft(tabId, {
        title: result.data.website.name,
        initialUrl: result.data.website.entryUrl,
        browserProfile: result.data.account.browserProfileId,
        webResourceRef: { accountId: result.data.account.id },
      })
      setExpandedPanel(null)
      notifyWebResourcesChanged()
      showToast('已保存到全局网站与账号', 'success')
      console.info('[WebResources] 网站账号保存成功', {
        tabId,
        accountId: result.data.account.id,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setSaveError(message)
      showToast(message, 'error')
      console.error('[WebResources] 网站账号保存异常', { tabId, message })
    } finally {
      setSaving(false)
    }
  }

  const prepareSave = (): void => {
    if (!draftId || tab.workspaceRef?.kind !== 'local' || tab.webResourceRef) return
    setDisplayName((current) => current || inferWebResourceDisplayName(browserState))
    setSaveError(null)
    setExpandedPanel('save')
  }

  const openExistingAccount = async (): Promise<void> => {
    if (!draftId || !duplicateAccountId || tab.workspaceRef?.kind !== 'local') return
    setSaving(true)
    setSaveError(null)
    try {
      const cancelled = await window.cclinkStudio.webResources.cancelDraft({
        workspaceRef: tab.workspaceRef,
        draftId,
        tabId,
      })
      if (!cancelled.success) throw new Error(cancelled.error.message)
      const launch = await window.cclinkStudio.webResources.resolveLaunch({
        workspaceRef: tab.workspaceRef,
        accountId: duplicateAccountId,
      })
      if (!launch.success) throw new Error(launch.error.message)
      useTabStore.getState().bindWebResourceDraft(tabId, {
        title: launch.data.title,
        initialUrl: launch.data.entryUrl,
        browserProfile: launch.data.browserProfileId,
        webResourceRef: launch.data.webResourceRef,
      })
      setExpandedPanel(null)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="browser-toolbar-shell">
      <div className="browser-toolbar" role="toolbar" aria-label="浏览器工具栏">
        <button
          type="button"
          onClick={() => window.cclinkStudio.browser.goBack(tabId)}
          title="后退"
          aria-label="后退"
        >
          <IconArrowLeft size={16} />
        </button>
        <button
          type="button"
          className="browser-forward-button"
          onClick={() => window.cclinkStudio.browser.goForward(tabId)}
          title="前进"
          aria-label="前进"
        >
          <IconArrowRight size={16} />
        </button>
        <button
          type="button"
          onClick={() => window.cclinkStudio.browser.reload(tabId)}
          title="刷新"
          aria-label="刷新"
        >
          <IconRefresh size={16} />
        </button>
        {findSession?.open ? (
          <div className="browser-find-bar" role="search">
            <input
              ref={findInputRef}
              value={findSession.query}
              onChange={(event) => updateFindQuery(event.target.value)}
              onFocus={() => void window.cclinkStudio.window.focusRenderer()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void runBrowserFind(
                    tabId,
                    {
                      forward: !event.shiftKey,
                      findNext: findSession.matches > 0,
                    },
                    event.currentTarget.value,
                  )
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  void closeBrowserFind(tabId)
                }
              }}
              placeholder="在网页中查找"
              aria-label="在网页中查找"
            />
            <span className={findSession.error ? 'browser-find-error' : 'browser-find-count'}>
              {findSession.error
                ? findSession.error
                : findSession.query
                  ? `${findSession.activeMatchOrdinal}/${findSession.matches}`
                  : '0/0'}
            </span>
            <button
              type="button"
              className="browser-find-text-button"
              title="上一个匹配项"
              aria-label="上一个匹配项"
              onClick={() => void runBrowserFind(tabId, { forward: false, findNext: true })}
            >
              ↑
            </button>
            <button
              type="button"
              className="browser-find-text-button"
              title="下一个匹配项"
              aria-label="下一个匹配项"
              onClick={() => void runBrowserFind(tabId, { forward: true, findNext: true })}
            >
              ↓
            </button>
            <button
              type="button"
              className="browser-find-text-button"
              title="关闭查找"
              aria-label="关闭查找"
              onClick={() => void closeBrowserFind(tabId)}
            >
              ×
            </button>
          </div>
        ) : (
          <div className="browser-address-field">
            <IconGlobe size={15} />
            {addressProtocol && (
              <span
                className={`browser-address-protocol ${addressProtocol === 'HTTP' ? 'plain-http' : ''}`}
                title={addressProtocol === 'HTTP' ? 'HTTP 连接（未加密）' : 'HTTPS 连接'}
              >
                {addressProtocol}
              </span>
            )}
            <input
              ref={urlInputRef}
              className="url-input"
              value={browserState?.urlInput ?? ''}
              onChange={(event) => onUrlInputChange(tabId, event.target.value)}
              onCompositionStart={() => {
                urlCompositionActiveRef.current = true
                navigateAfterCompositionRef.current = false
              }}
              onCompositionEnd={(event) => {
                urlCompositionActiveRef.current = false
                if (!navigateAfterCompositionRef.current) return
                navigateAfterCompositionRef.current = false
                onNavigate(event.currentTarget.value)
              }}
              onFocus={() => {
                void window.cclinkStudio.window.focusRenderer()
              }}
              onKeyDown={(event) => {
                const primaryModifier = event.metaKey || event.ctrlKey
                const key = event.key.toLowerCase()

                if (
                  shouldQueueBrowserAddressNavigation({
                    key: event.key,
                    nativeIsComposing: event.nativeEvent.isComposing,
                    compositionActive: urlCompositionActiveRef.current,
                  })
                ) {
                  navigateAfterCompositionRef.current = true
                  return
                }

                if (primaryModifier && !event.altKey && !event.shiftKey && key === 'a') {
                  event.preventDefault()
                  event.currentTarget.select()
                  return
                }

                if (primaryModifier && !event.altKey && !event.shiftKey && key === 'c') {
                  const input = event.currentTarget
                  const start = input.selectionStart ?? 0
                  const end = input.selectionEnd ?? start
                  if (end > start) {
                    event.preventDefault()
                    const selectedText = input.value.slice(start, end)
                    void copyTextToClipboard(selectedText).catch((error) => {
                      console.error('[BrowserToolbar] 地址复制失败:', error)
                    })
                  }
                  return
                }

                if (
                  shouldNavigateBrowserAddress({
                    key: event.key,
                    nativeIsComposing: event.nativeEvent.isComposing,
                    compositionActive: urlCompositionActiveRef.current,
                  })
                ) {
                  event.preventDefault()
                  onNavigate(event.currentTarget.value)
                }
              }}
              placeholder="输入网址"
              aria-label="浏览器地址"
            />
          </div>
        )}

        <button
          type="button"
          className="browser-zoom-summary"
          title="网页缩放与显示选项"
          aria-label="网页缩放与显示选项"
          aria-expanded={expandedPanel === 'options'}
          aria-controls={`browser-options-${tabId}`}
          onClick={(event) => toggleOptions(event.currentTarget, true)}
        >
          {browserState?.zoomMode === 'fit' && <span className="zoom-mode-label">自动</span>}
          <span>{zoomPercent}%</span>
          <IconChevronDown size={12} />
        </button>
        <button
          type="button"
          className="browser-account-button"
          data-mode={getBrowserTabMode(tab)}
          title={draftId ? '保存账号和登录状态' : `当前登录环境：${environmentLabel}`}
          aria-label={draftId ? '保存账号和登录状态' : `当前登录环境：${environmentLabel}`}
          aria-expanded={draftId ? expandedPanel === 'save' : expandedPanel === 'options'}
          aria-controls={draftId ? `browser-save-${tabId}` : `browser-options-${tabId}`}
          disabled={saving}
          onClick={(event) => {
            panelTriggerRef.current = event.currentTarget
            if (draftId) {
              if (expandedPanel === 'save') closePanel()
              else prepareSave()
            } else toggleOptions(event.currentTarget)
          }}
        >
          <IconUser size={16} />
          <span>
            {draftId ? '保存账号' : tab.webResourceRef ? accountLabel || tab.title : '默认环境'}
          </span>
        </button>
        <button
          type="button"
          ref={moreButtonRef}
          className="browser-more-button"
          title="更多浏览器操作"
          aria-label="更多浏览器操作"
          aria-expanded={expandedPanel === 'options'}
          aria-controls={`browser-options-${tabId}`}
          disabled={saving}
          onClick={(event) => toggleOptions(event.currentTarget)}
        >
          <span aria-hidden="true">•••</span>
        </button>
      </div>

      {expandedPanel === 'save' && draftId && (
        <section
          className="browser-toolbar-expansion browser-resource-save"
          id={`browser-save-${tabId}`}
          aria-label="保存当前登录环境"
        >
          <div className="browser-expansion-heading">
            <div>
              <strong>保存当前登录环境</strong>
              <p>登录完成后，为这个账号命名。当前页面和登录状态会保留。</p>
            </div>
            <button
              type="button"
              title="关闭保存账号"
              aria-label="关闭保存账号"
              disabled={saving}
              onClick={closePanel}
            >
              <IconClose size={14} />
            </button>
          </div>
          <div className="browser-resource-save-fields">
            <input
              autoFocus
              maxLength={160}
              value={displayName}
              disabled={saving}
              onFocus={() => void window.cclinkStudio.window.focusRenderer()}
              onChange={(event) => {
                setDisplayName(event.target.value)
                if (saveError) setSaveError(null)
              }}
              aria-required="true"
              aria-invalid={Boolean(saveError)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  void saveDraft()
                }
              }}
              placeholder="手机号或平台用户名（用于区分账号）"
              aria-label="账号手机号或平台用户名"
            />
            <div className="browser-resource-save-actions">
              <button type="button" disabled={saving} onClick={closePanel}>
                取消
              </button>
              {duplicateAccountId ? (
                <>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void openExistingAccount()}
                  >
                    打开已有账号
                  </button>
                  <button
                    type="button"
                    className="primary"
                    disabled={saving}
                    onClick={() => void saveDraft('save-another')}
                  >
                    作为另一个账号保存
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="primary"
                  disabled={saving}
                  onClick={() => void saveDraft()}
                >
                  {saving ? '保存中…' : '保存'}
                </button>
              )}
            </div>
          </div>
          {saveError && (
            <p className="browser-resource-save-error" role="alert">
              {saveError}
            </p>
          )}
        </section>
      )}

      {expandedPanel === 'options' && (
        <section
          className="browser-toolbar-expansion browser-options-panel"
          id={`browser-options-${tabId}`}
          aria-label="浏览器显示与操作"
        >
          <div className="browser-expansion-heading">
            <strong>浏览器显示与操作</strong>
            <button
              type="button"
              title="关闭浏览器选项"
              aria-label="关闭浏览器选项"
              onClick={closePanel}
            >
              <IconClose size={14} />
            </button>
          </div>
          <div className="browser-options-controls">
            <div className="browser-zoom-group" role="group" aria-label="网页缩放">
              <span className="browser-control-label">缩放</span>
              <button onClick={() => window.cclinkStudio.browser.zoomOut(tabId)} title="缩小">
                <IconZoomOut size={16} />
              </button>
              <span
                className="browser-zoom-value"
                title={
                  browserState?.zoomMode === 'fit'
                    ? '当前为适应宽度自动缩放；输入百分比可切换为手动缩放'
                    : '输入 30–300 之间的百分比'
                }
              >
                {browserState?.zoomMode === 'fit' ? (
                  <span className="zoom-mode-label">自动</span>
                ) : null}
                <input
                  ref={zoomInputRef}
                  className="zoom-percent-input"
                  value={zoomDraft}
                  inputMode="decimal"
                  aria-label="浏览器缩放百分比"
                  onFocus={(event) => {
                    cancelZoomCommitRef.current = false
                    zoomEditedRef.current = false
                    setEditingZoom(true)
                    event.currentTarget.select()
                    void window.cclinkStudio.window.focusRenderer()
                  }}
                  onChange={(event) => {
                    zoomEditedRef.current = true
                    setZoomDraft(event.target.value)
                  }}
                  onBlur={commitZoom}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      event.currentTarget.blur()
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      cancelZoomCommitRef.current = true
                      event.currentTarget.blur()
                    }
                  }}
                />
                <span className="zoom-percent-suffix">%</span>
              </span>
              <button onClick={() => window.cclinkStudio.browser.zoomIn(tabId)} title="放大">
                <IconZoomIn size={16} />
              </button>
              <button
                className={
                  browserState?.zoomMode === 'fit' && browserState?.viewMode === 'desktop'
                    ? 'active'
                    : ''
                }
                onClick={() => window.cclinkStudio.browser.fitWidth(tabId)}
                title="适应宽度（自动缩放以显示整页）"
                aria-label="适应宽度"
                aria-pressed={
                  browserState?.zoomMode === 'fit' && browserState?.viewMode === 'desktop'
                }
              >
                <IconFitWidth size={16} />
                <span>适应宽度</span>
              </button>
            </div>

            <div className="browser-device-group" role="group" aria-label="网页设备模式">
              <span className="browser-control-label">设备</span>
              <button
                className={browserState?.viewMode === 'desktop' ? 'active' : ''}
                onClick={() => window.cclinkStudio.browser.setDeviceMode(tabId, 'desktop')}
                title="桌面版"
                aria-pressed={browserState?.viewMode === 'desktop'}
              >
                <IconMonitor size={16} />
                <span>桌面</span>
              </button>
              <button
                className={browserState?.viewMode === 'mobile' ? 'active' : ''}
                onClick={() => window.cclinkStudio.browser.setDeviceMode(tabId, 'mobile')}
                title="移动版"
                aria-pressed={browserState?.viewMode === 'mobile'}
              >
                <IconMobile size={16} />
                <span>移动</span>
              </button>
            </div>
          </div>
          <div className="browser-options-actions">
            <button
              type="button"
              className="browser-forward-compact"
              onClick={() => window.cclinkStudio.browser.goForward(tabId)}
            >
              <IconArrowRight size={15} />
              前进
            </button>
            <BrowserHistoryMenu onOpenUrl={onOpenUrl} showLabel />
            <span className="browser-environment-badge" title={`当前登录环境：${environmentLabel}`}>
              {environmentLabel}
            </span>
          </div>
        </section>
      )}
    </div>
  )
}
