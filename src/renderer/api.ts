import { LogEntry, LogQuery, GlobalSettings, Conversation, ChatMessage } from '@shared'

/** 流式推送数据（Main → Renderer，对应 AgentStreamPushV1）。 */
export type ChatStreamData =
  | { kind: 'stream'; conversationId: string; runId: string; delta: string; done: boolean }
  | { kind: 'error'; conversationId?: string; runId?: string; message: string }
  | { kind: 'ui_render'; conversationId: string; runId: string; component: string; props: Record<string, unknown>; children?: unknown[] }
  | { kind: 'context-switch'; conversationId: string; runId: string; contextId?: string }

declare global {
  interface Window {
    electronAPI: {
      platform: string
      window: {
        minimize: () => Promise<void>
        maximizeToggle: () => Promise<void>
        close: () => Promise<void>
      }
      store: {
        getConfig: () => Promise<GlobalSettings>
        setConfig: (config: Partial<GlobalSettings>) => Promise<GlobalSettings>
      }
      conversations: {
        list: () => Promise<Conversation[]>
        create: (title?: string) => Promise<Conversation>
        delete: (id: string) => Promise<boolean>
        rename: (id: string, title: string) => Promise<Conversation | undefined>
        getMessages: (id: string) => Promise<ChatMessage[]>
      }
      chat: {
        send: (conversationId: string, text: string) => Promise<ChatMessage>
        abort: (conversationId: string) => Promise<void>
        onStream: (callback: (event: any, data: any) => void) => void
        offStream: () => void
      }
      logs: {
        query: (q?: LogQuery) => Promise<LogEntry[]>
        queryAll: (q?: LogQuery) => Promise<LogEntry[]>
        getChain: (runId: string, maxDepth?: number) => Promise<LogEntry[]>
        clear: () => Promise<boolean>
        getRecentErrors: (limit?: number) => Promise<LogEntry[]>
      }
      usage: {
        getTotals: () => Promise<{ promptTokens: number; completionTokens: number; cachedTokens: number; totalTokens: number; hitRate: number }>
        getDaily: (days?: number) => Promise<Array<{ day: string; promptTokens: number; completionTokens: number; cachedTokens: number; hitRate: number }>>
        getHourly: () => Promise<Array<{ hour: string; promptTokens: number; completionTokens: number; cachedTokens: number; hitRate: number; toolCalls: number; textCalls: number }>>
        getToolSplit: () => Promise<{ textCalls: number; toolCalls: number; total: number }>
        getContextDaily: () => Promise<Array<{ day: string; contexts: Record<string, number> }>>
      }
    }
  }
}

/** 读取全局配置（Main SQLite）。 */
export function getConfig(): Promise<GlobalSettings> {
  return window.electronAPI.store.getConfig()
}

/** 写入全局配置（Main SQLite）。 */
export function setConfig(config: Partial<GlobalSettings>): Promise<GlobalSettings> {
  return window.electronAPI.store.setConfig(config)
}

/** 获取对话列表（Main SQLite）。 */
export function listConversations(): Promise<Conversation[]> {
  return window.electronAPI.conversations.list()
}

/** 创建新对话（Main SQLite，返回含 UUID）。 */
export function createConversation(title?: string): Promise<Conversation> {
  return window.electronAPI.conversations.create(title)
}

/** 软删除对话（Main SQLite is_archived=1）。 */
export function deleteConversation(id: string): Promise<boolean> {
  return window.electronAPI.conversations.delete(id)
}

/** 重命名对话（Main SQLite 持久化）。 */
export function renameConversation(id: string, title: string): Promise<Conversation | undefined> {
  return window.electronAPI.conversations.rename(id, title)
}

/** 获取指定对话的消息列表（Main SQLite）。 */
export function getConversationMessages(id: string): Promise<ChatMessage[]> {
  return window.electronAPI.conversations.getMessages(id)
}

/** 发送用户消息到 Main 的 Runtime。返回已持久化的 ChatMessage（含真实 UUID）。 */
export function chatSend(conversationId: string, text: string): Promise<ChatMessage> {
  return window.electronAPI.chat.send(conversationId, text)
}

/** 中断流式响应。 */
export function chatAbort(conversationId: string): Promise<void> {
  return window.electronAPI.chat.abort(conversationId)
}

/** 订阅流式推送（LLM 回复的 delta chunk）。 */
export function onChatStream(callback: (data: ChatStreamData) => void): void {
  window.electronAPI.chat.onStream((_event: any, data: ChatStreamData) => callback(data))
}

/** 取消流式推送订阅。 */
export function offChatStream(): void {
  window.electronAPI.chat.offStream()
}

/** 查询日志（内存 ring buffer，快速）。 */
export function queryLogs(q?: LogQuery): Promise<LogEntry[]> {
  return window.electronAPI.logs.query(q)
}

/** 查询日志（全量，三表合并）。 */
export function queryAllLogs(q?: LogQuery): Promise<LogEntry[]> {
  return window.electronAPI.logs.queryAll(q)
}

/** 日志链式追踪（按 parentRunId 双向 BFS）。 */
export function getLogChain(runId: string, maxDepth?: number): Promise<LogEntry[]> {
  return window.electronAPI.logs.getChain(runId, maxDepth)
}

/** 清空所有日志。 */
export function clearLogs(): Promise<boolean> {
  return window.electronAPI.logs.clear()
}

/** 获取最近错误日志。 */
export function getRecentErrors(limit?: number): Promise<LogEntry[]> {
  return window.electronAPI.logs.getRecentErrors(limit)
}

/** 获取 Token 使用总量（输入/输出分开，命中率）。 */
export function getUsageTotals(): Promise<{ promptTokens: number; completionTokens: number; cachedTokens: number; totalTokens: number; hitRate: number }> {
  return window.electronAPI.usage.getTotals()
}

/** 获取按日 Token 统计（一周）。 */
export function getDailyUsage(days = 7): Promise<Array<{ day: string; promptTokens: number; completionTokens: number; cachedTokens: number; hitRate: number }>> {
  return window.electronAPI.usage.getDaily(days)
}
export function getHourlyUsage(): Promise<Array<{ hour: string; promptTokens: number; completionTokens: number; cachedTokens: number; hitRate: number; toolCalls: number; textCalls: number }>> {
  return window.electronAPI.usage.getHourly()
}
export function getToolSplit(): Promise<{ textCalls: number; toolCalls: number; total: number }> {
  return window.electronAPI.usage.getToolSplit()
}
export function getContextDaily(): Promise<Array<{ day: string; contexts: Record<string, number> }>> {
  return window.electronAPI.usage.getContextDaily()
}

/** 清空 Token 统计（总量+按日）。 */
export function clearUsage(): Promise<boolean> {
  return window.electronAPI.usage.clear()
}
