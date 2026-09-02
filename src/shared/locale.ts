export type AppLocale = 'zh-CN' | 'en-US'

/** 缺省语言（locale 未设置时的兜底，i18n 初始化与设置页显示共用）。 */
export const DEFAULT_LOCALE: AppLocale = 'zh-CN'

// 语言切换格式化转换工具
export function normalizeLocale(v: string | undefined | null): AppLocale {
  return v === 'en-US' ? 'en-US' : DEFAULT_LOCALE
}
