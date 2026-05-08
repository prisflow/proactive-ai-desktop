/** Set PROACTIVE_DEBUG_PLUGIN_ASSETS=1 for extra logs (e.g. every plugin-asset:// request). */
export function isPluginAssetsDebug(): boolean {
  return (
    process.env.PROACTIVE_DEBUG_PLUGIN_ASSETS === '1' || process.env.NODE_ENV === 'development'
  )
}

export function isPluginAssetsVerbose(): boolean {
  return process.env.PROACTIVE_DEBUG_PLUGIN_ASSETS === '1'
}

export function pluginAssetsMainLog(...args: unknown[]): void {
  if (isPluginAssetsDebug()) console.log('[plugin-assets:main]', ...args)
}

export function pluginAssetsMainVerbose(...args: unknown[]): void {
  if (isPluginAssetsVerbose()) console.log('[plugin-assets:main:verbose]', ...args)
}
