/** 所有 Widget 原子组件共有的属性。 */
export interface AtomProps {
  className?: string
}

/** WidgetButton 额外属性 */
interface WidgetButtonProps {
  content?: string
  action?: { type: 'send'; text: string }
  messageId?: string
}

/** 按钮。素色卡片风格。点击时若 action 存在则发送消息。按钮所属的 UI 消息存在即可交互（不要求最新）。 */
export function WidgetButton({ content, className, action, messageId }: AtomProps & WidgetButtonProps) {
  const handleClick = async () => {
    if (!action || action.type !== 'send') return
    const { useChatStore } = await import('@/stores/chatStore')
    const { useConversationStore } = await import('@/stores/conversationStore')
    const convId = useConversationStore.getState().currentConversationId
    if (!convId) return
    // 该 widgetNode 消息仍存在于对话中即可点击（引擎可能在 UI 推送后又追加文字说明，
    // 若要求"必须是最新消息"会把这些按钮全部置灰）
    const msgs = useChatStore.getState().messages[convId] ?? []
    if (!msgs.some((m) => m.id === messageId && m.widgetNode)) return
    useChatStore.getState().sendMessage(convId, action.text)
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm text-black hover:bg-gray-800 hover:text-white hover:border-gray-600 ${className || ''}`}
    >
      {content}
    </button>
  )
}

/** 文本。仅控制字号，颜色和粗细统一跟随主题。保留换行与空白（支持多行剧情）。 */
export function WidgetText({ content, size = 'sm', className }: { content?: string; size?: 'xs' | 'sm' | 'md' | 'lg' } & AtomProps) {
  const s: Record<string, string> = { xs: 'text-[10px]', sm: 'text-xs', md: 'text-sm', lg: 'text-base' }
  return <span className={`${s[size] || s.sm} whitespace-pre-wrap break-words text-[var(--app-fg)] ${className || ''}`}>{content}</span>
}

/** 水平分割线。 */
export function WidgetDivider({ className }: AtomProps) {
  return <div className={`h-px w-full bg-[var(--app-border)] ${className || ''}`} />
}
