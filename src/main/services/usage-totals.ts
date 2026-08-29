import { databaseService } from './store/database'

export interface UsageTotals {
  promptTokens: number
  completionTokens: number
  cachedTokens: number
  totalTokens: number
  hitRate: number // 0-100
  updatedAt: string
}

function rowToTotals(row: { prompt_tokens: number; completion_tokens: number; cached_tokens: number; updated_at: string }): UsageTotals {
  const prompt = row.prompt_tokens || 0
  const cached = row.cached_tokens || 0
  const completion = row.completion_tokens || 0
  return {
    promptTokens: prompt,
    completionTokens: completion,
    cachedTokens: cached,
    totalTokens: prompt + completion,
    hitRate: prompt > 0 ? Math.round((cached / prompt) * 1000) / 10 : 0,
    updatedAt: row.updated_at,
  }
}

export function getUsageTotals(): UsageTotals {
  const db = databaseService.getClient()
  const row = db.prepare('SELECT prompt_tokens, completion_tokens, cached_tokens, updated_at FROM usage_totals WHERE id = ?').get('total') as
    | { prompt_tokens: number; completion_tokens: number; cached_tokens: number; updated_at: string }
    | undefined
  if (!row) return { promptTokens: 0, completionTokens: 0, cachedTokens: 0, totalTokens: 0, hitRate: 0, updatedAt: new Date().toISOString() }
  return rowToTotals(row)
}
// 已改用 Node 系统本地时区（toLocaleDateString sv-SE），不再用 UTC toISOString/dd*86400000

function localDay(d = new Date()): string {
  // 系统本地时区 YYYY-MM-DD（sv-SE 即本地 ISO）
  return d.toLocaleDateString('sv-SE')
}
function localHour(d = new Date()): string {
  const day = d.toLocaleDateString('sv-SE')
  const h = String(d.getHours()).padStart(2, '0')
  return `${day} ${h}:00`
}

export function addUsage(promptTokens: number, completionTokens: number, cachedTokens: number, kind: 'text' | 'tool_calls' = 'text', contextId?: string): UsageTotals {
  const db = databaseService.getClient()
  const now = new Date()
  const day = localDay(now)
  const hour = localHour(now)
  const ctx = contextId || 'main'
  db.prepare(
    `INSERT INTO usage_totals (id, prompt_tokens, completion_tokens, cached_tokens, updated_at)
     VALUES ('total', ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       prompt_tokens = prompt_tokens + excluded.prompt_tokens,
       completion_tokens = completion_tokens + excluded.completion_tokens,
       cached_tokens = cached_tokens + excluded.cached_tokens,
       updated_at = datetime('now')`
  ).run(promptTokens || 0, completionTokens || 0, cachedTokens || 0)
  db.prepare(
    `INSERT INTO usage_daily (day, prompt_tokens, completion_tokens, cached_tokens, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(day) DO UPDATE SET
       prompt_tokens = prompt_tokens + excluded.prompt_tokens,
       completion_tokens = completion_tokens + excluded.completion_tokens,
       cached_tokens = cached_tokens + excluded.cached_tokens,
       updated_at = datetime('now')`
  ).run(day, promptTokens || 0, completionTokens || 0, cachedTokens || 0)
  db.prepare(
    `INSERT INTO usage_hourly (hour, prompt_tokens, completion_tokens, cached_tokens, tool_calls, text_calls, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(hour) DO UPDATE SET
       prompt_tokens = prompt_tokens + excluded.prompt_tokens,
       completion_tokens = completion_tokens + excluded.completion_tokens,
       cached_tokens = cached_tokens + excluded.cached_tokens,
       tool_calls = tool_calls + excluded.tool_calls,
       text_calls = text_calls + excluded.text_calls,
       updated_at = datetime('now')`
  ).run(hour, promptTokens || 0, completionTokens || 0, cachedTokens || 0, kind === 'tool_calls' ? 1 : 0, kind === 'text' ? 1 : 0)
  db.prepare(
    `INSERT INTO usage_context_daily (day, context_id, calls) VALUES (?, ?, 1)
     ON CONFLICT(day, context_id) DO UPDATE SET calls = calls + 1`
  ).run(day, ctx)
  return getUsageTotals()
}

export function getDailyUsage(days = 7): Array<{ day: string; promptTokens: number; completionTokens: number; cachedTokens: number; hitRate: number }> {
  const db = databaseService.getClient()
  const rows = db
    .prepare('SELECT day, prompt_tokens, completion_tokens, cached_tokens FROM usage_daily ORDER BY day DESC LIMIT ?')
    .all(days) as Array<{ day: string; prompt_tokens: number; completion_tokens: number; cached_tokens: number }>
  // 补齐近 7 天（含零），按系统本地日界
  const map = new Map(rows.map((r) => [r.day, r]))
  const out: Array<{ day: string; promptTokens: number; completionTokens: number; cachedTokens: number; hitRate: number }> = []
  for (let i = days - 1; i >= 0; i--) {
    const d0 = new Date()
    d0.setHours(0, 0, 0, 0)
    d0.setDate(d0.getDate() - i)
    const d = localDay(d0)
    const r = map.get(d)
    const prompt = r?.prompt_tokens ?? 0
    const cached = r?.cached_tokens ?? 0
    const completion = r?.completion_tokens ?? 0
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

export function getHourlyUsage(): Array<{ hour: string; promptTokens: number; completionTokens: number; cachedTokens: number; hitRate: number; toolCalls: number; textCalls: number }> {
  const db = databaseService.getClient()
  const rows = db.prepare('SELECT hour, prompt_tokens, completion_tokens, cached_tokens, tool_calls, text_calls FROM usage_hourly ORDER BY hour DESC LIMIT 24').all() as Array<{ hour: string; prompt_tokens: number; completion_tokens: number; cached_tokens: number; tool_calls: number; text_calls: number }>
  const map = new Map(rows.map((r) => [r.hour, r]))
  const out: Array<{ hour: string; promptTokens: number; completionTokens: number; cachedTokens: number; hitRate: number; toolCalls: number; textCalls: number }> = []
  const now = new Date()
  for (let i = 23; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 3600000)
    const h = localHour(d)
    const label = `${String(d.getHours()).padStart(2, '0')}:00`
    const r = map.get(h)
    const prompt = r?.prompt_tokens ?? 0
    const cached = r?.cached_tokens ?? 0
    const completion = r?.completion_tokens ?? 0
    out.push({ hour: label, promptTokens: prompt, completionTokens: completion, cachedTokens: cached, hitRate: prompt > 0 ? Math.round((cached / prompt) * 1000) / 10 : 0, toolCalls: r?.tool_calls ?? 0, textCalls: r?.text_calls ?? 0 })
  }
  return out
}

export function getToolSplit(): { textCalls: number; toolCalls: number; total: number } {
  const db = databaseService.getClient()
  const row = db.prepare('SELECT SUM(tool_calls) as tc, SUM(text_calls) as tx FROM usage_hourly').get() as { tc: number | null; tx: number | null }
  const tc = row?.tc ?? 0
  const tx = row?.tx ?? 0
  return { textCalls: tx, toolCalls: tc, total: (tx ?? 0) + (tc ?? 0) }
}

export function getContextDaily(): Array<{ day: string; contexts: Record<string, number> }> {
  return getContextWeekly()
}

export function getContextWeekly(): Array<{ day: string; contexts: Record<string, number> }> {
  const db = databaseService.getClient()
  const rows = db.prepare('SELECT day, context_id, calls FROM usage_context_daily ORDER BY day DESC LIMIT 50').all() as Array<{ day: string; context_id: string; calls: number }>
  const byDay = new Map<string, Record<string, number>>()
  for (const r of rows) {
    if (!byDay.has(r.day)) byDay.set(r.day, {})
    byDay.get(r.day)![r.context_id] = r.calls
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

export function clearUsage(): void {
  const db = databaseService.getClient()
  db.prepare("UPDATE usage_totals SET prompt_tokens=0, completion_tokens=0, cached_tokens=0, updated_at=datetime('now') WHERE id='total'").run()
  db.prepare('DELETE FROM usage_daily').run()
  db.prepare('DELETE FROM usage_hourly').run()
  db.prepare('DELETE FROM usage_context_daily').run()
}
