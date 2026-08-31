import { describe, it, expect, vi } from 'vitest'
import { toolNameToActionType, AndroidToolModule } from './index'
import { ANDROID_ACTION_TYPES } from '../../../android/android-actions'

// ─── toolNameToActionType ────────────────────────────

describe('toolNameToActionType', () => {
  it('简单工具名：去掉 android_ 前缀', () => {
    expect(toolNameToActionType('android_screenshot')).toBe('screenshot')
  })

  it('多段 snake_case 转为 camelCase', () => {
    expect(toolNameToActionType('android_dump_ui')).toBe('dumpUi')
  })

  it('go_home 转为 goHome', () => {
    expect(toolNameToActionType('android_go_home')).toBe('goHome')
  })

  it('list_packages 转为 listPackages', () => {
    expect(toolNameToActionType('android_list_packages')).toBe('listPackages')
  })

  it('没有 android_ 前缀时不报错', () => {
    expect(toolNameToActionType('screenshot')).toBe('screenshot')
  })

  it('空字符串返回空字符串', () => {
    expect(toolNameToActionType('')).toBe('')
  })
})

// ─── AndroidToolModule 工具定义校验 ──────────────────

const mockBridge = { isConnected: () => false } as any
const module = new AndroidToolModule(mockBridge)
const TOOLS = module.tools

describe('AndroidToolModule 工具定义', () => {
  it('应该有 15 个工具定义', () => {
    expect(TOOLS).toHaveLength(15)
  })

  it('所有工具名以 android_ 开头', () => {
    for (const def of TOOLS) {
      expect(def.name).toMatch(/^android_/)
    }
  })

  it('工具名没有重复', () => {
    const names = TOOLS.map((d) => d.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('每个工具都有必需字段', () => {
    for (const def of TOOLS) {
      expect(def).toHaveProperty('name')
      expect(def).toHaveProperty('description')
      expect(def).toHaveProperty('inputSchema')
      expect(def).toHaveProperty('annotations')
      expect(def.inputSchema).toHaveProperty('type', 'object')
      expect(def.inputSchema).toHaveProperty('properties')
    }
  })

  it('annotations 的 readOnlyHint 和 destructiveHint 都是布尔值', () => {
    for (const def of TOOLS) {
      expect(typeof def.annotations.readOnlyHint).toBe('boolean')
      expect(typeof def.annotations.destructiveHint).toBe('boolean')
    }
  })

  it('每个工具名都能映射到有效的 action type', () => {
    for (const def of TOOLS) {
      const actionType = toolNameToActionType(def.name)
      expect(ANDROID_ACTION_TYPES).toContain(actionType)
    }
  })

  it('在 ADB 副作用前拒绝 Run 工作空间外的 APK', async () => {
    const assertReadableFile = vi.fn().mockRejectedValue(new Error('OUTSIDE_WORKSPACE'))
    const fileService = {
      withAccess: (_context: unknown, operation: () => unknown) => operation(),
      assertReadableFile,
    }
    const securedModule = new AndroidToolModule(
      { isConnected: () => true } as any,
      undefined,
      fileService as any,
    )

    await expect(
      securedModule.execute(
        'android_install_apk',
        { path: '/workspace/b/canary.apk' },
        {
          trustedWorkspace: {
            kind: 'local',
            rootPath: '/workspace/a',
            workspaceKey: '/workspace/a',
          },
        },
      ),
    ).rejects.toThrow('OUTSIDE_WORKSPACE')
    expect(assertReadableFile).toHaveBeenCalledWith('/workspace/b/canary.apk')
  })
})
