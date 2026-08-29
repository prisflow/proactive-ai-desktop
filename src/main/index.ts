import { app, BrowserWindow, Menu } from 'electron'
import path from 'path'
import { logService, uniqueRunId } from './services/logger'
import { globalConfigStore, databaseService, conversationStore } from './services/store'
import { createWindow } from './window'
import { registerIpc } from './ipc'
import { createTray, destroyTray } from './tray'
import { contextRegistry } from './modules/conversations/context/context-manager'
import { toolRegistry } from './modules/conversations/tool/tool-manager'
import { createBuiltinTools } from './modules/conversations/tool/builtin-tools'
import { pluginLoader, syncBuiltinPlugins } from './modules/plugin'
import { flowHost } from './modules/conversations/flow/flow-host'
import { LlmProvider } from './modules/llm'

const WINDOW_TITLE = 'ProactiveAI'

// 进程级异常兜底：硬崩溃前留下日志，便于排查闪退
process.on('uncaughtException', (e) => {
  logService.log('error', 'error', {
    runId: uniqueRunId('runtime'),
    name: 'process.uncaughtException',
    message: e.message,
    stack: e.stack,
  })
})
process.on('unhandledRejection', (reason) => {
  logService.log('error', 'error', {
    runId: uniqueRunId('runtime'),
    name: 'process.unhandledRejection',
    message: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  })
})

app.whenReady().then(async () => {
  if (process.platform === 'darwin') app.setName(WINDOW_TITLE)

  Menu.setApplicationMenu(null)
  databaseService.init()
  // 清理超过保留期的归档会话（软删除的数据不会自动消失）
  conversationStore.purgeArchived(7)
  // 定期清理：每天一次
  setInterval(() => { conversationStore.purgeArchived(7) }, 24 * 60 * 60 * 1000)
  const config = await globalConfigStore.get()
  // 注入图执行器的共享 LLM provider（图内 llm 节点用）
  flowHost.setLlmProvider(new LlmProvider({ apiKey: config.apiKey, model: config.model, baseURL: config.baseURL }))

  // 注册内置工具到全局 ToolRegistry（一次性）
  for (const def of createBuiltinTools()) {
    toolRegistry.register(def)
  }

  // 注册主上下文到全局 ContextRegistry（一次性）
  contextRegistry.register({
    contextId: 'main',
    role: 'main',
    initialPrompt: 'You are a helpful AI assistant. Respond in the user\'s language.\n\nRules:\n- Call only ONE tool at a time.\n- After calling a tool, wait for the completion notification before deciding the next step.\n- The loop is: your turn → tool result → your next turn → ... → final response.\n- Your final response is delivered as plain text. Do not call any tool to output it.\n- Messages prefixed with 「【系统提示】」 are system-injected tool execution status and next-step instructions (success: instruction for the next tool; failure: "tool xx failed: reason, retry or use another tool"). They are NOT player input. Follow them and continue calling tools; if a 【系统提示】 message says the current tool chain is finished, end the loop with a final response or host_yield — do not treat it as a new player message.',
    toolNames: toolRegistry.listAll(),
  })

  // 启动插件守护进程（先 seed 内置插件到 userData/plugins，再扫描监听）
  const pluginsDir = path.join(app.getPath('userData'), 'plugins')
  const builtinPluginsDir = path.join(app.getAppPath(), 'resources', 'plugins')
  await syncBuiltinPlugins(builtinPluginsDir, pluginsDir)
  await pluginLoader.start(pluginsDir)

  registerIpc()
  createWindow()
  createTray()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  pluginLoader.stop()
  logService.stop()
  databaseService.close()
})

app.on('before-quit', () => {
  destroyTray()
})
