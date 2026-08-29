import { useSidebarStore } from '../stores/sidebarStore'

interface UseSidebarReturn {
  isOpen: boolean
  toggle: () => void
  setOpen: (open: boolean) => void
}

/**
 * 侧边栏展开/折叠状态 hook。
 * 透传 sidebarStore，无额外逻辑。
 */
export function useSidebar(): UseSidebarReturn {
  const { isOpen, toggle, setOpen } = useSidebarStore()

  return {
    isOpen,
    toggle,
    setOpen,
  }
}
