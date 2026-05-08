import type { HookRegistry } from './hook-registry'
import type { ModelTurn } from './model-turn'
import type { WorldStateStore } from './world-state-store'
import type { SubAgentRunner } from './subagent-runner'
import type { AgentEventBus } from './event-bus'
import type { AgentStreamPushV1 } from '../../shared/types'
import type { AgentTraceLogger } from './tracing'
import type { IdleSamplerHandle } from './idle'

export type AgentRuntimeDeps = {
  hooks: HookRegistry
  modelTurn: ModelTurn
  worldStore: WorldStateStore
  subAgentRunner: SubAgentRunner
  bus: AgentEventBus
  pushStream: (p: AgentStreamPushV1) => void
  getLastActiveConversationId: () => string | null
  setLastActiveConversationId: (id: string | null) => void
  traceLogger: AgentTraceLogger
  idleSampler: IdleSamplerHandle
}
