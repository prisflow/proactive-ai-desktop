/**
 * SQLite 数据库连接单例。
 * 管理 better-sqlite3 连接生命周期，通过 Drizzle ORM 提供类型安全查询。
 *
 * 表结构唯一真相源：src/main/services/store/schema.ts。
 * 变更流程：改 schema.ts → pnpm drizzle-kit generate → 提交 drizzle/ 下的新迁移文件，
 * 运行时由 migrate() 按 __drizzle_migrations 记录增量执行。
 */
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import fs from 'fs'
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
  /** 产生该消息时的活跃上下文 ID（'main' = 主上下文）。 */
  contextId: string
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
   * 打开数据库文件，启用 WAL 模式和外键约束，执行 Drizzle 迁移。
   * 幂等：重复调用直接返回。
   */
  init(): void {
    if (this.client) return

    this.client = new Database(this.dbPath)
    // 单例单进程下用增量记录文件支持并发读写
    this.client.pragma('journal_mode = WAL')
    this.client.pragma('foreign_keys = ON')

    // 旧库（无迁移记录的库）直接删除重建——此后所有 schema 演进走 drizzle 增量迁移，数据永久保留
    this.ensureFresh()

    this._db = drizzle(this.client)
    this.runMigrations()
  }

  /** 检测并删除旧版手写 schema 的库文件（无 __drizzle_migrations 记录即视为旧库）。 */
  private ensureFresh(): void {
    const db = this.client!
    const hasMigrations = db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'`)
      .get()
    if (hasMigrations) return

    db.close()
    for (const suffix of ['', '-wal', '-shm']) {
      const p = this.dbPath + suffix
      if (fs.existsSync(p)) fs.unlinkSync(p)
    }
    this.client = new Database(this.dbPath)
    this.client.pragma('journal_mode = WAL')
    this.client.pragma('foreign_keys = ON')
  }

  /** 执行 Drizzle 迁移：开发读项目根 drizzle/，打包后读 resources/drizzle。 */
  private runMigrations(): void {
    const dir = app.isPackaged
      ? path.join(process.resourcesPath, 'drizzle')
      : path.join(app.getAppPath(), 'drizzle')
    migrate(this._db!, { migrationsFolder: dir })
  }

  /** 关闭数据库连接。应用退出时调用。 */
  close(): void {
    if (!this.client) return
    this.client.close()
    this.client = null
    this._db = null
  }
}

export const databaseService = new DatabaseService()