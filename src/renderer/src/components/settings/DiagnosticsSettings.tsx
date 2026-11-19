import './diagnostics-settings.css'
import { useEffect, useState } from 'react'
import { useCommandStore } from '../../stores/command-store'
import { collectFrameworkDiagnosticReport } from '../../features/diagnostics/framework-diagnostic-report'

/** A read projection of existing services, not a new capability/health owner. */
export function DiagnosticsSettings({
  navigate,
}: {
  navigate: (section: 'components' | 'model-usage' | 'connections') => void
}): React.ReactElement {
  const [report, setReport] = useState('')
  const [summary, setSummary] = useState<Array<{ title: string; value: string }>>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    void Promise.all([
      collectFrameworkDiagnosticReport(),
      Promise.allSettled([
        window.cclinkStudio.scheduledTasks.getRuntimeStatus().then((status) => ({
          title: '定时任务',
          value: `${status.state === 'ready' ? '可调度' : status.state === 'degraded' ? '暂不可调度' : '已停止'} · ${status.enabledCount} 个已启用 · ${status.queuedCount} 个排队${status.lastError ? ' · ' + status.lastError.message : ''}`,
        })),
        window.cclinkStudio.runtimeComponents.listRuntimeResources().then((resources) => ({
          title: '可选组件',
          value: `${resources.filter((item) => item.health === 'healthy').length} / ${resources.length} 项已安装且通过原服务检查；详情见组件管理`,
        })),
      ]),
    ])
      .then(([value, checks]) => {
        if (alive) {
          setReport(value)
          setSummary(
            checks.map((check, index) =>
              check.status === 'fulfilled'
                ? check.value
                : {
                    title: index === 0 ? '定时任务' : '可选组件',
                    value: '读取失败：' + String(check.reason),
                  },
            ),
          )
        }
      })
      .catch((reason) => {
        if (alive) setError(String(reason))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [revision])
  return (
    <section className="settings-section" aria-label="运行状态与诊断">
      <h2>运行状态与诊断</h2>
      <p className="settings-description">
        本机检查。各项状态由原服务返回，未配置不表示本地工作台不可用。报告已脱敏，不含会话正文、工具参数或凭证明文。
      </p>
      <div className="diagnostics-actions">
        <button onClick={() => navigate('components')}>组件状态与修复</button>{' '}
        <button onClick={() => navigate('connections')}>管理模型与服务连接</button>{' '}
        <button onClick={() => navigate('model-usage')}>查看模型用量</button>
      </div>
      <div className="diagnostics-actions">
        <button disabled={loading} onClick={() => setRevision((value) => value + 1)}>
          刷新诊断
        </button>{' '}
        <button
          disabled={loading || !report}
          onClick={() =>
            void useCommandStore
              .getState()
              .executeCommand('diagnostics.copyFrameworkLogs', { source: 'toolbar' })
          }
        >
          复制脱敏诊断报告
        </button>
      </div>
      {loading && <p role="status">正在读取本机运行状态…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && (
        <div className="diagnostics-summary">
          {summary.map((item) => (
            <article key={item.title}>
              <strong>{item.title}</strong>
              <p>{item.value}</p>
            </article>
          ))}
        </div>
      )}
      <details className="diagnostics-details">
        <summary>查看脱敏诊断明细</summary>
        <pre aria-label="脱敏诊断报告">{report}</pre>
      </details>
    </section>
  )
}
