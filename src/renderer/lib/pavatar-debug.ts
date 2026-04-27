export function pavatarRendererLog(...args: unknown[]): void {
  if (import.meta.env.DEV) console.log('[pavatar:renderer]', ...args)
}
