import Store from 'electron-store'

const DEFAULT_ENABLED = ['com.proactiveai.pavatar'] as const

export interface PluginPreferences {
  enabled: string[]
  config: Record<string, Record<string, unknown>>
}

const DEFAULTS: PluginPreferences = {
  enabled: [...DEFAULT_ENABLED],
  config: {},
}

/** electron-store 不会在已有 `enabled` 数组上合并新的默认值；旧配置里若缺少内置 pavatar，补一次。 */
const MERGE_PAVATAR_FLAG = '__merge_builtin_pavatar_v1' as const

class PluginPreferencesStore {
  private store: Store<PluginPreferences>

  constructor() {
    this.store = new Store<PluginPreferences>({
      name: 'plugin-preferences',
      defaults: DEFAULTS,
    })
    this.ensureBuiltinPavatarInEnabledOnce()
  }

  private ensureBuiltinPavatarInEnabledOnce(): void {
    const st = this.store as any
    if (st.get(MERGE_PAVATAR_FLAG, false)) return
    st.set(MERGE_PAVATAR_FLAG, true)
    const enabled = st.get('enabled', []) as unknown
    if (!Array.isArray(enabled)) return
    const list = enabled.filter((x) => typeof x === 'string') as string[]
    if (list.includes('com.proactiveai.pavatar')) return
    st.set('enabled', [...list, 'com.proactiveai.pavatar'])
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
}

export const pluginPreferencesStore = new PluginPreferencesStore()
export { DEFAULT_ENABLED }
