import OpenAI from 'openai'
import { CORE_EVENT, createAgentEvent } from '../../shared/agent-events'
import type { AgentEventEnvelope } from '../../shared/agent-events'
import type { AgentStreamPushV1, ChatMessage, Conversation, GlobalSettings, ConversationSettings } from '../../shared/types'
import { configStore } from '../config-store'
import { conversationStore } from '../conversation-store'
import { messageStore } from '../message-store'
import { templateStore } from '../template-store'
import { pluginRegistry } from '../plugins/registry'
import { normalizeLocale, isDefaultConversationTitle, defaultConversationTitle } from '../../shared/locale'
import { getBuiltinRolePrompt, getFallbackRolePrompt, getImportantInfoSystemPrefix } from '../../shared/prompt-i18n'
import type { AgentRuntimeDeps } from './runtime-deps'
import type { ToolCallResult, ToolCall } from './model-turn'
import { DEFAULT_BASE_URL, DEFAULT_MODEL } from '../../shared/config'
import { buildSystemPrompt } from '../../shared/config'

// ─────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────

/** 主智能体决策后的结构化动作 */
export type OrchestratorAction =
  | { type: 'memory_sync'; memory: string[]; nextAction?: OrchestratorAction }
  | { type: 'tool_call'; toolCalls: ToolCall[]; conversationId: string; userMessage?: string; history?: ChatMessage[]; importantInfo?: string[]; rolePrompt?: string; conversationSettings?: ConversationSettings }
  | { type: 'delegate'; conversationId: string; userMessage: string; history: ChatMessage[]; importantInfo: string[]; rolePrompt: string; conversationSettings: ConversationSettings | undefined; globalSettings: GlobalSettings; isProactive?: boolean }
  | { type: 'done' }

// ─────────────────────────────────────────────
// route_event：根据事件类型准备上下文
// ─────────────────────────────────────────────

export async function pipelineRouteEvent(
  deps: AgentRuntimeDeps,
  envelope: AgentEventEnvelope
): Promise<Record<string, unknown>> {
  const ctx: Record<string, unknown> = { eventType: envelope.type }

  switch (envelope.type) {
    case CORE_EVENT.USER_TEXT: {
      const turnCtx = await pipelineIngestUserText(deps, envelope)
      ctx.userTurnContext = turnCtx
      deps.idleSampler.reset()
      break
    }
    case CORE_EVENT.SUBAGENT_FINISHED: {
      ctx.subagentPayload = envelope.payload
      break
    }
    case CORE_EVENT.TOOL_RESULT: {
      ctx.toolResultPayload = envelope.payload
      break
    }
    case CORE_EVENT.MEMORY_SYNCED: {
      ctx.memorySyncedPayload = envelope.payload
      break
    }
    case CORE_EVENT.IDLE_SAMPLE: {
      break
    }
    default:
      break
  }

  return ctx
}

// ─────────────────────────────────────────────
// orchestrator_think：主智能体统一决策
// ─────────────────────────────────────────────

export async function pipelineOrchestratorThink(
  deps: AgentRuntimeDeps,
  envelope: AgentEventEnvelope,
  routeContext: Record<string, unknown>
): Promise<OrchestratorAction> {
  const thinkRunId = `orch_think_${Date.now()}`
  await deps.traceLogger?.log('chain', 'start', {
    runId: thinkRunId,
    name: 'pipelineOrchestratorThink',
    inputs: { eventType: envelope.type, conversationId: envelope.conversationId },
  })

  try {
  const eventType = envelope.type
  const conversationId = envelope.conversationId

  // ── USER_TEXT：准备上下文，决定是直接委托还是先调工具 ──
  if (eventType === CORE_EVENT.USER_TEXT) {
    const ctx = routeContext.userTurnContext as UserTurnContext | null
    if (!ctx) return traceDone(deps, thinkRunId)

    // 同步记忆（用户消息落盘后的必要写回）
    await pipelineSyncMemoriesUserText(deps, ctx)

    // 检查是否有可用工具，如果有，先让主智能体决策是否调用
    const schemas = pluginRegistry.toolRuntime.getToolSchemas()
    if (schemas.length > 0) {
      const thinkResult = await pipelineAgentThink(deps, ctx)
    if (thinkResult.toolCalls && thinkResult.toolCalls.length > 0) {
      return traceEnd(deps, thinkRunId, { type: 'tool_call', toolCalls: thinkResult.toolCalls, conversationId: ctx.conversationId, userMessage: ctx.content, history: ctx.historyForModel, importantInfo: ctx.importantInfo, rolePrompt: ctx.rolePrompt, conversationSettings: ctx.conversationSettings })
    }
    }

    // 直接委托子智能体回复
    return traceEnd(deps, thinkRunId, {
      type: 'delegate',
      conversationId: ctx.conversationId,
      userMessage: ctx.content,
      history: ctx.historyForModel,
      importantInfo: ctx.importantInfo,
      rolePrompt: ctx.rolePrompt,
      conversationSettings: ctx.conversationSettings,
      globalSettings: configStore.get(),
    })
  }

  // ── TOOL_RESULT：工具执行结果，决定后续动作 ──
  if (eventType === CORE_EVENT.TOOL_RESULT) {
    const payload = routeContext.toolResultPayload as {
      toolResults?: ToolCallResult[]
      conversationId?: string
      userMessage?: string
      history?: ChatMessage[]
      importantInfo?: string[]
      rolePrompt?: string
      conversationSettings?: ConversationSettings
    } | undefined

    if (!payload?.toolResults?.length) return traceDone(deps, thinkRunId)

    // 工具执行完毕后，委托子智能体生成最终回复
    const cid = payload.conversationId || conversationId || ''
    if (!cid) return traceDone(deps, thinkRunId)

    const conv = await conversationStore.get(cid)
    const config = configStore.get()
    const locale = normalizeLocale(config.locale)
    const templateRef = conv?.settings?.templateName || config.defaultTemplateName || 'default'
    const template = templateStore.get(templateRef)
    const rolePrompt = payload.rolePrompt || (template?.isBuiltIn && template.id.startsWith('builtin_')
      ? getBuiltinRolePrompt(template.id.slice('builtin_'.length), locale)
      : template?.rolePrompt || getFallbackRolePrompt(locale))

    return traceEnd(deps, thinkRunId, {
      type: 'delegate',
      conversationId: cid,
      userMessage: payload.userMessage || '',
      history: payload.history || [],
      importantInfo: payload.importantInfo || conv?.memory || [],
      rolePrompt,
      conversationSettings: payload.conversationSettings || conv?.settings,
      globalSettings: config,
    })
  }

  // ── SUBAGENT_FINISHED：子智能体完成，主智能体决定是否同步记忆 ──
  if (eventType === CORE_EVENT.SUBAGENT_FINISHED) {
    const p = routeContext.subagentPayload as Partial<SubAgentFinishedPayload> | undefined
    const cid = (typeof p?.conversationId === 'string' ? p.conversationId : conversationId) || ''
    const runId = typeof p?.runId === 'string' ? p.runId : ''
    const summary = typeof p?.summary === 'string' ? p.summary : ''
    const isProactive = p?.isProactive === true
    const importantInfo = Array.isArray(p?.importantInfo) ? p.importantInfo : []

    if (!cid || !runId) return traceDone(deps, thinkRunId)

    // 子智能体回复落盘
    let replyOut = summary
    replyOut = await pluginRegistry.runMessageReceive(replyOut)

    const assistantMessage: ChatMessage = {
      id: runId,
      role: 'assistant',
      content: replyOut,
      createdAt: Date.now(),
      isProactive,
    }

    await deps.hooks.invokeAll('memory.beforeDialogueWrite', {
      conversationId: cid,
      message: assistantMessage,
      subagent: true,
    })
    messageStore.add(cid, assistantMessage)
    deps.pushStream({ v: 1, kind: 'message', conversationId: cid, message: assistantMessage })
    await deps.hooks.invokeAll('memory.afterDialogueWrite', {
      conversationId: cid,
      subagent: true,
    })

    // 主智能体决定是否同步记忆
    const newMemory = importantInfo.filter(Boolean)
    if (newMemory.length > 0) {
      return traceEnd(deps, thinkRunId, {
        type: 'memory_sync',
        memory: newMemory,
      })
    }

    // 更新 world state
    await deps.worldStore.patch(cid, {
      activeSubagentRunId: null as unknown as undefined,
      lastAssistantMessageAt: Date.now(),
    })

    return traceDone(deps, thinkRunId)
  }

  // ── MEMORY_SYNCED：记忆已同步完毕 ──
  if (eventType === CORE_EVENT.MEMORY_SYNCED) {
    return traceDone(deps, thinkRunId)
  }

  // ── IDLE_SAMPLE：主动关怀 ──
  if (eventType === CORE_EVENT.IDLE_SAMPLE) {
    const action = await pipelineIdleThink(deps)
    return traceEnd(deps, thinkRunId, action)
  }

  // ── 其他事件 ──
  return traceDone(deps, thinkRunId)
  } catch (e) {
    await deps.traceLogger?.log('chain', 'error', {
      runId: thinkRunId,
      name: 'pipelineOrchestratorThink',
      error: e instanceof Error ? e.message : String(e),
    })
    throw e
  }
}

/** trace 辅助：记录 done 并返回 */
async function traceDone(deps: AgentRuntimeDeps, runId: string): Promise<OrchestratorAction> {
  await deps.traceLogger?.log('chain', 'end', {
    runId,
    name: 'pipelineOrchestratorThink',
    outputs: { type: 'done' },
  })
  return { type: 'done' }
}

/** trace 辅助：记录 action 并返回 */
async function traceEnd(deps: AgentRuntimeDeps, runId: string, action: OrchestratorAction): Promise<OrchestratorAction> {
  await deps.traceLogger?.log('chain', 'end', {
    runId,
    name: 'pipelineOrchestratorThink',
    outputs: { type: action.type },
  })
  return action
}

// ─────────────────────────────────────────────
// execute_memory_sync：执行记忆写入
// ─────────────────────────────────────────────

export async function pipelineExecuteMemorySync(
  deps: AgentRuntimeDeps,
  action: OrchestratorAction,
  conversationId?: string
): Promise<void> {
  if (action.type !== 'memory_sync') return
  const cid = conversationId || ''
  if (!cid) return

  const newMemory = action.memory
  if (newMemory.length === 0) return

  const c = await conversationStore.get(cid)
  if (c) {
    const existing = c.memory || []
    const merged = Array.from(new Set([...existing, ...newMemory]))
    await deps.hooks.invokeAll('memory.beforeWorldWrite', { conversationId: cid, memory: merged })
    await conversationStore.update(cid, { memory: merged })
    await deps.hooks.invokeAll('memory.afterWorldWrite', { conversationId: cid })
  }
  await pluginRegistry.runMemoryUpdate(newMemory)

  // 记忆同步完成，入队 MEMORY_SYNCED 事件
  await deps.bus.enqueue(
    createAgentEvent({
      type: CORE_EVENT.MEMORY_SYNCED,
      source: 'kernel',
      conversationId: cid,
      payload: { memory: newMemory },
    })
  )
}

// ─────────────────────────────────────────────
// execute_tool_call：执行插件工具
// ─────────────────────────────────────────────

export async function pipelineExecuteToolCall(
  deps: AgentRuntimeDeps,
  action: OrchestratorAction,
  conversationId?: string
): Promise<void> {
  if (action.type !== 'tool_call') return
  const cid = action.conversationId || conversationId || ''

  const results = await pipelineCallTools(deps, action.toolCalls, cid)

  // 工具执行完成，入队 TOOL_RESULT 事件（携带原始上下文供后续 delegate 使用）
  await deps.bus.enqueue(
    createAgentEvent({
      type: CORE_EVENT.TOOL_RESULT,
      source: 'kernel',
      conversationId: cid,
      payload: {
        toolResults: results,
        conversationId: cid,
        userMessage: action.userMessage ?? '',
        history: action.history ?? [],
        importantInfo: action.importantInfo ?? [],
        rolePrompt: action.rolePrompt ?? '',
        conversationSettings: action.conversationSettings,
      },
    })
  )
}

// ─────────────────────────────────────────────
// execute_delegation：委托子智能体
// ─────────────────────────────────────────────

export async function pipelineExecuteDelegation(
  deps: AgentRuntimeDeps,
  action: OrchestratorAction,
  _conversationId?: string
): Promise<void> {
  if (action.type !== 'delegate') return

  const runId = `asst_${Date.now()}`
  deps.subAgentRunner.startRun({
    conversationId: action.conversationId,
    runId,
    subagentSystemPrompt: action.rolePrompt || '',
    userTask: action.userMessage,
    globalSettings: action.globalSettings,
    isProactive: action.isProactive,
    importantInfo: action.importantInfo,
  })

  // 记录当前活跃的子智能体 runId
  await deps.worldStore.patch(action.conversationId, {
    activeSubagentRunId: runId,
  })
}

// ─────────────────────────────────────────────
// 辅助函数（保留原有逻辑）
// ─────────────────────────────────────────────

export type UserTurnContext = {
  conversationId: string
  content: string
  userMessageId: string
  rolePrompt: string
  conversationSettings: Conversation['settings'] | undefined
  importantInfo: string[]
  historyForModel: ChatMessage[]
}

function titleFromFirstUserMessage(
  text: string,
  locale: ReturnType<typeof normalizeLocale>,
  maxLen = 42
): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return defaultConversationTitle(locale)
  if (normalized.length <= maxLen) return normalized
  return normalized.slice(0, maxLen).trimEnd() + '…'
}

/** 用户消息落盘 + UI；返回后续节点用的上下文 */
async function pipelineIngestUserText(
  deps: AgentRuntimeDeps,
  envelope: AgentEventEnvelope
): Promise<UserTurnContext | null> {
  const conversationId = envelope.conversationId
  const text = typeof envelope.payload.text === 'string' ? envelope.payload.text : ''
  if (!conversationId || !text.trim()) return null

  deps.setLastActiveConversationId(conversationId)
  const config = configStore.get()
  const locale = normalizeLocale(config.locale)

  let conversationSettings: Conversation['settings'] | undefined
  const conversation = await conversationStore.get(conversationId)
  if (conversation) conversationSettings = conversation.settings

  const templateRef = conversationSettings?.templateName || config.defaultTemplateName || 'default'
  const template = templateStore.get(templateRef)
  let rolePrompt: string
  if (template?.isBuiltIn && template.id.startsWith('builtin_')) {
    const key = template.id.slice('builtin_'.length)
    rolePrompt = getBuiltinRolePrompt(key, locale)
  } else {
    rolePrompt = template?.rolePrompt || getFallbackRolePrompt(locale)
  }

  const content = await pluginRegistry.runMessageSend(text)
  const history = messageStore.getByConversation(conversationId)

  const conv = await conversationStore.get(conversationId)
  if (history.length === 0 && conv && isDefaultConversationTitle(conv.title)) {
    await conversationStore.update(conversationId, {
      title: titleFromFirstUserMessage(content, locale),
    })
  }

  const userMessageId =
    typeof envelope.payload.userMessageId === 'string' && envelope.payload.userMessageId.length > 0
      ? envelope.payload.userMessageId
      : `msg_${Date.now()}`
  const userMessage: ChatMessage = {
    id: userMessageId,
    role: 'user',
    content,
    createdAt: Date.now(),
  }
  messageStore.add(conversationId, userMessage)
  deps.pushStream({ v: 1, kind: 'message', conversationId, message: userMessage })

  const importantInfo = conversation?.memory || []
  const historyForModel = pluginRegistry.patchHistoryLastUserContent(
    [...history, userMessage],
    content
  )

  return {
    conversationId,
    content,
    userMessageId,
    rolePrompt,
    conversationSettings,
    importantInfo,
    historyForModel,
  }
}

/** 用户消息后的记忆同步（world state 更新） */
async function pipelineSyncMemoriesUserText(
  deps: AgentRuntimeDeps,
  ctx: UserTurnContext
): Promise<void> {
  await deps.hooks.invokeAll('memory.beforeWorldWrite', {
    conversationId: ctx.conversationId,
    phase: 'sync_after_user_ingest',
  })
  await deps.worldStore.patch(ctx.conversationId, { lastUserActivityAt: Date.now() })
  await deps.hooks.invokeAll('memory.afterWorldWrite', {
    conversationId: ctx.conversationId,
    phase: 'sync_after_user_ingest',
  })
}

/** 主智能体非流式决策调用 */
async function pipelineAgentThink(
  deps: AgentRuntimeDeps,
  ctx: UserTurnContext,
  previousToolResults?: ToolCallResult[]
): Promise<{ toolCalls?: ToolCall[] }> {
  const runId = `llm_think_${Date.now()}`
  await deps.traceLogger?.log('llm', 'start', {
    runId,
    name: 'pipelineAgentThink',
    inputs: { model: configStore.get().model, toolCount: pluginRegistry.toolRuntime.getToolSchemas().length },
  })

  try {
  const config = configStore.get()
  const schemas = pluginRegistry.toolRuntime.getToolSchemas()
  const tools: OpenAI.Chat.ChatCompletionTool[] = schemas.map((s) => ({
    type: 'function',
    function: {
      name: s.name,
      description: `Tool ${s.name}`,
      parameters: s.schema || { type: 'object', properties: {} },
    },
  }))

  const apiKey = config.apiKey || ''
  const model = config.model || DEFAULT_MODEL
  const baseURL = config.baseURL || DEFAULT_BASE_URL
  const locale = normalizeLocale(config.locale)
  const finalRolePrompt = ctx.rolePrompt || getFallbackRolePrompt(locale)
  let systemPrompt = buildSystemPrompt(finalRolePrompt)

  systemPrompt = await pluginRegistry.runSystemPromptBuild({
    systemPrompt,
    locale,
  })

  const client = new OpenAI({ apiKey, baseURL })
  const recentMessagesCount = ctx.conversationSettings?.recentMessagesCount || 3

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = []
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt })
  }
  if (ctx.importantInfo.length > 0) {
    messages.push({
      role: 'system',
      content: `${getImportantInfoSystemPrefix(locale)}${ctx.importantInfo.join('; ')}`,
    })
  }
  for (const msg of ctx.historyForModel.slice(-recentMessagesCount)) {
    messages.push({ role: msg.role, content: msg.content })
  }

  if (previousToolResults && previousToolResults.length > 0) {
    messages.push({
      role: 'assistant',
      content: null,
      tool_calls: previousToolResults.map((tcr) => ({
        id: tcr.toolCall.id,
        type: tcr.toolCall.type,
        function: {
          name: tcr.toolCall.function.name,
          arguments: tcr.toolCall.function.arguments,
        },
      })),
    })
    for (const tcr of previousToolResults) {
      messages.push({
        role: 'tool',
        tool_call_id: tcr.toolCall.id,
        content: tcr.result.ok
          ? JSON.stringify(tcr.result.result)
          : JSON.stringify({ error: tcr.result.error, blocked: tcr.result.blocked }),
      })
    }
  }

  messages.push({ role: 'user', content: ctx.content })

  await deps.hooks.invokeAll('model.beforeCall', {
    userMessage: ctx.content,
    systemPromptLength: systemPrompt.length,
  })

  const completion = await client.chat.completions.create({
    model,
    messages,
    tools: tools.length > 0 ? tools : undefined,
    tool_choice: tools.length > 0 ? 'auto' : undefined,
    max_tokens: 1024,
  })

  const choice = completion.choices[0]
  const message = choice?.message

  if (message?.tool_calls && message.tool_calls.length > 0) {
    await deps.traceLogger?.log('llm', 'end', {
      runId,
      name: 'pipelineAgentThink',
      outputs: { toolCalls: message.tool_calls.map((tc) => ('function' in tc ? tc.function.name : '')) },
    })
    return {
      toolCalls: message.tool_calls.map((tc) => {
          const fn = ('function' in tc ? tc.function : (tc as { function: { name: string; arguments: string } }).function)
          return {
            id: tc.id,
            type: tc.type as 'function',
            function: { name: fn.name, arguments: fn.arguments },
          }
        }),
    }
  }

  await deps.traceLogger?.log('llm', 'end', {
    runId,
    name: 'pipelineAgentThink',
    outputs: { noToolCalls: true },
  })
  return {}
  } catch (e) {
    await deps.traceLogger?.log('llm', 'error', {
      runId,
      name: 'pipelineAgentThink',
      error: e instanceof Error ? e.message : String(e),
    })
    throw e
  }
}

/** 调用插件工具 */
async function pipelineCallTools(
  deps: AgentRuntimeDeps,
  toolCalls: ToolCall[],
  conversationId: string
): Promise<ToolCallResult[]> {
  const runId = `tools_${Date.now()}`
  await deps.traceLogger?.log('tool', 'start', {
    runId,
    name: 'pipelineCallTools',
    inputs: { toolNames: toolCalls.map((t) => t.function.name) },
  })

  const results: ToolCallResult[] = []

  for (const tc of toolCalls) {
    const toolRunId = `tool_${tc.function.name}_${Date.now()}`
    await deps.traceLogger?.log('tool', 'start', {
      runId: toolRunId,
      parentRunId: runId,
      name: tc.function.name,
      inputs: { args: tc.function.arguments },
    })

    let args: unknown
    try {
      args = JSON.parse(tc.function.arguments)
    } catch {
      args = tc.function.arguments
    }

    const result = await pluginRegistry.toolRuntime.call(
      tc.function.name,
      args,
      { actor: 'agent', conversationId }
    )

    const toolResult: ToolCallResult['result'] = result.ok
      ? { ok: true, result: result.result }
      : { ok: false, error: result.error, blocked: result.blocked }

    results.push({ toolCall: tc, result: toolResult })

    await deps.traceLogger?.log('tool', 'end', {
      runId: toolRunId,
      parentRunId: runId,
      name: tc.function.name,
      outputs: { ok: result.ok },
    })
  }

  await deps.traceLogger?.log('tool', 'end', {
    runId,
    name: 'pipelineCallTools',
    outputs: { toolCount: results.length },
  })

  return results
}

/** IDLE_SAMPLE 时的主动关怀决策 */
async function pipelineIdleThink(deps: AgentRuntimeDeps): Promise<OrchestratorAction> {
  const conversationId = deps.getLastActiveConversationId()
  if (!conversationId) return { type: 'done' }

  const config = configStore.get()
  if (!config.proactiveEnabled) return { type: 'done' }

  const conv = await conversationStore.get(conversationId)
  const proactiveEnabled = conv?.settings?.proactiveEnabled ?? config.proactiveEnabled
  if (!proactiveEnabled) return { type: 'done' }

  const locale = normalizeLocale(config.locale)
  const templateRef = conv?.settings?.templateName || config.defaultTemplateName || 'default'
  const template = templateStore.get(templateRef)
  let rolePrompt: string
  if (template?.isBuiltIn && template.id.startsWith('builtin_')) {
    rolePrompt = getBuiltinRolePrompt(template.id.slice('builtin_'.length), locale)
  } else {
    rolePrompt = template?.rolePrompt || getFallbackRolePrompt(locale)
  }

  const history = messageStore.getByConversation(conversationId)
  const importantInfo = conv?.memory || []
  const syntheticUser =
    locale === 'en-US'
      ? '[System] The user has been idle. If appropriate, send one brief, caring message.'
      : '【系统】用户已安静一段时间，若合适请发一条简短、自然的主动关心消息。'

  return {
    type: 'delegate',
    conversationId,
    userMessage: syntheticUser,
    history,
    importantInfo,
    rolePrompt,
    conversationSettings: conv?.settings,
    globalSettings: config,
    isProactive: true,
  }
}

// ─────────────────────────────────────────────
// SubAgentFinishedPayload 类型（从 subagent-runner 移出）
// ─────────────────────────────────────────────

export type SubAgentFinishedPayload = {
  runId: string
  status: 'success' | 'aborted'
  summary: string
  conversationId: string
  importantInfo?: string[]
  isProactive?: boolean
}
