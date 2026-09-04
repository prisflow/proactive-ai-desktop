import { contextBridge, ipcRenderer } from 'electron'
import type { GlobalSettings, Conversation, ChatMessage } from '@shared/types/domain'
import type { LogEntry, LogQuery } from '@shared/types/log'
import type { AgentStreamPushV1 } from '@shared/types/stream'
import type { UsageTotals, UsageDaily, UsageHourly, UsageContextDaily } from '@shared/types/usage'
import type { PluginImportResult, PluginInfo, PluginUninstallResult } from '@shared/types/plugin'

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
    getConfig: (): Promise<GlobalSettings> => ipcRenderer.invoke('store:config:get'),
    /** 写入配置。 */
    setConfig: (config: Partial<GlobalSettings>): Promise<GlobalSettings> => ipcRenderer.invoke('store:config:set', config),
  },

  /** 对话管理。 */
  conversations: {
    /** 获取对话列表（不含已归档）。 */
    list: (): Promise<Conversation[]> => ipcRenderer.invoke('conversations:list'),
    /** 创建新对话，返回含 UUID 的 Conversation。 */
    create: (title?: string): Promise<Conversation> => ipcRenderer.invoke('conversations:create', title),
    /** 软删除对话。 */
    delete: (id: string): Promise<boolean> => ipcRenderer.invoke('conversations:delete', id),
    /** 重命名对话。 */
    rename: (id: string, title: string): Promise<Conversation | undefined> => ipcRenderer.invoke('conversations:rename', id, title),
    /** 获取指定对话的消息列表。 */
    getMessages: (id: string): Promise<ChatMessage[]> => ipcRenderer.invoke('conversations:getMessages', id),
  },

  /** 用户输入与 LLM 流式响应。 */
  chat: {
    /** 发送用户消息到 Runtime，返回已持久化的 ChatMessage。 */
    send: (conversationId: string, text: string): Promise<ChatMessage> =>
      ipcRenderer.invoke('chat:send', conversationId, text),
    /** 中断当前流式响应。 */
    abort: (conversationId: string): Promise<void> =>
      ipcRenderer.invoke('chat:abort', conversationId),
    /** 订阅流式推送（LLM 回复的 delta chunk 或 error 事件）。 */
    onStream: (callback: (event: any, data: AgentStreamPushV1) => void) => {
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
    query: (q?: LogQuery): Promise<LogEntry[]> => ipcRenderer.invoke('logs:query', q),
    /** 全量查询（disk + ring buffer）。 */
    queryAll: (q?: LogQuery): Promise<LogEntry[]> => ipcRenderer.invoke('logs:queryAll', q),
    /** 链式追踪（按 parentRunId BFS 遍历调用树）。 */
    getChain: (runId: string, maxDepth?: number): Promise<LogEntry[]> =>
      ipcRenderer.invoke('logs:getChain', runId, maxDepth),
    /** 清空所有日志。 */
    clear: (): Promise<boolean> => ipcRenderer.invoke('logs:clear'),
    /** 获取最近错误日志。 */
    getRecentErrors: (limit?: number): Promise<LogEntry[]> =>
      ipcRenderer.invoke('logs:getRecentErrors', limit),
  },

  /** Token 使用总量。 */
  usage: {
    getTotals: (): Promise<UsageTotals> => ipcRenderer.invoke('usage:getTotals'),
    getDaily: (days?: number): Promise<UsageDaily[]> => ipcRenderer.invoke('usage:getDaily', days),
    getHourly: (): Promise<UsageHourly[]> => ipcRenderer.invoke('usage:getHourly'),
    getContextDaily: (): Promise<UsageContextDaily[]> => ipcRenderer.invoke('usage:getContextDaily'),
    clear: (): Promise<boolean> => ipcRenderer.invoke('usage:clear'),
  },

  /** 插件管理。 */
  plugins: {
    /** 打开文件选择器导入插件 zip，返回导入结果。 */
    importZip: (): Promise<PluginImportResult> =>
      ipcRenderer.invoke('plugins:importZip'),
    /** 已安装插件清单。 */
    list: (): Promise<PluginInfo[]> =>
      ipcRenderer.invoke('plugins:list'),
    /** 卸载插件（注销注册项并删除文件）。 */
    uninstall: (entryName: string): Promise<PluginUninstallResult> =>
      ipcRenderer.invoke('plugins:uninstall', entryName),
  },

  /** 公网中继（手机 anywhere 访问，走用户自建服务器）。 */
  relay: {
    /** 当前连接状态（off/connecting/online）。 */
    status: (): Promise<{ state: 'off' | 'connecting' | 'online' }> =>
      ipcRenderer.invoke('relay:status'),
    /** 当前手机访问链接（在线时返回，回环地址自动换局域网 IP；否则 null）。 */
    link: (): Promise<{ link: string | null }> =>
      ipcRenderer.invoke('relay:link'),
    /** 启用中继（url + 配对码），返回 deviceId。 */
    connect: (url: string, code: string): Promise<{ ok: boolean; error?: string; deviceId?: string }> =>
      ipcRenderer.invoke('relay:connect', url, code),
    /** 停用中继。 */
    disconnect: (): Promise<{ ok: boolean; deviceId?: string }> =>
      ipcRenderer.invoke('relay:disconnect'),
  },
})

export type ElectronAPI = typeof window.electronAPI
