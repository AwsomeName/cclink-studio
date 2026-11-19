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
export async function loadDirectories() {
  try {
    const { items, errors } = await window.cclinkStudio.ownerDirectories.list()
    for (const a of items) {
      const current = useOwners.getState().items.find((x) => x.id === a.id)
      if ((current?.directory?.revision ?? 0) <= a.directory!.revision) acceptDirectory(a)
    }
    if (errors.length) useOwners.setState({ error: errors.join('；') })
  } catch (e) {
    useOwners.setState({ error: '事务目录读取失败：' + String(e) })
  }
}
