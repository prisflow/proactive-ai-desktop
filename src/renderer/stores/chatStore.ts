import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { ChatMessage } from '@shared'

interface ChatStore {
  currentConversation: string | null
  messages: Record<string, ChatMessage[]>
  isLoading: boolean
  setCurrentConversation: (id: string) => void
  addMessage: (conversationId: string, message: ChatMessage) => void
  upsertMessage: (conversationId: string, message: ChatMessage) => void
  applyAgentStream: (
    conversationId: string,
    runId: string,
    delta: string,
    done: boolean
  ) => void
  updateMessages: (conversationId: string, messages: ChatMessage[]) => void
  clearConversation: (conversationId: string) => void
  setLoading: (loading: boolean) => void
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set) => ({
      currentConversation: null,
      messages: {},
      isLoading: false,
      setCurrentConversation: (id) => set({ currentConversation: id }),
      addMessage: (conversationId, message) =>
        set((state) => ({
          messages: {
            ...state.messages,
            [conversationId]: [...(state.messages[conversationId] || []), message],
          },
        })),
      upsertMessage: (conversationId, message) =>
        set((state) => {
          const list = [...(state.messages[conversationId] || [])]
          const i = list.findIndex((m) => m.id === message.id)
          if (i >= 0) list[i] = message
          else list.push(message)
          return {
            messages: { ...state.messages, [conversationId]: list },
          }
        }),
      applyAgentStream: (conversationId, runId, delta, done) =>
        set((state) => {
          const list = [...(state.messages[conversationId] || [])]
          const i = list.findIndex((m) => m.id === runId)
          if (i < 0) {
            if (delta)
              list.push({
                id: runId,
                role: 'assistant',
                content: delta,
                createdAt: Date.now(),
              })
          } else {
            const cur = list[i]
            list[i] = {
              ...cur,
              content: delta ? cur.content + delta : cur.content,
            }
          }
          void done
          return { messages: { ...state.messages, [conversationId]: list } }
        }),
      updateMessages: (conversationId, messages) =>
        set((state) => ({
          messages: {
            ...state.messages,
            [conversationId]: messages,
          },
        })),
      clearConversation: (conversationId) =>
        set((state) => ({
          messages: {
            ...state.messages,
            [conversationId]: [],
          },
        })),
      setLoading: (loading) => set({ isLoading: loading }),
    }),
    {
      name: 'chat-storage',
    }
  )
)