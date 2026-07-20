import { describe, expect, it } from 'vitest'
import {
  CLEAN_BROWSER_CHILD_ARGUMENT,
  encodeCleanBrowserChildOptions,
  isSupportedCleanBrowserUrl,
  parseCleanBrowserChildOptions,
} from './clean-browser-contract'

describe('clean browser contract', () => {
  it('round trips valid child options', () => {
    const options = {
      url: 'https://www.npmjs.com/login?next=%2Flogin%2Fcli%2Fabc',
      userDataPath: '/tmp/cclink-clean-browser',
    }
    expect(
      parseCleanBrowserChildOptions([
        `${CLEAN_BROWSER_CHILD_ARGUMENT}${encodeCleanBrowserChildOptions(options)}`,
      ]),
    ).toEqual(options)
  })

  it('rejects local files, embedded credentials, and malformed URLs', () => {
    expect(isSupportedCleanBrowserUrl('file:///tmp/token')).toBe(false)
    expect(isSupportedCleanBrowserUrl('https://user:secret@example.com/')).toBe(false)
    expect(isSupportedCleanBrowserUrl('not-a-url')).toBe(false)
  })
})
