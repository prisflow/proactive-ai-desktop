/** Set PROACTIVE_DEBUG_PAVATAR=1 for extra logs (e.g. every pavatar:// request). */
export function isPavatarDebug(): boolean {
  return (
    process.env.PROACTIVE_DEBUG_PAVATAR === '1' || process.env.NODE_ENV === 'development'
  )
}

export function isPavatarVerbose(): boolean {
  return process.env.PROACTIVE_DEBUG_PAVATAR === '1'
}

export function pavatarMainLog(...args: unknown[]): void {
  if (isPavatarDebug()) console.log('[pavatar:main]', ...args)
}

export function pavatarMainVerbose(...args: unknown[]): void {
  if (isPavatarVerbose()) console.log('[pavatar:main:verbose]', ...args)
}
