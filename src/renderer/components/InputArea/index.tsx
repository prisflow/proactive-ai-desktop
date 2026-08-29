import { SendHorizontal, Square } from 'lucide-react'
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useConversationStore } from '@/stores/conversationStore'
import { useChatStore } from '@/stores/chatStore'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { chatAbort } from '@/api'

/**
 * 底部输入区域。
 * - 自动高度 textarea（单行/多行切换）
 * - Enter 发送，Shift+Enter 换行
 * - 无当前对话时自动创建
 * - 发送后触发 scrollToLastUserMessage
 */
export default function InputArea({ chatAtBottom, onScrollToBottom }: { chatAtBottom?: boolean; onScrollToBottom?: () => void }) {
  const { t } = useTranslation()
  const [inputText, setInputText] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isMultiline, setIsMultiline] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { currentConversationId, createConversation } = useConversationStore()
  const { sendMessage, busyConversations } = useChatStore()
  const isBusy = currentConversationId ? !!busyConversations[currentConversationId] : false

  const handleSend = async () => {
    if (!inputText.trim() || isLoading || isBusy) return
    let conversationId = currentConversationId
    if (!conversationId) {
      conversationId = await createConversation()
    }
    const text = inputText.trim()
    setIsLoading(true)
    setInputText('')
    sendMessage(conversationId, text)
      .then(() => {
        requestAnimationFrame(() => onScrollToBottom?.())
      })
      .catch(() => {
        // 错误已在 chatStore 中 toast 提示，这里仅避免 unhandled rejection
      })
      .finally(() => setIsLoading(false))
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      // busy 时禁止回车发送（可继续输入，需先手动中断才能发送），防止连发插入工具执行
      if (isBusy) return
      e.preventDefault()
      handleSend()
    }
  }

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 240)}px`
      setIsMultiline(textareaRef.current.scrollHeight > 64)
    }
  }, [inputText])

  return (
    <div className="relative bg-gradient-to-t from-[var(--app-gradient-input-stop)] via-[var(--app-gradient-input-stop)] to-transparent px-4 pb-4 pt-2">
      {!chatAtBottom && (
        <button
          className="absolute bottom-full left-1/2 z-10 -translate-x-1/2 mb-2 rounded-full bg-[var(--app-surface)] border border-[var(--app-border)] p-2 shadow-lg hover:bg-[var(--app-hover)]"
          onClick={onScrollToBottom}
        >
          <svg className="h-5 w-5 text-[var(--app-fg)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      )}
      <div className="mx-auto max-w-3xl">
        <div className={cn('flex gap-2 rounded-[28px] border border-[color:var(--app-border)] bg-[var(--app-elevated)] px-4 py-2.5 shadow-2xl')}>
          <textarea
            ref={textareaRef}
            className="custom-scrollbar min-h-[44px] max-h-60 flex-1 resize-none border-none bg-transparent py-2 pl-1 pr-2 text-base text-[var(--app-fg)] outline-none placeholder:text-[var(--app-muted-fg)]"
            placeholder={t('input.placeholder')}
            rows={1}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={isBusy ? () => { chatAbort(currentConversationId!) } : handleSend}
            disabled={(!inputText.trim() && !isBusy) || isLoading}
            className={cn('h-9 w-9 shrink-0 rounded-full', isMultiline ? 'self-end' : 'self-center',
              isBusy ? 'bg-[var(--app-send-disabled)] text-[var(--app-fg)] hover:bg-[var(--app-hover)]' : inputText.trim() ? 'bg-[var(--app-send-ready)] text-white' : 'bg-[var(--app-send-disabled)]')}
          >
            {isBusy ? <Square size={16} strokeWidth={2.5} /> : <SendHorizontal size={18} strokeWidth={2} />}
          </Button>
        </div>
        <p className="mt-3 px-8 text-center text-[11px] text-[var(--app-muted)]">{t('input.disclaimer')}</p>
      </div>
    </div>
  )
}
