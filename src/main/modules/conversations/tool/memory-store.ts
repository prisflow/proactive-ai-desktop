/**
 * 通用记忆存储（host_memory 表）的共享读写函数。
 * 供 builtin 工具、Runtime（压缩器/组装）与插件 API 桥接复用，保证单点逻辑。
 */
import { and, eq, or, like, desc } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { databaseService } from '../../../services/store/database'
import { hostMemoryTable } from '../../../services/store/schema'

/** 记忆行。 */
export interface MemoryRow {
  slot: string
  data: string
  type: string
  importance: string
}

/**
 * 写入/覆盖一条记忆（同会话+上下文+slot 唯一，单条 UPSERT 原子）。
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
  const db = databaseService.getDb()
  const now = new Date().toISOString()
  db.insert(hostMemoryTable)
    .values({ id: randomUUID(), conversationId, contextId, slot, data, type, importance, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [hostMemoryTable.conversationId, hostMemoryTable.contextId, hostMemoryTable.slot],
      set: { data, type, importance, updatedAt: now },
    })
    .run()
}

/** 读取单条记忆，不存在返回 null。 */
export function memoryGet(conversationId: string, contextId: string, slot: string): MemoryRow | null {
  const db = databaseService.getDb()
  const row = db.select()
    .from(hostMemoryTable)
    .where(and(
      eq(hostMemoryTable.conversationId, conversationId),
      eq(hostMemoryTable.contextId, contextId),
      eq(hostMemoryTable.slot, slot),
    ))
    .get()
  return row ? { slot: row.slot, data: row.data, type: row.type, importance: row.importance } : null
}

/** 关键词搜索记忆（slot/data 模糊匹配），最多 20 条。 */
export function memorySearch(conversationId: string, contextId: string, query: string): MemoryRow[] {
  const db = databaseService.getDb()
  const base = and(
    eq(hostMemoryTable.conversationId, conversationId),
    eq(hostMemoryTable.contextId, contextId),
  )
  const where = query
    ? and(base, or(like(hostMemoryTable.slot, `%${query}%`), like(hostMemoryTable.data, `%${query}%`)))
    : base
  const rows = db.select()
    .from(hostMemoryTable)
    .where(where)
    .orderBy(desc(hostMemoryTable.updatedAt))
    .limit(20)
    .all()
  return rows.map((r) => ({ slot: r.slot, data: r.data, type: r.type, importance: r.importance }))
}

/** 删除单条记忆，不存在返回 false。 */
export function memoryRemove(conversationId: string, contextId: string, slot: string): boolean {
  const db = databaseService.getDb()
  const res = db.delete(hostMemoryTable)
    .where(and(
      eq(hostMemoryTable.conversationId, conversationId),
      eq(hostMemoryTable.contextId, contextId),
      eq(hostMemoryTable.slot, slot),
    ))
    .run()
  return res.changes > 0
}