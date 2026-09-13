import { app, ipcMain, dialog } from 'electron'
import path from 'path'
import { getMainWindow } from './window'
import { logService } from './services/logger'
import { globalConfigStore, conversationStore } from './services/store'
import { getUsageTotals, getDailyUsage, getHourlyUsage, clearUsage } from './services/usage-totals'
import type { ChatMessage, Conversation, GlobalSettings } from '@shared/types/domain'
import type { LogQuery } from '@shared/types/log'
import type { WidgetNode, WidgetNodeType } from '@shared/types/ui'
import type { PluginImportResult, PluginInfo, PluginUninstallResult, PluginExportResult } from '@shared/types/plugin'
import { runtimeManager } from './modules/conversations/runtime-manager'
import { sendMessage } from './modules/conversations/send-message'
import { toChatMessage } from './modules/conversations/to-chat-message'
import { LlmProvider, type LlmConfig } from './modules/llm'
import { flowHost } from './modules/conversations/flow/flow-host'
import { importPluginFromZip, pluginLoader, getPluginBrief, exportPluginToZip } from './modules/plugin'
import type { MessageRecord } from './services/store/database'
import { DEFAULT_MODEL, DEFAULT_BASE_URL } from '@shared/constants'

/** MessageRecord → ChatMessage，role 映射 + uiRender 解析。
 * 内部消息过滤：event-status（工具执行状态文本）、tool-result（工具结果文本）与 compact-marker
 * （压缩标记）是给 LLM/回放用的，不映射为前端消息（返回 null，调用方过滤）。
 * 例外：host_enter/exit_subcontext 的 tool-result（占位应答）放行——它是上下文切换点的
 * 唯一可见载体，前端据此渲染"已进入/已回到"分隔标签（切换时机 = 标签时机）。
 * 空内容且无 widgetNode 的 context（如零文本的 assistant(tool_calls) 轮）也不显示，避免空气泡。 */

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
  ipcMain.handle('logs:query', async (_ev, q?: LogQuery) => {
    return logService.query(q)
  })
  ipcMain.handle('logs:queryAll', async (_ev, q?: LogQuery) => {
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
  ipcMain.handle('usage:getContextDaily', async (_ev, days?: number) => {
    const { getContextWeekly } = await import('./services/usage-totals')
    return getContextWeekly()
  })
  ipcMain.handle('usage:clear', async () => {
    clearUsage()
    return true
  })

  // 插件——导入 zip（文件选择器）
  ipcMain.handle('plugins:importZip', async (): Promise<PluginImportResult> => {
    const w = getMainWindow()
    if (!w) return { ok: false, error: '窗口不可用' }
    const result = await dialog.showOpenDialog(w, {
      title: '导入插件',
      filters: [{ name: '插件包 (zip)', extensions: ['zip'] }],
      properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths[0]) return { ok: false, error: '已取消' }
    const pluginsDir = path.join(app.getPath('userData'), 'plugins')
    return importPluginFromZip(result.filePaths[0], pluginsDir)
  })

  // 插件——已装清单
  ipcMain.handle('plugins:list', (): PluginInfo[] => {
    return pluginLoader.listInstalled()
  })

  // 插件——卸载（注销上下文/工具 + 删文件）
  ipcMain.handle('plugins:uninstall', (_ev, entryName: string): PluginUninstallResult => {
    // 平铺（cultivation.js）与目录型（love/index.js）均接受；拒绝路径穿越/绝对路径/越级嵌套
    const normalized = String(entryName).replace(/\\/g, '/')
    const parts = normalized.split('/')
    const valid =
      normalized.endsWith('.js') &&
      parts.length >= 1 &&
      parts.length <= 2 &&
      parts.every((p) => p && p !== '.' && p !== '..')
    if (!valid) return { ok: false, error: '非法的插件入口名' }
    return pluginLoader.uninstallPlugin(normalized)
  })

  // 插件——导出 zip（分享给他人导入）
  // 用 entry 定位（与卸载同源）：目录型 entry = "<dir>/<file>.js"，平铺型 entry = "<name>.js"
  // ——避免 manifest.id 与目录名/文件名不一致时的定位失败
  ipcMain.handle('plugins:export', async (_ev, entryName: string): Promise<PluginExportResult> => {
    const w = getMainWindow()
    if (!w) return { ok: false, error: '窗口不可用' }
    const normalized = String(entryName ?? '').replace(/\\/g, '/')
    const key = normalized.includes('/') ? normalized.split('/')[0] : normalized.replace(/\.js$/i, '')
    if (!key || key === '.' || key === '..' || key.includes('/')) return { ok: false, error: '非法的插件入口名' }
    const pluginsDir = path.join(app.getPath('userData'), 'plugins')
    const brief = getPluginBrief(key, pluginsDir)
    if (!brief) return { ok: false, error: `插件不存在：${entryName}` }
    const result = await dialog.showSaveDialog(w, {
      title: '导出插件',
      defaultPath: `${brief.id}-v${brief.version}.zip`,
      filters: [{ name: '插件包 (zip)', extensions: ['zip'] }],
    })
    if (result.canceled || !result.filePath) return { ok: false, error: '已取消' }
    return exportPluginToZip(key, pluginsDir, result.filePath)
  })

  // 全局配置
  ipcMain.handle('store:config:get', async () => {
    return await globalConfigStore.get()
  })
  ipcMain.handle('store:config:set', async (_ev, config: Partial<GlobalSettings>) => {
    const next = await globalConfigStore.set(config)
    // 配置变更后重建图执行器的共享 LLM provider（null 用默认值兜底）
    flowHost.setLlmProvider(new LlmProvider({
      apiKey: next.apiKey ?? '',
      model: next.model ?? DEFAULT_MODEL,
      baseURL: next.baseURL ?? DEFAULT_BASE_URL,
    }))
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

  // 用户输入 → Runtime（流式；attachments 可选：dataURL 图片，落盘后随消息持久化并作多模态输入）
  ipcMain.handle(
    'chat:send',
    async (
      _ev,
      conversationId: string,
      text: string,
      attachments?: Array<{ dataUrl: string; name?: string }>,
    ): Promise<ChatMessage> => {
      const record = await sendMessage(conversationId, text, attachments)
      // 玩家输入记录不会是内部消息（event-status/tool-result/compact-marker），但类型上容错
      return toChatMessage(record) ?? {
      id: record.id,
      role: 'user',
      content: record.content,
      createdAt: record.createdAt,
      contextId: record.contextId,
      kind: null,
      widgetNode: null,
    }
  })

  // 中断流式响应
  ipcMain.handle('chat:abort', (_ev, conversationId: string): void => {
    const rt = runtimeManager.get(conversationId)
    rt?.abort()
  })
}
