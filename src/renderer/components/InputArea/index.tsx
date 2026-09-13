import { Plus, SendHorizontal, Square, X } from 'lucide-react'
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useConversationStore } from '@/stores/conversationStore'
import { useChatStore } from '@/stores/chatStore'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { chatAbort } from '@/api'

/** 待发送图片附件（本地 dataURL 预览；发送时交 main 落盘持久化）。 */
interface PendingAttachment {
  id: string
  dataUrl: string
  mime: string
  name: string
}

/** 图片类型白名单与大小上限（与 main 侧附件服务一致）。 */
const IMAGE_MIME_RE = /^image\/(png|jpe?g|webp|gif)$/
const MAX_ATTACH_BYTES = 8 * 1024 * 1024

/**
 * 底部输入区域。
 * - 自动高度 textarea（单行/多行切换）
 * - Enter 发送，Shift+Enter 换行
 * - 图片：Ctrl+V 粘贴 或 附件按钮导入（png/jpeg/webp/gif，单图 ≤8MB）
 * - 无当前对话时自动创建
 * - 发送后触发 scrollToLastUserMessage
 */
export default function InputArea({ chatAtBottom, onScrollToBottom }: { chatAtBottom?: boolean; onScrollToBottom?: () => void }) {
  const { t } = useTranslation()
  const [inputText, setInputText] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isMultiline, setIsMultiline] = useState(false)
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { currentConversationId, createConversation } = useConversationStore()
  const { sendMessage, busyConversations } = useChatStore()
  const isBusy = currentConversationId ? !!busyConversations[currentConversationId] : false

  /** 读取图片文件为 dataURL 入待发列表（类型/大小不合规静默跳过，main 侧日志同规则）。 */
  const readImageFile = (f: File) => {
    if (!IMAGE_MIME_RE.test(f.type) || f.size > MAX_ATTACH_BYTES) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '')
      if (!dataUrl) return
      setAttachments((prev) => [...prev, { id: crypto.randomUUID(), dataUrl, mime: f.type, name: f.name || 'image.png' }])
    }
    reader.readAsDataURL(f)
  }

  /** 粘贴拦截：剪贴板含图片时收为附件（纯文本粘贴走默认行为）。 */
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData?.items ?? [])
      .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f)
    if (!files.length) return
    e.preventDefault()
    for (const f of files) readImageFile(f)
  }

  const handleSend = async () => {
    const hasText = !!inputText.trim()
    if ((!hasText && attachments.length === 0) || isLoading || isBusy) return
    let conversationId = currentConversationId
    if (!conversationId) {
      conversationId = await createConversation()
    }
    const text = inputText.trim()
    const sendAttachments = attachments.length ? attachments.map((a) => ({ dataUrl: a.dataUrl, name: a.name })) : undefined
    setIsLoading(true)
    setInputText('')
    setAttachments([])
    sendMessage(conversationId, text, sendAttachments)
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
        <div className={cn('flex flex-col rounded-[28px] border border-[color:var(--app-border)] bg-[var(--app-elevated)] px-4 py-2.5 shadow-2xl')}>
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 pb-1 pt-1">
              {attachments.map((a) => (
                <div key={a.id} className="group/att relative">
                  <img src={a.dataUrl} alt={a.name} className="h-14 w-14 rounded-xl border border-[var(--app-border)] object-cover" />
                  <button
                    type="button"
                    aria-label={t('input.removeAttachment')}
                    onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                    className="absolute -right-1.5 -top-1.5 hidden rounded-full bg-[var(--app-fg)] p-0.5 text-[var(--app-bg)] group-hover/att:block"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className={cn('flex gap-2', attachments.length > 0 && 'items-end')}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              className="hidden"
              onChange={(e) => {
                for (const f of Array.from(e.target.files ?? [])) readImageFile(f)
                e.target.value = ''
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('input.attachImage')}
              onClick={() => fileInputRef.current?.click()}
              className={cn('h-9 w-9 shrink-0 rounded-full text-[var(--app-muted-fg)]', attachments.length > 0 ? 'self-end' : isMultiline ? 'self-end' : 'self-center')}
            >
              <Plus size={19} strokeWidth={2} />
            </Button>
            <textarea
              ref={textareaRef}
              className="custom-scrollbar min-h-[44px] max-h-60 flex-1 resize-none border-none bg-transparent py-2 pl-1 pr-2 text-base text-[var(--app-fg)] outline-none placeholder:text-[var(--app-muted-fg)]"
              placeholder={t('input.placeholder')}
              rows={1}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={isBusy ? () => { chatAbort(currentConversationId!) } : handleSend}
              disabled={((!inputText.trim() && attachments.length === 0) && !isBusy) || isLoading}
              className={cn('h-9 w-9 shrink-0 rounded-full', isMultiline || attachments.length > 0 ? 'self-end' : 'self-center',
                isBusy ? 'bg-[var(--app-send-disabled)] text-[var(--app-fg)] hover:bg-[var(--app-hover)]' : (inputText.trim() || attachments.length > 0) ? 'bg-[var(--app-send-ready)] text-white' : 'bg-[var(--app-send-disabled)]')}
            >
              {isBusy ? <Square size={16} strokeWidth={2.5} /> : <SendHorizontal size={18} strokeWidth={2} />}
            </Button>
          </div>
        </div>
        <p className="mt-3 px-8 text-center text-[11px] text-[var(--app-muted)]">{t('input.disclaimer')}</p>
      </div>
    </div>
  )
}
