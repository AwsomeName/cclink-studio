const CSDN_NUMERIC_DRAFT_PATH = /^\/mp_blog\/creation\/editor\/(\d+)\/?$/u

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
    if (url.protocol !== 'https:' || url.hostname !== 'mp.csdn.net') return null
    const match = CSDN_NUMERIC_DRAFT_PATH.exec(url.pathname)
    if (!match) return null
    return {
      draftId: match[1],
      url: `https://mp.csdn.net/mp_blog/creation/editor/${match[1]}`,
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
