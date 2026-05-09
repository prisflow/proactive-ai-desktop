/**
 * 开放事件信封：type 为字符串，非封闭枚举；插件可使用 plugin.<id>.<name> 等命名空间。
 */

export const CORE_EVENT = {
  USER_TEXT: 'core.user.text',
  IDLE_SAMPLE: 'core.idle.sample',
  SUBAGENT_FINISHED: 'core.subagent.finished',
  TOOL_RESULT: 'core.tool.result',
  MEMORY_SYNCED: 'core.memory.synced',
} as const

export type CoreEventType = (typeof CORE_EVENT)[keyof typeof CORE_EVENT]

export type AgentEventSource = 'kernel' | 'plugin' | 'subagent' | string

export interface AgentEventEnvelope {
  v: 1
  type: string
  conversationId?: string
  source: AgentEventSource
  correlationId?: string
  payload: Record<string, unknown>
  ts: number
}

export function createAgentEvent(
  partial: Omit<AgentEventEnvelope, 'v' | 'ts'> & { ts?: number }
): AgentEventEnvelope {
  return {
    v: 1,
    ts: partial.ts ?? Date.now(),
    type: partial.type,
    conversationId: partial.conversationId,
    source: partial.source,
    correlationId: partial.correlationId,
    payload: partial.payload && typeof partial.payload === 'object' ? partial.payload : {},
  }
}

/** 总线入口最小校验；不限制 type 取值集合 */
export function validateAgentEventEnvelope(raw: unknown): AgentEventEnvelope | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  if (o.v !== 1) return null
  if (typeof o.type !== 'string' || o.type.length === 0) return null
  const source = o.source
  if (typeof source !== 'string' || source.length === 0) return null
  const payload = o.payload
  if (payload !== undefined && (typeof payload !== 'object' || payload === null || Array.isArray(payload))) {
    return null
  }
  const conversationId = o.conversationId
  if (conversationId !== undefined && typeof conversationId !== 'string') return null
  const correlationId = o.correlationId
  if (correlationId !== undefined && typeof correlationId !== 'string') return null
  const ts = o.ts
  if (ts !== undefined && typeof ts !== 'number') return null

  return {
    v: 1,
    type: o.type,
    conversationId: typeof conversationId === 'string' ? conversationId : undefined,
    source,
    correlationId: typeof correlationId === 'string' ? correlationId : undefined,
    payload: (payload as Record<string, unknown>) || {},
    ts: typeof ts === 'number' ? ts : Date.now(),
  }
}
