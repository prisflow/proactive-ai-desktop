/**
 * 压缩层配置：per-context 可配置 + 全局默认。
 * 宿主通用压缩策略对齐 opencode 方案：
 *  - 触发：上次请求真实 usage（provider prompt_tokens）> window - output（见 Runtime.compactIfNeeded）
 *  - 摘要 + 保留尾部（checkpoint 式），摘要超预算时"摘要的摘要"
 *  - 稳定前缀来源：context 配置的 prefixSlots 记忆（world_setting/game_lore）
 */
import type { ContextCompactionConfig } from '../context/types'

/** 全局默认压缩配置（未配置的 context 使用）。tokenBudget 弃用，不再参与触发。 */
export const DEFAULT_COMPACTION: Required<Omit<ContextCompactionConfig, 'prefixSlots' | 'tokenBudget'>> & { prefixSlots: string[] } = {
  summaryPrompt:
    '你是对话压缩器。把给定的对话记录压缩成紧凑摘要，供后续对话参考。' +
    '要求：保留关键事实、决定、用户偏好与待办事项；按时间顺序归纳为短段落；' +
    '只归纳事实，不输出评论；输出纯文本，300字以内。',
  summarySlot: 'summary',
  summaryLabel: '',
  keepTokens: 8000,
  allowResummarize: true,
  prefixSlots: ['summary'],
}

/** 合并 per-context 配置与全局默认。 */
export function resolveCompaction(cfg?: ContextCompactionConfig): Required<Omit<ContextCompactionConfig, 'prefixSlots' | 'tokenBudget'>> & { prefixSlots: string[] } {
  return {
    summaryPrompt: cfg?.summaryPrompt ?? DEFAULT_COMPACTION.summaryPrompt,
    summarySlot: cfg?.summarySlot ?? DEFAULT_COMPACTION.summarySlot,
    summaryLabel: cfg?.summaryLabel ?? DEFAULT_COMPACTION.summaryLabel,
    keepTokens: cfg?.keepTokens ?? DEFAULT_COMPACTION.keepTokens,
    allowResummarize: cfg?.allowResummarize ?? DEFAULT_COMPACTION.allowResummarize,
    prefixSlots: cfg?.prefixSlots ?? DEFAULT_COMPACTION.prefixSlots,
  }
}
