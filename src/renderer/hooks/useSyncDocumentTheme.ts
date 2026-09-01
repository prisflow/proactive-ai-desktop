import { useEffect } from 'react'
import { useConfigStore } from '@/stores/configStore'

/**
 * 解析主题配置值，返回实际应用的亮/暗。
 * 'auto' 时跟随系统 prefers-color-scheme；null（未设置）默认 fallback 为 dark。
 */
function resolveTheme(theme: 'light' | 'dark' | 'auto' | null): 'light' | 'dark' {
  if (theme === 'light') return 'light'
  if (theme === 'dark' || theme === null) return 'dark'
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

/**
 * 将 configStore 中的 theme 设置同步到 `document.documentElement[data-theme]`。
 * 当主题为 'auto' 时，同时监听系统主题变化事件并及时更新。
 * CSS 变量通过 `html[data-theme='dark']` / `html[data-theme='light']` 选择器生效。
 */
export function useSyncDocumentTheme() {
  const theme = useConfigStore((s) => s.config.theme)

  useEffect(() => {
    const apply = () => {
      document.documentElement.setAttribute('data-theme', resolveTheme(theme))
    }
    apply()
    if (theme !== 'auto') return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = () => apply()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])
}
