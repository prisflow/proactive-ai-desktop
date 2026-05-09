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
    getConfig: (pluginId: string): Promise<Record<string, unknown>> =>
      ipcRenderer.invoke('plugins:getConfig', pluginId),
    setConfig: (pluginId: string, config: Record<string, unknown>): Promise<boolean> =>
      ipcRenderer.invoke('plugins:setConfig', pluginId, config),
    getManifest: (pluginId: string): Promise<unknown> =>
      ipcRenderer.invoke('plugins:getManifest', pluginId),
    getResolvedAssetPack: (pluginId: string): Promise<unknown> =>
      ipcRenderer.invoke('plugins:getResolvedAssetPack', pluginId),
    getDiagnostics: (): Promise<unknown> => ipcRenderer.invoke('plugins:getDiagnostics'),
    callTool: (
      toolName: string,
      input: unknown,
      actor?: 'user' | 'agent' | 'system'
    ): Promise<{ ok: true; result: unknown } | { ok: false; error: string; blocked?: boolean }> =>
      ipcRenderer.invoke('plugins:callTool', toolName, input, actor),
    installFromGithub: (
      github: string,
      ref?: string
    ): Promise<
      { ok: true; pluginId: string; version: string } | { ok: false; error: string }
    > => ipcRenderer.invoke('plugins:installFromGithub', { github, ref }),
    installFromUrl: (
      url: string
    ): Promise<{ ok: true; pluginId: string; version: string } | { ok: false; error: string }> =>
      ipcRenderer.invoke('plugins:installFromUrl', { url }),
    installFromRelease: (
      github: string,
      tag: string,
      asset: string
    ): Promise<{ ok: true; pluginId: string; version: string } | { ok: false; error: string }> =>
      ipcRenderer.invoke('plugins:installFromRelease', { github, tag, asset }),
    onToast: (
      cb: (payload: { v: 1; type: 'info' | 'success' | 'warning' | 'error'; text: string }) => void
    ) => {
      const handler = (_ev: unknown, payload: unknown) => cb(payload as any)
      ipcRenderer.on('app:toast', handler)
      return () => ipcRenderer.removeListener('app:toast', handler)
    },
  },
  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
    maximizeToggle: (): Promise<void> => ipcRenderer.invoke('window:maximize-toggle'),
    close: (): Promise<void> => ipcRenderer.invoke('window:close'),
  },
  agent: {
    submitUserText: (opts: {
      conversationId: string
      text: string
      userMessageId?: string
    }): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('agent:submitUserText', opts),
    onPush: (cb: (payload: unknown) => void) => {
      const handler = (_ev: unknown, payload: unknown) => cb(payload)
      ipcRenderer.on('agent:push', handler)
      return () => ipcRenderer.removeListener('agent:push', handler)
    },
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
