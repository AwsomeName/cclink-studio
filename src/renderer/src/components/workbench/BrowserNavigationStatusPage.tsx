import type { BrowserNavigationState } from '../../stores/browser-store'
import { IconGlobe, IconRefresh } from '../common/Icons'

export function formatBrowserNavigationError(message: string | null): string {
  if (!message) return '网页暂时无法打开'
  return message
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
}

export function BrowserNavigationStatusPage({
  navigation,
  onRetry,
  onCancel,
}: {
  navigation: BrowserNavigationState
  onRetry: (url: string) => void
  onCancel: () => void
}): React.ReactElement {
  const failed = navigation.status === 'failed'
  return (
    <div className="browser-navigation-status" role={failed ? 'alert' : 'status'}>
      <span className={`browser-navigation-status-icon ${failed ? 'failed' : 'loading'}`}>
        <IconGlobe size={24} />
      </span>
      <h2>{failed ? '无法打开网页' : '正在打开网页…'}</h2>
      <p className="browser-navigation-target" title={navigation.targetUrl}>
        {navigation.targetUrl}
      </p>
      {failed ? (
        <>
          <p className="browser-navigation-error">
            {formatBrowserNavigationError(navigation.error)}
          </p>
          <div className="browser-navigation-actions">
            <button type="button" className="primary" onClick={() => onRetry(navigation.targetUrl)}>
              <IconRefresh size={14} />
              重试
            </button>
            <button type="button" onClick={onCancel}>
              返回
            </button>
          </div>
        </>
      ) : null}
    </div>
  )
}
