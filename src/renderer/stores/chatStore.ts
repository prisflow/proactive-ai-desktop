import { create } from 'zustand'
import type { ChatMessage } from '@shared'
import type { WidgetNode, WidgetNodeType } from '@shared/types/ui'
import { chatSend as chatSendApi, chatAbort, onChatStream, offChatStream } from '../api'
import { useToastStore } from './toastStore'

interface ChatStore {
  messages: Record<string, ChatMessage[]>
  updateMessages: (conversationId: string, messages: ChatMessage[]) => void
  clearConversation: (conversationId: string) => void
  sendMessage: (conversationId: string, text: string) => Promise<void>
  /** 会话处理中状态：从发送到交付物到达（done / ui_render / error 任一）的整个周期，不区分流式还是工具路径。 */
  busyConversations: Record<string, boolean>
  /** 每会话最新一次剧情选项（你欲何为？），用于 0月瞬时屏常驻复用 */
  latestPlotChoices: Record<string, WidgetNode[]>
}

let streamSubscribed = false

function extractPlotRows(node: WidgetNode): WidgetNode[] | null {
  const kids = (node.children || []) as WidgetNode[]
  const idx = kids.findIndex((c) => (c.props as Record<string, unknown>)?.content === '你欲何为？')
  if (idx < 0) return null
  const rows: WidgetNode[] = []
  for (let i = idx + 1; i < kids.length; i++) {
    const c = kids[i]
    const t = (c as WidgetNode).type || (c as unknown as Record<string, unknown>).component as string
    if (t === 'Row') rows.push(c as WidgetNode)
    else break
  }
  return rows.length ? rows : null
}
function hasPlotSection(node: WidgetNode): boolean {
  return !!extractPlotRows(node)
}
function injectPlotRows(node: WidgetNode, rows: WidgetNode[]): WidgetNode {
  const kids = [...((node.children || []) as WidgetNode[])]
  kids.push({ type: 'Divider' as WidgetNodeType, props: {}, children: undefined } as unknown as WidgetNode)
  kids.push({ type: 'Text' as WidgetNodeType, props: { content: '你欲何为？', size: 'sm' }, children: undefined } as unknown as WidgetNode)
  for (const r of rows) kids.push(r)
  return { ...node, children: kids }
}

export const useChatStore = create<ChatStore>()(
  (set, get) => {
    if (!streamSubscribed) {
      streamSubscribed = true
      onChatStream((data) => {
        if (data.kind === 'ui_render' && data.component && data.runId) {
          let widgetNode: WidgetNode = {
            type: data.component as WidgetNodeType,
            props: data.props ?? {},
            children: data.children as WidgetNode[] | null,
          }
          const plotRows = extractPlotRows(widgetNode)
          const deepHasDeath = (node: WidgetNode): boolean => {
            const kids = (node.children || []) as WidgetNode[]
            return kids.some((c) => {
              const content = String((c.props as Record<string, unknown>)?.content || '')
              if (content.includes('身死道消')) return true
              const sub = (c as WidgetNode).children as WidgetNode[] | undefined
              return Array.isArray(sub) && sub.some((s) => String((s.props as Record<string, unknown>)?.content || '').includes('身死道消'))
            })
          }
          const isDeath = deepHasDeath(widgetNode)
          if (plotRows) {
            if (!isDeath) {
              set((state) => ({
                latestPlotChoices: { ...state.latestPlotChoices, [data.conversationId]: plotRows },
              }))
            } else {
              set((state) => {
                const { [data.conversationId]: _omit, ...rest } = state.latestPlotChoices
                return { latestPlotChoices: rest }
              })
            }
          } else if (!hasPlotSection(widgetNode)) {
            if (isDeath) {
              set((state) => {
                const { [data.conversationId]: _omit, ...rest } = state.latestPlotChoices
                return { latestPlotChoices: rest }
              })
            } else {
              const cached = get().latestPlotChoices[data.conversationId]
              if (cached && cached.length) {
                widgetNode = injectPlotRows(widgetNode, cached)
              }
            }
          }
          set((state) => {
            const msgs = state.messages[data.conversationId] || []
            return {
              messages: {
                ...state.messages,
                [data.conversationId]: [
                  ...msgs,
                  { id: data.runId!, role: 'assistant', content: '', createdAt: Date.now(), widgetNode } as ChatMessage,
                ],
              },
              // UI 交付只是回合中的一个节点，不复位 busy——回合级复位由 done（drain 清空）统一负责
            }
          })
          return
        }
        if (data.kind === 'error') {
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
        if (data.kind === 'context-switch') {
          // 上下文切换标签：追加一条 kind='context-switch' 的消息，ChatArea 渲染分隔标签
          set((state) => {
            const msgs = state.messages[data.conversationId] || []
            return {
              messages: {
                ...state.messages,
                [data.conversationId]: [
                  ...msgs,
                  {
                    id: data.runId!,
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
                  { id: data.runId!, role: 'assistant', content: data.delta, createdAt: Date.now() } as ChatMessage,
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
      })
    }

    return {
      messages: {},
      busyConversations: {},
      latestPlotChoices: {},

      updateMessages: (conversationId, msgs) =>
        set((state) => ({
          messages: { ...state.messages, [conversationId]: msgs },
        })),

      clearConversation: (conversationId) =>
        set((state) => {
          const { [conversationId]: _omit, ...rest } = state.latestPlotChoices
          return {
            messages: { ...state.messages, [conversationId]: [] },
            latestPlotChoices: rest,
          }
        }),

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

export function cleanupChatStream(): void {
  offChatStream()
  streamSubscribed = false
}
