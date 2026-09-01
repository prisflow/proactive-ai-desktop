import { create } from 'zustand'
import type { GlobalSettings } from '@shared'
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
      // 清空全部配置（null = 未设置），不再注入 DEFAULT 值
      const config = await setConfigApi({
        apiKey: null,
        model: null,
        baseURL: null,
        theme: null,
        fontSize: null,
        locale: null,
      })
      set({ config })
    },
  })
)
