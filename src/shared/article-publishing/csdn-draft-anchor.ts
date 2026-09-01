const CSDN_NUMERIC_DRAFT_PATH = /^\/mp_blog\/creation\/editor\/(\d+)\/?$/u
const CSDN_EDITOR_QUERY_PATH = /^(?:\/mp_blog\/creation\/editor\/?|\/md\/?)$/u
const CSDN_DRAFT_QUERY_KEYS = ['articleId', 'draftId', 'id'] as const

export interface CsdnDraftAnchor {
  draftId: string
  url: string
}

/**
 * Returns the stable identity of an existing CSDN draft.
 *
 * Generic editor entry points are intentionally rejected: they can create a new
 * draft and therefore cannot prove that a resumed Attempt is operating on the
 * same platform artifact.
 */
export function parseCsdnDraftAnchor(rawUrl: string): CsdnDraftAnchor | null {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'https:' || !['mp.csdn.net', 'editor.csdn.net'].includes(url.hostname)) {
      return null
    }
    const pathMatch =
      url.hostname === 'mp.csdn.net' ? CSDN_NUMERIC_DRAFT_PATH.exec(url.pathname) : null
    const queryDraftId = CSDN_EDITOR_QUERY_PATH.test(url.pathname)
      ? CSDN_DRAFT_QUERY_KEYS.map((key) => url.searchParams.get(key)).find((value) =>
          /^\d+$/u.test(value ?? ''),
        )
      : null
    const draftId = pathMatch?.[1] ?? queryDraftId
    if (!draftId) return null
    return {
      draftId,
      url:
        pathMatch !== null
          ? `https://mp.csdn.net/mp_blog/creation/editor/${draftId}`
          : `${url.origin}${url.pathname}?articleId=${draftId}`,
    }
  } catch {
    return null
  }
}

export function isSameCsdnDraft(leftUrl: string, rightUrl: string): boolean {
  const left = parseCsdnDraftAnchor(leftUrl)
  const right = parseCsdnDraftAnchor(rightUrl)
  return Boolean(left && right && left.draftId === right.draftId)
}
