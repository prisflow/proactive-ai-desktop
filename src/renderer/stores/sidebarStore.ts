import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * 侧边栏展开/折叠状态。
 * 通过 localStorage 持久化，跨会话保持用户偏好。
 */
interface SidebarStore {
  /** 当前是否展开 */
  isOpen: boolean
  /** 切换展开/折叠 */
  toggle: () => void
  /** 强制设置状态 */
  setOpen: (open: boolean) => void
}

export const useSidebarStore = create<SidebarStore>()(
  persist(
    (set) => ({
      isOpen: true,
      toggle: () => set((state) => ({ isOpen: !state.isOpen })),
      setOpen: (open) => set({ isOpen: open }),
    }),
    {
      name: 'sidebar-storage',
    }
  )
)
