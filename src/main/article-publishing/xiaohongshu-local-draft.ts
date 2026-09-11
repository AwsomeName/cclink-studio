import type { Page } from 'playwright-core'

export interface XiaohongshuDraftSnapshot {
  draftId: string
  uid: string
  title: string
  description: string
  descriptionHtml: string
  savedAt: number
  images: Array<{ fileId: string; name: string; width: number; height: number; uploaded: boolean }>
}

/** Only the platform's image-draft store. Never reads credentials or changes platform storage. */
export async function readXiaohongshuLocalDrafts(page: Page): Promise<XiaohongshuDraftSnapshot[]> {
  if (new URL(page.url()).origin !== 'https://creator.xiaohongshu.com')
    throw new Error('小红书草稿只能从绑定账号的创作后台读取')
  return page.evaluate(async () => {
    const databases = await indexedDB.databases()
    if (!databases.some((db) => db.name === 'draft-database-v1')) return []
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('draft-database-v1')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(new Error('小红书本地草稿库无法打开'))
      request.onupgradeneeded = () => request.transaction?.abort()
    })
    try {
      if (!db.objectStoreNames.contains('image-draft')) return []
      const records: unknown[] = await new Promise((resolve, reject) => {
        const request = db
          .transaction('image-draft', 'readonly')
          .objectStore('image-draft')
          .getAll()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(new Error('小红书本地草稿回读失败'))
      })
      return records.flatMap((value) => {
        // Deliberately project a small public-content shape; no complete store enters diagnostics.
        const record = value as {
          draftId?: unknown
          uid?: unknown
          timeStamp?: unknown
          content?: {
            draftStore?: {
              title?: unknown
              desc?: unknown
              descInnerHTML?: unknown
              imgList?: Array<{
                fileId?: unknown
                file?: { name?: unknown }
                status?: unknown
                fileMetadata?: { width?: unknown; height?: unknown }
              }>
            }
          }
        }
        const draft = record.content?.draftStore
        if (
          typeof record.draftId !== 'string' ||
          !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu.test(record.draftId) ||
          typeof record.uid !== 'string' ||
          !/^[\da-f]{24}$/iu.test(record.uid) ||
          typeof record.timeStamp !== 'number' ||
          !Number.isFinite(record.timeStamp) ||
          typeof draft?.title !== 'string' ||
          typeof draft.desc !== 'string' ||
          typeof draft.descInnerHTML !== 'string' ||
          !Array.isArray(draft.imgList)
        )
          return []
        const images = draft.imgList.map((img) => ({
          fileId: typeof img.fileId === 'string' ? img.fileId : '',
          name: typeof img.file?.name === 'string' ? img.file.name : '',
          width: typeof img.fileMetadata?.width === 'number' ? img.fileMetadata.width : 0,
          height: typeof img.fileMetadata?.height === 'number' ? img.fileMetadata.height : 0,
          uploaded: img.status === 2 || img.status === 5,
        }))
        return [
          {
            draftId: record.draftId,
            uid: record.uid,
            title: draft.title,
            description: draft.desc,
            descriptionHtml: draft.descInnerHTML,
            savedAt: record.timeStamp,
            images,
          },
        ]
      })
    } finally {
      db.close()
    }
  })
}

export function requireXiaohongshuDraft(
  drafts: XiaohongshuDraftSnapshot[],
  expected: { draftId: string; uid: string; title: string },
): XiaohongshuDraftSnapshot {
  const matches = drafts.filter((draft) => draft.draftId === expected.draftId)
  if (matches.length !== 1) throw new Error('小红书原草稿不存在或不唯一；禁止另建或按标题猜测')
  const draft = matches[0]
  if (draft.uid !== expected.uid) throw new Error('小红书原草稿账号不一致')
  if (draft.title !== expected.title) throw new Error('小红书原草稿标题不一致')
  if (draft.images.some((img) => !img.uploaded || !img.fileId || img.width <= 0 || img.height <= 0))
    throw new Error('小红书草稿含未完成上传或无法核验的图片')
  return draft
}
