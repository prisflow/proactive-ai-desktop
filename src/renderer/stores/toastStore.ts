import { create } from 'zustand'

export interface ToastItem {
  id: number
  message: string
  type: 'error' | 'info'
}

interface ToastStore {
  toasts: ToastItem[]
  push: (message: string, type?: ToastItem['type']) => void
  remove: (id: number) => void
}

let toastId = 0

/**
 * 全局轻量提示条 store。
 * push 后 3 秒自动消失，无动画（后续如需动效可加 framer-motion）。
 */
export const useToastStore = create<ToastStore>()((set) => ({
  toasts: [],
  push: (message, type = 'error') => {
    const id = ++toastId
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, 3000)
  },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))
