import type { PointerEvent as ReactPointerEvent } from 'react'
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { localWorkspaceRef } from '@shared/workspace-ref'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { beginWorkspaceRuntimeTransition } from '../../utils/workspace-transition'
import { cancelActivePanelResize } from '../../utils/panel-layout-drag-lifecycle'
import { ResizeHandle } from './ResizeHandle'

// 无 DOM 的事件生命周期测试；真实 React/Pointer Capture 交互由 Electron smoke 复验。
const { unmounts } = vi.hoisted(() => ({ unmounts: [] as Array<() => void> }))
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useCallback: (callback: unknown) => callback,
  useRef: (current: unknown) => ({ current }),
  useEffect: (effect: () => () => void) => {
    unmounts.push(effect())
  },
}))
vi.mock('../../features/context-actions/context-menu-store', () => ({
  useContextMenuStore: (selector: (state: { show: () => void }) => unknown) =>
    selector({ show: () => {} }),
}))
vi.mock('../../stores/workspace-store', async (original) => {
  const actual = await original<typeof import('../../stores/workspace-store')>()
  return {
    ...actual,
    useWorkspaceStore: Object.assign(
      (selector: (state: ReturnType<typeof actual.useWorkspaceStore.getState>) => unknown) =>
        selector(actual.useWorkspaceStore.getState()),
      actual.useWorkspaceStore,
    ),
  }
})

let listeners: Map<string, Set<(event: PointerEvent) => void>>
let captured: Set<number>
let classes: Set<string>
let bodyStyle: { cursor: string; userSelect: string }

function emit(type: string, x = 100, pointerId = 1): void {
  for (const listener of [...(listeners.get(type) ?? [])])
    listener({ clientX: x, pointerId } as PointerEvent)
}

function renderHandle(
  onResize = vi.fn(),
  onResizeEnd = vi.fn(),
): {
  down: (x?: number) => void
  onResize: typeof onResize
  onResizeEnd: typeof onResizeEnd
} {
  const element = ResizeHandle({ onResize, onResizeEnd, area: 'sidebar', side: 'left' })
  const props = element.props as {
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  }
  return {
    onResize,
    onResizeEnd,
    down: (x = 100) =>
      props.onPointerDown({
        button: 0,
        pointerId: 1,
        clientX: x,
        preventDefault: () => {},
        stopPropagation: () => {},
        currentTarget: {
          setPointerCapture: (id: number) => captured.add(id),
          hasPointerCapture: (id: number) => captured.has(id),
          releasePointerCapture: (id: number) => captured.delete(id),
        },
      } as unknown as ReactPointerEvent<HTMLDivElement>),
  }
}

beforeEach(() => {
  vi.stubGlobal('React', React)
  listeners = new Map()
  captured = new Set()
  classes = new Set()
  bodyStyle = { cursor: '', userSelect: '' }
  unmounts.length = 0
  vi.stubGlobal('window', {
    addEventListener: (name: string, listener: (event: PointerEvent) => void) => {
      const group = listeners.get(name) ?? new Set()
      group.add(listener)
      listeners.set(name, group)
    },
    removeEventListener: (name: string, listener: (event: PointerEvent) => void) =>
      listeners.get(name)?.delete(listener),
  })
  vi.stubGlobal('document', {
    body: {
      style: bodyStyle,
      classList: {
        add: (name: string) => classes.add(name),
        remove: (name: string) => classes.delete(name),
      },
    },
  })
  useWorkspaceStore.getState().commitActiveWorkspace(localWorkspaceRef('/workspace/a'))
})

afterEach(() => {
  cancelActivePanelResize()
  for (const unmount of unmounts) unmount()
  vi.unstubAllGlobals()
})

describe('ResizeHandle workspace lifetime', () => {
  it('cancels synchronously when switching starts; old callbacks cannot resize B', () => {
    const handle = renderHandle()
    handle.down()
    emit('pointermove', 120)
    expect(handle.onResize).toHaveBeenLastCalledWith(20)
    // 即便旧 listener 已被事件调度捕获，失效后也不得再调用 setter。
    const oldMove = [...listeners.get('pointermove')!][0]!
    const oldUp = [...listeners.get('pointerup')!][0]!
    beginWorkspaceRuntimeTransition()
    expect(handle.onResizeEnd).toHaveBeenCalledOnce()
    useWorkspaceStore.getState().commitActiveWorkspace(localWorkspaceRef('/workspace/b'))
    oldMove({ clientX: 250, pointerId: 1 } as PointerEvent)
    oldUp({ clientX: 250, pointerId: 1 } as PointerEvent)
    expect(handle.onResize).toHaveBeenCalledTimes(1)
    expect(classes.size).toBe(0)
    expect(captured.size).toBe(0)
    expect(bodyStyle).toEqual({ cursor: '', userSelect: '' })
  })

  it('checks committed workspace generation even if activation bypasses prepare', () => {
    const handle = renderHandle()
    handle.down()
    useWorkspaceStore.getState().commitActiveWorkspace(localWorkspaceRef('/workspace/a'))
    emit('pointermove', 240)
    expect(handle.onResize).not.toHaveBeenCalled()
    expect(handle.onResizeEnd).toHaveBeenCalledOnce()
  })

  it.each(['pointercancel', 'blur', 'unmount'])(
    'releases listeners and pointer capture after %s',
    (event) => {
      const handle = renderHandle()
      handle.down()
      if (event === 'unmount') unmounts[0]!()
      else emit(event)
      emit('pointermove', 240)
      emit('pointerup', 240)
      expect(handle.onResize).not.toHaveBeenCalled()
      expect(handle.onResizeEnd).toHaveBeenCalledOnce()
      expect([...listeners.values()].every((group) => group.size === 0)).toBe(true)
      expect(captured.size).toBe(0)
    },
  )

  it('releases the previous pointer-down before accepting a second drag', () => {
    const handle = renderHandle()
    handle.down(100)
    handle.down(200)
    emit('pointermove', 230)
    expect(handle.onResize).toHaveBeenCalledExactlyOnceWith(30)
    expect(handle.onResizeEnd).toHaveBeenCalledOnce()
  })
})
