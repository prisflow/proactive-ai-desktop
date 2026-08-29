import type { LogEntry, LogLevel } from '@shared'

/** 按 runId 聚合后的日志行：同 runId 的 start/end 合并为一行，展开可见原始条目。 */
export interface AggRow {
  runId: string
  ts: number
  level: LogLevel
  source?: string
  name: string
  message?: string
  ok?: boolean
  entries: LogEntry[]
}

/** 级别 → 标签颜色。 */
export const LEVEL_COLORS: Record<string, string> = {
  debug: 'bg-slate-500',
  info: 'bg-blue-500',
  warn: 'bg-amber-500',
  error: 'bg-red-500',
}

/** 级别严重度从低到高，用于取一组日志中的最严重级别。 */
const LEVEL_ORDER: LogLevel[] = ['debug', 'info', 'warn', 'error']

/** 格式化时间戳为 `HH:mm:ss.SSS` 格式 */
export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  })
}

/** 取一组日志中的最严重级别（error > warn > info > debug）。 */
export function worstLevel(entries: LogEntry[]): LogLevel {
  let worst: LogLevel = 'debug'
  for (const e of entries) {
    if (LEVEL_ORDER.indexOf(e.level) > LEVEL_ORDER.indexOf(worst)) worst = e.level
  }
  return worst
}

/** 截短 runId 便于展示，超长时保留头部 + 省略号。 */
export function shortRunId(id: string, max = 16): string {
  return id.length > max ? `${id.slice(0, max - 3)}…` : id
}

/**
 * 规范化日志显示名：`tool.create_world.finished` 这类总线事件去掉与 source 重复的 tool 前缀，
 * 并转为 `create_world · finished` 形式；其余保持 `source · name`。
 */
export function displayName(source: string | undefined, name: string | undefined): { source?: string; name: string } {
  const n = name || ''
  if (n.startsWith('tool.')) {
    const rest = n.slice('tool.'.length)
    const dot = rest.lastIndexOf('.')
    return dot > 0 ? { name: `${rest.slice(0, dot)} · ${rest.slice(dot + 1)}` } : { name: rest }
  }
  return { source, name: n }
}

/**
 * 按 runId 聚合日志：同 runId 的 start/end 合并为一行。
 * - ts 取组内最早产生时刻（倒序流中 start 晚于 end 出现，取 min）
 * - ok 取 end.data.ok（无 end 或非布尔则为 undefined）
 * - 返回按 ts 倒序（最新在上）
 */
export function aggregateLogs(entries: LogEntry[]): AggRow[] {
  const map = new Map<string, AggRow>()
  for (const e of entries) {
    if (!map.has(e.runId)) {
      map.set(e.runId, {
        runId: e.runId,
        ts: e.ts,
        level: e.level,
        source: e.source,
        name: e.name || '',
        message: e.message,
        entries: [],
      })
    }
  }
  for (const e of entries) {
    const g = map.get(e.runId)!
    g.entries.push(e)
    if (e.ts < g.ts) {
      g.ts = e.ts
      g.level = e.level
      g.source = e.source
      g.name = e.name || ''
      g.message = e.message
    }
    if (e.event === 'end') {
      const d = e.data as { ok?: boolean } | undefined
      if (d && typeof d.ok === 'boolean') g.ok = d.ok
    }
  }
  const rows = [...map.values()]
  rows.sort((a, b) => b.ts - a.ts)
  return rows
}
