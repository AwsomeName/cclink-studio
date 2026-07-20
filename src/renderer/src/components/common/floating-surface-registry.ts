import { useSyncExternalStore } from 'react'

let activeSurfaceCount = 0
const listeners = new Set<() => void>()

export function registerFloatingSurface(): () => void {
  activeSurfaceCount += 1
  emitChange()
  let registered = true

  return () => {
    if (!registered) return
    registered = false
    activeSurfaceCount = Math.max(0, activeSurfaceCount - 1)
    emitChange()
  }
}

export function useAnyFloatingSurfaceOpen(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): boolean {
  return activeSurfaceCount > 0
}

function getServerSnapshot(): boolean {
  return false
}

function emitChange(): void {
  for (const listener of listeners) listener()
}
