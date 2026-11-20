import { create } from 'zustand'
import { z } from 'zod'
import { affair, type Affair } from './affair'
const key = 'studio.owner.affairs.v1'
const schema = z.array(affair).max(100)
type State = {
  items: Affair[]
  error: string
  blocked: boolean
  save: (v: Affair) => boolean
  remove: (id: string) => void
}
function load() {
  try {
    return {
      items: schema.parse(JSON.parse(localStorage.getItem(key) ?? '[]')),
      error: '',
      blocked: false,
    }
  } catch {
    return { items: [], error: '事务记录无法读取；已保留原数据，未覆盖。', blocked: true }
  }
}
export const useOwners = create<State>((set, get) => {
  function write(items: Affair[]) {
    if (get().blocked) return false
    try {
      localStorage.setItem(key, JSON.stringify(schema.parse(items.filter((a) => !a.directory))))
      set({ items, error: '' })
      return true
    } catch {
      set({ error: '未保存：本机存储空间不足或已达资料上限。' })
      return false
    }
  }
  return {
    ...load(),
    save: (v) =>
      write([{ ...v, updated: Date.now() }, ...get().items.filter((a) => a.id !== v.id)]),
    remove: (id) => {
      write(get().items.filter((a) => a.id !== id))
    },
  }
})

export function acceptDirectory(a: Affair) {
  useOwners.setState((s) => ({
    items: [a, ...s.items.filter((x) => x.id !== a.id)].sort((a, b) => b.updated - a.updated),
  }))
  return a
}
// Only used when IPC supplied no receipt. The main process may already have saved this change.
const unacknowledged = new Map<string, Affair>()
const conflicts = new Set<string>()
export const hasDirectoryConflict = (id: string) => conflicts.has(id)
export async function useSavedDirectory(id: string) {
  if (!conflicts.has(id)) return
  const { items } = await window.cclinkStudio.ownerDirectories.list()
  const saved = items.find((item) => item.id === id)
  if (!saved || saved.directory?.error) throw Error('目录版本仍未就绪，请先重试保存')
  conflicts.delete(id)
  unacknowledged.delete(id)
  return acceptDirectory(saved)
}
export function keepUnacknowledged(candidate: Affair, cause: unknown) {
  unacknowledged.set(candidate.id, candidate)
  return acceptDirectory({
    ...candidate,
    directory: { ...candidate.directory!, error: '事务保存未确认：' + String(cause) },
  })
}
export async function retryDirectory(id: string) {
  const api = window.cclinkStudio.ownerDirectories
  const saved = await api.retry(id)
  const candidate = unacknowledged.get(id)
  if (!candidate) return acceptDirectory(saved)
  const sameRecord = (a: Affair) => JSON.stringify(affair.parse({ ...a, updated: 0 }))
  let result = saved
  if (sameRecord(candidate) !== sameRecord(saved)) {
    if (saved.directory?.error) throw Error(saved.directory.error)
    if (saved.directory?.revision !== candidate.directory!.revision) {
      const reason = '目录中已有另一版本，本次未保存的修改仍保留在当前页面。'
      conflicts.add(id)
      keepUnacknowledged(candidate, reason)
      throw Error(reason)
    }
    result = await api.save(candidate, candidate.directory!.revision)
  }
  conflicts.delete(id)
  unacknowledged.delete(id)
  return acceptDirectory(result)
}
export async function loadDirectories() {
  try {
    const { items, errors } = await window.cclinkStudio.ownerDirectories.list()
    for (const a of items) {
      const current = useOwners.getState().items.find((x) => x.id === a.id)
      if (unacknowledged.has(a.id)) continue
      if ((current?.directory?.revision ?? 0) <= a.directory!.revision) acceptDirectory(a)
    }
    if (errors.length) useOwners.setState({ error: errors.join('；') })
  } catch (e) {
    useOwners.setState({ error: '事务目录读取失败：' + String(e) })
  }
}
