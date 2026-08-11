import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/ipc/settings'
import { useSettingsStore } from '../../stores'
import { SettingsPage } from './SettingsPage'

beforeEach(() => {
  vi.stubGlobal('React', React)
})

afterEach(() => {
  vi.unstubAllGlobals()
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } })
})

describe('SettingsPage secrets', () => {
  it('never renders an API key from the public settings snapshot', () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'renderer-must-not-render-this' },
      loading: false,
    })

    const markup = renderToStaticMarkup(<SettingsPage initialSection="agent" />)

    expect(markup).not.toContain('renderer-must-not-render-this')
    expect(markup).toContain('type="password"')
    expect(markup).toContain('value=""')
    expect(markup).toContain('测试连接')
  })

  it('renders separate Meshy and Jimeng credential inputs for image generation', () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS },
      loading: false,
    })

    const markup = renderToStaticMarkup(<SettingsPage initialSection="image-generation" />)

    expect(markup).toContain('Meshy API Key')
    expect(markup).toContain('即梦 AK/SK')
    expect(markup).toContain('Access Key ID')
    expect(markup).toContain('Secret Access Key')
  })

  it('renders the component inventory with installation and update columns', () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, componentSetupPageSeenVersion: 1 },
      loading: false,
    })

    const markup = renderToStaticMarkup(<SettingsPage initialSection="components" />)

    expect(markup).toContain('组件管理')
    expect(markup).toContain('Claude Code Runtime')
    expect(markup).toContain('安装状态')
    expect(markup).toContain('版本 2.3.1')
    expect(markup).toContain('限定版本')
    expect(markup).toContain('仅 2.1.211')
    expect(markup).toContain('可用版本')
    expect(markup).toContain('操作')
    expect(markup).toContain('安装</button>')
    expect(markup).toContain('更新源尚未接入')
    expect(markup).not.toContain('清单项目')
    expect(markup).not.toContain('恢复默认')
  })
})
