import Store from 'electron-store'

const DEFAULT_ENABLED: string[] = []

export interface PluginPreferences {
  enabled: string[]
  config: Record<string, Record<string, unknown>>
}

const DEFAULTS: PluginPreferences = {
  enabled: [...DEFAULT_ENABLED],
  config: {},
}

class PluginPreferencesStore {
  private store: Store<PluginPreferences>

  constructor() {
    this.store = new Store<PluginPreferences>({
      name: 'plugin-preferences',
      defaults: DEFAULTS,
    })
  }

  get(): PluginPreferences {
    const raw = (this.store as any).store as PluginPreferences
    if (!Array.isArray(raw.enabled)) {
      return { ...DEFAULTS }
    }
    return raw
  }

  setPluginEnabled(pluginId: string, enabled: boolean): void {
    const cur = this.get().enabled.filter(Boolean)
    if (enabled) {
      if (!cur.includes(pluginId)) {
        ;(this.store as any).set('enabled', [...cur, pluginId])
      }
    } else {
      ;(this.store as any).set(
        'enabled',
        cur.filter((id) => id !== pluginId)
      )
    }
  }

  isEnabled(pluginId: string): boolean {
    return this.get().enabled.includes(pluginId)
  }

  getPluginConfig(pluginId: string): Record<string, unknown> {
    const cur = this.get()
    return (cur.config && cur.config[pluginId]) || {}
  }

  setPluginConfig(pluginId: string, next: Record<string, unknown>): void {
    const cur = this.get()
    const config = { ...(cur.config || {}) }
    config[pluginId] = { ...(next || {}) }
    ;(this.store as any).set('config', config)
  }

  /** 去掉未安装插件的启用项与配置，避免历史 id 残留 */
  pruneToInstalledPluginIds(installedIds: ReadonlySet<string>): void {
    const cur = this.get()
    let enabled = cur.enabled.filter((id) => installedIds.has(id))
    if (enabled.length === 0 && installedIds.size > 0 && cur.enabled.length > 0) {
      enabled = [...installedIds].sort((a, b) => a.localeCompare(b))
    }
    const config: Record<string, Record<string, unknown>> = {}
    const rawCfg = cur.config || {}
    for (const id of installedIds) {
      if (rawCfg[id]) config[id] = { ...rawCfg[id] }
    }
    ;(this.store as any).set('enabled', enabled)
    ;(this.store as any).set('config', config)
  }
}

export const pluginPreferencesStore = new PluginPreferencesStore()
export { DEFAULT_ENABLED }
