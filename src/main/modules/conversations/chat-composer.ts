/**
 * 统一消息组装器 —— 调度器与全部 flow 节点共用的三段式骨架：
 *
 *   [system] 共享稳定层（context 配置的 prefixSlots 记忆 + 插件 prefix 注入，慢变 → 缓存恒命中）
 *   [...公共聊天记录（当前上下文 history 原样消息数组，线性增长 → 前缀命中）]
 *   [user]   尾部指令块（插件 suffix 注入 + 各调用方自有：PROMPT/schema/输入，位于末尾不影响前缀命中）
 *
 * 所有的历史数据来源唯一（Runtime 内存 history ↔ DB 双写同步），
 * 组装只做引用与拼接，不做二次转换——保证调度器线与 flow 线的前缀逐字一致。
 * 历史尾部未应答的 assistant(tool_calls)（flow 执行中快照）整体裁剪，不补占位，
 * 使 flow 的请求前缀与调度器 REQ 完全一致，共享同一条缓存前缀。
 */
import { systemNote, type LlmMessage } from '../llm'
import { memoryGet } from './tool/memory-store'
import { resolveCompaction } from './compaction/config'
import { headInjectionStore } from './head-injection'
import { contextRegistry } from './context/context-manager'

/** 读慢变稳定层（context 配置的 prefixSlots 记忆 + 会话级头部注入），拼为稳定前缀文本。 */
export function loadStablePrefix(conversationId: string, contextId: string): string {
  const cfg = resolveCompaction(contextRegistry.get(contextId)?.compaction)
  const parts: string[] = []
  // per-context prefixSlots：默认 ['summary']，cultivation 配 ['game_lore']
  for (const slot of cfg.prefixSlots) {
    const row = memoryGet(conversationId, contextId, slot)
    if (row?.data) {
      parts.push(row.data)
    }
  }
  // 插件头部注入（prompts.set，固定/慢变文本 → 缓存恒命中）
  parts.push(...headInjectionStore.get(conversationId, contextId))
  return parts.join('\n\n')
}

/**
 * 组装完整 LLM 消息数组（调度器 / flow 节点通用）：
 * @param opts.conversationId 会话 ID
 * @param opts.contextId 上下文 ID（记忆隔离键）
 * @param opts.history 公共聊天记录（Runtime 内存 history 快照，原样消息数组）
 * @param opts.tail 尾部指令块（本次调用的角色 PROMPT / 输入 / schema 指令等）
 * @returns [system(稳定层), ...healed history, user(tail)]
 */
export function composeContextMessages(opts: {
  conversationId: string
  contextId: string
  history: LlmMessage[]
  tail: string
}): LlmMessage[] {
  // 稳定层：慢变记忆，任何变化仅使其后局部失效，前缀主体恒命中；无稳定内容时 system 为空
  const stable = loadStablePrefix(opts.conversationId, opts.contextId)
  const systemContent = stable ? `【世界状态】\n${stable}` : ''

  // 尾部指令块：调用方 tail 在后（快变，不影响前缀命中）。
  // 角色模板（initialPrompt）以 assistant 消息注入（保持尾部位置、不占 system 前缀、不影响缓存命中）
  const tail = opts.tail

  // 配对缝合：OpenAI 要求 assistant.tool_calls 必须被后续 tool 消息应答。
  // 历史中若存在未应答的 tool_calls（abort/崩溃/DB 排序错乱残留），不裁剪（裁剪会丢历史、误伤），
  // 而是补一条"已中断"tool 消息紧跟其后，保证配对完整、语义保留（模型知道自己发过调用但被中断）。
  // 已配对的保留原样。
  const answered = new Set<string>()
  for (const m of opts.history) {
    if (m.role === 'tool' && m.tool_call_id) answered.add(m.tool_call_id)
  }
  const healed: LlmMessage[] = []
  for (const m of opts.history) {
    healed.push(m)
    if (m.role === 'assistant' && m.tool_calls?.length) {
      for (const tc of m.tool_calls) {
        if (!answered.has(tc.id)) {
          healed.push({ role: 'tool', tool_call_id: tc.id, content: '[工具调用已中断，未执行]' })
          answered.add(tc.id)
        }
      }
    }
  }

  // 线性增长段追加在稳定层之后：已存在部分永远命中，仅新增尾部 miss。
  // 角色模板（initialPrompt）以 user + 【系统提示】标注注入（systemNote 包装）——
  // 位于尾部不影响前缀命中；不用 assistant（thinking 模式编造 assistant 会被 API 拒绝）。
  const result: LlmMessage[] = []
  if (systemContent) result.push({ role: 'system', content: systemContent })
  result.push(...healed)
  result.push(systemNote(tail))
  return result
}
