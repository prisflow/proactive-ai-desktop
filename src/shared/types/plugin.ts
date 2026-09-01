/**
 * 插件管理 —— Main 进程加载/导入、Renderer 展示列表的共享数据模型。
 */

/** zip 导入结果（plugins:importZip）。 */
export interface PluginImportResult {
  ok: boolean
  error?: string
  /** 导入成功时的元数据（尚未加载，故无 entry/loaded）。 */
  plugin?: {
    id: string
    name: string
    version: string
    description?: string
  }
}

/** 已安装插件信息（plugins:list）。 */
export interface PluginInfo {
  id: string
  name: string
  version: string
  description?: string
  entry: string
  loaded: boolean
}

/** 卸载结果（plugins:uninstall）。 */
export interface PluginUninstallResult {
  ok: boolean
  error?: string
}
