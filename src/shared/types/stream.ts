/**
 * Main → Renderer：流式推送协议（SSE 语义，走 Electron IPC）。
 *
 * - `stream`：LLM 回复的流式增量片段。
 * - `error`：处理过程中发生的错误。
 * - `ui_render`：交互式 UI 组件推送。
 */
import type { WidgetNode } from './ui'

export type AgentStreamPushV1 =
  | {
      kind: 'stream'
      conversationId: string
      runId: string
      delta: string
      done: boolean
    }
  | {
      kind: 'user-message'
      conversationId: string
      runId: string
      /** 已落库的用户消息 ID（多端去重用：发起端本地已显示，跳过同 id）。 */
      messageId: string
      content: string
      contextId: string | null
      /** 落库时间戳（多端时间戳渲染用）。 */
      createdAt: number
    }
  | {
      kind: 'error'
      conversationId: string
      runId: string
      message: string
    }
  | {
      kind: 'ui_render'
      conversationId: string
      runId: string
      component: string
      props: Record<string, unknown>
      children: WidgetNode[] | null
    }
  | {
      kind: 'context-switch'
      conversationId: string
      runId: string
      /** 进入的子上下文 ID（null = 回到主上下文）。 */
      contextId: string | null
    }
