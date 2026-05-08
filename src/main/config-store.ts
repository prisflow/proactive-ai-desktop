import Store from 'electron-store'
import { GlobalSettings } from '../shared/types'
import {
  DEFAULT_MODEL,
  DEFAULT_BASE_URL,
  DEFAULT_PROACTIVE_INTERVAL,
  DEFAULT_PROACTIVE_ENABLED,
  DEFAULT_TEMPLATE_NAME,
  DEFAULT_THEME,
  DEFAULT_FONT_SIZE,
} from '../shared/constants'
import { DEFAULT_LOCALE } from '../shared/locale'
import { migrateGlobalSettings } from '../shared/template-migration'

const DEFAULT_CONFIG: GlobalSettings = {
  apiKey: '',
  model: DEFAULT_MODEL,
  baseURL: DEFAULT_BASE_URL,
  locale: DEFAULT_LOCALE,
  defaultTemplateName: DEFAULT_TEMPLATE_NAME,
  defaultProactiveInterval: DEFAULT_PROACTIVE_INTERVAL,
  proactiveEnabled: DEFAULT_PROACTIVE_ENABLED,
  theme: DEFAULT_THEME as 'light' | 'dark' | 'auto',
  fontSize: DEFAULT_FONT_SIZE,
}

class ConfigStore {
  private store: Store<GlobalSettings>

  constructor() {
    this.store = new Store<GlobalSettings>({
      name: 'settings',
      defaults: DEFAULT_CONFIG,
    })
  }

  get(): GlobalSettings {
    const raw = (this.store as any).store as GlobalSettings
    return migrateGlobalSettings(raw)
  }

  set(config: GlobalSettings): void {
    const normalized = migrateGlobalSettings(config)
    Object.keys(normalized).forEach(key => {
      (this.store as any).set(key, normalized[key as keyof GlobalSettings])
    })
  }
}

export const configStore = new ConfigStore()
