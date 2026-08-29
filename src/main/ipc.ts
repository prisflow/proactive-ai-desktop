import { app, ipcMain } from 'electron'
import { getMainWindow } from './window'
import { logService } from './services/logger'
import { globalConfigStore, conversationStore } from './services/store'
import { getUsageTotals, getDailyUsage, getHourlyUsage, getToolSplit, clearUsage } from './services/usage-totals'
import type { ChatMessage, Conversation } from '@shared/types/domain'
import { runtimeManager } from './modules/conversations/runtime-manager'
import { LlmProvider, type LlmConfig } from './modules/llm'
import { flowHost } from './modules/conversations/flow/flow-host'

/** MessageRecord → ChatMessage，role 映射 + uiRender 解析。
 * 内部消息过滤：event-status（工具执行状态文本）、tool-result（工具结果文本）与 compact-marker
 * （压缩标记）是给 LLM/回放用的，不映射为前端消息（返回 null，调用方过滤）。
 * 例外：host_enter/exit_subcontext 的 tool-result（占位应答）放行——它是上下文切换点的
 * 唯一可见载体，前端据此渲染"已进入/已回到"分隔标签（切换时机 = 标签时机）。
 * 空内容且无 widgetNode 的 context（如零文本的 assistant(tool_calls) 轮）也不显示，避免空气泡。 */
function toChatMessage(msg: import('./services/store/database').MessageRecord): ChatMessage | null {
  const kind = (msg.extraData as { kind?: string; toolName?: string } | null)?.kind
  const toolName = (msg.extraData as { toolName?: string } | null)?.toolName
  const isContextSwitch = kind === 'tool-result' && (toolName === 'host_enter_subcontext' || toolName === 'host_exit_subcontext')
  if (!isContextSwitch && (kind === 'event-status' || kind === 'tool-result' || kind === 'compact-marker')) return null
  const chatMsg: ChatMessage = {
    id: msg.id,
    role: msg.role === 'context' ? 'assistant' : 'user',
    content: msg.content,
    createdAt: msg.createdAt,
    contextId: msg.contextId,
    kind: isContextSwitch ? 'context-switch' : undefined,
  }
  // 切换占位：enter 的占位 contextId 为 null（归属 main），但标签需显示目标子上下文——
  // 从占位 content 的 JSON 里解析目标 contextId 挂到 chatMsg.contextId
  if (isContextSwitch && toolName === 'host_enter_subcontext') {
    try {
      const parsed = JSON.parse(msg.content) as { contextId?: string }
      if (parsed.contextId) chatMsg.contextId = parsed.contextId
    } catch { /* 解析失败保持原样 */ }
  }
  // SQLite extraData.uiRender → widgetNode（含 children 递归）
  if (msg.extraData?.uiRender) {
    const ui = msg.extraData.uiRender as { component: string; props: Record<string, unknown>; children?: unknown[] }
    chatMsg.widgetNode = {
      type: ui.component as import('@shared/types/ui').WidgetNodeType,
      props: ui.props ?? {},
      children: Array.isArray(ui.children) ? ui.children as import('@shared/types/ui').WidgetNode[] : undefined,
    }
  }
  // 空内容且无 UI 的 assistant 消息不显示（零文本 tool_calls 轮 / 空 stop）
  if (!chatMsg.widgetNode && !String(chatMsg.content || '').trim() && chatMsg.role === 'assistant') return null
  return chatMsg
}

export function registerIpc(): void {
  // 窗口控制
  ipcMain.handle('window:minimize', () => getMainWindow()?.minimize())
  ipcMain.handle('window:maximize-toggle', () => {
    const w = getMainWindow()
    if (!w) return
    if (w.isMaximized()) { w.unmaximize() } else { w.maximize() }
  })
  // 关闭按钮 → 隐藏到系统托盘（不退出）
  ipcMain.handle('window:close', () => getMainWindow()?.hide())

  // 应用程序控制
  ipcMain.handle('app:quit', () => app.quit())

  // 日志查询
  ipcMain.handle('logs:query', async (_ev, q?: import('../shared/types').LogQuery) => {
    return logService.query(q)
  })
  ipcMain.handle('logs:queryAll', async (_ev, q?: import('../shared/types').LogQuery) => {
    return await logService.queryAll(q)
  })
  ipcMain.handle('logs:getChain', async (_ev, runId: string, maxDepth?: number) => {
    return await logService.getChain(runId, maxDepth)
  })
  ipcMain.handle('logs:clear', async () => {
    await logService.clear()
    return true
  })
  ipcMain.handle('logs:getRecentErrors', async (_ev, limit?: number) => {
    return logService.query({ level: 'error', limit: limit ?? 50 })
  })
  ipcMain.handle('usage:getTotals', async () => {
    return getUsageTotals()
  })
  ipcMain.handle('usage:getDaily', async (_ev, days?: number) => {
    return getDailyUsage(days ?? 7)
  })
  ipcMain.handle('usage:getHourly', async () => {
    return getHourlyUsage()
  })
  ipcMain.handle('usage:getToolSplit', async () => {
    return getToolSplit()
  })
  ipcMain.handle('usage:getContextDaily', async (_ev, days?: number) => {
    const { getContextWeekly } = await import('./services/usage-totals')
    return getContextWeekly()
  })
  ipcMain.handle('usage:clear', async () => {
    clearUsage()
    return true
  })

  // 全局配置
  ipcMain.handle('store:config:get', async () => {
    return await globalConfigStore.get()
  })
  ipcMain.handle('store:config:set', async (_ev, config: Partial<import('../shared/types').GlobalSettings>) => {
    const next = await globalConfigStore.set(config)
    // 配置变更后重建图执行器的共享 LLM provider
    flowHost.setLlmProvider(new LlmProvider({ apiKey: next.apiKey, model: next.model, baseURL: next.baseURL }))
    return next
  })

  // 对话管理
  ipcMain.handle('conversations:list', async (): Promise<Conversation[]> => {
    return conversationStore.list()
  })
  ipcMain.handle('conversations:create', async (_ev, title?: string): Promise<Conversation> => {
    return conversationStore.create(title)
  })
  ipcMain.handle('conversations:delete', async (_ev, id: string): Promise<boolean> => {
    return conversationStore.delete(id)
  })
  ipcMain.handle('conversations:rename', async (_ev, id: string, title: string): Promise<Conversation | undefined> => {
    return conversationStore.update(id, { title })
  })
  ipcMain.handle('conversations:getMessages', async (_ev, id: string): Promise<ChatMessage[]> => {
    const records = conversationStore.getMessages(id)
    return records.map(toChatMessage).filter((m): m is ChatMessage => m !== null)
  })

  // 用户输入 → Runtime（流式）
  ipcMain.handle('chat:send', async (_ev, conversationId: string, text: string): Promise<ChatMessage> => {
    const config = await globalConfigStore.get()
    const llmConfig: LlmConfig = {
      apiKey: config.apiKey,
      model: config.model,
      baseURL: config.baseURL,
    }
    const rt = runtimeManager.getOrCreate(conversationId, llmConfig)
    const record = await rt.run(text)
    // 玩家输入记录不会是内部消息（event-status/tool-result/compact-marker），但类型上容错
    return toChatMessage(record) ?? { id: record.id, role: 'user', content: record.content, createdAt: record.createdAt }
  })

  // 中断流式响应
  ipcMain.handle('chat:abort', (_ev, conversationId: string): void => {
    const rt = runtimeManager.get(conversationId)
    rt?.abort()
  })
}
