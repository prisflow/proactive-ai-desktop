import { app, BrowserWindow, ipcMain, Menu } from 'electron'
import path from 'path'
import { ChatCore } from './chat-core'
import { configStore } from './config-store'
import { templateStore } from './template-store'
import { conversationStore } from './conversation-store'
import { messageStore } from './message-store'
import {
  GlobalSettings,
  Conversation,
  ChatMessage,
  AIResponse,
  PromptTemplate,
} from '../shared/types'
import { normalizeLocale, isDefaultConversationTitle, defaultConversationTitle } from '../shared/locale'
import { getBuiltinRolePrompt, getFallbackRolePrompt } from '../shared/prompt-i18n'
import { pluginRegistry } from './plugins/registry'
import {
  ensurePAvatarPacksDir,
  getActivePAvatarPackResolved,
  registerPAvatarProtocol,
  scanPAvatarPacks,
  syncBundledPavatarPackIfNeeded,
} from './pavatar/pack-store'
import { pluginPreferencesStore } from './plugin-preferences-store'
import type { PAvatarPackResolved, PluginListEntry } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let chatCore: ChatCore | null = null

const WINDOW_TITLE = 'ProactiveAI'

function titleFromFirstUserMessage(
  text: string,
  locale: ReturnType<typeof normalizeLocale>,
  maxLen = 42
): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return defaultConversationTitle(locale)
  if (normalized.length <= maxLen) return normalized
  return normalized.slice(0, maxLen).trimEnd() + '…'
}

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
  registerPAvatarProtocol()
  await ensurePAvatarPacksDir()
  await syncBundledPavatarPackIfNeeded()
  chatCore = new ChatCore()
  pluginRegistry.setRendererDispatcher((message) => {
    mainWindow?.webContents.send('plugin:dispatch', message)
  })
  pluginRegistry.initBuiltins()
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

  // pavatar packs
  ipcMain.handle('pavatar:listPacks', async (): Promise<PAvatarPackResolved[]> => {
    return await scanPAvatarPacks()
  })
  ipcMain.handle('pavatar:getActivePack', async (): Promise<PAvatarPackResolved | null> => {
    return await getActivePAvatarPackResolved()
  })
  ipcMain.handle(
    'pavatar:setActivePack',
    async (_ev, packId: string, version: string): Promise<boolean> => {
      const packs = await scanPAvatarPacks()
      const hit = packs.find((p) => p.packId === packId && p.version === version)
      if (!hit) return false
      const cur = pluginPreferencesStore.getPluginConfig('com.proactiveai.pavatar')
      pluginPreferencesStore.setPluginConfig('com.proactiveai.pavatar', {
        ...cur,
        activePackId: packId,
        activePackVersion: version,
      })
      mainWindow?.webContents.send('pavatar:activePackChanged', { packId, version })
      return true
    }
  )

  ipcMain.handle('plugins:list', async (): Promise<PluginListEntry[]> => {
    return pluginRegistry.listPlugins()
  })
  ipcMain.handle(
    'plugins:setEnabled',
    async (_ev, pluginId: string, enabled: boolean): Promise<boolean> => {
      const known = pluginRegistry.listPlugins().some((p) => p.id === pluginId)
      if (!known) return false
      pluginRegistry.setEnabled(pluginId, enabled)
      mainWindow?.webContents.send('plugins:preferencesChanged')
      return true
    }
  )

  ipcMain.handle(
    'chat:send',
    async (
      event,
      message: string,
      history: ChatMessage[],
      importantInfo: string[],
      conversationId?: string
    ): Promise<AIResponse> => {
      if (!chatCore) {
        throw new Error('ChatCore not initialized')
      }

      const config = configStore.get()
      const locale = normalizeLocale(config.locale)
      let conversationSettings: Conversation['settings'] = undefined

      if (conversationId) {
        const conversation = await conversationStore.get(conversationId)
        if (conversation) {
          conversationSettings = conversation.settings
        }
      }

      const templateRef =
        conversationSettings?.templateName || config.defaultTemplateName
      const template = templateStore.resolveTemplate(templateRef)
      let rolePrompt: string
      if (template?.isBuiltIn && template.id.startsWith('builtin_')) {
        const key = template.id.slice('builtin_'.length)
        rolePrompt = getBuiltinRolePrompt(key, locale)
      } else {
        rolePrompt = template?.rolePrompt || getFallbackRolePrompt(locale)
      }

      const content = await pluginRegistry.runMessageSend(message)
      const historyForModel = pluginRegistry.patchHistoryLastUserContent(
        history,
        content
      )

      if (conversationId) {
        const prior = messageStore.getByConversation(conversationId)
        const conv = await conversationStore.get(conversationId)
        if (
          prior.length === 0 &&
          conv &&
          isDefaultConversationTitle(conv.title)
        ) {
          await conversationStore.update(conversationId, {
            title: titleFromFirstUserMessage(content, locale),
          })
        }

        // 立即把用户消息落盘，避免渲染层拉取时拿到空列表覆盖“乐观消息”
        const userMessage: ChatMessage = {
          id: `msg_${Date.now()}`,
          role: 'user',
          content,
          createdAt: Date.now(),
        }
        messageStore.add(conversationId, userMessage)
      }

      const response = await chatCore.sendMessage(
        content,
        historyForModel,
        importantInfo,
        config,
        conversationSettings,
        rolePrompt
      )

      let replyOut = response.reply
      replyOut = await pluginRegistry.runMessageReceive(replyOut)

      for (const t of response.triggers || []) {
        await pluginRegistry.runOnTrigger(t)
      }

      if (conversationId) {
        const assistantMessage: ChatMessage = {
          id: `msg_${Date.now() + 1}`,
          role: 'assistant',
          content: replyOut,
          createdAt: Date.now(),
        }
        messageStore.add(conversationId, assistantMessage)

        // Merge AI-extracted important info into conversation memory (session-level).
        const newMemory = (response.important_info || []).filter(Boolean)
        if (newMemory.length > 0) {
          const conversation = await conversationStore.get(conversationId)
          if (conversation) {
            const existing = conversation.memory || []
            const merged = Array.from(new Set([...existing, ...newMemory]))
            await conversationStore.update(conversationId, { memory: merged })
          }
        }
        await pluginRegistry.runMemoryUpdate(newMemory)
      }

      return {
        ...response,
        reply: replyOut,
      }
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
      if (!chatCore) {
        throw new Error('ChatCore not initialized')
      }
      return await chatCore.validateConfig(config)
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
