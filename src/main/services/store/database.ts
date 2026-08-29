/**
 * SQLite 数据库连接单例。
 * 管理 better-sqlite3 连接生命周期，通过 Drizzle ORM 提供类型安全查询。
 */
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import path from 'path'
import { app } from 'electron'

/** 消息角色：user = 用户输入，context = 上下文内产出 */
export type MessageRole = 'user' | 'context'

/** 存储层消息记录。IPC 层映射为 ChatMessage 供渲染层使用。 */
export interface MessageRecord {
  id: string
  conversationId: string
  role: MessageRole
  content: string
  contextId: string | null
  extraData: Record<string, unknown> | null
  createdAt: number
}

export class DatabaseService {
  private client: Database.Database | null = null
  private _db: BetterSQLite3Database | null = null
  private dbPath: string

  constructor() {
    this.dbPath = path.join(app.getPath('userData'), 'proactive-ai.db')
  }

  /**
   * 获取 Drizzle ORM 数据库实例。调用前必须先调用 init()。
   * @throws {Error} 未初始化时抛出
   */
  getDb(): BetterSQLite3Database {
    if (!this._db) {
      throw new Error('Database not initialized. Call init() first.')
    }
    return this._db
  }

  /**
   * 获取底层 better-sqlite3 客户端。
   * 仅在需要事务或特殊 SQL 操作时使用。
   */
  getClient(): Database.Database {
    if (!this.client) {
      throw new Error('Database not initialized. Call init() first.')
    }
    return this.client
  }

  /**
   * 初始化数据库连接。
   * 打开数据库文件，启用 WAL 模式和外键约束，执行 schema 迁移。
   * 幂等：重复调用直接返回。
   */
  init(): void {
    if (this.client) return

    this.client = new Database(this.dbPath)
    // 单例单进程下用增量记录文件支持并发读写
    this.client.pragma('journal_mode = WAL')
    this.client.pragma('foreign_keys = ON')
    this._db = drizzle(this.client)

    this.ensureSchema()
  }

  /** 关闭数据库连接。应用退出时调用。 */
  close(): void {
    if (!this.client) return
    this.client.close()
    this.client = null
    this._db = null
  }

  /**
   * 幂等建表（每次启动执行）。
   * 应用尚未发行任何版本、无存量数据需要升级，因此不需要版本迁移体系。
   * 将来 schema 演进时，直接在此追加 CREATE / ALTER 语句即可。
   */
  private ensureSchema(): void {
    const db = this.client!

    db.exec(`
      CREATE TABLE IF NOT EXISTS config (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL DEFAULT '',
        is_archived INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id              TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role            TEXT NOT NULL CHECK(role IN ('user','context')),
        content         TEXT NOT NULL,
        context_id      TEXT,
        extra_data      TEXT,
        created_at      TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_messages_conversation
        ON messages(conversation_id, created_at);

      CREATE TABLE IF NOT EXISTS plugin_data (
        plugin_id TEXT PRIMARY KEY,
        data      TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS usage_totals (
        id                TEXT PRIMARY KEY,
        prompt_tokens     INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        cached_tokens     INTEGER NOT NULL DEFAULT 0,
        updated_at        TEXT NOT NULL
      );
      INSERT OR IGNORE INTO usage_totals (id, prompt_tokens, completion_tokens, cached_tokens, updated_at)
        VALUES ('total', 0, 0, 0, datetime('now'));

      CREATE TABLE IF NOT EXISTS usage_daily (
        day               TEXT PRIMARY KEY,
        prompt_tokens     INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        cached_tokens     INTEGER NOT NULL DEFAULT 0,
        updated_at        TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS usage_hourly (
        hour              TEXT PRIMARY KEY,
        prompt_tokens     INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        cached_tokens     INTEGER NOT NULL DEFAULT 0,
        tool_calls        INTEGER NOT NULL DEFAULT 0,
        text_calls        INTEGER NOT NULL DEFAULT 0,
        updated_at        TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS usage_context_daily (
        day               TEXT NOT NULL,
        context_id        TEXT NOT NULL,
        calls             INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, context_id)
      );

      CREATE TABLE IF NOT EXISTS host_memory (
        id                TEXT PRIMARY KEY,
        conversation_id   TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        context_id        TEXT NOT NULL,
        slot              TEXT NOT NULL,
        data              TEXT NOT NULL,
        type              TEXT NOT NULL DEFAULT 'note',
        importance        TEXT NOT NULL DEFAULT 'normal',
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL,
        UNIQUE(conversation_id, context_id, slot)
      );
      CREATE INDEX IF NOT EXISTS idx_host_memory_cid_ctx
        ON host_memory(conversation_id, context_id);
      CREATE INDEX IF NOT EXISTS idx_host_memory_slot
        ON host_memory(conversation_id, context_id, slot);
    `)

    // 旧库兜底：为已存在的 conversations 表补 archived_at 列（幂等，列已存在则忽略）
    const cols = db.prepare(`PRAGMA table_info(conversations)`).all() as Array<{ name: string }>
    if (!cols.some((c) => c.name === 'archived_at')) {
      db.exec(`ALTER TABLE conversations ADD COLUMN archived_at TEXT`)
    }
  }
}

export const databaseService = new DatabaseService()
