import { create } from 'zustand'
import type { ChatMessage } from '@shared'
import type { WidgetNode, WidgetNodeType } from '@shared/types/ui'
import { chatSend as chatSendApi, chatAbort, onChatStream } from '../api'
import { useToastStore } from './toastStore'

interface ChatStore {
  messages: Record<string, ChatMessage[]>
  updateMessages: (conversationId: string, messages: ChatMessage[]) => void
  clearConversation: (conversationId: string) => void
  sendMessage: (conversationId: string, text: string) => Promise<void>
  /** 会话处理中状态：从发送到交付物到达（done / ui_render / error 任一）的整个周期，不区分流式还是工具路径。 */
  busyConversations: Record<string, boolean>
}

/** 防重复订阅守卫：仅开发阶段有意义——Vite HMR 热更新会重跑本模块导致 ipcRenderer.on 叠加注册
 * （同一条推送被处理 N 遍）。生产环境模块只加载一次，守卫恒走首订路径。 */
let streamSubscribed = false

export const useChatStore = create<ChatStore>()(
  (set, get) => {
    if (!streamSubscribed) {
      streamSubscribed = true
      onChatStream((data) => {
        // switch 对 discriminated union 的窄化不依赖早退链/复合条件——每个 case 类型精确
        switch (data.kind) {
          case 'ui_render': {
            const widgetNode: WidgetNode = {
              type: data.component as WidgetNodeType,
              props: data.props ?? {},
              children: data.children as WidgetNode[] | null,
            }
            set((state) => {
              const msgs = state.messages[data.conversationId] || []
              return {
                messages: {
                  ...state.messages,
                  [data.conversationId]: [
                    ...msgs,
                    { id: data.runId, role: 'assistant', content: '', createdAt: Date.now(), widgetNode } as ChatMessage,
                  ],
                },
                // UI 交付只是回合中的一个节点，不复位 busy——回合级复位由 done（drain 清空）统一负责
              }
            })
            return
          }
          case 'error': {
            // 单次流失败：只移除未完成的流式消息，不复位 busy——
            // busy 只由 done（agentLoop 结束）统一复位，工具 fail 重试期间 busy 必须保持
            set((state) => {
              const msgs = (state.messages[data.conversationId] || []).filter((m) => m.id !== data.runId)
              return {
                messages: { ...state.messages, [data.conversationId]: msgs },
              }
            })
            return
          }
          case 'context-switch': {
            // 上下文切换标签：追加一条 kind='context-switch' 的消息，ChatArea 渲染分隔标签
            set((state) => {
              const msgs = state.messages[data.conversationId] || []
              return {
                messages: {
                  ...state.messages,
                  [data.conversationId]: [
                    ...msgs,
                    {
                      id: data.runId,
                      role: 'assistant',
                      content: '',
                      createdAt: Date.now(),
                      contextId: data.contextId ?? null,
                      kind: 'context-switch',
                    } as ChatMessage,
                  ],
                },
              }
            })
            return
          }
          case 'stream': {
            // append 只要求 delta 非空，不要求 done=false：协议约定 delta 与 done 可能同条到达，
            // 以 done 作为 append 前置条件会静默丢弃内容（历史教训）
            if (data.delta) {
              set((state) => {
                const msgs = state.messages[data.conversationId] || []
                const idx = msgs.findIndex((m) => m.id === data.runId)
                if (idx >= 0) {
                  const updated = [...msgs]
                  updated[idx] = { ...updated[idx], content: updated[idx].content + data.delta }
                  return { messages: { ...state.messages, [data.conversationId]: updated } }
                }
                return {
                  messages: {
                    ...state.messages,
                    [data.conversationId]: [
                      ...msgs,
                      { id: data.runId, role: 'assistant', content: data.delta, createdAt: Date.now() } as ChatMessage,
                    ],
                  },
                  busyConversations: { ...state.busyConversations, [data.conversationId]: true },
                }
              })
            }
            if (data.done) {
              set((state) => ({
                busyConversations: { ...state.busyConversations, [data.conversationId]: false },
              }))
            }
            return
          }
        }
      })
    }

    return {
      messages: {},
      busyConversations: {},

      updateMessages: (conversationId, msgs) =>
        set((state) => ({
          messages: { ...state.messages, [conversationId]: msgs },
        })),

      clearConversation: (conversationId) =>
        set((state) => ({
          messages: { ...state.messages, [conversationId]: [] },
        })),

      sendMessage: async (conversationId: string, text: string) => {
        // 若该对话正在流式生成，先中断旧流再发送，防止并发双流导致消息交错（Main 不防并发）
        if (get().busyConversations[conversationId]) {
          await chatAbort(conversationId)
        }
        // 发送前置 busy（回复 done 到达时复位）
        set((state) => ({
          busyConversations: { ...state.busyConversations, [conversationId]: true },
        }))
        let msg: ChatMessage
        try {
          // chatSendApi 立即返回用户消息记录（agentLoop 后台跑，delta 实时推送）
          msg = await chatSendApi(conversationId, text)
        } catch (e) {
          // 发送失败（如未配置 API Key、IPC 错误）：复位 busy，提示用户，不落消息
          set((state) => ({
            busyConversations: { ...state.busyConversations, [conversationId]: false },
          }))
          useToastStore.getState().push(`发送失败：${e instanceof Error ? e.message : String(e)}`)
          throw e
        }
        // 追加用户消息（本地微任务先于网络 delta，顺序：用户消息在前、回复在后）
        set((state) => ({
          messages: {
            ...state.messages,
            [conversationId]: [
              ...(state.messages[conversationId] || []),
              msg,
            ],
          },
        }))
        const { useConversationStore } = await import('./conversationStore')
        useConversationStore.getState().loadConversations()
      },
    }
  }
)
