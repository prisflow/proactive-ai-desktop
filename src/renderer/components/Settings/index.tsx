import { X, Check, Loader2, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useConfigStore } from '@/stores/configStore'
import {
  GlobalSettings,
  PromptTemplate,
  migrateTemplateRef,
  DEFAULT_TEMPLATE_NAME,
} from '@shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  clearConversationMemory,
  createTemplate,
  deleteTemplate,
  getConversationMemory,
  getTemplates,
  listPlugins,
  setPluginEnabled,
} from '@/api'
import type { PluginListEntry } from '@shared'
import { useConversationStore } from '@/stores/conversationStore'

function builtinKeyFromId(id: string): string {
  return id.replace(/^builtin_/, '')
}

/** 配置存 builtin id、旧 key或自定义名称 */
function resolveTemplateSelectValue(
  stored: string | undefined,
  templates: PromptTemplate[]
): string {
  if (!templates.length) return ''
  const migrated = migrateTemplateRef(stored)
  const byMigrated = templates.find((t) => t.id === migrated)
  if (byMigrated) return byMigrated.id
  if (stored) {
    const byId = templates.find((t) => t.id === stored)
    if (byId) return byId.id
    const byName = templates.find((t) => t.name === stored)
    if (byName) return byName.isBuiltIn ? byName.id : byName.name
  }
  return templates.find((t) => t.id === 'builtin_default')?.id ?? templates[0]?.id ?? ''
}

export default function Settings({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const { config, updateConfig, saveToMain, validateAndSave } = useConfigStore()
  const { currentConversationId } = useConversationStore()
  const [isSaving, setIsSaving] = useState(false)
  const [isValidating, setIsValidating] = useState(false)
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [isAddTemplateOpen, setIsAddTemplateOpen] = useState(false)
  const [isCreatingTemplate, setIsCreatingTemplate] = useState(false)
  const [newTemplateName, setNewTemplateName] = useState('')
  const [newRolePrompt, setNewRolePrompt] = useState('')
  const [addTemplateError, setAddTemplateError] = useState<string | null>(null)
  const [templateToDelete, setTemplateToDelete] = useState<PromptTemplate | null>(null)
  const [isDeletingTemplate, setIsDeletingTemplate] = useState(false)
  const [memoryItems, setMemoryItems] = useState<string[]>([])
  const [isMemoryLoading, setIsMemoryLoading] = useState(false)
  const [plugins, setPlugins] = useState<PluginListEntry[]>([])
  const [pluginsLoading, setPluginsLoading] = useState(true)
  const [pluginsError, setPluginsError] = useState<'bridge' | 'ipc' | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const templateSelectValue = useMemo(
    () => resolveTemplateSelectValue(config.defaultTemplateName, templates),
    [config.defaultTemplateName, templates]
  )

  useEffect(() => {
    const load = async () => {
      try {
        const list = await getTemplates()
        setTemplates(list)
      } catch (err) {
        console.error('Failed to load templates:', err)
      }
    }
    load()
  }, [])

  useEffect(() => {
    const loadPlugins = async () => {
      setPluginsLoading(true)
      setPluginsError(null)
      try {
        const list = await listPlugins()
        setPlugins(list)
      } catch (err) {
        console.error('Failed to load plugins:', err)
        setPlugins([])
        const msg = err instanceof Error ? err.message : ''
        if (msg.includes('PRELOAD_PLUGINS') || msg.includes('LIST_MISSING')) {
          setPluginsError('bridge')
        } else {
          setPluginsError('ipc')
        }
      } finally {
        setPluginsLoading(false)
      }
    }
    void loadPlugins()
  }, [])

  const handlePluginToggle = async (pluginId: string, enabled: boolean) => {
    try {
      const ok = await setPluginEnabled(pluginId, enabled)
      if (ok) {
        setPlugins((prev) => prev.map((p) => (p.id === pluginId ? { ...p, enabled } : p)))
      }
    } catch (err) {
      console.error('Failed to set plugin enabled:', err)
    }
  }

  useEffect(() => {
    const loadMemory = async () => {
      if (!currentConversationId) {
        setMemoryItems([])
        return
      }
      setIsMemoryLoading(true)
      try {
        const items = await getConversationMemory(currentConversationId)
        setMemoryItems(items)
      } catch (err) {
        console.error('Failed to load memory:', err)
        setMemoryItems([])
      } finally {
        setIsMemoryLoading(false)
      }
    }
    loadMemory()
  }, [currentConversationId])

  const handleSave = async () => {
    setIsSaving(true)
    setMessage(null)
    try {
      const success = await saveToMain()
      if (success) {
        onClose()
      } else {
        setMessage({ type: 'error', text: t('settings.saveFailed') })
      }
    } catch {
      setMessage({ type: 'error', text: t('settings.saveFailed') })
    } finally {
      setIsSaving(false)
    }
  }

  const handleValidate = async () => {
    setIsValidating(true)
    setMessage(null)
    try {
      const success = await validateAndSave()
      if (success) {
        onClose()
      } else {
        setMessage({ type: 'error', text: t('settings.validateFailed') })
      }
    } catch {
      setMessage({ type: 'error', text: t('settings.apiValidateFailed') })
    } finally {
      setIsValidating(false)
    }
  }

  const handleUpdateGlobal = (key: keyof GlobalSettings, value: unknown) => {
    updateConfig({ [key]: value } as Partial<GlobalSettings>)
  }

  const reloadTemplates = async (): Promise<PromptTemplate[]> => {
    const list = await getTemplates()
    setTemplates(list)
    return list
  }

  const openAddTemplate = () => {
    setAddTemplateError(null)
    setNewTemplateName('')
    setNewRolePrompt('')
    setIsAddTemplateOpen(true)
  }

  const handleCreateTemplate = async () => {
    const name = newTemplateName.trim()
    const rolePrompt = newRolePrompt.trim()
    setAddTemplateError(null)
    if (!name) {
      setAddTemplateError(t('settings.errNameRequired'))
      return
    }
    if (!rolePrompt) {
      setAddTemplateError(t('settings.errRoleRequired'))
      return
    }
    if (templates.some((tpl) => tpl.name === name)) {
      setAddTemplateError(t('settings.errDuplicateName'))
      return
    }

    setIsCreatingTemplate(true)
    try {
      await createTemplate({ name, rolePrompt, isBuiltIn: false })
      await reloadTemplates()
      // 立即切换到新模板（保存配置由用户点击保存按钮触发）
      handleUpdateGlobal('defaultTemplateName', name)
      setIsAddTemplateOpen(false)
    } catch (err) {
      console.error('Failed to create template:', err)
      setAddTemplateError(t('settings.errCreateFailed'))
    } finally {
      setIsCreatingTemplate(false)
    }
  }

  const handleConfirmDeleteTemplate = async () => {
    if (!templateToDelete || templateToDelete.isBuiltIn) return
    const wasCurrentSelection =
      templateSelectValue === templateToDelete.id ||
      (!templateToDelete.isBuiltIn && templateSelectValue === templateToDelete.name)

    setIsDeletingTemplate(true)
    setMessage(null)
    try {
      const ok = await deleteTemplate(templateToDelete.id)
      if (!ok) {
        setMessage({ type: 'error', text: t('settings.errDeleteBuiltin') })
        return
      }
      setTemplateToDelete(null)
      const list = await reloadTemplates()
      if (wasCurrentSelection) {
        const fallback = list.find((t) => t.id === 'builtin_default') ?? list.find((t) => t.isBuiltIn) ?? list[0]
        handleUpdateGlobal(
          'defaultTemplateName',
          fallback?.isBuiltIn ? fallback.id : (fallback?.name ?? DEFAULT_TEMPLATE_NAME)
        )
      }
    } catch (err) {
      console.error('Failed to delete template:', err)
      setMessage({ type: 'error', text: t('settings.errDeleteFailed') })
    } finally {
      setIsDeletingTemplate(false)
    }
  }

  const handleClearMemory = async () => {
    if (!currentConversationId) return
    setIsMemoryLoading(true)
    try {
      const ok = await clearConversationMemory(currentConversationId)
      if (ok) {
        setMemoryItems([])
      }
    } catch (err) {
      console.error('Failed to clear memory:', err)
    } finally {
      setIsMemoryLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--app-overlay)] p-4 backdrop-blur-sm sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      onClick={onClose}
    >
      <div
        className={cn(
          'flex max-h-[min(85vh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl',
          'border border-[color:var(--app-border-strong)] bg-[var(--app-surface)] shadow-2xl shadow-[var(--app-shadow-modal)]'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[color:var(--app-border-strong)] px-5 py-4">
          <h2 id="settings-title" className="text-lg font-semibold tracking-tight text-[var(--app-fg)]">
            {t('settings.title')}
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 rounded-full text-[var(--app-muted)] hover:bg-[var(--app-hover-strong)] hover:text-[var(--app-fg)]"
            onClick={onClose}
            aria-label={t('settings.close')}
          >
            <X size={20} />
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {message && (
            <div
              className={cn(
                'mb-5 rounded-xl border px-3 py-2.5 text-sm',
                message.type === 'success'
                  ? 'border-green-500/30 bg-green-500/10 text-green-300'
                  : 'border-red-500/30 bg-red-500/10 text-red-300'
              )}
            >
              {message.text}
            </div>
          )}

          <div className="space-y-6">
            <section className="space-y-3 rounded-xl border border-[color:var(--app-border-strong)] bg-[var(--app-subtle-section)] p-4">
              <div className="space-y-2">
                <Label className="text-[var(--app-fg)]">{t('settings.language')}</Label>
                <Select
                  value={config.locale ?? 'zh-CN'}
                  onValueChange={(value) =>
                    handleUpdateGlobal('locale', value as GlobalSettings['locale'])
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper" sideOffset={6} align="start">
                    <SelectItem value="zh-CN">{t('settings.langZh')}</SelectItem>
                    <SelectItem value="en-US">{t('settings.langEn')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </section>

            <section className="space-y-3 rounded-xl border border-[color:var(--app-border-strong)] bg-[var(--app-subtle-section)] p-4">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-[var(--app-fg)]">{t('settings.memorySection')}</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs text-[var(--app-muted)] hover:bg-[var(--app-hover-strong)] hover:text-[var(--app-fg)]"
                  onClick={handleClearMemory}
                  disabled={!currentConversationId || isMemoryLoading || memoryItems.length === 0}
                >
                  {t('settings.memoryClear')}
                </Button>
              </div>
              {!currentConversationId ? (
                <p className="text-xs leading-relaxed text-[var(--app-muted)]">{t('settings.memoryPickConv')}</p>
              ) : isMemoryLoading ? (
                <p className="text-xs text-[var(--app-muted)]">{t('settings.memoryLoading')}</p>
              ) : memoryItems.length === 0 ? (
                <p className="text-xs text-[var(--app-muted)]">{t('settings.memoryEmpty')}</p>
              ) : (
                <div className="max-h-36 space-y-2 overflow-y-auto pr-1">
                  {memoryItems.slice(0, 12).map((item, idx) => (
                    <div
                      key={`${idx}_${item.slice(0, 24)}`}
                      className="rounded-lg border border-[color:var(--app-border-strong)] bg-[var(--app-input-bg)] px-3 py-2 text-xs leading-snug text-[var(--app-fg)]"
                    >
                      {item}
                    </div>
                  ))}
                  {memoryItems.length > 12 && (
                    <p className="text-[11px] text-[var(--app-muted)]">
                      {t('settings.memorySummary', { shown: 12, total: memoryItems.length })}
                    </p>
                  )}
                </div>
              )}
            </section>

            <section className="space-y-3 rounded-xl border border-[color:var(--app-border-strong)] bg-[var(--app-subtle-section)] p-4">
              <div className="space-y-1">
                <Label className="text-[var(--app-fg)]">{t('settings.pluginsSection')}</Label>
                <p className="text-xs leading-relaxed text-[var(--app-muted)]">{t('settings.pluginsHint')}</p>
              </div>
              {pluginsError === 'bridge' && (
                <p className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  {t('settings.pluginsBridgeMissing')}
                </p>
              )}
              {pluginsError === 'ipc' && !pluginsLoading && (
                <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                  {t('settings.pluginsIpcFailed')}
                </p>
              )}
              {pluginsLoading ? (
                <p className="text-xs text-[var(--app-muted)]">{t('settings.pluginsLoading')}</p>
              ) : plugins.length === 0 && !pluginsError ? (
                <p className="text-xs text-[var(--app-muted)]">{t('settings.pluginsEmpty')}</p>
              ) : plugins.length === 0 ? null : (
                <ul className="space-y-3">
                  {plugins.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-[color:var(--app-border-strong)] bg-[var(--app-input-bg)] px-3 py-2.5"
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-[var(--app-fg)]">{p.name}</span>
                        </div>
                        <p className="truncate text-[11px] text-[var(--app-muted)]">
                          {p.id} · v{p.version}
                        </p>
                        {p.error ? (
                          <p className="text-[11px] leading-snug text-amber-600 dark:text-amber-400">
                            {p.error}
                          </p>
                        ) : null}
                      </div>
                      <Switch
                        checked={p.enabled}
                        onCheckedChange={(v) => handlePluginToggle(p.id, v)}
                        aria-label={`${p.name} enabled`}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-4">
              <div className="space-y-2">
                <Label className="text-[var(--app-fg)]">{t('settings.appearance')}</Label>
                <Select
                  value={config.theme ?? 'dark'}
                  onValueChange={(value) =>
                    handleUpdateGlobal('theme', value as GlobalSettings['theme'])
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('settings.themePlaceholder')} />
                  </SelectTrigger>
                  <SelectContent position="popper" sideOffset={6} align="start">
                    <SelectItem value="dark">{t('settings.themeDark')}</SelectItem>
                    <SelectItem value="light">{t('settings.themeLight')}</SelectItem>
                    <SelectItem value="auto">{t('settings.themeAuto')}</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-[var(--app-muted)]">{t('settings.themeHint')}</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="settings-api-key" className="text-[var(--app-fg)]">
                  {t('settings.apiKey')}
                </Label>
                <Input
                  id="settings-api-key"
                  type="password"
                  value={config.apiKey}
                  onChange={(e) => handleUpdateGlobal('apiKey', e.target.value)}
                  placeholder={t('settings.apiKeyPlaceholder')}
                  autoComplete="off"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="settings-model" className="text-[var(--app-fg)]">
                  {t('settings.model')}
                </Label>
                <Input
                  id="settings-model"
                  type="text"
                  value={config.model}
                  onChange={(e) => handleUpdateGlobal('model', e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="settings-base-url" className="text-[var(--app-fg)]">
                  {t('settings.baseUrl')}
                </Label>
                <Input
                  id="settings-base-url"
                  type="text"
                  value={config.baseURL || ''}
                  onChange={(e) => handleUpdateGlobal('baseURL', e.target.value)}
                  placeholder={t('settings.baseUrlPlaceholder')}
                />
              </div>

              <div className="space-y-2">
                <Label className="text-[var(--app-fg)]">{t('settings.personaTemplate')}</Label>
                {templates.length > 0 && templateSelectValue ? (
                  <Select
                    value={templateSelectValue}
                    onValueChange={(value) => {
                      if (value === '__add_template__') {
                        openAddTemplate()
                        return
                      }
                      const sel =
                        templates.find((x) => x.id === value) ??
                        templates.find((x) => !x.isBuiltIn && x.name === value)
                      if (sel) {
                        handleUpdateGlobal(
                          'defaultTemplateName',
                          sel.isBuiltIn ? sel.id : sel.name
                        )
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t('settings.templatePlaceholder')} />
                    </SelectTrigger>
                    <SelectContent position="popper" sideOffset={6} align="start" className="min-w-[var(--radix-select-trigger-width)]">
                      {templates.map((tm) =>
                        tm.isBuiltIn ? (
                          <SelectItem key={tm.id} value={tm.id}>
                            {t(`templates.builtin.${builtinKeyFromId(tm.id)}.name`)}
                          </SelectItem>
                        ) : (
                          <SelectItem
                            key={tm.id}
                            value={tm.name}
                            textValue={tm.name}
                            trailing={
                              <button
                                type="button"
                                className="rounded-md p-1.5 text-[var(--app-muted)] outline-none transition-colors hover:bg-red-500/15 hover:text-red-400 focus-visible:ring-2 focus-visible:ring-[color:var(--app-focus-ring)] focus-visible:ring-offset-0"
                                aria-label={t('settings.deleteTemplateAria', { name: tm.name })}
                                onPointerDown={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                }}
                                onClick={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  setTemplateToDelete(tm)
                                }}
                              >
                                <Trash2 size={14} strokeWidth={2} />
                              </button>
                            }
                          >
                            {tm.name}
                          </SelectItem>
                        )
                      )}
                      <div className="my-1 h-px bg-[color:var(--app-border-strong)]" />
                      <SelectItem value="__add_template__">{t('settings.addTemplate')}</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-xs text-[var(--app-muted)]">{t('settings.templateLoading')}</p>
                )}
                <p className="text-xs text-[var(--app-muted)]">{t('settings.templateHint')}</p>
              </div>
            </section>

            <section className="space-y-5 border-t border-[color:var(--app-border-strong)] pt-5">
              <div className="space-y-3">
                <div className="flex items-baseline justify-between gap-2">
                  <Label className="text-[var(--app-fg)]">{t('settings.proactiveInterval')}</Label>
                  <span className="text-xs tabular-nums text-[var(--app-muted)]">
                    {config.defaultProactiveInterval || 60} {t('settings.seconds')}
                  </span>
                </div>
                <Slider
                  min={30}
                  max={300}
                  step={10}
                  value={[config.defaultProactiveInterval || 60]}
                  onValueChange={([value]) => handleUpdateGlobal('defaultProactiveInterval', value)}
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-baseline justify-between gap-2">
                  <Label className="text-[var(--app-fg)]">{t('settings.maxTriggers')}</Label>
                  <span className="text-xs tabular-nums text-[var(--app-muted)]">
                    {config.defaultMaxTriggers || 3}
                  </span>
                </div>
                <Slider
                  min={1}
                  max={5}
                  value={[config.defaultMaxTriggers || 3]}
                  onValueChange={([value]) => handleUpdateGlobal('defaultMaxTriggers', value)}
                />
              </div>


              <div className="flex items-center justify-between gap-4 rounded-xl border border-[color:var(--app-border-strong)] bg-[var(--app-subtle-section)] px-4 py-3">
                <Label htmlFor="settings-proactive" className="cursor-pointer text-[var(--app-fg)]">
                  {t('settings.proactiveToggle')}
                </Label>
                <Switch
                  id="settings-proactive"
                  checked={config.proactiveEnabled ?? true}
                  onCheckedChange={(checked) => handleUpdateGlobal('proactiveEnabled', checked)}
                />
              </div>
            </section>
          </div>
        </div>

        <footer className="shrink-0 space-y-2 border-t border-[color:var(--app-border-strong)] bg-[var(--app-surface-footer)] px-5 py-4 backdrop-blur-sm">
          <Button
            type="button"
            onClick={handleValidate}
            disabled={isValidating || !config.apiKey}
            className="w-full gap-2"
          >
            {isValidating ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Check size={18} />
            )}
            {t('settings.validateSave')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={handleSave}
            disabled={isSaving}
            className="w-full"
          >
            {isSaving ? t('settings.saving') : t('settings.saveOnly')}
          </Button>
        </footer>
      </div>

      {templateToDelete && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--app-overlay)] p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-template-title"
          onClick={() => {
            if (!isDeletingTemplate) setTemplateToDelete(null)
          }}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-2xl border border-[color:var(--app-border-strong)] bg-[var(--app-surface)] shadow-2xl shadow-[var(--app-shadow-modal)]"
            onClick={(e) => e.stopPropagation()}
          >
                       <header className="border-b border-[color:var(--app-border-strong)] px-5 py-4">
              <h3 id="delete-template-title" className="text-base font-semibold text-[var(--app-fg)]">
                {t('settings.deleteTemplateTitle')}
              </h3>
            </header>
            <div className="px-5 py-4">
              <p className="text-sm text-[var(--app-muted)]">
                {t('settings.deleteTemplateConfirm', { name: templateToDelete.name })}
              </p>
            </div>
            <footer className="flex items-center justify-end gap-2 border-t border-[color:var(--app-border-strong)] bg-[var(--app-surface-footer)] px-5 py-4">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setTemplateToDelete(null)}
                disabled={isDeletingTemplate}
              >
                {t('sidebar.cancel')}
              </Button>
              <Button
                type="button"
                disabled={isDeletingTemplate}
                className="bg-red-600 text-white hover:bg-red-500"
                onClick={() => void handleConfirmDeleteTemplate()}
              >
                {isDeletingTemplate ? t('settings.deleting') : t('settings.deleteLabel')}
              </Button>
            </footer>
          </div>
        </div>
      )}

      {isAddTemplateOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--app-overlay)] p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={t('settings.addTemplateTitle')}
          onClick={() => setIsAddTemplateOpen(false)}
        >
          <div
            className="w-full max-w-lg overflow-hidden rounded-2xl border border-[color:var(--app-border-strong)] bg-[var(--app-surface)] shadow-2xl shadow-[var(--app-shadow-modal)]"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between gap-3 border-b border-[color:var(--app-border-strong)] px-5 py-4">
              <h3 className="text-base font-semibold tracking-tight text-[var(--app-fg)]">
                {t('settings.addTemplateTitle')}
              </h3>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0 rounded-full text-[var(--app-muted)] hover:bg-[var(--app-hover-strong)] hover:text-[var(--app-fg)]"
                onClick={() => setIsAddTemplateOpen(false)}
                aria-label={t('settings.close')}
              >
                <X size={20} />
              </Button>
            </header>

            <div className="space-y-4 px-5 py-4">
              {addTemplateError && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
                  {addTemplateError}
                </div>
              )}

              <div className="space-y-2">
                <Label className="text-[var(--app-fg)]">{t('settings.templateName')}</Label>
                <Input
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  placeholder={t('settings.templateNamePh')}
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <Label className="text-[var(--app-fg)]">{t('settings.rolePrompt')}</Label>
                <textarea
                  value={newRolePrompt}
                  onChange={(e) => setNewRolePrompt(e.target.value)}
                  placeholder={t('settings.rolePromptPh')}
                  rows={6}
                  className={cn(
                    'w-full resize-y rounded-xl border border-[color:var(--app-input-border)] bg-[var(--app-input-bg)] px-4 py-3 text-base text-[var(--app-input-fg)] outline-none placeholder:text-[var(--app-muted-fg)] transition-colors',
                    'focus-visible:ring-2 focus-visible:ring-[color:var(--app-focus-ring)] focus-visible:ring-offset-0'
                  )}
                />
                <p className="text-xs text-[var(--app-muted)]">{t('settings.rolePromptHint')}</p>
              </div>
            </div>

            <footer className="flex items-center justify-end gap-2 border-t border-[color:var(--app-border-strong)] bg-[var(--app-surface-footer)] px-5 py-4">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setIsAddTemplateOpen(false)}
                disabled={isCreatingTemplate}
              >
                {t('sidebar.cancel')}
              </Button>
              <Button type="button" onClick={handleCreateTemplate} disabled={isCreatingTemplate}>
                {isCreatingTemplate ? t('settings.creating') : t('settings.create')}
              </Button>
            </footer>
          </div>
        </div>
      )}
    </div>
  )
}
