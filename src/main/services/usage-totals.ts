import { eq, sql } from 'drizzle-orm'
import { databaseService } from './store/database'
import {
  usageTotalsTable,
  usageDailyTable,
  usageHourlyTable,
  usageContextDailyTable,
} from './store/schema'
import type { UsageTotals, UsageDaily, UsageHourly, UsageContextDaily } from '@shared/types/usage'

function rowToTotals(row: typeof usageTotalsTable.$inferSelect): UsageTotals {
  const prompt = row.promptTokens || 0
  const cached = row.cachedTokens || 0
  const completion = row.completionTokens || 0
  return {
    promptTokens: prompt,
    completionTokens: completion,
    cachedTokens: cached,
    totalTokens: prompt + completion,
    hitRate: prompt > 0 ? Math.round((cached / prompt) * 1000) / 10 : 0,
    updatedAt: row.updatedAt,
  }
}

/**
 * 读取累计用量（usage_totals 单行 'total'）。
 * 无记录时返回全零 + 当前时间，供首次启动兜底。
 */
export function getUsageTotals(): UsageTotals {
  const db = databaseService.getDb()
  const row = db.select().from(usageTotalsTable).where(eq(usageTotalsTable.id, 'total')).get()
  if (!row) return { promptTokens: 0, completionTokens: 0, cachedTokens: 0, totalTokens: 0, hitRate: 0, updatedAt: new Date().toISOString() }
  return rowToTotals(row)
}

function localDay(d = new Date()): string {
  // 系统本地时区 YYYY-MM-DD（sv-SE 即本地 ISO）
  return d.toLocaleDateString('sv-SE')
}
function localHour(d = new Date()): string {
  const day = d.toLocaleDateString('sv-SE')
  const h = String(d.getHours()).padStart(2, '0')
  return `${day} ${h}:00`
}

/**
 * 记录一次 LLM 调用用量：同步 UPSERT 累加到 4 张表
 * （usage_totals 累计 / usage_daily 按日 / usage_hourly 按小时 / usage_context_daily 按上下文调用次数）。
 * @param promptTokens 输入 token 数
 * @param completionTokens 输出 token 数
 * @param cachedTokens 缓存命中 token 数（算命中率用）
 * @param kind 调用类型：'tool_calls' = 工具调用轮；'text' = 纯文本轮
 * @param contextId 产生该调用的上下文 ID（缺省归入 'main'）
 * @returns 累加后的累计用量
 */
export function addUsage(promptTokens: number, completionTokens: number, cachedTokens: number, kind: 'text' | 'tool_calls' = 'text', contextId?: string): UsageTotals {
  const db = databaseService.getDb()
  const now = new Date()
  const day = localDay(now)
  const hour = localHour(now)
  const ctx = contextId || 'main'
  db.insert(usageTotalsTable)
    .values({ id: 'total', promptTokens: promptTokens || 0, completionTokens: completionTokens || 0, cachedTokens: cachedTokens || 0, updatedAt: sql`datetime('now')` })
    .onConflictDoUpdate({
      target: usageTotalsTable.id,
      set: {
        promptTokens: sql`${usageTotalsTable.promptTokens} + excluded.prompt_tokens`,
        completionTokens: sql`${usageTotalsTable.completionTokens} + excluded.completion_tokens`,
        cachedTokens: sql`${usageTotalsTable.cachedTokens} + excluded.cached_tokens`,
        updatedAt: sql`datetime('now')`,
      },
    })
    .run()
  db.insert(usageDailyTable)
    .values({ day, promptTokens: promptTokens || 0, completionTokens: completionTokens || 0, cachedTokens: cachedTokens || 0, updatedAt: sql`datetime('now')` })
    .onConflictDoUpdate({
      target: usageDailyTable.day,
      set: {
        promptTokens: sql`${usageDailyTable.promptTokens} + excluded.prompt_tokens`,
        completionTokens: sql`${usageDailyTable.completionTokens} + excluded.completion_tokens`,
        cachedTokens: sql`${usageDailyTable.cachedTokens} + excluded.cached_tokens`,
        updatedAt: sql`datetime('now')`,
      },
    })
    .run()
  db.insert(usageHourlyTable)
    .values({ hour, promptTokens: promptTokens || 0, completionTokens: completionTokens || 0, cachedTokens: cachedTokens || 0, toolCalls: kind === 'tool_calls' ? 1 : 0, textCalls: kind === 'text' ? 1 : 0, updatedAt: sql`datetime('now')` })
    .onConflictDoUpdate({
      target: usageHourlyTable.hour,
      set: {
        promptTokens: sql`${usageHourlyTable.promptTokens} + excluded.prompt_tokens`,
        completionTokens: sql`${usageHourlyTable.completionTokens} + excluded.completion_tokens`,
        cachedTokens: sql`${usageHourlyTable.cachedTokens} + excluded.cached_tokens`,
        toolCalls: sql`${usageHourlyTable.toolCalls} + excluded.tool_calls`,
        textCalls: sql`${usageHourlyTable.textCalls} + excluded.text_calls`,
        updatedAt: sql`datetime('now')`,
      },
    })
    .run()
  db.insert(usageContextDailyTable)
    .values({ day, contextId: ctx, calls: 1 })
    .onConflictDoUpdate({
      target: [usageContextDailyTable.day, usageContextDailyTable.contextId],
      set: { calls: sql`${usageContextDailyTable.calls} + 1` },
    })
    .run()
  return getUsageTotals()
}

/**
 * 查询最近 N 天按日用量（含零日补齐，按系统本地日界，day 输出为 MM-DD）。
 * @param days 返回天数，默认 7
 */
export function getDailyUsage(days = 7): UsageDaily[] {
  const db = databaseService.getDb()
  const rows = db.select()
    .from(usageDailyTable)
    .orderBy(sql`${usageDailyTable.day} DESC`)
    .limit(days)
    .all()
  // 补齐近 7 天（含零），按系统本地日界
  const map = new Map(rows.map((r) => [r.day, r]))
  const out: UsageDaily[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d0 = new Date()
    d0.setHours(0, 0, 0, 0)
    d0.setDate(d0.getDate() - i)
    const d = localDay(d0)
    const r = map.get(d)
    const prompt = r?.promptTokens ?? 0
    const cached = r?.cachedTokens ?? 0
    const completion = r?.completionTokens ?? 0
    out.push({
      day: d.slice(5),
      promptTokens: prompt,
      completionTokens: completion,
      cachedTokens: cached,
      hitRate: prompt > 0 ? Math.round((cached / prompt) * 1000) / 10 : 0,
    })
  }
  return out
}

/**
 * 查询最近 24 小时按小时用量（含零补齐，hour 输出为 HH:00）。
 */
export function getHourlyUsage(): UsageHourly[] {
  const db = databaseService.getDb()
  const rows = db.select()
    .from(usageHourlyTable)
    .orderBy(sql`${usageHourlyTable.hour} DESC`)
    .limit(24)
    .all()
  const map = new Map(rows.map((r) => [r.hour, r]))
  const out: UsageHourly[] = []
  const now = new Date()
  for (let i = 23; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 3600000)
    const h = localHour(d)
    const label = `${String(d.getHours()).padStart(2, '0')}:00`
    const r = map.get(h)
    const prompt = r?.promptTokens ?? 0
    const cached = r?.cachedTokens ?? 0
    const completion = r?.completionTokens ?? 0
    out.push({ hour: label, promptTokens: prompt, completionTokens: completion, cachedTokens: cached, hitRate: prompt > 0 ? Math.round((cached / prompt) * 1000) / 10 : 0, toolCalls: r?.toolCalls ?? 0, textCalls: r?.textCalls ?? 0 })
  }
  return out
}

/** 查询各上下文每日调用次数（别名，语义与 getContextWeekly 一致）。 */
export function getContextDaily(): UsageContextDaily[] {
  return getContextWeekly()
}

/**
 * 查询最近 7 天各上下文的调用次数分布。
 * 返回每天一个条目，contexts 为该日 context_id → 调用次数的映射（无记录的日期为空对象）。
 */
export function getContextWeekly(): UsageContextDaily[] {
  const db = databaseService.getDb()
  const rows = db.select()
    .from(usageContextDailyTable)
    .orderBy(sql`${usageContextDailyTable.day} DESC`)
    .limit(50)
    .all()
  const byDay = new Map<string, Record<string, number>>()
  for (const r of rows) {
    if (!byDay.has(r.day)) byDay.set(r.day, {})
    byDay.get(r.day)![r.contextId] = r.calls
  }
  const days: string[] = []
  for (let i = 6; i >= 0; i--) {
    const d0 = new Date()
    d0.setHours(0, 0, 0, 0)
    d0.setDate(d0.getDate() - i)
    const d = localDay(d0).slice(5)
    days.push(d)
  }
  // 实际返回最近 7 天的聚合
  const fullDays: string[] = []
  for (let i = 6; i >= 0; i--) {
    const d0 = new Date()
    d0.setHours(0, 0, 0, 0)
    d0.setDate(d0.getDate() - i)
    fullDays.push(localDay(d0))
  }
  return fullDays.map((d) => ({ day: d.slice(5), contexts: byDay.get(d) || {} }))
}

/**
 * 清空全部用量统计：累计归零，按日/按小时/按上下文明细删除。
 */
export function clearUsage(): void {
  const db = databaseService.getDb()
  db.update(usageTotalsTable)
    .set({ promptTokens: 0, completionTokens: 0, cachedTokens: 0, updatedAt: sql`datetime('now')` })
    .where(eq(usageTotalsTable.id, 'total'))
    .run()
  db.delete(usageDailyTable).run()
  db.delete(usageHourlyTable).run()
  db.delete(usageContextDailyTable).run()
}