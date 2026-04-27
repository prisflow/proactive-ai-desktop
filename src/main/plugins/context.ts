import type { ChatMessage, GlobalSettings } from '../../shared/types'

export type PluginPermission =
  | 'messages.read'
  | 'fs.writesDownloads'
  | 'clipboard.write'
  | 'config.read'
  | 'ui.dispatch'

export interface PluginContext {
  getMessages?: (conversationId: string) => ChatMessage[]
  writeToDownloads?: (filename: string, content: string) => Promise<void>
  getPublicSettings?: () => Omit<GlobalSettings, 'apiKey'> & { apiKey?: undefined }
  dispatchToRenderer?: (message: import('../../shared/types').PluginDispatchMessage) => void
}

export interface PluginContextDeps {
  getMessages: (conversationId: string) => ChatMessage[]
  writeToDownloads: (filename: string, content: string) => Promise<void>
  getPublicSettings: () => Omit<GlobalSettings, 'apiKey'> & { apiKey?: undefined }
  dispatchToRenderer: (message: import('../../shared/types').PluginDispatchMessage) => void
}

export function createPluginContext(
  permissions: PluginPermission[],
  deps: PluginContextDeps
): PluginContext {
  const ctx: PluginContext = {}
  const set = new Set(permissions)
  if (set.has('messages.read')) {
    ctx.getMessages = deps.getMessages
  }
  if (set.has('fs.writesDownloads')) {
    ctx.writeToDownloads = deps.writeToDownloads
  }
  if (set.has('config.read')) {
    ctx.getPublicSettings = deps.getPublicSettings
  }
  if (set.has('ui.dispatch')) {
    ctx.dispatchToRenderer = deps.dispatchToRenderer
  }
  return ctx
}
