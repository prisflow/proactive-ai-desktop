export function pluginAssetsRendererLog(...args: unknown[]): void {
  if (import.meta.env.DEV) console.log('[plugin-assets:renderer]', ...args)
}
