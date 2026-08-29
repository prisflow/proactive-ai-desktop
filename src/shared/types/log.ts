/** 日志级别。 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** 单条日志条目，由 Main 进程 LogService 创建，通过 IPC 序列化到 Renderer。 */
export interface LogEntry {
  ts: number
  level: LogLevel
  runId: string
  parentRunId?: string
  source?: string
  event?: 'start' | 'end' | 'error'
  name?: string
  message?: string
  data?: unknown
  stack?: string
  /** 产生该日志的会话 ID（工具/LLM/运行时日志在写入时带上，供日志面板按对话筛选）。 */
  conversationId?: string
}

/** 日志查询过滤条件，所有条件为 AND 关系。 */
export interface LogQuery {
  level?: LogLevel | LogLevel[]
  source?: string
  name?: string
  runId?: string
  parentRunId?: string
  conversationId?: string
  since?: number
  until?: number
  limit?: number
  offset?: number
}
