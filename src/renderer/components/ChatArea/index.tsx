import { useTranslation } from 'react-i18next'
import { useChatStore } from '@/stores/chatStore'
import { useConversationStore } from '@/stores/conversationStore'
import { useEffect, useMemo, useRef, useState } from 'react'
import { formatDate } from '@/utils/helpers'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { getMessages } from '@/api'
import { MarkdownView } from '@/components/markdown/MarkdownView'

export default function ChatArea() {
  const { t } = useTranslation()
  const { messages, isLoading, updateMessages } = useChatStore()
  const { currentConversationId } = useConversationStore()
  const bottomRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const isAtBottomRef = useRef(true)

  const currentMessages = currentConversationId && messages[currentConversationId] 
    ? messages[currentConversationId] 
    : []

  const lastMessageId = useMemo(
    () => currentMessages[currentMessages.length - 1]?.id,
    [currentMessages]
  )

  const updateAtBottom = () => {
    const el = viewportRef.current
    if (!el) return
    const threshold = 24
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= threshold
    setIsAtBottom(atBottom)
    isAtBottomRef.current = atBottom
  }

  useEffect(() => {
    // 仅在“用户就在底部”时才自动滚动，避免无法向上翻历史
    // 不要把 isAtBottom 放进依赖：用户手动滚到底部时会触发一次自动 scrollIntoView，造成跳动
    if (!isAtBottomRef.current) return
    bottomRef.current?.scrollIntoView({ block: 'end' })
    // 有些情况下 scrollIntoView 后还未更新 scrollTop，这里补一次计算
    requestAnimationFrame(() => updateAtBottom())
  }, [lastMessageId, isLoading, currentConversationId])

  useEffect(() => {
    const load = async () => {
      if (!currentConversationId) return
      try {
        const msgs = await getMessages(currentConversationId)
        // 只在“主进程数据不落后于本地”时覆盖，避免发送中的乐观消息被回滚
        const local = useChatStore.getState().messages[currentConversationId] || []
        if (msgs.length < local.length) return
        updateMessages(currentConversationId, msgs)
      } catch (err) {
        console.error('Failed to load messages from main:', err)
      }
    }
    load()
  }, [currentConversationId, updateMessages])

  if (!currentConversationId) {
    return (
      <ScrollArea
        className="flex-1 px-4 py-8 md:px-6 lg:px-8"
        viewportRef={viewportRef}
        onViewportScroll={updateAtBottom}
      >
        <div className="max-w-3xl mx-auto space-y-8 pb-32">
          <div className="mt-20 space-y-8">
            <h1 className="text-5xl font-medium bg-gradient-to-r from-blue-400 via-purple-400 to-red-400 bg-clip-text text-transparent">
              {t('chat.heroTitle')}
            </h1>
            <p className="text-2xl font-medium text-[var(--app-muted)]">
              {t('chat.heroSubtitle')}
            </p>
          </div>
        </div>
      </ScrollArea>
    )
  }

  return (
    <ScrollArea
      className="flex-1 px-4 py-8 md:px-6 lg:px-8"
      viewportRef={viewportRef}
      onViewportScroll={updateAtBottom}
      onPointerDown={updateAtBottom}
      onMouseEnter={updateAtBottom}
    >
      <div className="max-w-3xl mx-auto space-y-8 pb-32">
        {currentMessages.length === 0 && (
          <div className="mt-16 space-y-3">
            <h2 className="text-2xl font-medium text-[var(--app-fg)]">{t('chat.emptyHeading')}</h2>
            <p className="text-sm text-[var(--app-muted)]">{t('chat.emptyHint')}</p>
          </div>
        )}
        {currentMessages.map((msg) => (
          <div
            key={msg.id}
            className={cn('flex w-full', msg.role === 'user' ? 'justify-end' : 'justify-start')}
          >
            <div
              className={cn(
                'max-w-[min(85%,42rem)] space-y-1',
                msg.role === 'user' ? 'rounded-3xl bg-[var(--app-user-bubble)] p-4' : ''
              )}
            >
              {msg.role === 'assistant' ? (
                <MarkdownView content={msg.content} />
              ) : (
                <p className="whitespace-pre-wrap leading-relaxed text-[var(--app-fg)]">
                  {msg.content}
                </p>
              )}
              <span className="mt-2 block text-[10px] uppercase text-[var(--app-muted)] opacity-60">
                {formatDate(msg.createdAt)}
              </span>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex w-full justify-start">
            <div className="flex items-center gap-1 py-2">
              <div className="h-2 w-2 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '0ms' }} />
              <div className="h-2 w-2 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '150ms' }} />
              <div className="h-2 w-2 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  )
}
