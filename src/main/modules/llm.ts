import OpenAI from 'openai'
import * as fs from 'fs'
import { addUsage } from '../services/usage-totals'

/** LLM API 连接配置。 */
export interface LlmConfig {
  apiKey: string
  model: string
  baseURL?: string
}

/** OpenAI Chat Completion messages 参数中的单条消息。 */
export interface LlmMessage {
  /** 消息角色。system = 系统提示，user = 用户，assistant = AI，tool = 工具结果回填。 */
  role: 'system' | 'user' | 'assistant' | 'tool'
  /** 消息文本内容。tool_calls 类型的消息 content 为空字符串。 */
  content: string
  /** tool 角色消息必填：关联的 tool_call ID。 */
  tool_call_id?: string
  /** assistant 角色消息可选：LLM 发起的工具调用列表。 */
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
}

/**
 * 系统注入文本的包装：以 user 角色 + 明确标注，表示"这是系统给模型看的提示词/状态，
 * 不是玩家发言"。
 * 不用 assistant 角色：thinking 模式下 assistant 消息必须回传 reasoning_content，
 * 编造的 assistant 消息会被 API 拒绝（400）。
 */
export function systemNote(text: string): LlmMessage {
  return { role: 'user', content: `【系统提示】${text}` }
}

/** 判断消息是否为系统注入（systemNote 产物）。 */
export function isSystemNote(m: LlmMessage): boolean {
  return m.role === 'user' && m.content.startsWith('【系统提示】')
}

/** OpenAI tools 参数中的单个工具定义。 */
export interface LlmToolDef {
  type: 'function'
  function: {
    /** 工具名，与 ToolDefinition.name 一致。 */
    name: string
    /** 工具描述，LLM 据此决定是否调用此工具。 */
    description: string
    /** 输入参数的 JSON Schema。 */
    parameters: Record<string, unknown>
  }
}

/** LLM 单次调用的结果。 */
export type LlmResult =
  | {
      /** 纯文本回复（无工具调用）。 */
      kind: 'text'
      /** 回复文本内容。 */
      text: string
    }
  | {
      /** LLM 发起了工具调用。 */
      kind: 'tool_calls'
      /** 工具调用列表。框架应逐个执行并将结果回填到 messages 后再次调 LLM。 */
      toolCalls: Array<{
        /** tool_call ID，用于 tool 角色消息回填。 */
        id: string
        /** 工具名。 */
        name: string
        /** 工具参数的 JSON 字符串。 */
        args: string
      }>
    }

/** 流式推送中的一个数据块。 */
export type StreamChunk =
  | { kind: 'delta'; delta: string }
  | { kind: 'done'; finishReason: 'stop' }
  | { kind: 'done'; finishReason: 'tool_calls'; toolCalls: Array<{ id: string; name: string; args: string }> }

/**
 * LLM 调用模块。封装 OpenAI API 调用，支持工具调用返回。
 */
export class LlmProvider {
  private client: OpenAI

  constructor(private config: LlmConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    })
  }

  /**
   * 单轮 LLM 调用（非流式）。支持同时传入 tools 参数让 LLM 选择调用。
   * 可传入 AbortSignal 用于中断（图执行器透传 Runtime 的 abort 信号）。
   * @returns LlmResult，由调用方决定是直接输出还是继续执行工具。
   */
  async chat(messages: LlmMessage[], tools?: LlmToolDef[], signal?: AbortSignal, maxTokens?: number, responseFormat?: { type: 'json_object' }, contextId?: string): Promise<LlmResult> {
    // 调试：REQ 全量展示（验证继承上下文/聊天记录是否按预期拼入），成功 RES 不记录
    let _reqHead = ''
    try {
      const p = 'C:\\Users\\31100\\AppData\\Local\\Temp\\llm-raw.log'
      _reqHead = messages.map((m) => `[${m.role}] ${String(m.content || '').replace(/\n/g, '\\n')}${m.tool_calls ? ' tool_calls=' + JSON.stringify(m.tool_calls) : ''}`).join(' | ')
    } catch {}
    const completion = await this.client.chat.completions.create({
      model: this.config.model,
      messages: messages as any,
      ...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
      max_tokens: maxTokens ?? 384000,
      ...(responseFormat ? { response_format: responseFormat } : {}),
    }, signal ? { signal } : {})

    // 持久化 token 使用（输入/输出分开，缓存命中算命中率）
    const choice = completion.choices[0]
    try {
      const u: any = (completion as any).usage
      if (u) {
        const prompt = Number(u.prompt_tokens ?? 0)
        const completionTok = Number(u.completion_tokens ?? 0)
        const cached = Number(u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens ?? u.cached_tokens ?? 0)
        const kind = (choice?.message as any)?.tool_calls?.length ? 'tool_calls' as const : 'text' as const
        if (prompt || completionTok) addUsage(prompt, completionTok, cached, kind, contextId)
      }
    } catch {}

    const msg = choice?.message

    if (msg?.tool_calls && msg.tool_calls.length > 0) {
      const res = {
        kind: 'tool_calls' as const,
        toolCalls: msg.tool_calls.map((tc) => {
          const fn = (tc as { function: { name: string; arguments: string } }).function
          return { id: tc.id, name: fn.name, args: fn.arguments }
        }),
      }
      try {
        const p = 'C:\\Users\\31100\\AppData\\Local\\Temp\\llm-raw.log'
        fs.appendFileSync(p, `[DONE ${new Date().toISOString()} ctx=${contextId || ''}] REQ=${_reqHead}\n`, 'utf8')
      } catch {}
      return res
    }

    const text = msg?.content || ''
    try {
      const p = 'C:\\Users\\31100\\AppData\\Local\\Temp\\llm-raw.log'
      fs.appendFileSync(p, `[DONE ${new Date().toISOString()} ctx=${contextId || ''}] REQ=${_reqHead}\n`, 'utf8')
    } catch {}
    return { kind: 'text', text }
  }

  /**
   * 单轮 LLM 调用（流式）。逐 chunk yield。
   * 支持 AbortSignal 用于流式中断。
   */
  async *chatStream(messages: LlmMessage[], tools?: LlmToolDef[], signal?: AbortSignal): AsyncGenerator<StreamChunk> {
    // 调试：REQ 全量展示，成功 RES 不记录
    let _reqHead = ''
    try {
      const p = 'C:\\Users\\31100\\AppData\\Local\\Temp\\llm-raw.log'
      _reqHead = messages.map((m) => `[${m.role}] ${String(m.content || '').replace(/\n/g, '\\n')}${m.tool_calls ? ' tool_calls=' + JSON.stringify(m.tool_calls) : ''}`).join(' | ')
    } catch {}
    let stream: any
    try {
      stream = await this.client.chat.completions.create({
      model: this.config.model,
      messages: messages as any,
      ...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
      max_tokens: 384000,
      stream: true,
      stream_options: { include_usage: true } as any,
    }, signal ? { signal } : {})
    } catch (e) {
      try {
        const p = 'C:\\Users\\31100\\AppData\\Local\\Temp\\llm-raw.log'
        const msg = e instanceof Error ? e.message : String(e)
        fs.appendFileSync(p, `[RES-STREAM-ERR ${new Date().toISOString()}] ${msg}\n[DONE-STREAM-ERR ${new Date().toISOString()}] REQ=${_reqHead} | ERR=${msg}\n`, 'utf8')
      } catch {}
      throw e
    }

    // 聚合流式工具调用参数（OpenAI 将 tool_calls 的 arguments 拆成多个 chunk）
    const toolCallAccumulators = new Map<number, { id?: string; name?: string; args: string }>()

    for await (const chunk of stream) {
      // 流式 usage（需 stream_options.include_usage）
      try {
        const u: any = (chunk as any).usage
        if (u) {
          const prompt = Number(u.prompt_tokens ?? 0)
          const completionTok = Number(u.completion_tokens ?? 0)
          const cached = Number(u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens ?? u.cached_tokens ?? 0)
          if (prompt || completionTok) addUsage(prompt, completionTok, cached, 'text')
        }
      } catch {}
      const choice = chunk.choices?.[0]
      if (!choice) continue

      const delta = choice.delta

      if (delta?.content) {
        yield { kind: 'delta', delta: delta.content }
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const acc = toolCallAccumulators.get(tc.index) ?? { args: '' }
          if (tc.id) acc.id = tc.id
          if (tc.function?.name) acc.name = tc.function.name
          if (tc.function?.arguments) acc.args += tc.function.arguments
          toolCallAccumulators.set(tc.index, acc)
        }
      }

      if (choice.finish_reason === 'stop') {
        try {
          const p = 'C:\\Users\\31100\\AppData\\Local\\Temp\\llm-raw.log'
          fs.appendFileSync(p, `[DONE-STREAM ${new Date().toISOString()}] REQ=${_reqHead}\n`, 'utf8')
        } catch {}
        yield { kind: 'done', finishReason: 'stop' }
        return
      }
      if (choice.finish_reason === 'tool_calls') {
        const toolCalls = Array.from(toolCallAccumulators.values())
          .filter((tc): tc is { id: string; name: string; args: string } => !!tc.id && !!tc.name)
          .map((tc) => ({ id: tc.id, name: tc.name, args: tc.args }))
        try {
          const p = 'C:\\Users\\31100\\AppData\\Local\\Temp\\llm-raw.log'
          fs.appendFileSync(p, `[DONE-STREAM ${new Date().toISOString()}] REQ=${_reqHead}\n`, 'utf8')
        } catch {}
        yield { kind: 'done', finishReason: 'tool_calls', toolCalls }
        return
      }
    }
  }
}
