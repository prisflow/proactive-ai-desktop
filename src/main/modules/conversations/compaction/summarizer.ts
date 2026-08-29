/**
 * 压缩器（对齐 opencode checkpoint 方案）：
 *  - 触发：估算请求 token 超预算（由调用方判断，见 Runtime.compactIfNeeded）
 *  - 摘要 + 保留尾部：head 送 LLM 摘要，尾部按 keepTokens 预算保留
 *  - 再压缩：摘要本身超预算时，旧摘要 + 新 head 合并生成新摘要（旧摘要丢弃）
 *  - 产物写入 host_memory 的 summarySlot（覆盖，不无限追加）
 */
import type { LlmMessage, LlmProvider } from '../../llm'
import type { ContextCompactionConfig } from '../context/types'
import { memoryGet, memorySet } from '../tool/memory-store'
import { estimateTokens } from './token'

/** 压缩产物。 */
export interface CompactResult {
  /** 摘要文本（压缩后写入 summarySlot）。 */
  summary: string
  /** 保留的最近消息（新历史）。 */
  kept: LlmMessage[]
}

/** 序列化消息为压缩器可读文本。 */
function serialize(messages: LlmMessage[]): string {
  return messages
    .map((m) => {
      if (m.role === 'tool') return `[tool result] ${m.content || ''}`
      if (m.role === 'assistant' && m.tool_calls?.length) {
        return `[assistant tool call] ${m.tool_calls.map((tc) => `${tc.function.name}(${tc.function.arguments})`).join('; ')}`
      }
      return `[${m.role}] ${m.content || ''}`
    })
    .join('\n')
}

/** 从历史尾部向前累计 token，返回保留起点 index（保留 [start, end)）。 */
function selectTail(messages: LlmMessage[], keepTokens: number): number {
  let total = 0
  let start = messages.length
  for (let i = messages.length - 1; i >= 0; i--) {
    const next = total + estimateTokens(messages[i].content || '')
    if (next > keepTokens) break
    total = next
    start = i
  }
  return start
}

/**
 * 执行压缩：head 摘要 + keepTokens 尾部。
 * @param cfg 压缩配置（已 resolve）
 * @param existingSummary 现有摘要（再压缩时并入）
 * @param llm 压缩用 LLM（宿主 provider，非流式）
 */
export async function compactHistory(
  conversationId: string,
  contextId: string,
  cfg: Required<Omit<ContextCompactionConfig, 'prefixSlots'>> & { prefixSlots: string[] },
  llm: LlmProvider,
  messages: LlmMessage[],
): Promise<CompactResult> {
  const start = selectTail(messages, cfg.keepTokens)
  const head = messages.slice(0, start)
  const kept = messages.slice(start)

  // 再压缩：现有摘要 + 新 head 合并（旧摘要不保留，未带进新摘要的信息即丢失）
  const existing = memoryGet(conversationId, contextId, cfg.summarySlot)?.data ?? ''
  const needResummarize = cfg.allowResummarize && existing.length > 0 && estimateTokens(existing) > cfg.keepTokens * 0.5

  const userText = needResummarize
    ? `<prior-summary>\n${existing}\n</prior-summary>\n\n<conversation>\n${serialize(head)}\n</conversation>`
    : serialize(head)

  const res = await llm.chat([
    { role: 'system', content: cfg.summaryPrompt },
    { role: 'user', content: userText },
  ])

  if (res.kind === 'text' && res.text.trim()) {
    return { summary: res.text.trim(), kept }
  }
  // 压缩失败：保留原历史，放弃本轮压缩（不截断，修复原数据丢失 bug）
  throw new Error('compaction failed: empty summary')
}

/** 压缩成功后把摘要写入记忆槽（覆盖）。 */
export function persistSummary(
  conversationId: string,
  contextId: string,
  cfg: Required<Omit<ContextCompactionConfig, 'prefixSlots'>> & { prefixSlots: string[] },
  summary: string,
): void {
  memorySet(conversationId, contextId, cfg.summarySlot, summary, 'summary', 'core')
}
