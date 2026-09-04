import { useEffect, useRef, useState } from 'react'
import { X, PackagePlus, Settings2, Globe, Palette, Plug, Cpu, Cloud } from 'lucide-react'
import QRCode from 'qrcode'
import { useTranslation } from 'react-i18next'
import { useConfigStore } from '@/stores/configStore'
import { useToastStore } from '@/stores/toastStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import { syncI18nFromConfig } from '@/i18n'
import { DEFAULT_MODEL, DEFAULT_BASE_URL, DEFAULT_THEME, DEFAULT_FONT_SIZE, DEFAULT_RELAY_URL } from '@shared/constants'
import { DEFAULT_LOCALE } from '@shared/locale'

/** 分段控件：一组等宽选项，选中高亮。 */
function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[]
  value: T | null
  onChange: (v: T) => void
}) {
  return (
    <div className="inline-flex w-fit rounded-lg border border-[color:var(--app-border-strong)] bg-[var(--app-subtle-section)] p-1">
      {options.map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={() => onChange(opt.key)}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            value === opt.key
              ? 'bg-[var(--app-surface)] text-[var(--app-fg)] shadow-sm'
              : 'text-[var(--app-muted)] hover:text-[var(--app-fg)]'
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

/** 分组标题（图标 + 文字）。 */
function SectionTitle({ icon: Icon, children }: { icon: React.ComponentType<{ size?: number; className?: string }>; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[var(--app-fg)]">
      <Icon size={15} className="text-[var(--app-muted)]" />
      <span className="text-sm font-semibold">{children}</span>
    </div>
  )
}

export default function Settings({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const { config, updateConfig } = useConfigStore()
  const toast = useToastStore()
  const [importing, setImporting] = useState(false)
  const [installed, setInstalled] = useState<Array<{ id: string; name: string; version: string; description?: string; entry: string; loaded: boolean }>>([])

  async function refreshPlugins() {
    try {
      setInstalled(await window.electronAPI.plugins.list())
    } catch {
      // 忽略，列表保持空
    }
  }
  useEffect(() => {
    refreshPlugins()
  }, [])

  // 公网中继：状态恢复
  const [relayState, setRelayState] = useState<'off' | 'connecting' | 'online'>('off')
  // 预填：配置里的回环地址（本地测试残留）视为无效，回退官方默认地址
  const isLoopbackRelay = (u: string | null) => /^(wss?:\/\/)(127\.0\.0\.1|localhost)/.test(u ?? '')
  const [relayUrlInput, setRelayUrlInput] = useState(
    config.relayUrl && !isLoopbackRelay(config.relayUrl) ? config.relayUrl : DEFAULT_RELAY_URL,
  )
  const [relayCodeInput, setRelayCodeInput] = useState(config.relayCode ?? '')
  const [relayLink, setRelayLink] = useState<string | null>(null)
  const [relayLastError, setRelayLastError] = useState<string | null>(null)
  const relayQrRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    // 恢复连接状态；已在线时取手机访问链接（主进程生成，回环地址自动换局域网 IP）
    window.electronAPI.relay.status().then(async (s) => {
      setRelayState(s.state)
      setRelayLastError(s.lastError)
      if (s.state === 'online') {
        const { link } = await window.electronAPI.relay.link()
        if (link) setRelayLink(link)
      }
    })
  }, [])

  useEffect(() => {
    // 依赖含 relayState：canvas 在 online 时才挂载，挂载后需重新生成二维码
    if (relayLink && relayState === 'online' && relayQrRef.current) {
      QRCode.toCanvas(relayQrRef.current, relayLink, { width: 112, margin: 1 }).catch(() => {
        // 二维码生成失败不影响使用（链接可复制）
      })
    }
  }, [relayLink, relayState])

  async function handleRelayConnect() {
    const res = await window.electronAPI.relay.connect(relayUrlInput, relayCodeInput)
    if (!res.ok) {
      toast.push(t('settings.relayFailed', { error: res.error ?? '未知错误' }), 'error')
      return
    }
    setRelayState('connecting')
    setRelayLastError(null)
    const poll = setInterval(async () => {
      const s = await window.electronAPI.relay.status()
      if (s.state === 'online') {
        clearInterval(poll)
        setRelayState('online')
        const { link } = await window.electronAPI.relay.link()
        if (link) setRelayLink(link)
        toast.push(t('settings.relayOnline'), 'info')
      } else if (s.lastError) {
        setRelayLastError(s.lastError)
      }
    }, 1500)
    setTimeout(() => clearInterval(poll), 15000)
  }

  async function handleRelayDisconnect() {
    await window.electronAPI.relay.disconnect()
    setRelayState('off')
    setRelayLink(null)
  }

  async function handleRelayCopy() {
    if (!relayLink) return
    await navigator.clipboard.writeText(relayLink)
    toast.push(t('settings.linkCopied'), 'info')
  }

  async function handleImportPlugin() {
    setImporting(true)
    try {
      const res = await window.electronAPI.plugins.importZip()
      if (res.ok && res.plugin) {
        toast.push(t('settings.importPluginSuccess', { name: res.plugin.name, version: res.plugin.version }), 'info')
        refreshPlugins()
      } else if (res.error === '已取消') {
        toast.push(t('settings.importPluginCanceled'), 'info')
      } else {
        toast.push(t('settings.importPluginFailed', { error: res.error ?? '未知错误' }), 'error')
      }
    } catch (e) {
      toast.push(t('settings.importPluginFailed', { error: e instanceof Error ? e.message : String(e) }), 'error')
    } finally {
      setImporting(false)
    }
  }

  async function handleUninstallPlugin(p: { name: string; entry: string }) {
    try {
      const res = await window.electronAPI.plugins.uninstall(p.entry)
      if (res.ok) {
        toast.push(t('settings.uninstallPluginSuccess', { name: p.name }), 'info')
        refreshPlugins()
      } else {
        toast.push(t('settings.uninstallPluginFailed', { error: res.error ?? '未知错误' }), 'error')
      }
    } catch (e) {
      toast.push(t('settings.uninstallPluginFailed', { error: e instanceof Error ? e.message : String(e) }), 'error')
    }
  }

  const themes: { key: 'light' | 'dark' | 'auto'; label: string }[] = [
    { key: 'light', label: t('settings.themeLight') },
    { key: 'dark', label: t('settings.themeDark') },
    { key: 'auto', label: t('settings.themeAuto') },
  ]

  const locales: { key: 'zh-CN' | 'en-US'; label: string }[] = [
    { key: 'zh-CN', label: t('settings.langZh') },
    { key: 'en-US', label: t('settings.langEn') },
  ]

  const fontSize = config.fontSize ?? DEFAULT_FONT_SIZE

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--app-overlay)] p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className={cn(
          'flex max-h-[min(85vh,720px)] w-full max-w-md flex-col overflow-hidden rounded-2xl',
          'border border-[color:var(--app-border-strong)] bg-[var(--app-surface)] shadow-xl',
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          'data-[state=open]:slide-in-from-bottom-2 data-[state=closed]:slide-out-to-bottom-2'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[color:var(--app-border-strong)] px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Settings2 size={17} className="text-[var(--app-primary)]" />
            <h2 className="text-base font-semibold tracking-tight text-[var(--app-fg)]">
              {t('settings.title')}
            </h2>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
            <X size={18} />
          </Button>
        </header>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {/* 语言 */}
          <section className="space-y-2.5">
            <SectionTitle icon={Globe}>{t('settings.language')}</SectionTitle>
            <Segmented
              options={locales}
              value={config.locale ?? DEFAULT_LOCALE}
              onChange={(v) => {
                updateConfig({ locale: v })
                syncI18nFromConfig(v)
              }}
            />
          </section>

          {/* 插件 */}
          <section className="space-y-2.5">
            <SectionTitle icon={Plug}>{t('settings.plugins')}</SectionTitle>
            <Button type="button" variant="outline" size="sm" onClick={handleImportPlugin} disabled={importing}>
              <PackagePlus size={15} />
              {importing ? t('settings.importPlugin') + '…' : t('settings.importPlugin')}
            </Button>
            <p className="text-xs text-[var(--app-muted)]">{t('settings.importPluginHint')}</p>

            {installed.length > 0 ? (
              <ul className="space-y-1.5 pt-1">
                {installed.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-[color:var(--app-border)] px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-[var(--app-fg)]">{p.name}</span>
                        <span className="shrink-0 text-xs text-[var(--app-muted)]">v{p.version}</span>
                      </div>
                      {p.description && (
                        <div className="mt-0.5 truncate text-xs text-[var(--app-muted)]">{p.description}</div>
                      )}
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={() => handleUninstallPlugin(p)}>
                      {t('settings.uninstallPlugin')}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="pt-1 text-xs text-[var(--app-muted)]">{t('settings.noPlugins')}</p>
            )}
          </section>

          {/* 外观 */}
          <section className="space-y-2.5">
            <SectionTitle icon={Palette}>{t('settings.appearance')}</SectionTitle>
            <Segmented options={themes} value={config.theme ?? DEFAULT_THEME} onChange={(v) => updateConfig({ theme: v })} />
            <p className="text-xs text-[var(--app-muted)]">{t('settings.themeHint')}</p>

            <div className="flex items-center gap-3 pt-1">
              <Label className="shrink-0 text-[var(--app-muted)] text-sm">{t('settings.fontSize')}</Label>
              <Slider
                value={[fontSize]}
                min={12}
                max={24}
                step={1}
                className="flex-1"
                onValueChange={([v]) => updateConfig({ fontSize: v })}
              />
              <span className="w-10 shrink-0 rounded-md bg-[var(--app-subtle-section)] px-1.5 py-0.5 text-center text-xs font-medium text-[var(--app-fg)]">
                {fontSize}
              </span>
            </div>
          </section>

          {/* LLM 设置 */}
          <section className="space-y-2.5">
            <SectionTitle icon={Cpu}>LLM</SectionTitle>
            <div className="space-y-3 rounded-xl border border-[color:var(--app-border)] bg-[var(--app-subtle-section)] p-4">
              <div className="flex flex-col gap-2">
                <Label className="text-[var(--app-muted)] text-sm">{t('settings.apiKey')}</Label>
                <Input
                  type="password"
                  value={config.apiKey ?? ''}
                  onChange={(e) => updateConfig({ apiKey: e.target.value })}
                  placeholder={t('settings.apiKeyPlaceholder')}
                  autoComplete="off"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label className="text-[var(--app-muted)] text-sm">{t('settings.model')}</Label>
                <Input
                  value={config.model ?? DEFAULT_MODEL}
                  onChange={(e) => updateConfig({ model: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label className="text-[var(--app-muted)] text-sm">{t('settings.baseUrl')}</Label>
                <Input
                  value={config.baseURL || DEFAULT_BASE_URL}
                  onChange={(e) => updateConfig({ baseURL: e.target.value })}
                  placeholder={t('settings.baseUrlPlaceholder')}
                />
              </div>
            </div>
          </section>

          {/* 公网中继 */}
          <section className="space-y-2.5">
            <SectionTitle icon={Cloud}>{t('settings.relayPlay')}</SectionTitle>
            <div className="space-y-3 rounded-xl border border-[color:var(--app-border)] bg-[var(--app-subtle-section)] p-4">
              <div className="flex flex-col gap-2">
                <Label className="text-[var(--app-muted)] text-sm">{t('settings.relayUrl')}</Label>
                <Input
                  value={relayUrlInput}
                  onChange={(e) => setRelayUrlInput(e.target.value)}
                  placeholder={DEFAULT_RELAY_URL}
                  autoComplete="off"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label className="text-[var(--app-muted)] text-sm">{t('settings.relayCode')}</Label>
                <Input
                  value={relayCodeInput}
                  onChange={(e) => setRelayCodeInput(e.target.value)}
                  placeholder={t('settings.relayCodePlaceholder')}
                  autoComplete="off"
                />
              </div>
              {relayState === 'online' ? (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-[var(--app-muted)]">{t('settings.relayOnline')}</span>
                    <Button type="button" variant="outline" size="sm" onClick={handleRelayDisconnect}>
                      {t('settings.relayStop')}
                    </Button>
                  </div>
                  {relayLink && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 rounded-lg border border-[color:var(--app-border)] px-3 py-2">
                        <span className="min-w-0 flex-1 truncate text-xs text-[var(--app-muted)]">{relayLink}</span>
                        <Button type="button" variant="ghost" size="sm" onClick={handleRelayCopy}>
                          {t('settings.linkCopy')}
                        </Button>
                      </div>
                      <div className="flex items-center gap-3">
                        <canvas ref={relayQrRef} className="h-28 w-28 shrink-0 rounded-lg border border-[color:var(--app-border)] bg-white p-1" />
                        <p className="text-xs leading-relaxed text-[var(--app-muted)]">{t('settings.relayQrHint')}</p>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Button type="button" variant="outline" size="sm" onClick={handleRelayConnect} disabled={relayState === 'connecting'}>
                    <Cloud size={15} />
                    {relayState === 'connecting' ? t('settings.relayConnecting') : t('settings.relayStart')}
                  </Button>
                  {relayLastError && (
                    <p className="text-xs leading-relaxed text-red-500">连接失败：{relayLastError}（将继续自动重试）</p>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>

        <footer className="shrink-0 border-t border-[color:var(--app-border-strong)] px-5 py-3.5">
          <div className="flex items-center justify-end gap-2">
            <Button type="button" size="sm" onClick={onClose}>
              {t('settings.close')}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  )
}
