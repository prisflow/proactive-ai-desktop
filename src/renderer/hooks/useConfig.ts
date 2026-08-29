import { useConfigStore } from '../stores/configStore'
import { GlobalSettings } from '@shared'

interface UseConfigReturn {
  config: GlobalSettings
  updateConfig: (config: Partial<GlobalSettings>) => void
  resetConfig: () => void
}

/**
 * 全局配置读写 hook。
 * 通过 configStore 走 IPC 与 Main 进程 SQLite 同步。
 */
export function useConfig(): UseConfigReturn {
  const { config, updateConfig, resetConfig } = useConfigStore()

  return {
    config,
    updateConfig,
    resetConfig,
  }
}
