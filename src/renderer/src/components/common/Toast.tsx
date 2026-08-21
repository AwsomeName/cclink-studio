/**
 * 轻量 Toast 提示组件
 *
 * 全局单例，通过 useToastStore.show(message, type) 调用。
 * 普通提示 3 秒后自动消失；错误提示保留 8 秒，确保状态栏中的完整原因可被读到。
 */

import { create } from 'zustand'

// ─── Toast Store ──────────────────────────────────────

interface ToastState {
  message: string
  type: 'success' | 'error' | 'info'
  visible: boolean
  show: (message: string, type?: 'success' | 'error' | 'info') => void
}

let toastTimer: ReturnType<typeof setTimeout> | null = null

export const useToastStore = create<ToastState>((set) => ({
  message: '',
  type: 'info',
  visible: false,

  show: (message, type = 'info') => {
    if (toastTimer) clearTimeout(toastTimer)
    set({ message, type, visible: true })
    toastTimer = setTimeout(
      () => {
        set({ visible: false })
        toastTimer = null
      },
      type === 'error' ? 8000 : 3000,
    )
  },
}))

// ─── Toast 组件 ───────────────────────────────────────

export function Toast(): React.ReactElement | null {
  const visible = useToastStore((s) => s.visible)
  const message = useToastStore((s) => s.message)
  const type = useToastStore((s) => s.type)

  if (!visible) return null

  return (
    <div
      className={`toast toast-${type}`}
      role={type === 'error' ? 'alert' : 'status'}
      title={message}
    >
      <span className="toast-icon">
        {type === 'success' && '✅'}
        {type === 'error' && '❌'}
        {type === 'info' && 'ℹ️'}
      </span>
      <span className="toast-message">{message}</span>
    </div>
  )
}
