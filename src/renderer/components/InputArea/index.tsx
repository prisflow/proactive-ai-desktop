import { SendHorizontal } from 'lucide-react'
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useConversationStore } from '@/stores/conversationStore'
import { useChatStore } from '@/stores/chatStore'
import { submitUserText, getConfig, agentActivityPing } from '@/api'
import { GlobalSettings } from '@shared'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export default function InputArea() {
  const { t } = useTranslation()
  const [inputText, setInputText] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [config, setConfig] = useState<GlobalSettings | null>(null)
  const [isMultiline, setIsMultiline] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const activityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { currentConversationId, createConversation, refreshConversationFromMain } =
    useConversationStore()
  const { addMessage, setLoading } = useChatStore()

  useEffect(() => {
    loadConfig()
  }, [])

  const loadConfig = async () => {
    try {
      const cfg = await getConfig()
      setConfig(cfg)
    } catch (error) {
      console.error('Failed to load config:', error)
    }
  }

  const scheduleActivityPing = (conversationId: string | null) => {
    if (!conversationId) return
    if (activityTimerRef.current) clearTimeout(activityTimerRef.current)
    activityTimerRef.current = setTimeout(() => {
      void agentActivityPing(conversationId)
    }, 400)
  }

  const handleSend = async () => {
    if (!inputText.trim() || isLoading) return

    let conversationId = currentConversationId
    if (!conversationId) {
      conversationId = await createConversation()
    }

    const userMessageId = `msg_${Date.now()}`
    const text = inputText.trim()

    setIsLoading(true)
    setLoading(true)

    addMessage(conversationId, {
      id: userMessageId,
      role: 'user',
      content: text,
      createdAt: Date.now(),
    })
    setInputText('')

    const priorLen = useChatStore.getState().messages[conversationId]?.length ?? 0
    const isFirstUserMessage = priorLen <= 1

    try {
      if (!config?.apiKey) {
        throw new Error(t('input.needApiKey'))
      }

      const r = await submitUserText({
        conversationId,
        text,
        userMessageId,
      })
      if (!r.ok) {
        throw new Error(r.error || t('input.sendFailed'))
      }
    } catch (error) {
      console.error('Failed to send message:', error)
      addMessage(conversationId, {
        id: `msg_${Date.now() + 1}`,
        role: 'assistant',
        content: `${t('input.errorPrefix')}${error instanceof Error ? error.message : t('input.sendFailed')}`,
        createdAt: Date.now(),
      })
    } finally {
      if (isFirstUserMessage) {
        void refreshConversationFromMain(conversationId)
      }
      setIsLoading(false)
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
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
    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-[var(--app-gradient-input-stop)] via-[var(--app-gradient-input-stop)] to-transparent px-4 pb-4 pt-2 md:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">

        <div
          className={cn(
            'flex gap-2 rounded-[28px] border border-[color:var(--app-border)] bg-[var(--app-elevated)] px-4 py-2.5 shadow-2xl transition-colors focus-within:border-[color:var(--app-border-strong)]',
            isMultiline ? 'items-end' : 'items-center'
          )}
        >
          <textarea
            ref={textareaRef}
            className="custom-scrollbar min-h-[44px] max-h-60 flex-1 resize-none border-none bg-transparent py-2 pl-1 pr-2 text-base text-[var(--app-fg)] outline-none placeholder:text-[var(--app-muted-fg)] focus:ring-0"
            placeholder={t('input.placeholder')}
            rows={1}
            value={inputText}
            onChange={(e) => {
              setInputText(e.target.value)
              scheduleActivityPing(currentConversationId)
            }}
            onKeyDown={handleKeyDown}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleSend}
            disabled={!inputText.trim() || isLoading}
            aria-label={t('input.send')}
            className={cn(
              'h-9 w-9 shrink-0 rounded-full transition-colors',
              isMultiline ? 'self-end' : 'self-center',
              inputText.trim() && !isLoading
                ? 'bg-[var(--app-send-ready)] text-white hover:bg-[var(--app-send-ready-hover)] hover:text-white'
                : 'bg-[var(--app-send-disabled)] text-[var(--app-send-disabled-fg)] hover:bg-[var(--app-send-disabled)]'
            )}
          >
            <SendHorizontal size={18} strokeWidth={2} />
          </Button>
        </div>
        <p className="mt-3 px-8 text-center text-[11px] text-[var(--app-muted)]">
          {t('input.disclaimer')}
        </p>
      </div>
    </div>
  )
}
