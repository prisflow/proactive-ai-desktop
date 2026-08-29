/**
 * 全局配置持久化。读写 SQLite config 表，启动时自动加载。
 */
import type { GlobalSettings } from '@shared/types/domain'
import { DEFAULT_MODEL, DEFAULT_BASE_URL, DEFAULT_THEME, DEFAULT_FONT_SIZE } from '@shared/constants'
import { databaseService } from './database'
import { configTable } from './schema'

const DEFAULT_CONFIG: GlobalSettings = {
  apiKey: '',
  model: DEFAULT_MODEL,
  baseURL: DEFAULT_BASE_URL,
  theme: DEFAULT_THEME,
  fontSize: DEFAULT_FONT_SIZE,
}

/** GlobalSettings 中需要持久化的键集合 */
const CONFIG_KEYS: (keyof GlobalSettings)[] = ['apiKey', 'model', 'baseURL', 'locale', 'theme', 'fontSize']

export class GlobalConfigStore {
  private cache: GlobalSettings | null = null

  /** 读取全部配置。先检查缓存，再从 SQLite 读取。 */
  async get(): Promise<GlobalSettings> {
    if (this.cache) return { ...this.cache }

    const db = databaseService.getDb()
    const rows = db.select().from(configTable).all()

    if (rows.length > 0) {
      const parsed: Record<string, unknown> = {}
      for (const row of rows) {
        parsed[row.key] = JSON.parse(row.value)
      }
      this.cache = { ...DEFAULT_CONFIG, ...parsed } as GlobalSettings
    } else {
      this.cache = { ...DEFAULT_CONFIG }
    }

    return { ...this.cache }
  }

  /** 写入配置并持久化到 SQLite。 */
  async set(config: Partial<GlobalSettings>): Promise<GlobalSettings> {
    const current = await this.get()
    const next: GlobalSettings = { ...current, ...config }
    this.cache = next

    const sqlite = databaseService.getClient()
    // 预编译 upsert 语句：key 已存在则整行替换，不存在则插入（SQLite 的 INSERT OR REPLACE 语义）
    const upsert = sqlite.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)')
    // 事务包裹：本次配置的多个键要么全部写入成功，要么全部回滚，避免半写状态
    const txn = sqlite.transaction(() => {
      for (const [key, value] of Object.entries(config)) {
        // 只持久化白名单内的键，未知键（如前端传来的多余字段）直接跳过
        if (!CONFIG_KEYS.includes(key as keyof GlobalSettings)) continue
        // 值以 JSON 字符串落库，键为 GlobalSettings 字段名；带类型捕获 write 返回占位参数
        upsert.run(key, JSON.stringify(value))
      }
    })
    // 提交事务（同步执行，better-sqlite3 的 transaction 是同步 API）
    txn()

    return { ...next }
  }
}

export const globalConfigStore = new GlobalConfigStore()
