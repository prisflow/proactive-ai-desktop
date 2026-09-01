/**
 * Token 使用统计 —— Main 进程统计、Renderer 图表的共享数据模型。
 */

/** 总体用量（usage:getTotals）。hitRate 为 0-100 百分比。 */
export interface UsageTotals {
  promptTokens: number
  completionTokens: number
  cachedTokens: number
  totalTokens: number
  hitRate: number
  updatedAt: string
}

/** 每日用量（usage:getDaily）。day 为 "MM-DD"。 */
export interface UsageDaily {
  day: string
  promptTokens: number
  completionTokens: number
  cachedTokens: number
  hitRate: number
}

/** 每小时用量（usage:getHourly）。hour 为 "HH:00"。 */
export interface UsageHourly {
  hour: string
  promptTokens: number
  completionTokens: number
  cachedTokens: number
  hitRate: number
  toolCalls: number
  textCalls: number
}

/** 按上下文聚合的每日用量（usage:getContextDaily）。 */
export interface UsageContextDaily {
  day: string
  /** contextId → 调用次数 */
  contexts: Record<string, number>
}
