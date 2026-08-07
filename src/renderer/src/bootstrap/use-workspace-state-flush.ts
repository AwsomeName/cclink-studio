import { useEffect } from 'react'
import { flushAgentConversationWorkspaceState } from '../stores/agent-store'
import { recordRendererDiagnosticLog } from '../features/diagnostics/renderer-diagnostic-log'
import { flushPendingWorkspaceStateWrites } from '../utils/workspace-state'

/** 主进程关闭窗口前，确保 renderer 尚未送达的最终工作空间快照已经写盘。 */
export function useWorkspaceStateFlush(): void {
  useEffect(
    () =>
      window.cclinkStudio.workspaceState.onFlushRequest((requestId) => {
        void (async () => {
          let success = false
          try {
            await flushAgentConversationWorkspaceState()
            await flushPendingWorkspaceStateWrites()
            success = true
            recordRendererDiagnosticLog('info', [
              '[ConversationPersistence] shutdown-flush-complete',
            ])
          } catch (error) {
            recordRendererDiagnosticLog('error', [
              '[ConversationPersistence] shutdown-flush-failed',
              error,
            ])
          } finally {
            window.cclinkStudio.workspaceState.acknowledgeFlush({ requestId, success })
          }
        })()
      }),
    [],
  )
}
