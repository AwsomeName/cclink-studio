import { afterEach, describe, expect, it, vi } from 'vitest'
import { readExactJikeFeedPublication, readJikePublication } from './jike-publication'

describe('Jike publication recovery', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('binds one visible feed card only when account, body, dispatch time and images match', async () => {
    const imageKey = 'FvYZi-0ACXVxduE_Ikfj09mcXkSRv3.png'
    const image = {
      currentSrc: `https://cdnv2.ruguoapp.com/${imageKey}?imageMogr2/thumbnail`,
      src: `https://cdnv2.ruguoapp.com/${imageKey}`,
      getBoundingClientRect: () => ({ width: 100, height: 100 }),
      closest: () => null,
    }
    const root = {
      getBoundingClientRect: () => ({ width: 400, height: 300 }),
      querySelectorAll: (selector: string) => (selector === 'img' ? [image] : []),
      __reactFiber$test: {
        memoizedProps: {
          data: {
            id: '6aaac1a3bd0563695ba68bdf',
            type: 'ORIGINAL_POST',
            status: 'NORMAL',
            content: 'Body',
            createdAt: '2026-09-16T16:19:47.121Z',
            pictures: [{ key: imageKey }],
            user: { username: 'account-a' },
          },
        },
      },
    }
    vi.stubGlobal(
      'DOMParser',
      class {
        parseFromString() {
          return {
            body: { textContent: 'Body' },
            querySelectorAll: () => [],
          }
        }
      },
    )
    vi.stubGlobal('document', {
      querySelectorAll: (selector: string) =>
        selector === '[data-clickable-feedback="true"]' ? [root] : [],
    })
    const page = {
      url: () => 'https://web.okjike.com/following',
      evaluate: async (fn: (input: unknown) => unknown, input: unknown) => fn(input),
    }

    await expect(
      readExactJikeFeedPublication(page as never, {
        accountId: 'account-a',
        articleHtml: '<p>Body</p>',
        imageKeys: [imageKey],
        dispatchedAt: '2026-09-16T16:19:46.141Z',
      }),
    ).resolves.toEqual({
      accountId: 'account-a',
      id: '6aaac1a3bd0563695ba68bdf',
      createdAt: '2026-09-16T16:19:47.121Z',
      imageKeys: [imageKey],
      url: 'https://web.okjike.com/u/account-a/post/6aaac1a3bd0563695ba68bdf',
    })
  })

  it('reads a Jike detail page from its exact live post model and loaded images', async () => {
    const id = '6aaac1a3bd0563695ba68bdf'
    const key = 'FvYZi-0ACXVxduE_Ikfj09mcXkSRv3.png'
    const url = `https://web.okjike.com/u/account-a/post/${id}`
    const image = {
      currentSrc: `https://cdnv2.ruguoapp.com/${key}?imageMogr2/thumbnail`,
      src: `https://cdnv2.ruguoapp.com/${key}`,
      alt: '图片',
      complete: true,
      naturalWidth: 100,
      getBoundingClientRect: () => ({ width: 100, height: 100 }),
      __reactFiber$test: {
        memoizedProps: {
          data: {
            id,
            type: 'ORIGINAL_POST',
            status: 'NORMAL',
            content: 'Body',
            pictures: [{ key }],
            user: { username: 'account-a' },
          },
        },
      },
    }
    vi.stubGlobal('location', { href: url })
    vi.stubGlobal('document', {
      querySelectorAll: (selector: string) => (selector === 'img' ? [image] : []),
    })
    const page = {
      url: () => url,
      evaluate: async (fn: (input: unknown) => unknown, input: unknown) => fn(input),
    }

    await expect(readJikePublication(page as never)).resolves.toMatchObject({
      id,
      accountId: 'account-a',
      text: 'Body',
      recognized: true,
      imageEnumerationComplete: true,
      images: [
        {
          src: `https://cdnv2.ruguoapp.com/${key}`,
          alt: '图片',
          loaded: true,
        },
      ],
    })
  })
})
