export type AppLocale = 'zh-CN' | 'en-US'

// 语言切换格式化转换工具
export function normalizeLocale(v: string | undefined | null): AppLocale {
  return v === 'en-US' ? 'en-US' : 'zh-CN'
}
