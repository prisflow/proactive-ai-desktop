/**
 * MessageRecord（DB 原始行）→ ChatMessage（前端展示模型）的统一转换。
 * Main 进程内所有历史出口（conversations:getMessages IPC / Web 中继 history）必须共用，
 * 保证 PC 与浏览器拿到的历史逐字节一致：
 * - role 归一：DB 'context' → 'assistant'
 * - 内部消息过滤：event-status / tool-result / compact-marker 不外露
 * - 上下文切换占位 → kind='context-switch'（解析目标 contextId）
 * - UI 卡片从 extraData.uiRender 重建 widgetNode
 */
import type { ChatMessage } from '../../../shared/types/domain'
import type { WidgetNode, WidgetNodeType } from '../../../shared/types/ui'
import type { MessageRecord } from '../../services/store/database'

export function toChatMessage(msg: MessageRecord): ChatMessage | null {
  const kind = (msg.extraData as { kind?: string; toolName?: string } | null)?.kind
  const toolName = (msg.extraData as { toolName?: string } | null)?.toolName
  const isContextSwitch = kind === 'tool-result' && (toolName === 'host_enter_subcontext' || toolName === 'host_exit_subcontext')
  if (!isContextSwitch && (kind === 'event-status' || kind === 'tool-result' || kind === 'compact-marker')) return null
  const chatMsg: ChatMessage = {
    id: msg.id,
    role: msg.role === 'context' ? 'assistant' : 'user',
    content: msg.content,
    createdAt: msg.createdAt,
    contextId: msg.contextId,
    kind: isContextSwitch ? 'context-switch' : null,
    widgetNode: null,
  }
  // 切换占位：enter 的占位 contextId 是 null（归属 main），但标签需显示目标子上下文名。
  // 从占位 content 的 JSON 里解析目标 contextId 挂到 chatMsg.contextId
  if (isContextSwitch && toolName === 'host_enter_subcontext') {
    try {
      const parsed = JSON.parse(msg.content) as { contextId?: string }
      if (parsed.contextId) chatMsg.contextId = parsed.contextId
    } catch { /* 解析失败保持原样 */ }
  }
  // SQLite extraData.uiRender → widgetNode（含 children 递归）
  if (msg.extraData?.uiRender) {
    const ui = msg.extraData.uiRender as { component: string; props: Record<string, unknown>; children?: unknown[] }
    chatMsg.widgetNode = {
      type: ui.component as WidgetNodeType,
      props: ui.props ?? {},
      children: Array.isArray(ui.children) ? ui.children as WidgetNode[] : null,
    }
  }
  // 空内容且无 UI 的 assistant 消息不显示（零文本 tool_calls 轮 / 空 stop 轮）
  if (!chatMsg.widgetNode && !String(chatMsg.content || '').trim() && chatMsg.role === 'assistant') return null
  return chatMsg
}

/** 批量转换 + 过滤内部消息。 */
export function toChatMessages(records: MessageRecord[]): ChatMessage[] {
  return records.map(toChatMessage).filter((m): m is ChatMessage => m !== null)
}