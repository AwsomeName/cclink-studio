import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAndroidContextCommands } from './android-context-actions'
import { createDataSourceContextCommands } from './data-source-context-actions'
import { createOperationsContextCommands } from './operations-context-actions'
import { createProductionContextCommands } from './production-context-actions'
import { createSettingsContextCommands } from './settings-context-actions'
import { registerOperationsContextSurface } from '../operations-context-surface'
import { useFsStore } from '../../../stores/fs-store'
import { useHardwareStore } from '../../../stores/hardware-store'
import { useSettingsStore } from '../../../stores/settings-store'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('M4 domain context actions', () => {
  it('keeps operations and production menus free of remote submission commands', () => {
    const ids = [...createOperationsContextCommands(), ...createProductionContextCommands()].map(
      (command) => command.id.toLowerCase(),
    )

    expect(ids.some((id) => /(publish|submit|send|reply|order|payment)/.test(id))).toBe(false)
  })

  it('prepares an operations session through its owning surface', async () => {
    const preparePlatformSession = vi.fn()
    const unregister = registerOperationsContextSurface('/workspace/a', {
      hasPlatform: (platformId) => platformId === 'v2ex',
      openConfig: vi.fn(),
      preparePlatformSession,
      getPlatformStatus: () => '已登录',
    })
    const command = createOperationsContextCommands().find(
      (item) => item.id === 'operations.preparePlatformSession',
    )!

    await command.action({
      source: 'context-menu',
      target: {
        kind: 'operations-platform',
        workspaceKey: '/workspace/a',
        workspacePath: '/workspace/a',
        platformId: 'v2ex',
        platformName: 'V2EX',
      },
    })

    expect(preparePlatformSession).toHaveBeenCalledWith('v2ex')
    unregister()
  })

  it('reports a clear unavailable reason when Android has no device or adb capability', () => {
    const command = createAndroidContextCommands().find(
      (item) => item.id === 'android.connectDisplay',
    )!
    const availability = command.enabled?.({
      source: 'context-menu',
      target: {
        kind: 'android',
        workspaceKey: '/workspace/a',
        tabId: 'android-1',
        available: false,
        connected: false,
        unavailableReason: '未连接用户真机；请确认本机 adb 可用且设备已授权',
      },
    })

    expect(availability).toEqual({
      enabled: false,
      reason: '未连接用户真机；请确认本机 adb 可用且设备已授权',
    })
  })

  it('copies only stable identifiers for data sources and setting rows', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const copySource = createDataSourceContextCommands().find(
      (item) => item.id === 'dataSource.copyIdentifier',
    )!
    const copySetting = createSettingsContextCommands().find(
      (item) => item.id === 'settings.copyKey',
    )!

    await copySource.action({
      source: 'context-menu',
      target: {
        kind: 'data-source',
        workspaceKey: '/workspace/a',
        sourceId: 'source-1',
        sourceName: 'Articles',
      },
    })
    await copySetting.action({
      source: 'context-menu',
      target: {
        kind: 'setting',
        settingKey: 'editorFontSize',
        label: '编辑器字号',
        modified: true,
      },
    })

    expect(writeText.mock.calls).toEqual([['source-1'], ['editorFontSize']])
  })

  it('resets one non-secret setting through the Settings owner', async () => {
    const resetSetting = vi.fn().mockResolvedValue(true)
    useSettingsStore.setState({ resetSetting })
    const command = createSettingsContextCommands().find(
      (item) => item.id === 'settings.resetCurrent',
    )!

    await command.action({
      source: 'context-menu',
      target: {
        kind: 'setting',
        settingKey: 'editorFontSize',
        label: '编辑器字号',
        modified: true,
      },
    })

    expect(resetSetting).toHaveBeenCalledWith('editorFontSize')
  })

  it('disables production inspection until the owning workspace has hardware signals', () => {
    useFsStore.setState({ workspacePath: '/workspace/a' })
    useHardwareStore.setState({
      summary: null,
      loading: false,
      inspecting: false,
      savingReport: false,
    })
    const command = createProductionContextCommands().find(
      (item) => item.id === 'production.inspect',
    )!

    expect(
      command.enabled?.({
        source: 'context-menu',
        target: { kind: 'production', workspaceKey: '/workspace/a', workspacePath: '/workspace/a' },
      }),
    ).toEqual({ enabled: false, reason: '未发现生产文件' })
  })
})
