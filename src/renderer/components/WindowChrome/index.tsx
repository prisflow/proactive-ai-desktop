import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'

/** 窗口管理按钮：最小化 / 最大化 / 关闭 */
const platform = window.electronAPI?.platform ?? 'win32'

export default function WindowChrome() {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    const check = () => {
      setIsMaximized(
        window.outerWidth >= window.screen.availWidth ||
        window.outerHeight >= window.screen.availHeight,
      )
    }
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  return (
    <header
      className={cn(
        'relative flex h-9 shrink-0 items-stretch justify-between border-b border-[color:var(--app-border)] bg-[var(--app-bg)]',
        platform === 'darwin' ? 'pl-20' : '',
      )}
    >
      {/* macOS 拖拽区域 */}
      {platform === 'darwin' && (
        <div className="absolute left-0 top-0 z-[1] h-full w-20 [-webkit-app-region:drag]" />
      )}

      {/* 居中标题 */}
      <div className="pointer-events-none absolute left-1/2 top-0 z-[1] flex h-full -translate-x-1/2 items-center" aria-hidden>
        <span className="text-xs font-semibold tracking-wide text-[var(--app-muted)] select-none">ProactiveAI</span>
      </div>

      {/* 拖拽区域 */}
      <div
        className={cn(
          'flex-1 [-webkit-app-region:drag]',
          platform === 'darwin' ? '' : 'mr-auto',
        )}
        aria-hidden
      />

      {/* Windows 窗口按钮 */}
      {platform !== 'darwin' && (
        <div className="flex h-full items-stretch">
          <button
            onClick={() => window.electronAPI!.window.minimize()}
            className="flex h-full w-11 items-center justify-center text-[var(--app-muted)] transition-colors hover:bg-[var(--app-hover)] hover:text-[var(--app-fg)]"
            aria-label="最小化"
          >
            <svg width="10" height="10" viewBox="0 0 10 10"><rect y="4" width="10" height="1.2" fill="currentColor" /></svg>
          </button>

          <button
            onClick={() => window.electronAPI!.window.maximizeToggle()}
            className="flex h-full w-11 items-center justify-center text-[var(--app-muted)] transition-colors hover:bg-[var(--app-hover)] hover:text-[var(--app-fg)]"
            aria-label={isMaximized ? '还原' : '最大化'}
          >
            {isMaximized ? (
              <svg width="10" height="10" viewBox="0 0 10 10">
                <rect x="1.5" y="3" width="6" height="6" rx="0.5" fill="none" stroke="currentColor" strokeWidth="1" />
                <rect x="3" y="1" width="6" height="6" rx="0.5" fill="var(--app-bg)" stroke="currentColor" strokeWidth="1" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10">
                <rect x="1" y="1" width="8" height="8" rx="0.8" fill="none" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            )}
          </button>

          <button
            onClick={() => window.electronAPI!.window.close()}
            className="flex h-full w-11 items-center justify-center text-[var(--app-muted)] transition-colors hover:bg-red-500 hover:text-white"
            aria-label="关闭"
          >
            <svg width="10" height="10" viewBox="0 0 10 10">
              <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}
    </header>
  )
}
