/** 日志级别。 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** 单条日志条目，由 Main 进程 LogService 创建，通过 IPC 序列化到 Renderer。 */
export interface LogEntry {
  /** 时间戳（ms）。 */
  ts: number
  /** 日志级别。 */
  level: LogLevel
  /** 生成该日志的运行链 ID（工具/LLM/回合的链路根）。 */
  runId: string
  /** 父运行 ID（子运行指向父，构成链路树；根运行无父为 null）。 */
  parentRunId: string | null
  /** 来源（如 renderer / 模块名；未标注为 null）。 */
  source: string | null
  /** 事件阶段：start（开始）/ end（结束）/ error（错误）；普通日志无阶段为 null。 */
  event: 'start' | 'end' | 'error' | null
  /** 语义名称（如 runtime.init / loader.load；未命名为 null）。 */
  name: string | null
  /** 日志正文消息（无正文为 null）。 */
  message: string | null
  /** 附加结构化数据（任意 JSON；无数据为 null 或 undefined）。 */
  data: unknown
  /** 错误堆栈（仅错误日志有；无栈为 null）。 */
  stack: string | null
  /** 产生该日志的会话 ID（工具/LLM/运行时日志在写入时带上，供日志面板按对话筛选；非会话相关为 null）。 */
  conversationId: string | null
}

/**
 * 日志查询过滤条件，所有条件为 AND 关系。
 * 不落库——纯查询入参，全部可选（不传即不过滤该维度）。
 */
export interface LogQuery {
  /** 按级别过滤（单个或多个）。 */
  level?: LogLevel | LogLevel[]
  /** 按来源过滤。 */
  source?: string
  /** 按语义名称过滤。 */
  name?: string
  /** 按运行链 ID 过滤。 */
  runId?: string
  /** 按父运行 ID 过滤。 */
  parentRunId?: string
  /** 按会话 ID 过滤。 */
  conversationId?: string
  /** 起始时间（ms，含）。 */
  since?: number
  /** 截止时间（ms，含）。 */
  until?: number
  /** 返回条数上限。 */
  limit?: number
  /** 分页偏移。 */
  offset?: number
}
