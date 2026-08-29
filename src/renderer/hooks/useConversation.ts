import { useConversationStore } from '../stores/conversationStore'
import type { Conversation } from '@shared'

interface UseConversationReturn {
  conversations: Conversation[]
  currentConversationId: string | null
  createConversation: (title?: string) => Promise<string>
  deleteConversation: (id: string) => Promise<void>
  setCurrentConversation: (id: string) => void
  loadConversations: () => Promise<void>
}

export function useConversation(): UseConversationReturn {
  const {
    conversations,
    currentConversationId,
    createConversation,
    deleteConversation,
    setCurrentConversation,
    loadConversations,
  } = useConversationStore()

  return {
    conversations,
    currentConversationId,
    createConversation,
    deleteConversation,
    setCurrentConversation,
    loadConversations,
  }
}
