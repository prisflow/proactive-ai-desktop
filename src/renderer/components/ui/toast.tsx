import { CheckCircle2, XCircle, Info } from 'lucide-react'
import { useToastStore } from '@/stores/toastStore'

/**
 * 全局提示条容器。挂在 App 顶层。
 * 固定在右下角，info/error 分色，带图标与滑入动画。
 */
export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts)
  if (toasts.length === 0) return null
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={[
            'pointer-events-auto flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm shadow-lg',
            'animate-in slide-in-from-right-4 fade-in duration-200',
            t.type === 'error'
              ? 'border-red-500/30 bg-[var(--app-surface)] text-red-500'
              : 'border-[color:var(--app-border)] bg-[var(--app-surface)] text-[var(--app-fg)]',
          ].join(' ')}
        >
          {t.type === 'error' ? (
            <XCircle size={16} className="mt-0.5 shrink-0" />
          ) : (
            <Info size={16} className="mt-0.5 shrink-0 text-[var(--app-muted)]" />
          )}
          <span className="min-w-0 break-words leading-snug">{t.message}</span>
        </div>
      ))}
    </div>
  )
}
