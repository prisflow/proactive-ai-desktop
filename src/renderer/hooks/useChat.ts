import { useChatStore } from '../stores/chatStore'
import type { ChatMessage } from '@shared/types/domain'

interface UseChatReturn {
  sendMessage: (conversationId: string, text: string) => Promise<void>
  messages: ChatMessage[]
}

export function useChat(conversationId: string): UseChatReturn {
  const messages = useChatStore((s) => s.messages[conversationId] ?? [])
  const sendMessage = useChatStore((s) => s.sendMessage)

  return { sendMessage, messages }
}
