/**
 * 通用记忆存储（host_memory 表）的共享读写函数。
 * 供 builtin 工具、Runtime（压缩器/组装）与插件 API 桥接复用，保证单点逻辑。
 */
import { databaseService } from '../../../services/store/database'
import { randomUUID } from 'crypto'

/** 记忆行。 */
export interface MemoryRow {
  slot: string
  data: string
  type: string
  importance: string
}

/**
 * 写入/覆盖一条记忆（同会话+上下文+slot 唯一）。
 * @param type 记忆类型（world/character/faction/note 等）
 * @param importance 重要度
 */
export function memorySet(
  conversationId: string,
  contextId: string,
  slot: string,
  data: string,
  type = 'note',
  importance: 'core' | 'normal' = 'normal',
): void {
  const db = databaseService.getClient()
  const now = new Date().toISOString()
  const existing = db.prepare('SELECT id FROM host_memory WHERE conversation_id=? AND context_id=? AND slot=?').get(conversationId, contextId, slot) as { id: string } | undefined
  if (existing) {
    db.prepare('UPDATE host_memory SET data=?, type=?, importance=?, updated_at=? WHERE id=?').run(data, type, importance, now, existing.id)
  } else {
    db.prepare('INSERT INTO host_memory (id, conversation_id, context_id, slot, data, type, importance, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(), conversationId, contextId, slot, data, type, importance, now, now)
  }
}

/** 读取单条记忆，不存在返回 null。 */
export function memoryGet(conversationId: string, contextId: string, slot: string): MemoryRow | null {
  const db = databaseService.getClient()
  const row = db.prepare('SELECT slot, data, type, importance FROM host_memory WHERE conversation_id=? AND context_id=? AND slot=?').get(conversationId, contextId, slot) as MemoryRow | undefined
  return row ?? null
}

/** 关键词搜索记忆（slot/data 模糊匹配），最多 20 条。 */
export function memorySearch(conversationId: string, contextId: string, query: string): MemoryRow[] {
  const db = databaseService.getClient()
  if (query) {
    const like = `%${query}%`
    return db.prepare('SELECT slot, data, type, importance FROM host_memory WHERE conversation_id=? AND context_id=? AND (slot LIKE ? OR data LIKE ?) ORDER BY updated_at DESC LIMIT 20').all(conversationId, contextId, like, like) as MemoryRow[]
  }
  return db.prepare('SELECT slot, data, type, importance FROM host_memory WHERE conversation_id=? AND context_id=? ORDER BY updated_at DESC LIMIT 20').all(conversationId, contextId) as MemoryRow[]
}

/** 删除单条记忆，不存在返回 false。 */
export function memoryRemove(conversationId: string, contextId: string, slot: string): boolean {
  const db = databaseService.getClient()
  const res = db.prepare('DELETE FROM host_memory WHERE conversation_id=? AND context_id=? AND slot=?').run(conversationId, contextId, slot)
  return res.changes > 0
}

/** 追加式写入（读旧值 + 拼接 + 覆盖），用于 game_lore 叙事史累积。 */
export function memoryAppend(
  conversationId: string,
  contextId: string,
  slot: string,
  segment: string,
  type = 'note',
  importance: 'core' | 'normal' = 'normal',
): void {
  const existing = memoryGet(conversationId, contextId, slot)
  const joined = existing?.data ? `${existing.data}\n${segment}` : segment
  memorySet(conversationId, contextId, slot, joined, type, importance)
}