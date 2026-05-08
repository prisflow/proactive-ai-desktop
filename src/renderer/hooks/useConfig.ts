import { useConfigStore } from '../stores/configStore'
import { GlobalSettings } from '@shared'

interface UseConfigReturn {
  config: GlobalSettings
  updateConfig: (config: Partial<GlobalSettings>) => void
  resetConfig: () => void
}

export function useConfig(): UseConfigReturn {
  const { config, updateConfig, resetConfig, saveToMain } = useConfigStore()

  const handleUpdateConfig = (newConfig: Partial<GlobalSettings>) => {
    updateConfig(newConfig)
    void saveToMain()
  }

  const handleResetConfig = () => {
    resetConfig()
    void saveToMain()
  }

  return {
    config,
    updateConfig: handleUpdateConfig,
    resetConfig: handleResetConfig,
  }
}
