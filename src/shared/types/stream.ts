/**
 * Main → Renderer：流式推送协议（SSE 语义，走 Electron IPC）。
 *
 * - `stream`：LLM 回复的流式增量片段。
 * - `error`：处理过程中发生的错误。
 * - `ui_render`：交互式 UI 组件推送。
 */
export type AgentStreamPushV1 =
  | {
      kind: 'stream'
      conversationId: string
      runId: string
      delta: string
      done: boolean
    }
  | {
      kind: 'error'
      conversationId?: string
      runId?: string
      message: string
    }
  | {
      kind: 'ui_render'
      conversationId: string
      runId: string
      component: string
      props: Record<string, unknown>
      children?: import('./ui').WidgetNode[]
    }
  | {
      kind: 'context-switch'
      conversationId: string
      runId: string
      /** 进入的子上下文 ID（退出时为 undefined → 回到主上下文）。 */
      contextId?: string
    }
