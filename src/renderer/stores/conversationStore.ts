import { create } from 'zustand'
import type { Conversation } from '@shared'
import { listConversations, createConversation as createConversationApi, deleteConversation as deleteConversationApi, renameConversation as renameConversationApi } from '../api'

/**
 * 对话列表 store。
 * 所有 CRUD 操作通过 IPC 同步到 Main SQLite，本 store 仅做前端缓存。
 */
interface ConversationStore {
  conversations: Conversation[]
  currentConversationId: string | null
  loadConversations: () => Promise<void>
  createConversation: (title?: string) => Promise<string>
  deleteConversation: (id: string) => Promise<void>
  renameConversation: (id: string, title: string) => Promise<void>
  setCurrentConversation: (id: string) => void
  updateConversation: (id: string, data: Partial<Conversation>) => void
}

export const useConversationStore = create<ConversationStore>()(
  (set) => ({
    conversations: [],
    currentConversationId: null,

    /** 从 Main 加载对话列表。启动时由 App.tsx 调用。 */
    loadConversations: async () => {
      const list = await listConversations()
      set({ conversations: list })
    },

    /** 创建新对话 → IPC → SQLite → 返回 UUID。 */
    createConversation: async (title?: string) => {
      const conv = await createConversationApi(title)
      set((state) => ({
        conversations: [conv, ...state.conversations],
        currentConversationId: conv.id,
      }))
      return conv.id
    },

    /** 软删除对话（IPC → SQLite is_archived=1）。自动切换到前一个对话。 */
    deleteConversation: async (id: string) => {
      await deleteConversationApi(id)
      set((state) => {
        const list = state.conversations.filter((c) => c.id !== id)
        return {
          conversations: list,
          currentConversationId:
            state.currentConversationId === id ? list[0]?.id || null : state.currentConversationId,
        }
      })
    },

    /** 重命名对话（IPC → SQLite 持久化 → 本地更新）。 */
    renameConversation: async (id: string, title: string) => {
      const conv = await renameConversationApi(id, title)
      if (!conv) return
      set((state) => ({
        conversations: state.conversations.map((c) => (c.id === id ? conv : c)),
      }))
    },

    setCurrentConversation: (id: string) => set({ currentConversationId: id }),

    updateConversation: (id: string, data: Partial<Conversation>) =>
      set((state) => ({
        conversations: state.conversations.map((c) =>
          c.id === id ? { ...c, ...data, updatedAt: Date.now() } : c
        ),
      })),
  })
)
