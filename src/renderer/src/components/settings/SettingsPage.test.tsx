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
})
