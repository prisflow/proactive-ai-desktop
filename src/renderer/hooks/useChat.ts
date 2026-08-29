import { useChatStore } from '../stores/chatStore'

interface UseChatReturn {
  sendMessage: (conversationId: string, text: string) => Promise<void>
  messages: import('@shared').ChatMessage[]
}

export function useChat(conversationId: string): UseChatReturn {
  const messages = useChatStore((s) => s.messages[conversationId] ?? [])
  const sendMessage = useChatStore((s) => s.sendMessage)

  return { sendMessage, messages }
}
