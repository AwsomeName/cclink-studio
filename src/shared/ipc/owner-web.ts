import { z } from 'zod'
import { defineIpcInvoke, defineNoArgsIpc } from './contract'

/**
 * Owner's public-web evidence channel. Studio runs every search and fetch through the existing
 * web search service (DeepSeek); the renderer never gets the key and models never call it
 * directly, so each call is counted and every fetched page becomes a hashed snapshot.
 */
export type OwnerWebStatus = { ready: boolean; reason?: string }
export type OwnerWebHit = { url: string; title: string; snippet: string }
export type OwnerWebSearchResult = { ok: true; hits: OwnerWebHit[] } | { ok: false; error: string }
export type OwnerWebPage =
  | {
      ok: true
      repo: 'web'
      url: string
      title: string
      /** SHA-256 of the whole fetched text. */
      sha: string
      /** The window around the anchor that becomes evidence. */
      text: string
      startLine: number
      chars: number
      truncated: boolean
      matchedAnchor?: boolean
      /** Lines in the page that match the anchor, for the next targeted read. */
      locations?: string[]
      at: number
    }
  | { ok: false; error: string }
export type OwnerWebMoreOutcome = 'approved' | 'denied' | 'timeout'
/** Every Owner affair gets this many extra calls each time the user approves more. */
export const OWNER_WEB_EXTRA = 10

const affairId = z.string().uuid()
const conversationId = z.string().regex(/^owner-[0-9a-f-]{36}-[a-h]$/)
export const ownerWebQuery = z
  .string()
  .trim()
  .min(1)
  .refine((q) => [...q].length <= 128, '搜索词需要 1–128 个字符')
export const ownerWebUrl = z
  .string()
  .max(8192)
  .url()
  .refine((u) => /^https?:\/\//i.test(u), '只能读取 http(s) 网址')

export const ownerWebIpc = {
  status: defineNoArgsIpc<OwnerWebStatus>('owner-web:status'),
  search: defineIpcInvoke<[string, string], OwnerWebSearchResult>('owner-web:search', (args) =>
    z.tuple([affairId, ownerWebQuery]).parse(args),
  ),
  fetch: defineIpcInvoke<[string, string, string], OwnerWebPage>('owner-web:fetch', (args) =>
    z.tuple([affairId, ownerWebUrl, z.string().max(120)]).parse(args),
  ),
  /** Asks the user, in the affair's conversation, for OWNER_WEB_EXTRA more calls. */
  more: defineIpcInvoke<[string, string, number, number], OwnerWebMoreOutcome>(
    'owner-web:more',
    (args) =>
      z
        .tuple([
          affairId,
          conversationId,
          z.number().int().min(0).max(1000),
          z.number().int().min(1).max(1000),
        ])
        .refine(([id, conv]) => conv.startsWith('owner-' + id + '-'), '会话不属于该事务')
        .parse(args),
  ),
}
