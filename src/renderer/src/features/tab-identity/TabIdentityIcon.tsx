import { useEffect, useState } from 'react'
import type { Tab } from '../../types'
import type { WorkspaceRef } from '@shared/workspace-ref'
import {
  IconClock,
  IconCloud,
  IconCube,
  IconDatabase,
  IconDollar,
  IconFile,
  IconGlobe,
  IconHistory,
  IconHome,
  IconMobile,
  IconMonitor,
  IconNewspaper,
  IconPaintbrush,
  IconProjects,
  IconRobot,
  IconSettings,
  IconTerminal,
  IconUser,
} from '../../components/common/Icons'
import { observeWebResourcesChanged } from '../web-resources/web-resource-events'
import {
  TAB_IDENTITY_COLOR_VALUES,
  identityColorFor,
  shortNameFromLabel,
  type TabMonogram,
} from './tab-identity'
import './tab-identity.css'

/** 各类型的线条图标；替换历史上写进 Tab.icon 的 emoji，风格与工作台一致。 */
export function TabTypeIcon({ tab }: { tab: Tab }): React.ReactElement {
  switch (tab.type) {
    case 'workspace-home':
      return <IconHome size={16} />
    case 'browser':
    case 'web-resource':
      return <IconGlobe size={16} />
    case 'editor':
    case 'preview':
    case 'file-preview':
    case 'remote-file':
      return <IconFile size={16} />
    case 'settings':
      return <IconSettings size={16} />
    case 'remote-desktop':
      return <IconMonitor size={16} />
    case 'android':
      return <IconMobile size={16} />
    case 'model':
    case 'hardware-gerber':
      return <IconCube size={16} />
    case 'conversation':
    case 'agent-role':
      return tab.type === 'agent-role' ? <IconUser size={16} /> : <IconRobot size={16} />
    case 'remote-conversation':
      return <IconCloud size={16} />
    case 'terminal':
      return <IconTerminal size={16} />
    case 'terminal-record':
      return <IconHistory size={16} />
    case 'data-source-query':
    case 'data-source-result':
      return <IconDatabase size={16} />
    case 'scheduled-task':
      return <IconClock size={16} />
    case 'web-affair':
    case 'article-publishing':
      return <IconNewspaper size={16} />
    case 'media-production':
      return <IconPaintbrush size={16} />
    case 'company-accounts':
      return <IconDollar size={16} />
    case 'company-workspace':
      return <IconProjects size={16} />
    default:
      return <>{tab.icon}</>
  }
}

function MonogramTile({
  monogram,
  className = '',
}: {
  monogram: TabMonogram
  className?: string
}): React.ReactElement {
  return (
    <span
      className={`tab-identity-tile ${className}`}
      style={{ background: TAB_IDENTITY_COLOR_VALUES[monogram.color] }}
    >
      {monogram.text}
    </span>
  )
}

/** 远程桌面：显示器屏幕里是设备简称，底色是设备固定颜色；绿点 = 已连接。 */
export function DesktopIdentityIcon({
  identity,
  live,
}: {
  identity: TabMonogram | null
  live: boolean
}): React.ReactElement {
  return (
    <span className="tab-identity-desktop">
      <svg viewBox="0 0 22 20" width="22" height="20" fill="none" aria-hidden="true">
        <path d="M8 19h6M11 14v5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <rect
          x="1.5"
          y="0.75"
          width="19"
          height="13"
          rx="3"
          stroke="currentColor"
          strokeWidth="1.2"
        />
      </svg>
      {identity && (
        <span
          className="tab-identity-screen"
          style={{ background: TAB_IDENTITY_COLOR_VALUES[identity.color] }}
        >
          {identity.text}
        </span>
      )}
      {live && <span className="tab-identity-live-dot" />}
    </span>
  )
}

export interface AccountBadge {
  text: string
  color: TabMonogram['color']
}

/** 账号名小徽标：手机号取后两位，其余取首字。 */
export function accountBadgeFor(accountId: string, label: string): AccountBadge | null {
  const trimmed = label.trim()
  if (!trimmed) return null
  const digits = trimmed.replace(/[\s-]/g, '')
  const text = /^\+?\d{4,}$/.test(digits)
    ? digits.slice(-2)
    : (Array.from(shortNameFromLabel(trimmed))[0] ?? '')
  return text ? { text, color: identityColorFor(`account:${accountId}`) } : null
}

/** 网页：优先网站自带图标；没有或加载失败时用字母块；已保存账号加右下角徽标。 */
export function BrowserIdentityIcon({
  faviconUrl,
  monogram,
  account,
}: {
  faviconUrl: string | null | undefined
  monogram: TabMonogram | null
  account: AccountBadge | null
}): React.ReactElement {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [faviconUrl])
  return (
    <span className="tab-identity-browser">
      {faviconUrl && !failed ? (
        <img
          className="browser-favicon"
          src={faviconUrl}
          alt=""
          width={14}
          height={14}
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : monogram ? (
        <MonogramTile monogram={monogram} />
      ) : (
        <IconGlobe size={14} />
      )}
      {account && (
        <span
          className="tab-identity-account"
          style={{ background: TAB_IDENTITY_COLOR_VALUES[account.color] }}
        >
          {account.text}
        </span>
      )}
    </span>
  )
}

/** 当前标签栏里已保存网站账号的名称；只读账号名，不读凭证。 */
export function useWebAccountLabels(tabs: Tab[]): Record<string, string> {
  const accountTab = tabs.find(
    (tab) => tab.type === 'browser' && tab.webResourceRef && tab.workspaceRef?.kind === 'local',
  )
  const workspaceRef: WorkspaceRef | undefined = accountTab?.workspaceRef
  const workspaceKey = workspaceRef?.kind === 'local' ? workspaceRef.path : null
  const [labels, setLabels] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!workspaceRef || !workspaceKey) {
      setLabels({})
      return
    }
    let cancelled = false
    const load = (): void => {
      void window.cclinkStudio.webResources
        .getSnapshot({ workspaceRef })
        .then((result) => {
          if (cancelled || !result.success) return
          setLabels(
            Object.fromEntries(result.data.accounts.map((account) => [account.id, account.label])),
          )
        })
        .catch(() => {
          // 账号名只用于徽标；读取失败时不显示徽标，标签照常可用。
        })
    }
    load()
    const off = observeWebResourcesChanged(load)
    return () => {
      cancelled = true
      off()
    }
    // workspaceKey 代表 workspaceRef 的身份，避免对象引用变化重复读取。
  }, [workspaceKey])

  return labels
}
