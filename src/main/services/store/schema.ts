/**
 * Drizzle ORM 表定义。
 * 作为类型安全的 schema 单源，替代 DbConversation/DbMessage 手写接口。
 * 时间戳均以 ISO 字符串存储（text），不用 SQLite 的 datetime 类型。
 */
import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core'

/** 全局配置表：key-value 存储，key 为 GlobalSettings 的字段名。 */
export const configTable = sqliteTable('config', {
  /** 配置键名（GlobalSettings 字段名，如 apiKey / model / baseURL）。 */
  key: text('key').primaryKey(),
  /** 配置值（JSON 序列化后的字符串）。 */
  value: text('value').notNull(),
})

/** 对话元数据表。 */
export const conversationsTable = sqliteTable('conversations', {
  /** 对话 ID（UUID）。 */
  id: text('id').primaryKey(),
  /** 对话标题，默认"新对话"，首条消息后自动重命名。 */
  title: text('title').notNull().default('新对话'),
  /** 软删除标记：1 = 已归档（列表隐藏），0 = 正常。 */
  isArchived: integer('is_archived').notNull().default(0),
  /** 归档时间（ISO 字符串），purge 依据：超过保留期的归档物理删除。 */
  archivedAt: text('archived_at'),
  /** 创建时间（ISO 字符串）。 */
  createdAt: text('created_at').notNull(),
  /** 最后活动时间（ISO 字符串），会话列表排序依据。 */
  updatedAt: text('updated_at').notNull(),
})

/** 插件持久化数据表：一个插件一行，data 为任意 JSON。 */
export const pluginDataTable = sqliteTable('plugin_data', {
  /** 插件唯一 ID（如 cultivation）。 */
  pluginId: text('plugin_id').primaryKey(),
  /** 插件自有数据（JSON 序列化后的字符串）。 */
  data: text('data').notNull(),
})

/** Token 使用总量表：单行 id='total'，输入/输出分开，缓存命中算命中率。 */
export const usageTotalsTable = sqliteTable('usage_totals', {
  id: text('id').primaryKey(),
  promptTokens: integer('prompt_tokens').notNull().default(0),
  completionTokens: integer('completion_tokens').notNull().default(0),
  cachedTokens: integer('cached_tokens').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
})

/** Token 按日统计表：day='YYYY-MM-DD'，输入/输出/缓存分开。 */
export const usageDailyTable = sqliteTable('usage_daily', {
  day: text('day').primaryKey(),
  promptTokens: integer('prompt_tokens').notNull().default(0),
  completionTokens: integer('completion_tokens').notNull().default(0),
  cachedTokens: integer('cached_tokens').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
})

/** Token 按小时统计表：hour='YYYY-MM-DD HH:00'，含工具/文本调用数。 */
export const usageHourlyTable = sqliteTable('usage_hourly', {
  hour: text('hour').primaryKey(),
  promptTokens: integer('prompt_tokens').notNull().default(0),
  completionTokens: integer('completion_tokens').notNull().default(0),
  cachedTokens: integer('cached_tokens').notNull().default(0),
  toolCalls: integer('tool_calls').notNull().default(0),
  textCalls: integer('text_calls').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
})

/** 按上下文一周请求次数表：day + context_id */
export const usageContextDailyTable = sqliteTable('usage_context_daily', {
  day: text('day').notNull(),
  contextId: text('context_id').notNull(),
  calls: integer('calls').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.day, t.contextId] })])

/** 通用记忆层：按会话+上下文隔离，单条为 slot 键。 */
export const hostMemoryTable = sqliteTable('host_memory', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => conversationsTable.id, { onDelete: 'cascade' }),
  contextId: text('context_id').notNull(),
  slot: text('slot').notNull(),
  data: text('data').notNull(),
  type: text('type').notNull().default('note'),
  importance: text('importance').notNull().default('normal'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  index('idx_host_memory_cid_ctx').on(table.conversationId, table.contextId),
  index('idx_host_memory_slot').on(table.conversationId, table.contextId, table.slot),
])

/** 消息表：一个对话的多条消息，级联删除。 */
export const messagesTable = sqliteTable('messages', {
  /** 消息 ID（UUID）。 */
  id: text('id').primaryKey(),
  /** 所属对话 ID，外键关联 conversations，对话删除时级联删除消息。 */
  conversationId: text('conversation_id').notNull().references(() => conversationsTable.id, { onDelete: 'cascade' }),
  /** 消息角色：user = 用户输入；context = AI 产出（文本回复 / UI 渲染 / 中间轮次）。 */
  role: text('role').notNull().$type<'user' | 'context'>(),
  /** 消息正文（用户文本或 AI 回复内容）。 */
  content: text('content').notNull(),
  /** 产生该消息时的活跃上下文 ID（当前为 null，未来插件上下文用）。 */
  contextId: text('context_id'),
  /** 附加数据（JSON 字符串，如 uiRender 组件树 / rawResponse 等）。 */
  extraData: text('extra_data'),
  /** 创建时间（ISO 字符串）。 */
  createdAt: text('created_at').notNull(),
}, (table) => [
  /** 按对话查消息的复合索引（conversationId + createdAt 排序）。 */
  index('idx_messages_conversation').on(table.conversationId, table.createdAt),
])
