/**
 * ConversationStore —— 对话与消息的 CRUD 持久化层。
 * 通过 Drizzle ORM 提供类型安全查询，无需手写 Row 映射。
 */
import { v4 as uuidv4 } from 'uuid'
import { eq, desc, and, isNull, isNotNull } from 'drizzle-orm'
import type { Conversation } from '@shared/types/domain'
import { databaseService, type MessageRecord, type MessageRole } from './database'
import { conversationsTable, messagesTable } from './schema'
import { pluginStorageService } from './plugin-storage'

/** ISO 8601 当前时间字符串 */
function nowISO(): string {
  return new Date().toISOString()
}

/** Unix 毫秒时间戳 */
function nowMs(): number {
  return Date.now()
}

/** Drizzle 行 → Conversation 领域对象 */
function toConversation(row: typeof conversationsTable.$inferSelect): Conversation {
  return {
    id: row.id,
    title: row.title,
    createdAt: new Date(row.createdAt).getTime(),
    updatedAt: new Date(row.updatedAt).getTime(),
  }
}

/** Drizzle 行 → MessageRecord */
function toMessageRecord(row: typeof messagesTable.$inferSelect): MessageRecord {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role as MessageRole,
    content: row.content,
    contextId: row.contextId,
    extraData: row.extraData ? JSON.parse(row.extraData) : null,
    createdAt: new Date(row.createdAt).getTime(),
  }
}

export class ConversationStore {
  /**
   * 创建新对话。
   * @param title - 对话标题，空时使用默认值
   */
  create(title?: string): Conversation {
    const db = databaseService.getDb()
    const id = uuidv4()
    const now = nowISO()
    const ms = nowMs()

    db.insert(conversationsTable).values({
      id,
      title: title ?? '新对话',
      createdAt: now,
      updatedAt: now,
    }).run()

    return { id, title: title ?? '新对话', createdAt: ms, updatedAt: ms }
  }

  /** 列出所有未归档的对话，按更新时间倒序。 */
  list(): Conversation[] {
    const db = databaseService.getDb()
    const rows = db.select()
      .from(conversationsTable)
      .where(eq(conversationsTable.isArchived, 0))
      .orderBy(desc(conversationsTable.updatedAt))
      .all()

    return rows.map(toConversation)
  }

  /**
   * 获取单个对话详情。
   * @param id - 对话 ID
   * @returns 未找到时返回 undefined
   */
  get(id: string): Conversation | undefined {
    const db = databaseService.getDb()
    const row = db.select()
      .from(conversationsTable)
      .where(and(eq(conversationsTable.id, id), eq(conversationsTable.isArchived, 0)))
      .get()

    return row ? toConversation(row) : undefined
  }

  /**
   * 软删除对话（标记为已归档）。
   * 记录归档时间（purge 依据），同步清理插件存储中该会话的存档数据。
   * 数据保留到 purgeArchived 物理删除（保留期内可恢复/列表隐藏）。
   * @returns 是否删除了记录
   */
  delete(id: string): boolean {
    const db = databaseService.getDb()
    const result = db.update(conversationsTable)
      .set({ isArchived: 1, archivedAt: nowISO() })
      .where(and(eq(conversationsTable.id, id), eq(conversationsTable.isArchived, 0)))
      .run()

    if (result.changes > 0) {
      pluginStorageService.removeConversation(id)
    }

    return result.changes > 0
  }

  /**
   * 物理删除超过保留期的归档对话（purge）。
   * 软删除的数据不会自动消失，需定期调用本方法清理：
   * 删除 conversations 行 → messages/host_memory 经 ON DELETE CASCADE 自动级联删除。
   * @param olderThanDays 保留期（天），归档超过该天数则物理删除。默认 30 天。
   * @returns 物理删除的对话数
   */
  purgeArchived(olderThanDays = 30): number {
    const db = databaseService.getDb()
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString()
    // archivedAt 是 UTC ISO 字符串，字典序比较即时间序
    const rows = db.select({ id: conversationsTable.id, archivedAt: conversationsTable.archivedAt })
      .from(conversationsTable)
      .where(and(eq(conversationsTable.isArchived, 1), isNotNull(conversationsTable.archivedAt)))
      .all()
    const expired = rows.filter((r) => r.archivedAt! < cutoff)
    let deleted = 0
    for (const r of expired) {
      db.delete(conversationsTable).where(eq(conversationsTable.id, r.id)).run()
      deleted++
    }
    return deleted
  }

  /**
   * 更新对话属性。
   * @param id - 对话 ID
   * @param updates - 要更新的字段
   * @returns 更新后的对话，未找到时返回 undefined
   */
  update(id: string, updates: Partial<Pick<Conversation, 'title'>>): Conversation | undefined {
    const current = this.get(id)
    if (!current) return undefined

    const title = updates.title ?? current.title
    const now = nowISO()

    const db = databaseService.getDb()
    db.update(conversationsTable)
      .set({ title, updatedAt: now })
      .where(eq(conversationsTable.id, id))
      .run()

    return { ...current, title, updatedAt: nowMs() }
  }

  /**
   * 向指定对话追加一条消息。
   * 自动生成 UUID 和时间戳，同时更新对话的 updated_at。
   *
   * @param conversationId - 目标对话 ID
   * @param msg - 消息内容（不含 id 和 createdAt）
   */
  addMessage(conversationId: string, msg: Omit<MessageRecord, 'id' | 'createdAt' | 'conversationId'>): MessageRecord {
    const db = databaseService.getDb()
    const id = uuidv4()
    // created_at 严格递增：同毫秒连续落库（如 assistant(tool_calls)+tool-result）时 +1ms，
    // 保证 DB 顺序 = 落库顺序，回放排序稳定（否则同毫秒两条顺序不定，tool 可能排在 assistant 前 → 配对断裂）
    const now = nowISO()
    const last = db.select({ createdAt: messagesTable.createdAt })
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, conversationId))
      .orderBy(desc(messagesTable.createdAt))
      .limit(1)
      .get()
    const createdAt = last && last.createdAt >= now ? new Date(new Date(last.createdAt).getTime() + 1).toISOString() : now
    const nowMsVal = new Date(createdAt).getTime()

    db.insert(messagesTable).values({
      id,
      conversationId,
      role: msg.role,
      content: msg.content,
      contextId: msg.contextId,
      extraData: msg.extraData ? JSON.stringify(msg.extraData) : null,
      createdAt,
    }).run()

    db.update(conversationsTable)
      .set({ updatedAt: createdAt })
      .where(eq(conversationsTable.id, conversationId))
      .run()

    return {
      id,
      conversationId,
      role: msg.role,
      content: msg.content,
      contextId: msg.contextId,
      extraData: msg.extraData ?? null,
      createdAt: nowMsVal,
    }
  }

  /**
   * 获取指定对话的所有消息，按创建时间升序排列。
   * @param conversationId - 对话 ID
   */
  getMessages(conversationId: string): MessageRecord[] {
    const db = databaseService.getDb()
    const rows = db.select()
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, conversationId))
      .orderBy(messagesTable.createdAt)
      .all()

    return rows.map(toMessageRecord)
  }

  /**
   * 获取指定对话中指定上下文的消息，按创建时间升序排列。
   * contextId 为 null 的历史消息（旧数据）归入 'main'。
   * @param conversationId - 对话 ID
   * @param contextId - 上下文 ID
   */
  getMessagesByContext(conversationId: string, contextId: string): MessageRecord[] {
    const db = databaseService.getDb()
    const rows = db.select()
      .from(messagesTable)
      .where(and(
        eq(messagesTable.conversationId, conversationId),
        contextId === 'main'
          ? isNull(messagesTable.contextId)
          : eq(messagesTable.contextId, contextId),
      ))
      .orderBy(messagesTable.createdAt)
      .all()

    return rows.map(toMessageRecord)
  }

  /**
   * 物理删除单条消息（孤儿 tool 清理用）。
   * @returns 是否删除成功
   */
  deleteMessage(id: string): boolean {
    const db = databaseService.getDb()
    const result = db.delete(messagesTable).where(eq(messagesTable.id, id)).run()
    return result.changes > 0
  }
}

export const conversationStore = new ConversationStore()
