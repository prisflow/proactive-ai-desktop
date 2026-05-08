import {
  ChatMessage,
  GlobalSettings,
  PromptTemplate,
  Conversation,
  AssetPackResolved,
  PluginListEntry,
  PluginManifestV1,
  PluginDiagnostics,
  ToolActor,
  AgentStreamPushV1,
} from '@shared'

declare global {
  interface Window {
    electronAPI: {
      platform: NodeJS.Platform
      plugins: {
        onDispatch: (cb: (message: import('@shared').PluginDispatchMessage) => void) => () => void
        list: () => Promise<PluginListEntry[]>
        setEnabled: (pluginId: string, enabled: boolean) => Promise<boolean>
        onPreferencesChanged: (cb: () => void) => () => void
        getConfig: (pluginId: string) => Promise<Record<string, unknown>>
        setConfig: (pluginId: string, config: Record<string, unknown>) => Promise<boolean>
        getManifest: (pluginId: string) => Promise<import('@shared').PluginManifestV1 | null>
        getResolvedAssetPack: (
          pluginId: string
        ) => Promise<import('@shared').AssetPackResolved | null>
        getDiagnostics: () => Promise<import('@shared').PluginDiagnostics>
        callTool: (
          toolName: string,
          input: unknown,
          actor?: import('@shared').ToolActor
        ) => Promise<{ ok: true; result: unknown } | { ok: false; error: string; blocked?: boolean }>
        installFromGithub: (
          github: string,
          ref?: string
        ) => Promise<
          { ok: true; pluginId: string; version: string } | { ok: false; error: string }
        >
        installFromUrl: (
          url: string
        ) => Promise<{ ok: true; pluginId: string; version: string } | { ok: false; error: string }>
        installFromRelease: (
          github: string,
          tag: string,
          asset: string
        ) => Promise<{ ok: true; pluginId: string; version: string } | { ok: false; error: string }>
        onToast: (
          cb: (payload: { v: 1; type: 'info' | 'success' | 'warning' | 'error'; text: string }) => void
        ) => () => void
      }
      window: {
        minimize: () => Promise<void>
        maximizeToggle: () => Promise<void>
        close: () => Promise<void>
      }
      agent: {
        submitUserText: (opts: {
          conversationId: string
          text: string
          userMessageId?: string
        }) => Promise<{ ok: boolean; error?: string }>
        activityPing: (conversationId: string) => Promise<{ ok: boolean }>
        onPush: (cb: (payload: AgentStreamPushV1) => void) => () => void
      }
      config: {
        get: () => Promise<GlobalSettings>
        set: (config: GlobalSettings) => Promise<boolean>
        validate: (config: GlobalSettings) => Promise<boolean>
      }
      conversations: {
        list: () => Promise<Conversation[]>
        get: (id: string) => Promise<Conversation | undefined>
        create: (title?: string) => Promise<Conversation>
        update: (id: string, updates: Partial<Conversation>) => Promise<boolean>
        delete: (id: string) => Promise<boolean>
      }
      messages: {
        list: (conversationId: string) => Promise<ChatMessage[]>
        clear: (conversationId: string) => Promise<boolean>
      }
      templates: {
        list: () => Promise<PromptTemplate[]>
        create: (template: Omit<PromptTemplate, 'id' | 'createdAt' | 'updatedAt'>) => Promise<PromptTemplate>
        update: (id: string, updates: Partial<PromptTemplate>) => Promise<boolean>
        delete: (id: string) => Promise<boolean>
      }
      memory: {
        list: (conversationId: string) => Promise<string[]>
        clear: (conversationId: string) => Promise<boolean>
      }
    }
  }
}

export async function submitUserText(opts: {
  conversationId: string
  text: string
  userMessageId?: string
}): Promise<{ ok: boolean; error?: string }> {
  return window.electronAPI.agent.submitUserText(opts)
}

export async function agentActivityPing(conversationId: string): Promise<void> {
  void window.electronAPI.agent.activityPing(conversationId)
}

export function subscribeAgentPush(cb: (payload: AgentStreamPushV1) => void): () => void {
  return window.electronAPI.agent.onPush(cb)
}

export async function getConfig(): Promise<GlobalSettings> {
  return window.electronAPI.config.get()
}

export async function saveConfig(config: GlobalSettings): Promise<boolean> {
  return window.electronAPI.config.set(config)
}

export async function validateConfig(config: GlobalSettings): Promise<boolean> {
  return window.electronAPI.config.validate(config)
}

export async function getConversations(): Promise<Conversation[]> {
  return window.electronAPI.conversations.list()
}

export async function getConversation(id: string): Promise<Conversation | undefined> {
  return window.electronAPI.conversations.get(id)
}

export async function createConversation(title?: string): Promise<Conversation> {
  return window.electronAPI.conversations.create(title)
}

export async function updateConversation(id: string, updates: Partial<Conversation>): Promise<boolean> {
  return window.electronAPI.conversations.update(id, updates)
}

export async function deleteConversation(id: string): Promise<boolean> {
  return window.electronAPI.conversations.delete(id)
}

export async function getMessages(conversationId: string): Promise<ChatMessage[]> {
  return window.electronAPI.messages.list(conversationId)
}

export async function clearMessages(conversationId: string): Promise<boolean> {
  return window.electronAPI.messages.clear(conversationId)
}

export async function getTemplates(): Promise<PromptTemplate[]> {
  return window.electronAPI.templates.list()
}

export async function createTemplate(
  template: Omit<PromptTemplate, 'id' | 'createdAt' | 'updatedAt'>
): Promise<PromptTemplate> {
  return window.electronAPI.templates.create(template)
}

export async function updateTemplate(
  id: string,
  updates: Partial<PromptTemplate>
): Promise<boolean> {
  return window.electronAPI.templates.update(id, updates)
}

export async function deleteTemplate(id: string): Promise<boolean> {
  return window.electronAPI.templates.delete(id)
}

export async function getConversationMemory(conversationId: string): Promise<string[]> {
  return window.electronAPI.memory.list(conversationId)
}

export async function clearConversationMemory(conversationId: string): Promise<boolean> {
  return window.electronAPI.memory.clear(conversationId)
}

export async function listPlugins(): Promise<PluginListEntry[]> {
  const listFn = window.electronAPI?.plugins?.list
  if (typeof listFn !== 'function') {
    throw new Error('PRELOAD_PLUGINS_LIST_MISSING')
  }
  const out = await listFn()
  if (!Array.isArray(out)) {
    throw new Error('PLUGINS_LIST_INVALID')
  }
  return out
}

export async function setPluginEnabled(pluginId: string, enabled: boolean): Promise<boolean> {
  const fn = window.electronAPI?.plugins?.setEnabled
  if (typeof fn !== 'function') {
    throw new Error('PRELOAD_PLUGINS_SET_ENABLED_MISSING')
  }
  return fn(pluginId, enabled)
}

export async function getPluginConfig(pluginId: string): Promise<Record<string, unknown>> {
  const fn = window.electronAPI?.plugins?.getConfig
  if (typeof fn !== 'function') throw new Error('PRELOAD_PLUGINS_GET_CONFIG_MISSING')
  return fn(pluginId)
}

export async function setPluginConfig(
  pluginId: string,
  config: Record<string, unknown>
): Promise<boolean> {
  const fn = window.electronAPI?.plugins?.setConfig
  if (typeof fn !== 'function') throw new Error('PRELOAD_PLUGINS_SET_CONFIG_MISSING')
  return fn(pluginId, config)
}

export async function getPluginManifest(pluginId: string): Promise<PluginManifestV1 | null> {
  const fn = window.electronAPI?.plugins?.getManifest
  if (typeof fn !== 'function') throw new Error('PRELOAD_PLUGINS_GET_MANIFEST_MISSING')
  const raw = await fn(pluginId)
  return raw && typeof raw === 'object' ? (raw as PluginManifestV1) : null
}

export async function getPluginResolvedAssetPack(pluginId: string): Promise<AssetPackResolved | null> {
  const fn = window.electronAPI?.plugins?.getResolvedAssetPack
  if (typeof fn !== 'function') return null
  const raw = await fn(pluginId)
  return raw && typeof raw === 'object' ? (raw as AssetPackResolved) : null
}

export async function getPluginDiagnostics(): Promise<PluginDiagnostics> {
  const fn = window.electronAPI?.plugins?.getDiagnostics
  if (typeof fn !== 'function') throw new Error('PRELOAD_PLUGINS_GET_DIAGNOSTICS_MISSING')
  return (await fn()) as PluginDiagnostics
}

export async function callPluginTool(
  toolName: string,
  input: unknown,
  actor: ToolActor = 'user'
): Promise<{ ok: true; result: unknown } | { ok: false; error: string; blocked?: boolean }> {
  const fn = window.electronAPI?.plugins?.callTool
  if (typeof fn !== 'function') throw new Error('PRELOAD_PLUGINS_CALL_TOOL_MISSING')
  return fn(toolName, input, actor)
}

export function subscribeAppToast(
  cb: (payload: { v: 1; type: 'info' | 'success' | 'warning' | 'error'; text: string }) => void
): () => void {
  const fn = window.electronAPI?.plugins?.onToast
  if (typeof fn !== 'function') return () => {}
  return fn(cb)
}

export async function installPluginFromGithub(
  github: string,
  ref?: string
): Promise<{ ok: true; pluginId: string; version: string } | { ok: false; error: string }> {
  const fn = window.electronAPI?.plugins?.installFromGithub
  if (typeof fn !== 'function') return { ok: false, error: 'preload_missing_installFromGithub' }
  return fn(github, ref)
}

export async function installPluginFromUrl(
  url: string
): Promise<{ ok: true; pluginId: string; version: string } | { ok: false; error: string }> {
  const fn = window.electronAPI?.plugins?.installFromUrl
  if (typeof fn !== 'function') return { ok: false, error: 'preload_missing_installFromUrl' }
  return fn(url)
}

export async function installPluginFromRelease(
  github: string,
  tag: string,
  asset: string
): Promise<{ ok: true; pluginId: string; version: string } | { ok: false; error: string }> {
  const fn = window.electronAPI?.plugins?.installFromRelease
  if (typeof fn !== 'function') return { ok: false, error: 'preload_missing_installFromRelease' }
  return fn(github, tag, asset)
}

