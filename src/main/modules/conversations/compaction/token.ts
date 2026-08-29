/**
 * Token 估算（对齐 opencode：chars/4 字符启发式）。
 * 仅用于压缩决策（触发/预算），不用于账单——账单用 provider 返回的实际 usage。
 */
import type { LlmMessage, LlmToolDef } from '../../llm'

/** 估算单段文本的 token 数。 */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4))
}

/** 估算消息数组的 token 数（content + tool_calls 序列化）。 */
export function estimateMessages(messages: LlmMessage[]): number {
  let total = 0
  for (const m of messages) {
    total += estimateTokens(m.content || '')
    if (m.tool_calls?.length) {
      total += estimateTokens(JSON.stringify(m.tool_calls))
    }
  }
  return total
}

/** 估算完整请求（system + messages + tools）的 token 数——对齐 opencode preflight。 */
export function estimateRequest(messages: LlmMessage[], toolDefs: LlmToolDef[]): number {
  return estimateMessages(messages) + estimateTokens(JSON.stringify(toolDefs ?? []))
}
