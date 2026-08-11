import { describe, expect, it } from 'vitest'
import {
  COMPONENT_SETUP_PAGE_VERSION,
  shouldOpenComponentSetupPage,
} from './use-component-setup-onboarding'

describe('component setup onboarding', () => {
  it('opens only before the current setup page version has been seen', () => {
    expect(shouldOpenComponentSetupPage(0)).toBe(true)
    expect(shouldOpenComponentSetupPage(COMPONENT_SETUP_PAGE_VERSION)).toBe(false)
    expect(shouldOpenComponentSetupPage(COMPONENT_SETUP_PAGE_VERSION + 1)).toBe(false)
  })
})
