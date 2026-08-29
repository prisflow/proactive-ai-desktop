import { create } from 'zustand'
import type { GlobalSettings } from '@shared'
import { DEFAULT_MODEL, DEFAULT_BASE_URL, DEFAULT_THEME, DEFAULT_FONT_SIZE } from '@shared/constants'
import { getConfig as getConfigApi, setConfig as setConfigApi } from '../api'
import { syncI18nFromConfig } from '../i18n'

interface ConfigStore {
  config: GlobalSettings
  loaded: boolean
  loadConfig: () => Promise<void>
  updateConfig: (config: Partial<GlobalSettings>) => Promise<void>
  resetConfig: () => Promise<void>
}

export const useConfigStore = create<ConfigStore>()(
  (set) => ({
    config: {} as GlobalSettings,
    loaded: false,

    loadConfig: async () => {
      const config = await getConfigApi()
      syncI18nFromConfig(config.locale)
      set({ config, loaded: true })
    },

    updateConfig: async (newConfig) => {
      const config = await setConfigApi(newConfig)
      set({ config })
    },

    resetConfig: async () => {
      const config = await setConfigApi({
        apiKey: '',
        model: DEFAULT_MODEL,
        baseURL: DEFAULT_BASE_URL,
        theme: DEFAULT_THEME,
        fontSize: DEFAULT_FONT_SIZE,
      })
      set({ config })
    },
  })
)
