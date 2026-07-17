/**
 * PermissionManager — 工具权限管理器
 *
 * 管理三种权限模式（auto / categorized / strict），
 * 在 MCP tool call 执行前检查是否需要用户确认。
 *
 * 确认流程：
 * 1. McpToolHost.handleToolCall() 检查 needsConfirmation()
 * 2. 需要确认 → requestConfirmation() → IPC 发送到渲染进程
 * 3. 渲染进程展示确认卡片，用户点击允许/拒绝
 * 4. IPC 回传 resolveConfirmation() → Promise resolve
 * 5. 超时 60 秒自动拒绝
 */

import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import type { PermissionMode, ToolAnnotations } from './types'
import type { ToolConfirmationRequest } from '../../shared/ipc/agent'

export type { ToolConfirmationRequest } from '../../shared/ipc/agent'

/** 等待中的确认 */
interface PendingConfirmation {
  /** Promise resolve 回调 */
  resolve: (approved: boolean) => void
  /** 超时定时器 */
  timeout: ReturnType<typeof setTimeout>
  /** 关联的确认请求 */
  request: ToolConfirmationRequest
}

/** 超时时间（毫秒） */
const CONFIRMATION_TIMEOUT = 60_000

export class PermissionManager {
  private mode: PermissionMode = 'auto'
  private mainWindow: BrowserWindow | null = null
  private pending: Map<string, PendingConfirmation> = new Map()
  /** 用户选择了"始终允许"的工具集合 */
  private alwaysAllowed: Set<string> = new Set()

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow
  }

  /** 设置权限模式 */
  setMode(mode: PermissionMode): void {
    this.mode = mode
    // 切换模式时清除所有等待中的确认（全部拒绝）
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.resolve(false)
    }
    this.pending.clear()
    console.log(`[PermissionManager] 权限模式切换为: ${mode}`)
  }

  /** 获取当前权限模式 */
  getMode(): PermissionMode {
    return this.mode
  }

  /**
   * 检查工具是否需要用户确认
   *
   * @param toolName - 工具名
   * @param annotations - 工具注解（readOnlyHint / destructiveHint）
   * @returns true = 需要确认
   */
  needsConfirmation(toolName: string, annotations: ToolAnnotations | undefined): boolean {
    // 已被"始终允许"的工具不需要确认
    if (this.alwaysAllowed.has(toolName)) {
      return false
    }

    switch (this.mode) {
      case 'auto':
        // 全部放行
        return false

      case 'categorized':
        // 只读放行，写操作和破坏性操作需确认
        return annotations ? !annotations.readOnlyHint : true

      case 'strict':
        // 全部需确认
        return true

      default:
        return true
    }
  }

  /**
   * 请求用户确认
   *
   * 通过 IPC 发送确认请求到渲染进程，返回 Promise 等待用户操作。
   * 超时 60 秒自动拒绝。
   */
  requestConfirmation(req: Omit<ToolConfirmationRequest, 'id'>): Promise<boolean> {
    return new Promise((resolve) => {
      const id = randomUUID()
      const request: ToolConfirmationRequest = { id, ...req }

      // 超时自动拒绝
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        console.log(`[PermissionManager] 确认超时，自动拒绝: ${req.toolName}`)
        resolve(false)
      }, CONFIRMATION_TIMEOUT)

      this.pending.set(id, { resolve, timeout, request })

      // 发送确认请求到渲染进程
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('agent:requestConfirmation', request)
        console.log(`[PermissionManager] 请求确认: ${req.toolName} (${req.riskLevel})`)
      } else {
        // 窗口已关闭，直接拒绝
        clearTimeout(timeout)
        this.pending.delete(id)
        resolve(false)
      }
    })
  }

  /**
   * 用户确认/拒绝（由渲染进程 IPC 调用）
   *
   * @param id - 确认请求 ID
   * @param approved - true = 允许，false = 拒绝
   * @param alwaysAllow - true = 始终允许此类工具
   */
  resolveConfirmation(id: string, approved: boolean, alwaysAllow?: boolean): void {
    const pending = this.pending.get(id)
    if (!pending) {
      console.warn(`[PermissionManager] 未找到确认请求: ${id}`)
      return
    }

    clearTimeout(pending.timeout)
    this.pending.delete(id)

    // "始终允许"
    if (approved && alwaysAllow && pending.request.allowAlways !== false) {
      this.alwaysAllowed.add(pending.request.toolName)
      console.log(`[PermissionManager] 始终允许: ${pending.request.toolName}`)
    }

    console.log(
      `[PermissionManager] 确认结果: ${pending.request.toolName} → ${approved ? '允许' : '拒绝'}`,
    )
    pending.resolve(approved)
  }

  /**
   * 根据工具注解判断风险等级
   */
  static getRiskLevel(annotations: ToolAnnotations | undefined): 'read' | 'write' | 'destructive' {
    if (!annotations) return 'write'
    if (annotations.destructiveHint) return 'destructive'
    if (annotations.readOnlyHint) return 'read'
    return 'write'
  }

  /** 销毁资源 */
  destroy(): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timeout)
      pending.resolve(false)
    }
    this.pending.clear()
    this.mainWindow = null
  }
}
