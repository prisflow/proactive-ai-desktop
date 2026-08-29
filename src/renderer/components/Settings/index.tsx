import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useConfigStore } from '@/stores/configStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { syncI18nFromConfig } from '@/i18n'

export default function Settings({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const { config, updateConfig } = useConfigStore()
  // 字号输入使用本地草稿态：允许临时输入（含空/未完成数字），仅在合法范围（12-24）内提交
  const [fontSizeDraft, setFontSizeDraft] = useState<string>(String(config.fontSize ?? 16))
  useEffect(() => {
    setFontSizeDraft(String(config.fontSize ?? 16))
  }, [config.fontSize])

  const themes: { key: 'light' | 'dark' | 'auto'; label: string }[] = [
    { key: 'light', label: t('settings.themeLight') },
    { key: 'dark', label: t('settings.themeDark') },
    { key: 'auto', label: t('settings.themeAuto') },
  ]

  const locales: { key: 'zh-CN' | 'en-US'; label: string }[] = [
    { key: 'zh-CN', label: t('settings.langZh') },
    { key: 'en-US', label: t('settings.langEn') },
  ]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--app-overlay)] p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className={cn(
          'flex max-h-[min(85vh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl',
          'border border-[color:var(--app-border-strong)] bg-[var(--app-surface)] shadow-2xl'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[color:var(--app-border-strong)] px-5 py-4">
          <h2 className="text-lg font-semibold tracking-tight text-[var(--app-fg)]">
            {t('settings.title')}
          </h2>
          <Button type="button" variant="ghost" size="icon" onClick={onClose}>
            <X size={20} />
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* 语言 */}
          <section className="space-y-2">
            <Label className="text-[var(--app-fg)]">{t('settings.language')}</Label>
            <div className="flex gap-2">
              {locales.map((loc) => (
                <Button
                  key={loc.key}
                  type="button"
                  variant={config.locale === loc.key ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => {
                    updateConfig({ locale: loc.key })
                    syncI18nFromConfig(loc.key)
                  }}
                >
                  {loc.label}
                </Button>
              ))}
            </div>
          </section>

          {/* 外观 */}
          <section className="space-y-2">
            <Label className="text-[var(--app-fg)]">{t('settings.appearance')}</Label>
            <div className="flex gap-2">
              {themes.map((th) => (
                <Button
                  key={th.key}
                  type="button"
                  variant={config.theme === th.key ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => updateConfig({ theme: th.key })}
                >
                  {th.label}
                </Button>
              ))}
            </div>
            <p className="text-xs text-[var(--app-muted)]">{t('settings.themeHint')}</p>

            <div className="flex items-center gap-3 pt-2">
              <Label className="text-[var(--app-fg)] shrink-0">{t('settings.fontSize')}</Label>
              <Input
                type="number"
                min={12}
                max={24}
                className="w-20"
                value={fontSizeDraft}
                onChange={(e) => {
                  setFontSizeDraft(e.target.value)
                  const n = parseInt(e.target.value)
                  if (!Number.isNaN(n) && n >= 12 && n <= 24) updateConfig({ fontSize: n })
                }}
              />
              <span className="text-xs text-[var(--app-muted)]">{t('settings.fontSizeHint')}</span>
            </div>
          </section>

          {/* LLM 设置 */}
          <section className="space-y-3">
            <div className="flex flex-col gap-2">
              <Label className="text-[var(--app-fg)]">{t('settings.apiKey')}</Label>
              <Input
                type="password"
                value={config.apiKey}
                onChange={(e) => updateConfig({ apiKey: e.target.value })}
                placeholder={t('settings.apiKeyPlaceholder')}
                autoComplete="off"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label className="text-[var(--app-fg)]">{t('settings.model')}</Label>
              <Input
                value={config.model}
                onChange={(e) => updateConfig({ model: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label className="text-[var(--app-fg)]">{t('settings.baseUrl')}</Label>
              <Input
                value={config.baseURL || ''}
                onChange={(e) => updateConfig({ baseURL: e.target.value })}
                placeholder={t('settings.baseUrlPlaceholder')}
              />
            </div>
          </section>
        </div>

        <footer className="shrink-0 border-t border-[color:var(--app-border-strong)] px-5 py-4">
          <Button type="button" onClick={onClose} className="w-full">
            {t('settings.close')}
          </Button>
        </footer>
      </div>
    </div>
  )
}
