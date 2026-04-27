import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  plugins: {
    onDispatch: (cb: (message: any) => void) => {
      const handler = (_ev: any, message: any) => cb(message)
      ipcRenderer.on('plugin:dispatch', handler)
      return () => ipcRenderer.removeListener('plugin:dispatch', handler)
    },
    list: (): Promise<any[]> => ipcRenderer.invoke('plugins:list'),
    setEnabled: (pluginId: string, enabled: boolean): Promise<boolean> =>
      ipcRenderer.invoke('plugins:setEnabled', pluginId, enabled),
    onPreferencesChanged: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on('plugins:preferencesChanged', handler)
      return () => ipcRenderer.removeListener('plugins:preferencesChanged', handler)
    },
  },
  pavatar: {
    listPacks: (): Promise<any[]> => ipcRenderer.invoke('pavatar:listPacks'),
    getActivePack: (): Promise<any | null> => ipcRenderer.invoke('pavatar:getActivePack'),
    setActivePack: (packId: string, version: string): Promise<boolean> =>
      ipcRenderer.invoke('pavatar:setActivePack', packId, version),
    onActivePackChanged: (cb: (x: { packId: string; version: string }) => void) => {
      const handler = (_ev: any, payload: any) => cb(payload)
      ipcRenderer.on('pavatar:activePackChanged', handler)
      return () => ipcRenderer.removeListener('pavatar:activePackChanged', handler)
    },
  },
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
