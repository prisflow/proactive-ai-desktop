/**
 * 压缩层配置：per-context 可配置 + 全局默认。
 * 宿主通用压缩策略对齐 opencode 方案：
 *  - token 估算（chars/4）触发，而非消息条数
 *  - 摘要 + 保留尾部（checkpoint 式），摘要超预算时"摘要的摘要"
 *  - 稳定前缀与尾部指令的插件注入点（prompts）
 */
import type { ContextCompactionConfig } from '../context/types'

/** 全局默认压缩配置（未配置的 context 使用）。 */
export const DEFAULT_COMPACTION: Required<Omit<ContextCompactionConfig, 'prefixSlots'>> & { prefixSlots: string[] } = {
  summaryPrompt:
    '你是对话压缩器。把给定的对话记录压缩成紧凑摘要，供后续对话参考。' +
    '要求：保留关键事实、决定、用户偏好与待办事项；按时间顺序归纳为短段落；' +
    '只归纳事实，不输出评论；输出纯文本，300字以内。',
  summarySlot: 'summary',
  summaryLabel: '',
  tokenBudget: 60000,
  keepTokens: 8000,
  allowResummarize: true,
  prefixSlots: ['summary'],
}

/** 合并 per-context 配置与全局默认。 */
export function resolveCompaction(cfg?: ContextCompactionConfig): Required<Omit<ContextCompactionConfig, 'prefixSlots'>> & { prefixSlots: string[] } {
  return {
    summaryPrompt: cfg?.summaryPrompt ?? DEFAULT_COMPACTION.summaryPrompt,
    summarySlot: cfg?.summarySlot ?? DEFAULT_COMPACTION.summarySlot,
    summaryLabel: cfg?.summaryLabel ?? DEFAULT_COMPACTION.summaryLabel,
    tokenBudget: cfg?.tokenBudget ?? DEFAULT_COMPACTION.tokenBudget,
    keepTokens: cfg?.keepTokens ?? DEFAULT_COMPACTION.keepTokens,
    allowResummarize: cfg?.allowResummarize ?? DEFAULT_COMPACTION.allowResummarize,
    prefixSlots: cfg?.prefixSlots ?? DEFAULT_COMPACTION.prefixSlots,
  }
}

/**
 * 固定提示词注入存储（PluginSetupAPI.prompts）。
 * key 形如 `${contextId}:${where}`，value 为注入文本列表（按注入顺序）。
 * 宿主组装三段式骨架时读取（chat-composer）。
 */
class PromptInjectionStore {
  private map = new Map<string, string[]>()

  private key(contextId: string, where: 'prefix' | 'suffix'): string {
    return `${contextId}:${where}`
  }

  inject(contextId: string, where: 'prefix' | 'suffix', text: string): void {
    const k = this.key(contextId, where)
    const list = this.map.get(k) ?? []
    if (!list.includes(text)) list.push(text)
    this.map.set(k, list)
  }

  remove(contextId: string, where: 'prefix' | 'suffix', text: string): void {
    const k = this.key(contextId, where)
    const list = this.map.get(k)
    if (!list) return
    const next = list.filter((t) => t !== text)
    if (next.length) this.map.set(k, next)
    else this.map.delete(k)
  }

  /** 读取指定位置的注入文本（按注入顺序拼接）。 */
  get(contextId: string, where: 'prefix' | 'suffix'): string[] {
    return this.map.get(this.key(contextId, where)) ?? []
  }
}

/** 全局单例。 */
export const promptInjectionStore = new PromptInjectionStore()
