import fs from 'fs/promises'
import path from 'path'
import { app } from 'electron'
import { BaseCallbackHandler } from '@langchain/core/callbacks/base'

export type TraceLevel = 'chain' | 'llm' | 'tool' | 'node' | 'error'

export type TraceEntry = {
  ts: number
  level: TraceLevel
  event: 'start' | 'end' | 'error'
  runId: string
  parentRunId?: string
  name?: string
  threadId?: string
  inputs?: unknown
  outputs?: unknown
  error?: string
  tags?: string[]
  metadata?: Record<string, unknown>
}

// ─────────────────────────────────────────────
// 配置
// ─────────────────────────────────────────────

const MAX_TRACE_FILE_BYTES = 2 * 1024 * 1024   // 2MB 后轮转
const MAX_TRACE_FILES = 3                        // 最多保留 3 个历史文件
const ERROR_RING_SIZE = 50                       // 内存中保留最近 50 条错误
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000       // 每 5 分钟检查一次

// ─────────────────────────────────────────────
// TraceWriter：串行写入 + 文件轮转
// ─────────────────────────────────────────────

class TraceWriter {
  private filePath: string
  private writeChain: Promise<void> = Promise.resolve()
  private currentSize: number | null = null
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor(filePath: string) {
    this.filePath = filePath
    this.startCleanupTimer()
  }

  async append(entry: TraceEntry): Promise<void> {
    const line = JSON.stringify(entry) + '\n'
    this.writeChain = this.writeChain.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true })
      await fs.appendFile(this.filePath, line, 'utf-8')
    })
    await this.writeChain
  }

  /** 获取当前日志文件大小（缓存，每次清理时刷新） */
  private async getFileSize(): Promise<number> {
    try {
      const stat = await fs.stat(this.filePath)
      this.currentSize = stat.size
      return stat.size
    } catch {
      this.currentSize = 0
      return 0
    }
  }

  /** 定时清理：超过大小限制则轮转 */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      void this.rotateIfNeeded()
    }, CLEANUP_INTERVAL_MS)
    // 不要阻止进程退出
    if (this.cleanupTimer.unref) this.cleanupTimer.unref()
  }

  private async rotateIfNeeded(): Promise<void> {
    try {
      const size = await this.getFileSize()
      if (size < MAX_TRACE_FILE_BYTES) return

      // 轮转：trace.jsonl → trace.1.jsonl → trace.2.jsonl → 删除最老的
      for (let i = MAX_TRACE_FILES - 1; i >= 1; i--) {
        const older = this.rotatedPath(i)
        const newer = this.rotatedPath(i - 1)
        try {
          await fs.rename(newer, older)
        } catch {
          // 文件不存在，跳过
        }
      }
      // 当前文件 → trace.0.jsonl
      try {
        await fs.rename(this.filePath, this.rotatedPath(0))
      } catch {
        // 当前文件可能不存在
      }
      this.currentSize = 0
      console.log('[trace] rotated log files')
    } catch (e) {
      console.error('[trace] rotation failed', e)
    }
  }

  private rotatedPath(index: number): string {
    const ext = path.extname(this.filePath)   // .jsonl
    const base = path.basename(this.filePath, ext)
    const dir = path.dirname(this.filePath)
    return path.join(dir, `${base}.${index}${ext}`)
  }

  /** 停止定时器（应用退出时调用） */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }
}

// ─────────────────────────────────────────────
// ErrorRing：内存中保留最近的错误条目
// ─────────────────────────────────────────────

class ErrorRing {
  private entries: TraceEntry[] = []
  private readonly maxSize: number

  constructor(maxSize = ERROR_RING_SIZE) {
    this.maxSize = maxSize
  }

  push(entry: TraceEntry): void {
    if (entry.event !== 'error' && entry.level !== 'error') return
    this.entries.push(entry)
    if (this.entries.length > this.maxSize) {
      this.entries.shift()
    }
  }

  /** 返回最近的错误（最新在前） */
  snapshot(): TraceEntry[] {
    return [...this.entries].reverse()
  }

  clear(): void {
    this.entries = []
  }
}

// ─────────────────────────────────────────────
// AgentTraceLogger
// ─────────────────────────────────────────────

export class AgentTraceLogger {
  private writer: TraceWriter
  private errorRing: ErrorRing

  constructor() {
    const filePath = path.join(app.getPath('userData'), 'agent-trace.jsonl')
    this.writer = new TraceWriter(filePath)
    this.errorRing = new ErrorRing()
  }

  async log(
    level: TraceLevel,
    event: 'start' | 'end' | 'error',
    opts: {
      runId: string
      name?: string
      threadId?: string
      inputs?: unknown
      outputs?: unknown
      error?: string
    }
  ): Promise<void> {
    const entry: TraceEntry = {
      ts: Date.now(),
      level,
      event,
      ...opts,
    }
    this.errorRing.push(entry)
    await this.writer.append(entry)
  }

  createCallbackHandler(): AgentTracerCallbackHandler {
    return new AgentTracerCallbackHandler(this)
  }

  /** 获取最近的错误条目（最新在前） */
  getRecentErrors(): TraceEntry[] {
    return this.errorRing.snapshot()
  }

  /** 清空内存中的错误记录 */
  clearErrors(): void {
    this.errorRing.clear()
  }

  /** 停止定时清理（应用退出时调用） */
  stop(): void {
    this.writer.stop()
  }
}

// ─────────────────────────────────────────────
// LangGraph 回调处理器
// ─────────────────────────────────────────────

class AgentTracerCallbackHandler extends BaseCallbackHandler {
  name = 'AgentTracer'

  constructor(private logger: AgentTraceLogger) {
    super()
  }

  async onChainStart(
    chain: { name: string },
    inputs: Record<string, unknown>,
    runId: string,
    parentRunId?: string
  ): Promise<void> {
    await this.logger.log('chain', 'start', {
      runId,
      parentRunId,
      name: chain.name,
      inputs,
    })
  }

  async onChainEnd(
    outputs: Record<string, unknown>,
    runId: string,
    parentRunId?: string
  ): Promise<void> {
    await this.logger.log('chain', 'end', {
      runId,
      parentRunId,
      outputs,
    })
  }

  async onChainError(error: Error, runId: string, parentRunId?: string): Promise<void> {
    await this.logger.log('chain', 'error', {
      runId,
      parentRunId,
      error: error.message,
    })
  }
}
