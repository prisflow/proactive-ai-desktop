import type { LogEntry, LogQuery } from '../../../shared/types/log'

/** 内存 ring buffer，保留最近 N 条日志，供 query() 快速响应。 */
export class RingBuffer {
  private entries: LogEntry[] = []
  private readonly maxSize: number

  constructor(maxSize = 500) {
    this.maxSize = maxSize
  }

  push(entry: LogEntry): void {
    this.entries.push(entry)
    if (this.entries.length > this.maxSize) {
      this.entries.shift()
    }
  }

  /** 按条件过滤 ring buffer 内的条目 */
  query(q: LogQuery): LogEntry[] {
    let result = [...this.entries]
    if (q.level) {
      const levels = Array.isArray(q.level) ? q.level : [q.level]
      result = result.filter(e => levels.includes(e.level))
    }
    if (q.source) result = result.filter(e => e.source === q.source)
    if (q.name) result = result.filter(e => e.name === q.name)
    if (q.runId) result = result.filter(e => e.runId === q.runId)
    if (q.parentRunId) result = result.filter(e => e.parentRunId === q.parentRunId)
    if (q.since) result = result.filter(e => e.ts >= q.since!)
    if (q.until) result = result.filter(e => e.ts <= q.until!)
    result.reverse()
    if (q.offset) result = result.slice(q.offset)
    if (q.limit) result = result.slice(0, q.limit)
    return result
  }

  clear(): void {
    this.entries = []
  }

  toArray(): LogEntry[] {
    return [...this.entries]
  }
}
