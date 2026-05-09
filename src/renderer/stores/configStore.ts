import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { GlobalSettings, DEFAULT_MODEL, DEFAULT_BASE_URL, DEFAULT_TEMPLATE_NAME } from '@shared'
import { getConfig as getConfigAPI, saveConfig as saveConfigAPI, validateConfig as validateConfigAPI } from '../api'
import { syncI18nFromConfig } from '../i18n'

const DEFAULT_CONFIG: GlobalSettings = {
  apiKey: '',
  model: DEFAULT_MODEL,
  baseURL: DEFAULT_BASE_URL,
  locale: 'zh-CN',
  defaultTemplateName: DEFAULT_TEMPLATE_NAME,
  defaultProactiveInterval: 60,
  proactiveEnabled: true,
  theme: 'dark',
  fontSize: 16,
}

interface ConfigStore {
  config: GlobalSettings
  isLoading: boolean
  updateConfig: (config: Partial<GlobalSettings>) => void
  setConfig: (config: GlobalSettings) => void
  resetConfig: () => void
  loadFromStorage: () => void
  loadFromMain: () => Promise<void>
  saveToMain: () => Promise<boolean>
  validateAndSave: () => Promise<boolean>
}

export const useConfigStore = create<ConfigStore>()(
  persist(
    (set, get) => ({
      config: DEFAULT_CONFIG,
      isLoading: false,

      loadFromStorage: () => {
        const saved = localStorage.getItem('proactive-config')
        if (saved) {
          try {
            const parsed = JSON.parse(saved)
            set({ config: { ...DEFAULT_CONFIG, ...parsed } })
          } catch {
            set({ config: DEFAULT_CONFIG })
          }
        }
      },

      loadFromMain: async () => {
        set({ isLoading: true })
        try {
          const config = await getConfigAPI()
          set({ config })
          syncI18nFromConfig(config.locale)
          localStorage.setItem('proactive-config', JSON.stringify(config))
        } catch (error) {
          console.error('Failed to load config from main:', error)
        } finally {
          set({ isLoading: false })
        }
      },

      updateConfig: (newConfig) =>
        set((state) => {
          const config = { ...state.config, ...newConfig }
          if (Object.prototype.hasOwnProperty.call(newConfig, 'locale')) {
            syncI18nFromConfig(config.locale)
          }
          return { config }
        }),

      setConfig: (config) => set({ config }),

      resetConfig: () => set({ config: DEFAULT_CONFIG }),

      saveToMain: async () => {
        const { config } = get()
        try {
          await saveConfigAPI(config)
          localStorage.setItem('proactive-config', JSON.stringify(config))
          return true
        } catch (error) {
          console.error('Failed to save config:', error)
          return false
        }
      },

      validateAndSave: async () => {
        const { config } = get()
        try {
          await validateConfigAPI(config)
          await saveConfigAPI(config)
          localStorage.setItem('proactive-config', JSON.stringify(config))
          return true
        } catch (error) {
          console.error('Failed to validate config:', error)
          return false
        }
      },
    }),
    {
      name: 'config-storage',
      partialize: (state) => ({ config: state.config }),
    }
  )
)
