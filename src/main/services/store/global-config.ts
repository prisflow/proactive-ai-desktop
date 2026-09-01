/**
 * 全局配置持久化。读写 SQLite config 表，启动时自动加载。
 *
 * 语义：get() 返回数据库原样（未设置 = null），不做默认值合并。
 * 默认值兜底由前端显示处（theme/locale/fontSize）与后端请求处（model/baseURL）各自完成。
 */
import type { GlobalSettings } from '@shared/types/domain'
import { databaseService } from './database'
import { configTable } from './schema'

/** GlobalSettings 中需要持久化的键集合 */
const CONFIG_KEYS: (keyof GlobalSettings)[] = ['apiKey', 'model', 'baseURL', 'locale', 'theme', 'fontSize']

export class GlobalConfigStore {
  private cache: GlobalSettings | null = null

  /** 读取全部配置。返回数据库原样；缺失键为 null（无默认合并）。 */
  async get(): Promise<GlobalSettings> {
    if (this.cache) return { ...this.cache }

    const db = databaseService.getDb()
    const rows = db.select().from(configTable).all()

    const config: GlobalSettings = {
      apiKey: null,
      model: null,
      baseURL: null,
      locale: null,
      theme: null,
      fontSize: null,
    }
    for (const row of rows) {
      if (!CONFIG_KEYS.includes(row.key as keyof GlobalSettings)) continue
      try {
        const v = JSON.parse(row.value) as unknown
        ;(config as unknown as Record<string, unknown>)[row.key] = v
      } catch {
        // 单值解析失败跳过，保持 null
      }
    }
    this.cache = config

    return { ...this.cache }
  }

  /** 写入配置并持久化到 SQLite。null 表示清除该键（存 null）。 */
  async set(config: Partial<GlobalSettings>): Promise<GlobalSettings> {
    const current = await this.get()
    const next: GlobalSettings = { ...current, ...config }
    this.cache = next

    const sqlite = databaseService.getClient()
    const upsert = sqlite.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)')
    const deleteStmt = sqlite.prepare('DELETE FROM config WHERE key = ?')
    const txn = sqlite.transaction(() => {
      for (const [key, value] of Object.entries(config)) {
        if (!CONFIG_KEYS.includes(key as keyof GlobalSettings)) continue
        // null = 清除该键（落后于 get 的 null 语义）
        if (value === null) {
          deleteStmt.run(key)
        } else {
          upsert.run(key, JSON.stringify(value))
        }
      }
    })
    txn()

    return { ...next }
  }
}

export const globalConfigStore = new GlobalConfigStore()
