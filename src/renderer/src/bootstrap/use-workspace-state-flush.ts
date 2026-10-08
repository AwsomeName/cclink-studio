import { useEffect } from 'react'
import { flushAgentConversationWorkspaceState, useAgentStore } from '../stores/agent-store'
import { useTabStore } from '../stores/tab-store'
import type { UpdateInstallImpact } from '@shared/update'
import { recordRendererDiagnosticLog } from '../features/diagnostics/renderer-diagnostic-log'
import { flushPendingWorkspaceStateWrites } from '../utils/workspace-state'
import { flushRemoteFileDrafts } from '../utils/remote-file-draft-registry'
import { flushPendingWorkbenchTabWrites } from '../utils/workbench-tab-model'
import { flushPendingWorkbenchBrowserWrites } from '../utils/workbench-browser-state'

/** 主进程关闭窗口前，确保 renderer 尚未送达的最终工作空间快照已经写盘。 */
export function useWorkspaceStateFlush(): void {
  useEffect(() => {
    const flushBeforeUnload = (): void => {
      void flushRemoteFileDrafts().catch((error: unknown) => {
        recordRendererDiagnosticLog('error', [
          '[RemoteDraftPersistence] beforeunload-flush-failed',
          error,
        ])
      })
    }
    window.addEventListener('beforeunload', flushBeforeUnload)
    const unsubscribe = window.cclinkStudio.workspaceState.onFlushRequest((requestId) => {
      if (requestId.startsWith('update-inspect:')) {
        const impacts: UpdateInstallImpact[] = []
        for (const tab of useTabStore.getState().tabs) {
          if (tab.dirty)
            impacts.push({
              kind: 'editor',
              severity: 'blocked',
              label: tab.title.slice(0, 256) || '未保存文档',
              detail: '请先保存或自行关闭未保存的文档，再安装更新。',
            })
        }
        for (const conversation of Object.values(useAgentStore.getState().conversations)) {
          if (
            ['starting', 'running', 'cancelling'].includes(conversation.runStatus ?? '') ||
            ['connecting', 'streaming'].includes(conversation.backendState)
          ) {
            impacts.push({
              kind: 'agent',
              severity: 'blocked',
              label: 'Agent 任务尚未结束',
              detail: '请等待任务完成，或自行停止后重试。',
            })
          }
        }
        window.cclinkStudio.workspaceState.acknowledgeFlush({
          requestId,
          success: true,
          updateInstallImpacts: impacts.slice(0, 128),
        })
        return
      }
      void (async () => {
        let success = false
        try {
          await flushAgentConversationWorkspaceState()
          await flushPendingWorkbenchTabWrites()
          await flushPendingWorkbenchBrowserWrites()
          await flushPendingWorkspaceStateWrites()
          await flushRemoteFileDrafts()
          success = true
          recordRendererDiagnosticLog('info', ['[ConversationPersistence] shutdown-flush-complete'])
        } catch (error) {
          recordRendererDiagnosticLog('error', [
            '[ConversationPersistence] shutdown-flush-failed',
            error,
          ])
        } finally {
          window.cclinkStudio.workspaceState.acknowledgeFlush({ requestId, success })
        }
      })()
    })
    return () => {
      window.removeEventListener('beforeunload', flushBeforeUnload)
      unsubscribe()
    }
  }, [])
}
