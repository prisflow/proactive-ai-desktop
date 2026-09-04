import { app, BrowserWindow, Menu } from 'electron'
import path from 'path'
import { logService, uniqueRunId } from './services/logger'
import { globalConfigStore, databaseService, conversationStore } from './services/store'
import { createWindow } from './window'
import { registerIpc } from './ipc'
import { createTray, destroyTray } from './tray'
import { registerRelayIpc } from './transport/relay-ipc'
import { contextRegistry } from './modules/conversations/context/context-manager'
import { toolRegistry } from './modules/conversations/tool/tool-manager'
import { createBuiltinTools } from './modules/conversations/tool/builtin-tools'
import { pluginLoader, syncBuiltinPlugins } from './modules/plugin'
import { flowHost } from './modules/conversations/flow/flow-host'
import { LlmProvider } from './modules/llm'
import { DEFAULT_MODEL, DEFAULT_BASE_URL } from '@shared/constants'

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
  // null（未设置）时用默认值兜底；apiKey 未配置传空串（LLM 请求自会失败，前端有提示）
  flowHost.setLlmProvider(new LlmProvider({
    apiKey: config.apiKey ?? '',
    model: config.model ?? DEFAULT_MODEL,
    baseURL: config.baseURL ?? DEFAULT_BASE_URL,
  }))

  // 注册内置工具到全局 ToolRegistry（一次性）
  for (const def of createBuiltinTools()) {
    toolRegistry.register(def)
  }

  // 注册主上下文到全局 ContextRegistry（一次性）
  contextRegistry.register({
    contextId: 'main',
    role: 'main',
    initialPrompt: '你是 ProactiveAI 的主上下文（默认对话入口），使用用户的语言回复。\n\n' +
      '【上下文结构】系统采用扁平的上下文注册制：你（main）与各插件注册的子上下文平级共存，互不嵌套。' +
      '可用子上下文见 host_enter_subcontext 工具的 contextId 参数说明。' +
      '玩家想使用某个插件能力时，你调 host_enter_subcontext 进入该子上下文——进入后对话由子上下文完全接管（它的工具与规则与你无关），' +
      '直到收到【系统提示】中"[context-switch: 你已回到主上下文]"为止。收到该标记后你已回到 main：' +
      '此前子上下文中的内容仅作为历史摘要存在，除非玩家再次要求进入，否则不要延续子上下文的剧情口吻。\n\n' +
      '【工具规则】\n' +
      '- 每次只调用一个工具；调用后等待【系统提示】的完成通知，再决定下一步。\n' +
      '- 循环：你的回合 → 工具结果 → 下一回合 → … → 最终回复。\n' +
      '- 最终回复以纯文本交付，不要再用任何工具输出。\n' +
      '- 带【系统提示】前缀的消息是系统注入的工具执行状态与下一步指示' +
      '（成功 = 下一步 instruction；失败 = "工具 xx 失败：原因，请重试或换工具"），不是玩家发言。' +
      '按其继续调用工具；若其表示当前工具链已结束，以最终回复或 host_yield 收轮，勿当成玩家新输入。',
    toolNames: toolRegistry.listAll(),
  })

  // 启动插件守护进程（先 seed 内置插件到 userData/plugins，再扫描监听）
  const pluginsDir = path.join(app.getPath('userData'), 'plugins')
  const builtinPluginsDir = path.join(app.getAppPath(), 'resources', 'plugins')
  await syncBuiltinPlugins(builtinPluginsDir, pluginsDir)
  await pluginLoader.start(pluginsDir)

  registerIpc()
  registerRelayIpc()
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
