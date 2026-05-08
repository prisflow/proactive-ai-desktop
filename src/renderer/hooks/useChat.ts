import { useState } from 'react'
import { useChatStore } from '../stores/chatStore'
import { useConfigStore } from '../stores/configStore'
import { submitUserText } from '../api'

interface UseChatReturn {
  sendMessage: (content: string) => Promise<void>
  isLoading: boolean
  error: Error | null
}

/** @deprecated Prefer InputArea + agent push subscription */
export function useChat(conversationId: string): UseChatReturn {
  const { addMessage, setLoading } = useChatStore()
  const { config } = useConfigStore()
  const [error, setError] = useState<Error | null>(null)

  const sendMessage = async (content: string) => {
    if (!content.trim()) return
    if (!config.apiKey) {
      throw new Error('请先配置 API Key')
    }
    setLoading(true)
    setError(null)
    const userMessageId = `msg_${Date.now()}`
    try {
      addMessage(conversationId, {
        id: userMessageId,
        role: 'user',
        content: content.trim(),
        createdAt: Date.now(),
      })
      const r = await submitUserText({
        conversationId,
        text: content.trim(),
        userMessageId,
      })
      if (!r.ok) throw new Error(r.error || 'send failed')
    } catch (err) {
      setError(err as Error)
      throw err
    } finally {
      setLoading(false)
    }
  }

  return {
    sendMessage,
    isLoading: useChatStore((state) => state.isLoading),
    error,
  }
}
