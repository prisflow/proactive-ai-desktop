import { CORE_EVENT, createAgentEvent } from '../../shared/agent-events'
import type { AgentStreamPushV1, GlobalSettings } from '../../shared/types'
import type { AgentEventBus } from './event-bus'
import type { HookRegistry } from './hook-registry'
import { ModelTurn } from './model-turn'
import type { SubAgentFinishedPayload } from './pipelines'

export class SubAgentRunner {
  constructor(
    private hooks: HookRegistry,
    private bus: AgentEventBus,
    private modelTurn: ModelTurn,
    private pushStream: (p: AgentStreamPushV1) => void
  ) {}

  /** 异步执行：流式推送 Renderer，结束后向总线投递 SubAgentFinished */
  startRun(opts: {
    conversationId: string
    runId: string
    subagentSystemPrompt: string
    userTask: string
    globalSettings: GlobalSettings
    signal?: AbortSignal
  }): void {
    void this.run(opts)
  }

  private async run(opts: {
    conversationId: string
    runId: string
    subagentSystemPrompt: string
    userTask: string
    globalSettings: GlobalSettings
    signal?: AbortSignal
  }): Promise<void> {
    const { conversationId, runId, subagentSystemPrompt, userTask, globalSettings, signal } = opts
    try {
      const { reply } = await this.modelTurn.streamSubagentPlain(
        subagentSystemPrompt,
        userTask,
        globalSettings,
        (delta) => {
          if (signal?.aborted) return
          void this.hooks.invokeAll('ipc.beforeSendStream', {
            conversationId,
            runId,
            kind: 'subagent',
          })
          this.pushStream({
            v: 1,
            kind: 'stream',
            conversationId,
            runId,
            role: 'assistant',
            delta,
            done: false,
            streamKind: 'subagent',
          })
        }
      )

      if (signal?.aborted) {
        await this.finish(conversationId, runId, 'aborted', reply)
        return
      }

      this.pushStream({
        v: 1,
        kind: 'stream',
        conversationId,
        runId,
        role: 'assistant',
        delta: '',
        done: true,
        streamKind: 'subagent',
      })
      await this.finish(conversationId, runId, 'success', reply)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await this.finish(conversationId, runId, 'aborted', msg)
    }
  }

  private async finish(
    conversationId: string,
    runId: string,
    status: 'success' | 'aborted',
    summary: string
  ): Promise<void> {
    const envelope = createAgentEvent({
      type: CORE_EVENT.SUBAGENT_FINISHED,
      source: 'subagent',
      conversationId,
      correlationId: runId,
      payload: {
        runId,
        status,
        summary,
        conversationId,
      } satisfies SubAgentFinishedPayload,
    })
    await this.bus.enqueue(envelope)
  }
}
