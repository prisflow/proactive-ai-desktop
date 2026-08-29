import { useToastStore } from '@/stores/toastStore'

/**
 * 全局提示条容器。挂在 App 顶层，fixed 定位居中显示。
 * 目前只有 error 样式，info 类型将来扩展时再补配色。
 */
export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts)
  if (toasts.length === 0) return null
  return (
    <div className="pointer-events-none fixed left-1/2 top-4 z-[100] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto max-w-md rounded-lg border border-red-500/30 bg-[var(--app-surface)] px-4 py-2 text-xs text-red-400 shadow-xl"
        >
          {t.message}
        </div>
      ))}
    </div>
  )
}
