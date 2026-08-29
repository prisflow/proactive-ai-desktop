import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { normalizeLocale } from '@shared/locale'
import zh from './locales/zh-CN.json'
import en from './locales/en-US.json'

/**
 * i18next 初始化入口。
 * 语言资源通过 Vite 原生 JSON 导入静态加载，无异步网络请求。
 * 默认语言 zh-CN，fallback 也是 zh-CN。
 * React 绑定通过 react-i18next 的 initReactI18next 模块注入。
 */
void i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zh },
    'en-US': { translation: en },
  },
  lng: 'zh-CN',
  fallbackLng: 'zh-CN',
  // 不用再转义，react自己会转
  interpolation: { escapeValue: false },
})

/**
 * 根据配置切换当前语言。
 * locale 为空或无法识别时由 normalizeLocale 回退到默认语言。
 */
export function syncI18nFromConfig(locale?: string): void {
  void i18n.changeLanguage(normalizeLocale(locale))
}

export default i18n
