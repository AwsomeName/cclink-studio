import { IconClose, IconCloud, IconRefresh } from '../common/Icons'
import { useEscapeDismiss } from '../common/dismissable-layer'
import { useFloatingSurfaceRegistration } from '../common/floating-surface-registry'
import { useUpdateStore } from '../../stores/update-store'

export function UpdatePanel(): React.ReactElement | null {
  const snapshot = useUpdateStore((state) => state.snapshot)
  const open = useUpdateStore((state) => state.panelOpen)
  const close = useUpdateStore((state) => state.closePanel)
  const check = useUpdateStore((state) => state.check)
  const startDownload = useUpdateStore((state) => state.startDownload)
  const startDownloadInBackground = useUpdateStore((state) => state.startDownloadInBackground)
  const cancelDownload = useUpdateStore((state) => state.cancelDownload)
  const defer = useUpdateStore((state) => state.defer)
  const ignoreVersion = useUpdateStore((state) => state.ignoreVersion)
  const openManualInstaller = useUpdateStore((state) => state.openManualInstaller)
  const manualInstallerBusy = useUpdateStore((state) => state.manualInstallerBusy)
  const manualInstallerError = useUpdateStore((state) => state.manualInstallerError)

  useFloatingSurfaceRegistration(open)
  useEscapeDismiss(open, close)

  if (!open) return null

  const release = snapshot.availableRelease
  const busy =
    snapshot.phase === 'checking' ||
    snapshot.phase === 'downloading' ||
    snapshot.phase === 'verifying'

  return (
    <div className="update-panel-overlay" onMouseDown={close}>
      <section
        className="update-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-panel-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="update-panel-header">
          <div>
            <h2 id="update-panel-title">CCLink Studio 更新</h2>
            <p>
              当前版本 v{snapshot.currentVersion} ·{' '}
              {snapshot.track === 'beta' ? '测试通道' : '稳定通道'}
            </p>
          </div>
          <button type="button" className="icon-button" title="关闭" onClick={close}>
            <IconClose size={16} />
          </button>
        </header>

        <div className="update-panel-body">
          {snapshot.phase === 'disabled' && (
            <UpdateMessage
              title="当前构建未启用更新服务"
              detail="本机功能不受影响；正式 macOS 安装包会使用公开更新源。"
            />
          )}

          {snapshot.phase === 'idle' && (
            <UpdateMessage
              title={snapshot.lastCheckedAt ? '已是最新版本' : '尚未检查更新'}
              detail={
                snapshot.lastCheckedAt
                  ? `上次检查：${formatDateTime(snapshot.lastCheckedAt)}`
                  : snapshot.track === 'beta'
                    ? '点击下方按钮检查公开测试版和正式版。'
                    : '点击下方按钮检查公开正式版。'
              }
            />
          )}

          {snapshot.phase === 'checking' && (
            <UpdateMessage title="正在检查更新" detail="正在读取公开 Release 和更新清单…" />
          )}

          {release && (
            <div className="update-release">
              <div className="update-release-title">
                <IconCloud size={18} />
                <div>
                  <strong>
                    发现 v{release.version}
                    {release.prerelease ? ' · 测试版' : ' · 正式版'}
                  </strong>
                  <span>
                    {release.architecture} · {formatBytes(release.asset.size)} ·{' '}
                    {formatDateTime(release.publishedAt)}
                  </span>
                  {snapshot.lastCheckedAt && (
                    <span>上次成功检查：{formatDateTime(snapshot.lastCheckedAt)}</span>
                  )}
                </div>
              </div>
              {release.releaseNotes && (
                <pre className="update-release-notes">{release.releaseNotes}</pre>
              )}
            </div>
          )}

          {snapshot.phase === 'available' && snapshot.error && release && (
            <div className="update-error update-refresh-error" role="status">
              <strong>未能刷新最新版本</strong>
              <span>
                {snapshot.error.userMessage}（{snapshot.error.code}）；已保留 v{release.version}
                ，仍可下载或重试检查。
              </span>
            </div>
          )}

          {snapshot.phase === 'downloading' && snapshot.progress && (
            <div className="update-download-progress">
              <div className="update-progress-label">
                <span>正在下载</span>
                <span>{Math.round(snapshot.progress.fraction * 100)}%</span>
              </div>
              <progress
                value={snapshot.progress.downloadedBytes}
                max={snapshot.progress.totalBytes}
              />
              <div className="update-progress-detail">
                <span>
                  {formatBytes(snapshot.progress.downloadedBytes)} /{' '}
                  {formatBytes(snapshot.progress.totalBytes)}
                </span>
                <span>{formatBytes(snapshot.progress.bytesPerSecond)}/秒</span>
              </div>
            </div>
          )}

          {snapshot.phase === 'verifying' && (
            <UpdateMessage title="正在校验下载文件" detail="正在核对文件大小和 SHA-256…" />
          )}

          {snapshot.phase === 'readyToInstall' && (
            <UpdateMessage
              title="更新已下载并通过校验"
              detail="打开前会再次核对完整性、Apple 公证、发布者、版本和 arm64 架构。macOS 打开后，将 CCLink Studio 开源版拖入“应用程序”完成替换。"
            />
          )}

          {manualInstallerError && (
            <div className="update-error" role="alert">
              <strong>{manualInstallerError}</strong>
              <span>当前版本不会被替换；可以直接重试。</span>
            </div>
          )}

          {snapshot.phase === 'failed' && snapshot.error && (
            <div className="update-error" role="alert">
              <strong>{snapshot.error.userMessage}</strong>
              <span>错误码：{snapshot.error.code}</span>
            </div>
          )}
        </div>

        <footer className="update-panel-actions">
          {snapshot.phase === 'available' && (
            <>
              <button type="button" onClick={() => void check()}>
                <IconRefresh size={14} />
                重新检查
              </button>
              <button type="button" onClick={() => void ignoreVersion()}>
                忽略此版本
              </button>
              <button type="button" onClick={() => void defer()}>
                稍后提醒
              </button>
              <button
                type="button"
                className="primary"
                title="关闭更新面板并在后台继续下载，可从状态栏查看进度"
                onClick={() => void startDownloadInBackground()}
              >
                后台下载
              </button>
            </>
          )}
          {snapshot.phase === 'downloading' && (
            <button type="button" onClick={() => void cancelDownload()}>
              取消下载
            </button>
          )}
          {snapshot.phase === 'failed' && snapshot.error?.retryable && (
            <button
              type="button"
              className="primary"
              onClick={() => void (snapshot.availableRelease ? startDownload() : check())}
            >
              重试
            </button>
          )}
          {(snapshot.phase === 'idle' || snapshot.phase === 'disabled') && (
            <button
              type="button"
              className="primary"
              disabled={snapshot.phase === 'disabled'}
              onClick={() => void check()}
            >
              <IconRefresh size={14} />
              检查更新
            </button>
          )}
          {snapshot.phase === 'checking' && (
            <button type="button" disabled>
              正在检查…
            </button>
          )}
          {snapshot.phase === 'readyToInstall' && (
            <>
              <button type="button" disabled={manualInstallerBusy} onClick={close}>
                稍后安装
              </button>
              <button
                type="button"
                className="primary"
                disabled={manualInstallerBusy}
                onClick={() => void openManualInstaller()}
              >
                {manualInstallerBusy ? '正在安全检查…' : '打开安装包'}
              </button>
            </>
          )}
          {!busy && (snapshot.phase === 'idle' || snapshot.phase === 'disabled') && (
            <button type="button" onClick={close}>
              关闭
            </button>
          )}
        </footer>
      </section>
    </div>
  )
}

function UpdateMessage({ title, detail }: { title: string; detail: string }): React.ReactElement {
  return (
    <div className="update-message">
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}
