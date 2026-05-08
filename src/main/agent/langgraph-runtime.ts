import type { AgentEventEnvelope } from '../../shared/agent-events'
import type { HookRegistry } from './hook-registry'
import type { CompiledAgentGraph } from './graph/build-agent-graph'
import type { AgentRuntimeDeps } from './runtime-deps'

function agentDebugLog(...args: unknown[]): void {
  if (process.env.PROACTIVE_DEBUG_AGENT === '1') {
    console.log('[agent-debug]', ...args)
  }
}

export class LangGraphAgentRuntime {
  constructor(
    private hooks: HookRegistry,
    private graph: CompiledAgentGraph,
    private deps: AgentRuntimeDeps
  ) {}

  async handleEvent(envelope: AgentEventEnvelope): Promise<void> {
    await this.hooks.invokeAll('orchestrator.beforeHandle', { envelope })
    const tid = envelope.conversationId ?? '__global__'
    try {
      agentDebugLog('invoke start', { thread_id: tid, type: envelope.type, source: envelope.source })
      await this.graph.invoke(
        {
          event: envelope,
          routeContext: {},
          orchestratorAction: null,
        },
        {
          configurable: { thread_id: tid },
          callbacks: [this.deps.traceLogger.createCallbackHandler()],
        }
      )
      agentDebugLog('invoke done', { thread_id: tid, type: envelope.type })
    } catch (e) {
      console.error('[langgraph] invoke failed', tid, e)
      this.deps.pushStream({
        v: 1,
        kind: 'error',
        conversationId: envelope.conversationId,
        message: e instanceof Error ? e.message : String(e),
      })
    } finally {
      await this.hooks.invokeAll('orchestrator.afterHandle', { envelope })
    }
  }
}
