import { app } from 'electron'
import path from 'path'
import { RotatingFileWriter } from './rotating-writer'
import { RingBuffer } from './ring-buffer'
import type { LogEntry, LogLevel, LogQuery } from '../../../shared/types/log'

let runSeq = 0

/**
 * 生成带前缀的唯一 runId。
 * 日志调用必须使用唯一 runId（getChain 按 runId 归组节点），
 * 禁止用常量 runId（如 'runtime'），否则不同对话/会话的日志会被串成一棵调用链树。
 */
export function uniqueRunId(prefix: string): string {
  runSeq++
  return `${prefix}_${Date.now()}_${runSeq}`
}

function applyFilter(entries: LogEntry[], q: LogQuery): LogEntry[] {
  let result = entries
  if (q.level) {
    const levels = Array.isArray(q.level) ? q.level : [q.level]
    result = result.filter(e => levels.includes(e.level))
  }
  if (q.source) result = result.filter(e => e.source === q.source)
  if (q.name) result = result.filter(e => e.name === q.name)
  if (q.runId) result = result.filter(e => e.runId === q.runId)
  if (q.parentRunId) result = result.filter(e => e.parentRunId === q.parentRunId)
  if (q.conversationId) result = result.filter(e => e.conversationId === q.conversationId)
  if (q.since) result = result.filter(e => e.ts >= q.since!)
  if (q.until) result = result.filter(e => e.ts <= q.until!)
  return result
}

/**
 * 日志服务 —— Main 进程单例，统一写入 app.trace.log。
 *
 * 写：日志同时写入磁盘（RotatingFileWriter）和内存（RingBuffer），
 *     并在 runIdMap / parentMap 建立索引供快速查询。
 * 读：query() 走内存 ring buffer 快速响应；
 *     queryAll() 走索引合并 disk + ring 全量返回；
 *     getChain() 按 parentRunId BFS 遍历调用树。
 */
export class LogService {
  private writer: RotatingFileWriter
  private ring: RingBuffer
  private filePath: string

  private diskEntries: LogEntry[] = []
  private runIdMap = new Map<string, LogEntry[]>()
  private parentMap = new Map<string, Set<string>>()
  private diskReady = false
  private diskLoadPromise: Promise<void> | null = null

  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'app.trace.log')
    this.writer = new RotatingFileWriter(this.filePath)
    this.ring = new RingBuffer()
    this.diskLoadPromise = this.loadDiskEntriesAsync()
  }

  /** 写入一条日志：写盘 + ring buffer + 内存索引 */
  append(entry: LogEntry): void {
    const line = JSON.stringify(entry)
    this.ring.push(entry)
    this.writer.append(line)
    this.indexEntry(entry)
  }

  /**
   * 结构化日志 API。
   * @param level - 日志级别
   * @param event - start / end / error 或 undefined
   * @param opts.runId - 必须唯一
   */
  log(
    level: LogLevel,
    event: 'start' | 'end' | 'error' | undefined,
    opts: {
      runId: string
      parentRunId?: string
      source?: string
      name?: string
      message?: string
      data?: unknown
      stack?: string
      conversationId?: string
    }
  ): void {
    this.append({
      ts: Date.now(),
      level,
      event: event ?? null,
      runId: opts.runId,
      parentRunId: opts.parentRunId ?? null,
      source: opts.source ?? null,
      name: opts.name ?? null,
      message: opts.message ?? null,
      data: opts.data,
      stack: opts.stack ?? null,
      conversationId: opts.conversationId ?? null,
    })
  }

  /** 内存热查询，仅查 ring buffer */
  query(q: LogQuery = {}): LogEntry[] {
    return this.ring.query(q)
  }

  /** 全量查询，走内存索引（disk + ring），命中 runId 时 O(1) 返回 */
  async queryAll(q: LogQuery = {}): Promise<LogEntry[]> {
    await this.ensureDiskReady()
    let entries: LogEntry[]
    if (q.runId) {
      entries = this.runIdMap.get(q.runId) || []
      entries = applyFilter(entries, { ...q, runId: undefined })
    } else {
      entries = [...this.diskEntries, ...this.ring.toArray()]
      entries = applyFilter(entries, q)
    }
    entries.sort((a, b) => b.ts - a.ts)
    if (q.offset) entries = entries.slice(q.offset)
    if (q.limit) entries = entries.slice(0, q.limit)
    return entries
  }

  /**
   * 链式追踪：从指定 runId 出发做双向 BFS 收集调用链。
   *
   * 链路定义：
   * - 节点 = 一个 runId（runIdMap 把同 runId 的多条日志归为一个节点）
   * - 父子边 = parentRunId（向下经 parentMap 找子节点，向上经 entry.parentRunId 找父节点）
   * - 目前 parentRunId 尚未有调用方赋值，因此实际展示为"同 runId 归组"；
   *   将来恢复链路字段后自动获得树形结构。
   */
  async getChain(runId: string, maxDepth = 20): Promise<LogEntry[]> {
    await this.ensureDiskReady()
    const result: LogEntry[] = []
    const visited = new Set<string>()
    const queue: string[] = [runId]
    let depth = 0

    while (queue.length > 0 && depth < maxDepth) {
      const currentId = queue.shift()!
      if (visited.has(currentId)) continue
      visited.add(currentId)

      const entries = this.runIdMap.get(currentId)
      if (entries) {
        result.push(...entries)
        const children = this.parentMap.get(currentId)
        if (children) {
          for (const childId of children) {
            if (!visited.has(childId)) queue.push(childId)
          }
        }
        for (const e of entries) {
          if (e.parentRunId && !visited.has(e.parentRunId)) {
            queue.push(e.parentRunId)
          }
        }
      }
      depth++
    }

    result.sort((a, b) => a.ts - b.ts)
    return result
  }

  /** 清空所有日志 */
  async clear(): Promise<void> {
    this.ring.clear()
    this.diskEntries = []
    this.runIdMap.clear()
    this.parentMap.clear()
    await this.writer.clearAll()
  }

  /** 停止定时轮转（应用退出时调用） */
  stop(): void {
    this.writer.stop()
  }

  private indexEntry(entry: LogEntry): void {
    const list = this.runIdMap.get(entry.runId)
    if (list) { list.push(entry) } else { this.runIdMap.set(entry.runId, [entry]) }
    if (entry.parentRunId) {
      const set = this.parentMap.get(entry.parentRunId)
      if (set) { set.add(entry.runId) } else { this.parentMap.set(entry.parentRunId, new Set([entry.runId])) }
    }
  }

  /** 启动时异步读盘重建内存索引。readAllLines 会连轮转历史文件一起读，保证重启后 queryAll 仍能查到旧日志。 */
  private async loadDiskEntriesAsync(): Promise<void> {
    try {
      const lines = await this.writer.readAllLines()
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as LogEntry
          this.diskEntries.push(entry)
          this.indexEntry(entry)
        } catch { /* skip malformed */ }
      }
    } catch { /* ignore */ }
    finally { this.diskReady = true }
  }

  private async ensureDiskReady(): Promise<void> {
    if (this.diskReady) return
    if (this.diskLoadPromise) await this.diskLoadPromise
  }
}

/** 全局 LogService 单例，模块加载时自动初始化 */
export const logService = new LogService()
