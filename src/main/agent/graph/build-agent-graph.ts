import { StateGraph, START, END, Annotation, MemorySaver } from '@langchain/langgraph'
import { CORE_EVENT } from '../../../shared/agent-events'
import type { AgentEventEnvelope } from '../../../shared/agent-events'
import type { AgentRuntimeDeps } from '../runtime-deps'
import type { OrchestratorAction } from '../pipelines'
import {
  pipelineRouteEvent,
  pipelineOrchestratorThink,
  pipelineExecuteMemorySync,
  pipelineExecuteToolCall,
  pipelineExecuteDelegation,
} from '../pipelines'

/** 主智能体决策后的结构化输出 */
export type OrchestratorDecision = OrchestratorAction

const AgentState = Annotation.Root({
  event: Annotation<AgentEventEnvelope>({
    reducer: (_prev, next) => next,
  }),
  /** route_event 准备的上下文，供 orchestrator_think 使用 */
  routeContext: Annotation<Record<string, unknown>>({
    reducer: (_prev, next) => next,
    default: () => ({}),
  }),
  /** orchestrator_think 输出的决策 */
  orchestratorAction: Annotation<OrchestratorAction | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
})

export type CompiledAgentGraph = ReturnType<typeof buildAgentGraph>['graph']

export function buildAgentGraph(deps: AgentRuntimeDeps) {
  const g = new StateGraph(AgentState)
    // ─── route_event：根据事件类型准备上下文 ───
    .addNode('route_event', async (state) => {
      const ctx = await pipelineRouteEvent(deps, state.event)
      return { routeContext: ctx }
    })
    // ─── orchestrator_think：主智能体决策 ───
    .addNode('orchestrator_think', async (state) => {
      const action = await pipelineOrchestratorThink(deps, state.event, state.routeContext)
      return { orchestratorAction: action }
    })
    // ─── execute_memory_sync：执行记忆写入 ───
    .addNode('execute_memory_sync', async (state) => {
      await pipelineExecuteMemorySync(deps, state.orchestratorAction!, state.event.conversationId)
      return {}
    })
    // ─── execute_tool_call：执行插件工具 ───
    .addNode('execute_tool_call', async (state) => {
      await pipelineExecuteToolCall(deps, state.orchestratorAction!, state.event.conversationId)
      return {}
    })
    // ─── execute_delegation：委托子智能体 ───
    .addNode('execute_delegation', async (state) => {
      await pipelineExecuteDelegation(deps, state.orchestratorAction!, state.event.conversationId)
      return {}
    })

  // START → route_event → orchestrator_think
  g.addEdge(START, 'route_event')
  g.addEdge('route_event', 'orchestrator_think')

  // orchestrator_think → 条件边（根据 action 类型分发）
  g.addConditionalEdges(
    'orchestrator_think',
    (state) => {
      const action = state.orchestratorAction
      if (!action) return END
      switch (action.type) {
        case 'memory_sync':
          return 'execute_memory_sync'
        case 'tool_call':
          return 'execute_tool_call'
        case 'delegate':
          return 'execute_delegation'
        case 'done':
        default:
          return END
      }
    },
    {
      execute_memory_sync: 'execute_memory_sync',
      execute_tool_call: 'execute_tool_call',
      execute_delegation: 'execute_delegation',
      [END]: END,
    }
  )

  // 所有执行节点完成后 → END（通过事件总线回环）
  g.addEdge('execute_memory_sync', END)
  g.addEdge('execute_tool_call', END)
  g.addEdge('execute_delegation', END)

  const checkpointer = new MemorySaver()
  const graph = g.compile({ checkpointer })

  return { graph, checkpointer }
}
