import type { AgentEventEnvelope } from '../../shared/agent-events'
import type { AgentStreamPushV1 } from '../../shared/types'
import { HookRegistry } from './hook-registry'
import { AgentEventBus } from './event-bus'
import { ModelTurn } from './model-turn'
import { WorldStateStore } from './world-state-store'
import { SubAgentRunner } from './subagent-runner'
import { startIdleSampler } from './idle'
import { buildAgentGraph } from './graph/build-agent-graph'
import { LangGraphAgentRuntime } from './langgraph-runtime'
import type { AgentRuntimeDeps } from './runtime-deps'
import { AgentTraceLogger } from './tracing'

export function createAgentRuntime(pushStream: (p: AgentStreamPushV1) => void): {
  hooks: HookRegistry
  bus: AgentEventBus
  modelTurn: ModelTurn
  worldStore: WorldStateStore
  subAgentRunner: SubAgentRunner
  orchestrator: LangGraphAgentRuntime
  deps: AgentRuntimeDeps
} {
  const hooks = new HookRegistry()
  const bus = new AgentEventBus(hooks)
  const traceLogger = new AgentTraceLogger()
  const modelTurn = new ModelTurn(hooks, traceLogger)
  const worldStore = new WorldStateStore()

  let lastActiveConversationId: string | null = null
  const subAgentRunner = new SubAgentRunner(hooks, bus, modelTurn, pushStream)
  const idleSampler = startIdleSampler(bus)

  const deps: AgentRuntimeDeps = {
    hooks,
    modelTurn,
    worldStore,
    subAgentRunner,
    bus,
    pushStream,
    getLastActiveConversationId: () => lastActiveConversationId,
    setLastActiveConversationId: (id) => {
      lastActiveConversationId = id
    },
    traceLogger,
    idleSampler,
  }

  const { graph } = buildAgentGraph(deps)
  const orchestrator = new LangGraphAgentRuntime(hooks, graph, deps)

  bus.setConsumer((e: AgentEventEnvelope) => orchestrator.handleEvent(e))

  return { hooks, bus, modelTurn, worldStore, subAgentRunner, orchestrator, deps }
}
