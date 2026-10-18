import { useState } from 'react'
import {
  describeWebServiceStartupFailure,
  formatWebServiceStartupDiagnostic,
  type WebServiceStartupFailure,
} from '@shared/web-service-startup'
import './web-service-startup-notice.css'

export function WebServiceStartupNotice({
  failure,
}: {
  failure: WebServiceStartupFailure
}): React.ReactElement {
  const [copyStatus, setCopyStatus] = useState('')
  const diagnostic = formatWebServiceStartupDiagnostic(failure)

  const copyDiagnostic = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(diagnostic)
      setCopyStatus('诊断已复制')
    } catch {
      setCopyStatus('复制失败，请展开诊断后手动复制')
    }
  }

  return (
    <div className="web-service-startup-notice" role="alert">
      <p>{describeWebServiceStartupFailure(failure)}</p>
      <button type="button" onClick={() => void copyDiagnostic()}>
        复制启动诊断
      </button>
      <span role="status">{copyStatus}</span>
      <details>
        <summary>查看启动诊断</summary>
        <pre>{diagnostic}</pre>
      </details>
    </div>
  )
}
