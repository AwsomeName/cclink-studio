import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import type { LocalWorkspaceRef } from '../../shared/workspace-ref'
import {
  webResourcesIpcEvents,
  type AgentWebResourceLaunchAcknowledgement,
} from '../../shared/web-resources/web-resource'
import { parseAgentWebResourceLaunchAcknowledgement } from '../../shared/web-resources/web-resource-schema'
import type { WebResourceLaunchDescriptor } from '../../shared/web-resources/web-resource-types'
import {
  registerTrustedIpcListener,
  type TrustedRendererGuard,
} from '../ipc/trusted-renderer-guard'

export interface AgentWebResourceLaunchResult {
  tabId: string
}

/** Main 是请求/校验 owner；renderer 只负责把已解析 descriptor 显示成可见 Tab。 */
export class AgentWebResourceLaunchCoordinator {
  private readonly pending = new Map<
    string,
    (acknowledgement: AgentWebResourceLaunchAcknowledgement) => void
  >()

  constructor(
    private readonly mainWindow: BrowserWindow,
    trustedRendererGuard: TrustedRendererGuard,
    private readonly timeoutMs = 8_000,
  ) {
    registerTrustedIpcListener(
      webResourcesIpcEvents.agentLaunchAcknowledged,
      trustedRendererGuard,
      (_event, value: unknown) => {
        try {
          const acknowledgement = parseAgentWebResourceLaunchAcknowledgement(value)
          this.pending.get(acknowledgement.requestId)?.(acknowledgement)
        } catch (error) {
          console.warn('[WebResource] 已忽略非法 Agent Tab 打开响应:', error)
        }
      },
    )
  }

  requestLaunch(
    workspaceRef: LocalWorkspaceRef,
    descriptor: WebResourceLaunchDescriptor,
  ): Promise<AgentWebResourceLaunchResult> {
    if (this.mainWindow.isDestroyed() || this.mainWindow.webContents.isDestroyed()) {
      return Promise.reject(new Error('工作台窗口当前不可用'))
    }
    const requestId = randomUUID()
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (acknowledgement?: AgentWebResourceLaunchAcknowledgement): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        this.pending.delete(requestId)
        if (!acknowledgement) {
          reject(new Error('等待网站账号 Tab 打开超时'))
        } else if (!acknowledgement.success || !acknowledgement.tabId) {
          reject(new Error(acknowledgement.errorMessage || '网站账号 Tab 打开失败'))
        } else {
          resolve({ tabId: acknowledgement.tabId })
        }
      }
      const timeout = setTimeout(() => finish(), this.timeoutMs)
      this.pending.set(requestId, finish)
      this.mainWindow.webContents.send(webResourcesIpcEvents.agentLaunchRequested, {
        requestId,
        workspaceRef,
        workspaceKey: workspaceRef.path,
        descriptor,
      })
    })
  }

  dispose(): void {
    for (const finish of this.pending.values()) {
      finish({ requestId: '', success: false, errorMessage: '工作台正在关闭' })
    }
    this.pending.clear()
  }
}
