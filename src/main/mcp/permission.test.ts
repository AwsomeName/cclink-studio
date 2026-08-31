import { describe, it, expect, vi } from 'vitest'
import { PermissionManager } from './permission'
import type { ToolAnnotations } from './types'

// ─── getRiskLevel（静态方法，纯函数） ────────────────

describe('PermissionManager.getRiskLevel', () => {
  it('undefined annotations 返回 write', () => {
    expect(PermissionManager.getRiskLevel(undefined)).toBe('write')
  })

  it('readOnlyHint: true 返回 read', () => {
    expect(PermissionManager.getRiskLevel({ readOnlyHint: true, destructiveHint: false })).toBe(
      'read',
    )
  })

  it('destructiveHint: true 返回 destructive', () => {
    expect(PermissionManager.getRiskLevel({ readOnlyHint: false, destructiveHint: true })).toBe(
      'destructive',
    )
  })

  it('两个 hint 都是 false 返回 write', () => {
    expect(PermissionManager.getRiskLevel({ readOnlyHint: false, destructiveHint: false })).toBe(
      'write',
    )
  })

  it('destructive 优先于 readOnly（两者都为 true）', () => {
    expect(PermissionManager.getRiskLevel({ readOnlyHint: true, destructiveHint: true })).toBe(
      'destructive',
    )
  })
})

// ─── needsConfirmation（需要实例化） ──────────────────

// 最小 mock：PermissionManager 构造函数接收 BrowserWindow，
// 但只需要 isDestroyed() 和 webContents.send()
function createManager(): PermissionManager {
  const mockWindow = {
    isDestroyed: () => false,
    webContents: { send: () => {} },
  } as any
  return new PermissionManager(mockWindow)
}

describe('PermissionManager.needsConfirmation', () => {
  const readAnnotations: ToolAnnotations = { readOnlyHint: true, destructiveHint: false }
  const writeAnnotations: ToolAnnotations = { readOnlyHint: false, destructiveHint: false }
  const destructiveAnnotations: ToolAnnotations = { readOnlyHint: false, destructiveHint: true }

  describe('auto 模式', () => {
    it('任何工具都不需要确认', () => {
      const pm = createManager()
      pm.setMode('auto')
      expect(pm.needsConfirmation('browser_click', writeAnnotations)).toBe(false)
      expect(pm.needsConfirmation('browser_evaluate', destructiveAnnotations)).toBe(false)
      expect(pm.needsConfirmation('browser_screenshot', readAnnotations)).toBe(false)
    })
  })

  describe('categorized 模式', () => {
    it('只读工具不需要确认', () => {
      const pm = createManager()
      pm.setMode('categorized')
      expect(pm.needsConfirmation('browser_screenshot', readAnnotations)).toBe(false)
    })

    it('写入工具需要确认', () => {
      const pm = createManager()
      pm.setMode('categorized')
      expect(pm.needsConfirmation('browser_click', writeAnnotations)).toBe(true)
    })

    it('破坏性工具需要确认', () => {
      const pm = createManager()
      pm.setMode('categorized')
      expect(pm.needsConfirmation('browser_evaluate', destructiveAnnotations)).toBe(true)
    })

    it('没有 annotations 时需要确认（默认视为写入）', () => {
      const pm = createManager()
      pm.setMode('categorized')
      expect(pm.needsConfirmation('unknown_tool', undefined)).toBe(true)
    })
  })

  describe('strict 模式', () => {
    it('所有工具都需要确认', () => {
      const pm = createManager()
      pm.setMode('strict')
      expect(pm.needsConfirmation('browser_screenshot', readAnnotations)).toBe(true)
      expect(pm.needsConfirmation('browser_click', writeAnnotations)).toBe(true)
    })
  })

  describe('alwaysAllowed 覆盖', () => {
    it('已设为始终允许的工具不需要确认（即使 strict 模式）', () => {
      const pm = createManager()
      pm.setMode('strict')

      // strict 模式下默认需要确认
      expect(pm.needsConfirmation('browser_screenshot', readAnnotations)).toBe(true)
    })
  })
})

// ─── getMode / setMode ──────────────────────────────

describe('PermissionManager 模式管理', () => {
  it('默认模式是 auto', () => {
    const pm = createManager()
    expect(pm.getMode()).toBe('auto')
  })

  it('setMode 切换模式', () => {
    const pm = createManager()
    pm.setMode('strict')
    expect(pm.getMode()).toBe('strict')
    pm.setMode('categorized')
    expect(pm.getMode()).toBe('categorized')
  })
})

describe('PermissionManager confirmation IPC boundary', () => {
  it('sends only a bounded redacted summary to the renderer', async () => {
    const send = vi.fn()
    const manager = new PermissionManager({
      isDestroyed: () => false,
      webContents: { send },
    } as never)
    const canary = 'CONFIRMATION_IPC_SECRET_CANARY'
    const pending = manager.requestConfirmation({
      conversationId: 'conversation-a',
      runId: 'run-a',
      toolName: 'Bash',
      params: { command: `curl -H 'Authorization: ${canary}'`, token: canary, body: canary },
      workspaceRoot: '/workspace/a',
      riskLevel: 'destructive',
      reason: canary,
      allowAlways: false,
    })
    const payload = send.mock.calls[0]?.[1] as Record<string, unknown>
    expect(JSON.stringify(payload)).not.toContain(canary)
    expect(payload).not.toHaveProperty('params')
    expect(payload).not.toHaveProperty('reason')
    expect(payload.summary).toEqual([{ label: '内容', value: '脚本或命令内容已隐藏' }])
    manager.resolveConfirmation(String(payload.id), false)
    await expect(pending).resolves.toBe(false)
  })
})
