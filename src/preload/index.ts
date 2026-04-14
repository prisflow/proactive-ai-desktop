import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
    maximizeToggle: (): Promise<void> => ipcRenderer.invoke('window:maximize-toggle'),
    close: (): Promise<void> => ipcRenderer.invoke('window:close'),
  },
  chat: {
    send: (
      message: string,
      history: any[],
      importantInfo: string[],
      conversationId?: string
    ): Promise<any> =>
      ipcRenderer.invoke('chat:send', message, history, importantInfo, conversationId),
  },
  config: {
    get: (): Promise<any> =>
      ipcRenderer.invoke('config:get'),
    set: (config: any): Promise<boolean> =>
      ipcRenderer.invoke('config:set', config),
    validate: (config: any): Promise<boolean> =>
      ipcRenderer.invoke('config:validate', config),
  },
  conversations: {
    list: (): Promise<any[]> =>
      ipcRenderer.invoke('conversations:list'),
    get: (id: string): Promise<any> =>
      ipcRenderer.invoke('conversations:get', id),
    create: (title?: string): Promise<any> =>
      ipcRenderer.invoke('conversations:create', title),
    update: (id: string, updates: any): Promise<boolean> =>
      ipcRenderer.invoke('conversations:update', id, updates),
    delete: (id: string): Promise<boolean> =>
      ipcRenderer.invoke('conversations:delete', id),
  },
  messages: {
    list: (conversationId: string): Promise<any[]> =>
      ipcRenderer.invoke('messages:list', conversationId),
    clear: (conversationId: string): Promise<boolean> =>
      ipcRenderer.invoke('messages:clear', conversationId),
  },
  templates: {
    list: (): Promise<any[]> =>
      ipcRenderer.invoke('templates:list'),
    create: (template: any): Promise<any> =>
      ipcRenderer.invoke('templates:create', template),
    update: (id: string, updates: any): Promise<boolean> =>
      ipcRenderer.invoke('templates:update', id, updates),
    delete: (id: string): Promise<boolean> =>
      ipcRenderer.invoke('templates:delete', id),
  },
  memory: {
    list: (conversationId: string): Promise<string[]> =>
      ipcRenderer.invoke('memory:list', conversationId),
    clear: (conversationId: string): Promise<boolean> =>
      ipcRenderer.invoke('memory:clear', conversationId),
  },
})

export type ElectronAPI = typeof window.electronAPI
