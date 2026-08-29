/**
 * PluginStorageService —— 插件持久化存储。
 * 每个插件一行 plugin_data 表，值可以是任意 JSON（如游戏世界存档）。
 * 通过 PluginSetupAPI.storage 暴露给插件，插件运行在主进程，无需 IPC。
 */
import { eq } from 'drizzle-orm'
import { databaseService } from './database'
import { pluginDataTable } from './schema'

export class PluginStorageService {
  /**
   * 读取插件数据。
   * @param pluginId - 插件 ID
   * @returns 解析后的数据，无记录或 JSON 损坏时返回 null
   */
  get(pluginId: string): unknown {
    const db = databaseService.getDb()
    const row = db.select()
      .from(pluginDataTable)
      .where(eq(pluginDataTable.pluginId, pluginId))
      .get()
    if (!row) return null
    try {
      return JSON.parse(row.data)
    } catch {
      return null
    }
  }

  /**
   * 写入插件数据（整体覆盖该插件的数据）。
   * @param pluginId - 插件 ID
   * @param data - 任意 JSON 可序列化的数据
   */
  set(pluginId: string, data: unknown): void {
    const db = databaseService.getDb()
    const json = JSON.stringify(data)
    db.insert(pluginDataTable)
      .values({ pluginId, data: json })
      .onConflictDoUpdate({ target: pluginDataTable.pluginId, set: { data: json } })
      .run()
  }

  /**
   * 会话删除时清理插件数据。
   * 按约定插件数据顶层以 conversationId 为键（如 { [cid]: world }），
   * 遍历所有插件行删除对应键，防止孤儿存档无限堆积。
   * 仅删除"值为对象"的顶层键，插件级全局数据不受影响。
   * @param conversationId - 被删除的会话 ID
   */
  removeConversation(conversationId: string): void {
    const db = databaseService.getDb()
    const rows = db.select().from(pluginDataTable).all()
    for (const row of rows) {
      let data: unknown
      try {
        data = JSON.parse(row.data)
      } catch {
        continue
      }
      if (typeof data !== 'object' || data === null || Array.isArray(data)) continue
      const record = data as Record<string, unknown>
      if (!(conversationId in record)) continue
      const value = record[conversationId]
      if (typeof value !== 'object' || value === null) continue
      delete record[conversationId]
      this.set(row.pluginId, record)
    }
  }
}

export const pluginStorageService = new PluginStorageService()
