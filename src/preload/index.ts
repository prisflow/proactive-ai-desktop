import { contextBridge, ipcRenderer } from 'electron'

/**
 * 通过 contextBridge 暴露 IPC 接口到渲染进程。
 * 所有方法均通过 ipcRenderer.invoke / on 与 Main 通信。
 */
contextBridge.exposeInMainWorld('electronAPI', {
  /** 运行平台字符串（如 'win32'、'darwin'）。 */
  platform: process.platform,

  /** 应用程序控制。 */
  app: {
    /** 完全退出应用程序（关闭托盘和进程）。 */
    quit: (): Promise<void> => ipcRenderer.invoke('app:quit'),
  },

  /** 窗口管理。 */
  window: {
    /** 最小化窗口。 */
    minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
    /** 切换最大化/还原。 */
    maximizeToggle: (): Promise<void> => ipcRenderer.invoke('window:maximize-toggle'),
    /** 关闭窗口。 */
    close: (): Promise<void> => ipcRenderer.invoke('window:close'),
  },

  /** 全局配置（LLM API Key / 模型 / 主题等）。 */
  store: {
    /** 读取全部配置。 */
    getConfig: (): Promise<any> => ipcRenderer.invoke('store:config:get'),
    /** 写入配置。 */
    setConfig: (config: any): Promise<any> => ipcRenderer.invoke('store:config:set', config),
  },

  /** 对话管理。 */
  conversations: {
    /** 获取对话列表（不含已归档）。 */
    list: (): Promise<any[]> => ipcRenderer.invoke('conversations:list'),
    /** 创建新对话，返回含 UUID 的 Conversation。 */
    create: (title?: string): Promise<any> => ipcRenderer.invoke('conversations:create', title),
    /** 软删除对话。 */
    delete: (id: string): Promise<boolean> => ipcRenderer.invoke('conversations:delete', id),
    /** 重命名对话。 */
    rename: (id: string, title: string): Promise<any> => ipcRenderer.invoke('conversations:rename', id, title),
    /** 获取指定对话的消息列表。 */
    getMessages: (id: string): Promise<any[]> => ipcRenderer.invoke('conversations:getMessages', id),
  },

  /** 用户输入与 LLM 流式响应。 */
  chat: {
    /** 发送用户消息到 Runtime，返回已持久化的 ChatMessage。 */
    send: (conversationId: string, text: string): Promise<any> =>
      ipcRenderer.invoke('chat:send', conversationId, text),
    /** 中断当前流式响应。 */
    abort: (conversationId: string): Promise<void> =>
      ipcRenderer.invoke('chat:abort', conversationId),
    /** 订阅流式推送（LLM 回复的 delta chunk 或 error 事件）。 */
    onStream: (callback: (event: any, data: any) => void) => {
      ipcRenderer.on('chat:stream', callback)
    },
    /** 取消流式推送订阅。 */
    offStream: () => {
      ipcRenderer.removeAllListeners('chat:stream')
    },
  },

  /** 日志查询。 */
  logs: {
    /** 内存热查询（最近 500 条内）。 */
    query: (q?: any): Promise<any[]> => ipcRenderer.invoke('logs:query', q),
    /** 全量查询（disk + ring buffer）。 */
    queryAll: (q?: any): Promise<any[]> => ipcRenderer.invoke('logs:queryAll', q),
    /** 链式追踪（按 parentRunId BFS 遍历调用树）。 */
    getChain: (runId: string, maxDepth?: number): Promise<any[]> =>
      ipcRenderer.invoke('logs:getChain', runId, maxDepth),
    /** 清空所有日志。 */
    clear: (): Promise<boolean> => ipcRenderer.invoke('logs:clear'),
    /** 获取最近错误日志。 */
    getRecentErrors: (limit?: number): Promise<any[]> =>
      ipcRenderer.invoke('logs:getRecentErrors', limit),
  },

  /** Token 使用总量。 */
  usage: {
    getTotals: (): Promise<any> => ipcRenderer.invoke('usage:getTotals'),
    getDaily: (days?: number): Promise<any> => ipcRenderer.invoke('usage:getDaily', days),
    getHourly: (): Promise<any> => ipcRenderer.invoke('usage:getHourly'),
    getToolSplit: (): Promise<any> => ipcRenderer.invoke('usage:getToolSplit'),
    getContextDaily: (): Promise<any> => ipcRenderer.invoke('usage:getContextDaily'),
    clear: (): Promise<boolean> => ipcRenderer.invoke('usage:clear'),
  },
})

export type ElectronAPI = typeof window.electronAPI
