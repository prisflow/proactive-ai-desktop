import { useChatStore } from '@/stores/chatStore'
import { useConversationStore } from '@/stores/conversationStore'
import { useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle, useLayoutEffect } from 'react'
import { formatDate } from '@/utils/helpers'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { MarkdownView } from '@/components/markdown/MarkdownView'
import { renderWidgetNode } from '@/components/widget-system'
import { useTranslation } from 'react-i18next'
import { getConversationMessages } from '@/api'
import type { ChatMessage } from '@shared'

interface ChatAreaProps {
  onScrollChange?: (atBottom: boolean) => void
}

export interface ChatAreaHandle {
  /** 将最后一条用户消息滚动到视口顶部。调用方需传入最新消息列表。 */
  scrollToLastUserMessage: (msgs: ChatMessage[], behavior?: 'smooth' | 'instant') => void
}

/** 从消息数组中找出最后一条 user 消息的 DOM 元素 */
function getLastUserMsgEl(msgs: ChatMessage[]): HTMLElement | null {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'user') {
      return document.getElementById(`msg-${msgs[i].id}`)
    }
  }
  return null
}

/**
 * 消息列表渲染区域。
 *
 * 三种状态：Hero 标题 / 空状态 / 消息列表。
 *
 * 自动滚动 + 弹性 min-height 占位：
 *   用户发新消息后，获取当前容器原始 scrollHeight，
 *   计算 spacerPx = max(0, 视口高度 - (scrollHeight - userMsg.offsetTop))，
 *   容器 min-height = scrollHeight + spacerPx，
 *   使 user 消息下方空间 ≥ 视口高度。
 *   滚动由 scrollToLastUserMessage 统一处理，不依赖闭包。
 */
export default forwardRef<ChatAreaHandle, ChatAreaProps>(function ChatArea({ onScrollChange }, ref) {
  const { t } = useTranslation()
  const { messages, busyConversations } = useChatStore()
  const { currentConversationId } = useConversationStore()
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  /** 当前请求加载的对话 ID 序列号，用于丢弃过期加载结果（快速切换对话时防竞态）。 */
  const loadSeqRef = useRef(0)
  const [isLoadingMessages, setIsLoadingMessages] = useState(false)

  const currentMessages = currentConversationId && messages[currentConversationId] ? messages[currentConversationId] : []
  const lastMessageId = useMemo(() => currentMessages[currentMessages.length - 1]?.id, [currentMessages])
  const isBusy = currentConversationId ? !!busyConversations[currentConversationId] : false
  const lastIdx = currentMessages.length - 1

  /** 判断最后一条 user 消息是否在视口顶部附近，决定下滑按钮的显隐。 */
  const updateAtBottom = () => {
    const viewport = viewportRef.current
    if (!viewport || !currentMessages.length) return
    const el = getLastUserMsgEl(currentMessages)
    if (!el) return
    onScrollChange?.(viewport.scrollTop >= el.offsetTop - viewport.clientHeight)
  }

  /** 滚动最后一条 user 消息到视口顶部。调用方传入最新消息列表解决闭包过期问题。 */
  const scrollToLastUserMessage = (msgs: ChatMessage[], behavior: 'smooth' | 'instant' = 'smooth') => {
    const viewport = viewportRef.current
    if (!viewport) return
    const el = getLastUserMsgEl(msgs)
    if (!el) return
    viewport.scrollTo({ top: el.offsetTop - 16, behavior })
  }

  useImperativeHandle(ref, () => ({ scrollToLastUserMessage }))

  /** 新 user 消息：计算 spacer + min-height + smooth 滚动 */
  useLayoutEffect(() => {
    const container = contentRef.current
    const viewport = viewportRef.current
    if (!container || !viewport || !currentMessages.length || currentMessages[lastIdx]?.role !== 'user') return

    const el = getLastUserMsgEl(currentMessages)
    if (!el) return

    const rawScrollHeight = container.scrollHeight
    const distance = rawScrollHeight - el.offsetTop
    const missing = Math.max(0, viewport.clientHeight - distance)
    container.style.minHeight = `${rawScrollHeight + missing}px`
    viewport.scrollTo({ top: el.offsetTop - 16, behavior: 'smooth' })
  }, [lastMessageId])

  /** 切换对话：重置 min-height → 加载消息 → instant 滚动 */
  useEffect(() => {
    if (!currentConversationId) return
    if (contentRef.current) contentRef.current.style.minHeight = ''
    const id = currentConversationId
    const seq = ++loadSeqRef.current
    ;(async () => {
      setIsLoadingMessages(true)
      const fn = useChatStore.getState().updateMessages
      const msgs = await getConversationMessages(id)
      // 加载期间已切换到别的对话则丢弃结果，避免覆盖新对话的消息
      if (seq !== loadSeqRef.current) return
      // 该对话正在流式生成时跳过 DB 覆盖：内存中的消息已含流式增量，
      // 用 DB 数据覆盖会导致已生成的部分文本丢失、后续 delta 分裂成新消息
      if (useChatStore.getState().busyConversations[id]) {
        setIsLoadingMessages(false)
        return
      }
      fn(id, msgs)
      setIsLoadingMessages(false)
      requestAnimationFrame(() => scrollToLastUserMessage(msgs, 'instant'))
    })()
  }, [currentConversationId])

  if (!currentConversationId) {
    return (
      <ScrollArea className="flex-1 overflow-hidden" viewportRef={viewportRef} onViewportScroll={updateAtBottom}>
        <div className="max-w-3xl mx-auto space-y-8 pb-32">
          <div className="mt-20 space-y-8">
            <h1 className="text-5xl font-medium bg-gradient-to-r from-blue-400 via-purple-400 to-red-400 bg-clip-text text-transparent">
              {t('chat.heroTitle')}
            </h1>
            <p className="text-2xl font-medium text-[var(--app-muted)]">{t('chat.heroSubtitle')}</p>
          </div>
        </div>
      </ScrollArea>
    )
  }

  return (
    <ScrollArea className="flex-1 overflow-hidden" viewportRef={viewportRef} onViewportScroll={updateAtBottom}>
      <div ref={contentRef} className="max-w-3xl mx-auto space-y-8 pb-8">
        {isLoadingMessages ? (
          <div className="mt-16 space-y-6 px-4">
            <div className="h-4 w-3/4 animate-pulse rounded bg-[var(--app-hover)]" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-[var(--app-hover)]" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-[var(--app-hover)]" />
            <div className="h-4 w-1/3 animate-pulse rounded bg-[var(--app-hover)]" />
          </div>
        ) : currentMessages.length === 0 ? (
          <div className="mt-16 space-y-3">
            <h2 className="text-2xl font-medium text-[var(--app-fg)]">{t('chat.emptyHeading')}</h2>
            <p className="text-sm text-[var(--app-muted)]">{t('chat.emptyHint')}</p>
          </div>
        ) : (
          currentMessages.map((msg) => {
            // 上下文切换标签：切换占位消息（kind='context-switch'）只渲染居中分隔标签
            if (msg.kind === 'context-switch') {
              const isEnter = (msg.contextId ?? '') !== '' && msg.contextId !== 'main'
              const label = isEnter ? `已进入 ${msg.contextId}` : '已回到主上下文'
              return (
                <div key={msg.id} className="flex items-center justify-center gap-3 py-2">
                  <div className="h-px flex-1 bg-[var(--app-hover)]" />
                  <span className="rounded-full bg-[var(--app-hover)] px-3 py-0.5 text-xs text-[var(--app-muted)]">
                    {label}
                  </span>
                  <div className="h-px flex-1 bg-[var(--app-hover)]" />
                </div>
              )
            }
            return (
            <div key={msg.id}>
              <div
                id={`msg-${msg.id}`}
                className={cn('flex w-full', msg.role === 'user' ? 'justify-end' : 'justify-start')}
              >
                <div className={cn('group max-w-[min(85%,42rem)] space-y-1', msg.role === 'user' ? 'rounded-3xl bg-[var(--app-user-bubble)] p-4' : '')}>
                  {msg.role === 'assistant' ? (
                    // 有 widgetNode 的用 widget-system 渲染
                    msg.widgetNode ? (
                      ['Row', 'Column'].includes(msg.widgetNode.type) ? (
                        <div className="w-full">{renderWidgetNode(msg.widgetNode, msg.id, 0)}</div>
                      ) : (
                        <div className="space-y-2">{renderWidgetNode(msg.widgetNode, msg.id, 0)}</div>
                      )
                    ) : (
                      <MarkdownView content={msg.content} />
                    )
                  ) : (
                    <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                  )}
                  <div className="flex items-center gap-2">
                    <span className="mt-2 block text-[10px] uppercase text-[var(--app-muted)] opacity-60">{formatDate(msg.createdAt)}</span>
                    {!msg.widgetNode && (
                    <button
                      onClick={() => navigator.clipboard.writeText(msg.content)}
                      className="mt-2 text-[var(--app-muted)] opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-60"
                      aria-label="复制"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                    </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )})
        )}
        {/* 等待首个输出的占位：AI 第一个 token/UI 出现后消失（回合级 busy 仍由 drain 统一复位） */}
        {isBusy && currentMessages[lastIdx]?.role === 'user' && (
          <div className="flex items-center gap-1 pl-1 pt-1">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--app-muted)] [animation-delay:-0.3s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--app-muted)] [animation-delay:-0.15s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--app-muted)]" />
          </div>
        )}
      </div>
    </ScrollArea>
  )
})
