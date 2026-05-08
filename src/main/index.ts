import { app, BrowserWindow, ipcMain, Menu } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import { configStore } from './config-store'
import { createAgentRuntime } from './agent/orchestrator'
import { CORE_EVENT, createAgentEvent } from '../shared/agent-events'
import type { AgentStreamPushV1 } from '../shared/types'
import { templateStore } from './template-store'
import { conversationStore } from './conversation-store'
import { messageStore } from './message-store'
import {
  GlobalSettings,
  Conversation,
  ChatMessage,
  PromptTemplate,
} from '../shared/types'
import { normalizeLocale, defaultConversationTitle } from '../shared/locale'
import { pluginRegistry } from './plugins/registry'
import { seedBundledPluginsIfNeeded } from './plugins/bundled-seed'
import {
  installPluginFromGithub,
  installPluginFromUrl,
  githubReleaseAssetUrl,
  parseGithubPluginSpec,
} from './plugins/install-from-github'
import {
  ensurePluginAssetPacksDir,
  getActiveAssetPackResolved,
  registerPluginAssetProtocol,
} from './plugin-assets/pack-store'
import { pluginPreferencesStore } from './plugin-preferences-store'
import type { PluginListEntry, ToolActor } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let agentRuntime: ReturnType<typeof createAgentRuntime> | null = null

function pushAgentStream(p: AgentStreamPushV1): void {
  mainWindow?.webContents.send('agent:push', p)
}

const WINDOW_TITLE = 'ProactiveAI'

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: WINDOW_TITLE,
    frame: false,
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hidden' as const,
          trafficLightPosition: { x: 12, y: 14 },
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin') {
    app.setName(WINDOW_TITLE)
  }
  Menu.setApplicationMenu(null)
  templateStore.init()
  registerPluginAssetProtocol()
  await ensurePluginAssetPacksDir()
  await seedBundledPluginsIfNeeded()
  agentRuntime = createAgentRuntime(pushAgentStream)
  pluginRegistry.setAgentBridge({
    enqueueEvent: (envelope) => agentRuntime!.bus.enqueue(envelope),
    registerHook: (mountPoint, handler) => agentRuntime!.hooks.register(mountPoint, handler),
  })
  pluginRegistry.setRendererDispatcher((message) => {
    mainWindow?.webContents.send('plugin:dispatch', message)
  })
  pluginRegistry.setToastDispatcher((payload) => {
    mainWindow?.webContents.send('app:toast', payload)
  })
  await pluginRegistry.initPlugins()
  // Register IPC before any window loads the renderer (avoids invoke races in dev).
  setupIPC()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

function setupIPC() {
  ipcMain.handle('window:minimize', () => {
    mainWindow?.minimize()
  })
  ipcMain.handle('window:maximize-toggle', () => {
    if (!mainWindow) return
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
  })
  ipcMain.handle('window:close', () => {
    mainWindow?.close()
  })

  ipcMain.handle('plugins:list', async (): Promise<PluginListEntry[]> => {
    return pluginRegistry.listPlugins()
  })
  ipcMain.handle(
    'plugins:setEnabled',
    async (_ev, pluginId: string, enabled: boolean): Promise<boolean> => {
      if (!pluginRegistry.hasPlugin(pluginId)) return false
      pluginRegistry.setEnabled(pluginId, enabled)
      mainWindow?.webContents.send('plugins:preferencesChanged')
      return true
    }
  )

  ipcMain.handle(
    'plugins:getConfig',
    async (_ev, pluginId: string): Promise<Record<string, unknown>> => {
      if (!pluginRegistry.hasPlugin(pluginId)) return {}
      return pluginPreferencesStore.getPluginConfig(pluginId)
    }
  )

  ipcMain.handle(
    'plugins:setConfig',
    async (_ev, pluginId: string, config: Record<string, unknown>): Promise<boolean> => {
      if (!pluginRegistry.hasPlugin(pluginId)) return false
      pluginPreferencesStore.setPluginConfig(pluginId, config)
      mainWindow?.webContents.send('plugins:preferencesChanged')
      return true
    }
  )

  ipcMain.handle('plugins:getManifest', async (_ev, pluginId: string) => {
    return pluginRegistry.getManifest(pluginId)
  })

  ipcMain.handle('plugins:getResolvedAssetPack', async (_ev, pluginId: string) => {
    const p = await getActiveAssetPackResolved(String(pluginId || ''))
    if (!p) return null
    const { dir: _omit, ...rest } = p
    return rest
  })

  ipcMain.handle('plugins:getDiagnostics', async () => {
    return pluginRegistry.getDiagnostics()
  })

  ipcMain.handle(
    'plugins:callTool',
    async (
      _ev,
      toolName: string,
      input: unknown,
      actor?: ToolActor
    ): Promise<{ ok: true; result: unknown } | { ok: false; error: string; blocked?: boolean }> => {
      const a: ToolActor =
        actor === 'agent' || actor === 'system' || actor === 'user' ? actor : 'user'
      return pluginRegistry.toolRuntime.call(toolName, input, { actor: a })
    }
  )

  ipcMain.handle(
    'plugins:installFromGithub',
    async (
      _ev,
      payload: { github: string; ref?: string }
    ): Promise<
      { ok: true; pluginId: string; version: string } | { ok: false; error: string }
    > => {
      const spec = parseGithubPluginSpec(payload?.github || '')
      if (!spec) return { ok: false, error: 'invalid_github_spec' }
      const storeRoot = path.join(app.getPath('userData'), 'plugins', 'packages')
      await fs.mkdir(storeRoot, { recursive: true })
      const r = await installPluginFromGithub({
        owner: spec.owner,
        repo: spec.repo,
        ref: payload?.ref,
        pluginsParentDir: storeRoot,
      })
      if (!r.ok) return r
      pluginPreferencesStore.setPluginEnabled(r.pluginId, true)
      await pluginRegistry.initPlugins()
      mainWindow?.webContents.send('plugins:preferencesChanged')
      return { ok: true, pluginId: r.pluginId, version: r.version }
    }
  )

  ipcMain.handle(
    'plugins:installFromUrl',
    async (
      _ev,
      payload: { url: string }
    ): Promise<
      { ok: true; pluginId: string; version: string } | { ok: false; error: string }
    > => {
      const url = String(payload?.url || '').trim()
      if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'invalid_url' }
      const storeRoot = path.join(app.getPath('userData'), 'plugins', 'packages')
      await fs.mkdir(storeRoot, { recursive: true })
      const r = await installPluginFromUrl({ url, pluginsParentDir: storeRoot })
      if (!r.ok) return r
      pluginPreferencesStore.setPluginEnabled(r.pluginId, true)
      await pluginRegistry.initPlugins()
      mainWindow?.webContents.send('plugins:preferencesChanged')
      return { ok: true, pluginId: r.pluginId, version: r.version }
    }
  )

  ipcMain.handle(
    'plugins:installFromRelease',
    async (
      _ev,
      payload: { github: string; tag: string; asset: string }
    ): Promise<
      { ok: true; pluginId: string; version: string } | { ok: false; error: string }
    > => {
      const spec = parseGithubPluginSpec(payload?.github || '')
      if (!spec) return { ok: false, error: 'invalid_github_spec' }
      const tag = String(payload?.tag || '').trim()
      const asset = String(payload?.asset || '').trim()
      if (!tag || !asset) return { ok: false, error: 'missing_tag_or_asset' }
      const url = githubReleaseAssetUrl(spec.owner, spec.repo, tag, asset)
      const storeRoot = path.join(app.getPath('userData'), 'plugins', 'packages')
      await fs.mkdir(storeRoot, { recursive: true })
      const r = await installPluginFromUrl({ url, pluginsParentDir: storeRoot })
      if (!r.ok) return r
      pluginPreferencesStore.setPluginEnabled(r.pluginId, true)
      await pluginRegistry.initPlugins()
      mainWindow?.webContents.send('plugins:preferencesChanged')
      return { ok: true, pluginId: r.pluginId, version: r.version }
    }
  )

  ipcMain.handle(
    'agent:submitUserText',
    async (
      _ev,
      opts: { conversationId: string; text: string; userMessageId?: string }
    ): Promise<{ ok: boolean; error?: string }> => {
      if (!agentRuntime) return { ok: false, error: 'agent_not_ready' }
      const text = String(opts?.text || '').trim()
      const conversationId = String(opts?.conversationId || '').trim()
      if (!conversationId || !text) return { ok: false, error: 'invalid_input' }
      const ok = await agentRuntime.bus.enqueue(
        createAgentEvent({
          type: CORE_EVENT.USER_TEXT,
          source: 'kernel',
          conversationId,
          payload: {
            text,
            ...(opts.userMessageId ? { userMessageId: opts.userMessageId } : {}),
          },
        })
      )
      return ok ? { ok: true } : { ok: false, error: 'enqueue_failed' }
    }
  )

  ipcMain.handle(
    'agent:activityPing',
    async (_ev, conversationId?: string): Promise<{ ok: boolean }> => {
      if (!agentRuntime || !conversationId) return { ok: true }
      void agentRuntime.bus.enqueue(
        createAgentEvent({
          type: CORE_EVENT.USER_ACTIVITY,
          source: 'kernel',
          conversationId,
          payload: {},
        })
      )
      return { ok: true }
    }
  )

  ipcMain.handle('config:get', async (): Promise<GlobalSettings> => {
    return configStore.get()
  })

  ipcMain.handle(
    'config:set',
    async (event, config: GlobalSettings): Promise<boolean> => {
      configStore.set(config)
      return true
    }
  )

  ipcMain.handle(
    'config:validate',
    async (event, config: GlobalSettings): Promise<boolean> => {
      if (!agentRuntime) {
        throw new Error('Agent runtime not initialized')
      }
      return await agentRuntime.modelTurn.validateConfig(config)
    }
  )

  ipcMain.handle('templates:list', async (): Promise<PromptTemplate[]> => {
    return templateStore.getAll()
  })

  ipcMain.handle(
    'templates:create',
    async (
      event,
      template: Omit<PromptTemplate, 'id' | 'createdAt' | 'updatedAt'>
    ): Promise<PromptTemplate> => {
      return templateStore.create(template)
    }
  )

  ipcMain.handle(
    'templates:update',
    async (
      event,
      id: string,
      updates: Partial<PromptTemplate>
    ): Promise<boolean> => {
      templateStore.update(id, updates)
      return true
    }
  )

  ipcMain.handle(
    'templates:delete',
    async (event, id: string): Promise<boolean> => {
      return templateStore.delete(id)
    }
  )

  ipcMain.handle('conversations:list', async (): Promise<Conversation[]> => {
    return await conversationStore.getAll()
  })

  ipcMain.handle(
    'conversations:get',
    async (event, id: string): Promise<Conversation | undefined> => {
      return await conversationStore.get(id)
    }
  )

  ipcMain.handle(
    'conversations:create',
    async (event, title?: string): Promise<Conversation> => {
      const cfg = configStore.get()
      const initial =
        title && title.length > 0
          ? title
          : defaultConversationTitle(normalizeLocale(cfg.locale))
      return await conversationStore.create(initial)
    }
  )

  ipcMain.handle(
    'conversations:update',
    async (
      event,
      id: string,
      updates: Partial<Conversation>
    ): Promise<boolean> => {
      await conversationStore.update(id, updates)
      return true
    }
  )

  ipcMain.handle(
    'conversations:delete',
    async (event, id: string): Promise<boolean> => {
      await conversationStore.delete(id)
      messageStore.clear(id)
      return true
    }
  )

  ipcMain.handle(
    'messages:list',
    async (event, conversationId: string): Promise<ChatMessage[]> => {
      return messageStore.getByConversation(conversationId)
    }
  )

  ipcMain.handle(
    'messages:clear',
    async (event, conversationId: string): Promise<boolean> => {
      messageStore.clear(conversationId)
      return true
    }
  )

  ipcMain.handle(
    'memory:list',
    async (event, conversationId: string): Promise<string[]> => {
      const conversation = await conversationStore.get(conversationId)
      return conversation?.memory || []
    }
  )

  ipcMain.handle(
    'memory:clear',
    async (event, conversationId: string): Promise<boolean> => {
      const conversation = await conversationStore.get(conversationId)
      if (!conversation) return false
      await conversationStore.update(conversationId, { memory: [] })
      return true
    }
  )

}
