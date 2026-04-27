import {
  ChatMessage,
  UserConfig,
  ChatResponse,
  GlobalSettings,
  PromptTemplate,
  Conversation,
  PluginListEntry,
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
      }
      pavatar: {
        listPacks: () => Promise<import('@shared').PAvatarPackResolved[]>
        getActivePack: () => Promise<import('@shared').PAvatarPackResolved | null>
        setActivePack: (packId: string, version: string) => Promise<boolean>
        onActivePackChanged: (cb: (x: { packId: string; version: string }) => void) => () => void
      }
      window: {
        minimize: () => Promise<void>
        maximizeToggle: () => Promise<void>
        close: () => Promise<void>
      }
      chat: {
        send: (
          message: string,
          history: ChatMessage[],
          importantInfo: string[],
          conversationId?: string
        ) => Promise<ChatResponse>
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

export async function sendMessage(
  message: string,
  history: ChatMessage[],
  importantInfo: string[],
  conversationId?: string
): Promise<ChatResponse> {
  const response = await window.electronAPI.chat.send(
    message,
    history,
    importantInfo,
    conversationId
  )
  return response
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

