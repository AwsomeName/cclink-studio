import { useEffect, useRef, useState } from 'react'
import type { BrowserTabState } from '../../stores/browser-store'
import type { Tab } from '../../types'
import { useTabStore } from '../../stores/tab-store'
import { notifyWebResourcesChanged } from '../../features/web-resources/web-resource-events'
import { copyTextToClipboard } from '../../utils/clipboard'
import {
  IconArrowLeft,
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
import {
  closeBrowserFind,
  runBrowserFind,
  stopBrowserFindSelection,
} from '../../features/browser/browser-find-controller'

interface BrowserToolbarProps {
  tabId: string
  tab: Tab
  browserState: BrowserTabState | undefined
  onUrlInputChange: (tabId: string, value: string) => void
  onNavigate: () => void
  onOpenUrl: (url: string) => void
}

export function BrowserToolbar({
  tabId,
  tab,
  browserState,
  onUrlInputChange,
  onNavigate,
  onOpenUrl,
}: BrowserToolbarProps): React.ReactElement {
  const [showSave, setShowSave] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [duplicateAccountId, setDuplicateAccountId] = useState<string | null>(null)
  const findSession = useBrowserFindStore((state) => state.sessions[tabId])
  const setFindQuery = useBrowserFindStore((state) => state.setQuery)
  const findInputRef = useRef<HTMLInputElement>(null)
  const draftId = tab.webResourceDraftRef?.draftId

  useEffect(() => {
    setShowSave(false)
    setDisplayName('')
    setSaveError(null)
    setDuplicateAccountId(null)
  }, [draftId])

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

  const updateFindQuery = (value: string): void => {
    setFindQuery(tabId, value)
    if (value.trim()) void runBrowserFind(tabId, { forward: true, findNext: false }, value)
    else void stopBrowserFindSelection(tabId)
  }

  const saveDraft = async (duplicateResolution?: 'save-another'): Promise<void> => {
    if (!draftId || tab.workspaceRef?.kind !== 'local' || !displayName.trim()) return
    setSaving(true)
    setSaveError(null)
    setDuplicateAccountId(null)
    try {
      const result = await window.cclinkStudio.webResources.saveDraft({
        workspaceRef: tab.workspaceRef,
        draftId,
        tabId,
        displayName,
        duplicateResolution,
      })
      if (!result.success) {
        setSaveError(result.error.message)
        setDuplicateAccountId(result.error.context?.existingAccountId ?? null)
        return
      }
      const projectId = result.data.account.projectId
      if (!projectId) throw new Error('保存结果未归属当前项目')
      useTabStore.getState().bindWebResourceDraft(tabId, {
        title: result.data.website.name,
        initialUrl: result.data.website.entryUrl,
        browserProfile: result.data.account.browserProfileId,
        webResourceRef: { projectId, accountId: result.data.account.id },
      })
      notifyWebResourcesChanged()
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
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
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="browser-toolbar">
      <button onClick={() => window.cclinkStudio.browser.goBack(tabId)} title="后退">
        <IconArrowLeft size={16} />
      </button>
      <button onClick={() => window.cclinkStudio.browser.goForward(tabId)} title="前进">
        <IconArrowRight size={16} />
      </button>
      <button onClick={() => window.cclinkStudio.browser.reload(tabId)} title="刷新">
        <IconRefresh size={16} />
      </button>
      <BrowserHistoryMenu onOpenUrl={onOpenUrl} />
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
        <input
          className="url-input"
          value={browserState?.urlInput ?? ''}
          onChange={(event) => onUrlInputChange(tabId, event.target.value)}
          onFocus={() => {
            void window.cclinkStudio.window.focusRenderer()
          }}
          onKeyDown={(event) => {
            const primaryModifier = event.metaKey || event.ctrlKey
            const key = event.key.toLowerCase()

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

            if (event.key === 'Enter') onNavigate()
          }}
          placeholder="输入 URL..."
        />
      )}

      {draftId ? (
        showSave ? (
          <div className="browser-resource-save">
            <input
              autoFocus
              maxLength={160}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void saveDraft()
                if (event.key === 'Escape') setShowSave(false)
              }}
              placeholder="账号名称"
              aria-label="账号名称"
            />
            {saveError ? <span title={saveError}>{saveError}</span> : null}
            {duplicateAccountId ? (
              <>
                <button
                  type="button"
                  className="browser-resource-text-button"
                  disabled={saving}
                  onClick={() => void openExistingAccount()}
                >
                  打开已有账号
                </button>
                <button
                  type="button"
                  className="browser-resource-text-button primary"
                  disabled={saving}
                  onClick={() => void saveDraft('save-another')}
                >
                  作为另一个账号保存
                </button>
              </>
            ) : (
              <button
                type="button"
                className="browser-resource-text-button primary"
                disabled={saving || !displayName.trim()}
                onClick={() => void saveDraft()}
              >
                {saving ? '保存中…' : '保存'}
              </button>
            )}
            <button
              type="button"
              className="browser-resource-text-button"
              disabled={saving}
              onClick={() => setShowSave(false)}
            >
              返回
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="browser-resource-text-button primary"
            onClick={() => setShowSave(true)}
          >
            登录完成，保存到当前项目
          </button>
        )
      ) : null}

      <div className="browser-zoom-group">
        <button onClick={() => window.cclinkStudio.browser.zoomOut(tabId)} title="缩小">
          <IconZoomOut size={16} />
        </button>
        <button
          className="zoom-label"
          onClick={() => window.cclinkStudio.browser.resetZoom(tabId)}
          title="点击重置为 100%"
        >
          {Math.round((browserState?.zoomFactor ?? 1) * 100)}%
        </button>
        <button onClick={() => window.cclinkStudio.browser.zoomIn(tabId)} title="放大">
          <IconZoomIn size={16} />
        </button>
        <button
          className={
            browserState?.zoomMode === 'fit' && browserState?.viewMode === 'desktop' ? 'active' : ''
          }
          onClick={() => window.cclinkStudio.browser.fitWidth(tabId)}
          title="适应宽度（自动缩放以显示整页）"
        >
          <IconFitWidth size={16} />
        </button>
      </div>

      <div className="browser-device-group">
        <button
          className={browserState?.viewMode === 'desktop' ? 'active' : ''}
          onClick={() => window.cclinkStudio.browser.setDeviceMode(tabId, 'desktop')}
          title="桌面版"
        >
          <IconMonitor size={16} />
        </button>
        <button
          className={browserState?.viewMode === 'mobile' ? 'active' : ''}
          onClick={() => window.cclinkStudio.browser.setDeviceMode(tabId, 'mobile')}
          title="移动版"
        >
          <IconMobile size={16} />
        </button>
      </div>
    </div>
  )
}
