import OpenAI from 'openai'
import { addUsage } from '../services/usage-totals'
import { MODEL_SPECS, DEFAULT_OUTPUT_LIMIT } from '@shared/constants'

/** LLM API 连接配置。baseURL 与 GlobalSettings 数据库约束对齐（string | null）。 */
export interface LlmConfig {
  apiKey: string
  model: string
  baseURL: string | null
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
 * 从 OpenAI usage 响应中提取 token 计数并落库（chat / chatStream 共用）。
 * 兼容多种 usage 形态：非流式 completion.usage、流式 chunk.usage（需 include_usage）。
 * 结构异常时静默跳过，不影响主流程。
 * @param usage OpenAI 响应的 usage 字段
 * @param kind 调用类型：'tool_calls' = 工具调用轮；'text' = 纯文本轮
 * @param contextId 产生该调用的上下文 ID（缺省归入 'main'）
 * @returns 本次请求的输入 token 数（供调用方记录 lastPromptTokens，异常返回 0）
 */
function trackUsage(usage: unknown, kind: 'text' | 'tool_calls', contextId?: string): number {
  try {
    if (!usage) return 0
    const u = usage as {
      prompt_tokens?: number
      completion_tokens?: number
      prompt_tokens_details?: { cached_tokens?: number }
      prompt_cache_hit_tokens?: number
      cached_tokens?: number
    }
    const prompt = Number(u.prompt_tokens ?? 0)
    const completion = Number(u.completion_tokens ?? 0)
    const cached = Number(u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens ?? u.cached_tokens ?? 0)
    if (prompt || completion) addUsage(prompt, completion, cached, kind, contextId)
    return prompt
  } catch {
    return 0
  }
}

/** 单次请求输出上限：模型规格的 output（缺省兜底）。max_tokens 超过它会被 provider 拒绝或截断。 */
function outputCap(model: string): number {
  return MODEL_SPECS[model]?.output ?? DEFAULT_OUTPUT_LIMIT
}

/**
 * LLM 调用模块。封装 OpenAI API 调用，支持工具调用返回。
 */
export class LlmProvider {
  private client: OpenAI
  /** 最近一次请求的真实输入 token 数（provider usage 返回，压缩触发判据）。 */
  lastPromptTokens = 0

  constructor(private config: LlmConfig) {
    this.client = new OpenAI({
      // 空 apiKey 用占位符：SDK 构造遇空串会 throw（炸掉整个启动链），
      // 占位符让启动正常、请求时才失败（前端有"未配置 API Key"提示）
      apiKey: config.apiKey || 'not-configured',
      // null（未配置）→ 不传，走 OpenAI SDK 默认地址
      baseURL: config.baseURL ?? undefined,
    })
  }

  /**
   * 单轮 LLM 调用（非流式）。支持同时传入 tools 参数让 LLM 选择调用。
   * 可传入 AbortSignal 用于中断（图执行器透传 Runtime 的 abort 信号）。
   * @returns LlmResult，由调用方决定是直接输出还是继续执行工具。
   */
  async chat(messages: LlmMessage[], tools?: LlmToolDef[], signal?: AbortSignal, maxTokens?: number, responseFormat?: { type: 'json_object' }, contextId?: string): Promise<LlmResult> {
    const completion = await this.client.chat.completions.create({
      model: this.config.model,
      messages: messages as any,
      ...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
      max_tokens: Math.min(maxTokens ?? outputCap(this.config.model), outputCap(this.config.model)),
      ...(responseFormat ? { response_format: responseFormat } : {}),
    }, signal ? { signal } : {})

    // 持久化 token 使用（输入/输出分开，缓存命中算命中率）+ 记录真实输入 token（压缩触发判据）
    const choice = completion.choices[0]
    const kind = (choice?.message as any)?.tool_calls?.length ? 'tool_calls' as const : 'text' as const
    this.lastPromptTokens = trackUsage((completion as any).usage, kind, contextId)

    const msg = choice?.message

    if (msg?.tool_calls && msg.tool_calls.length > 0) {
      const res = {
        kind: 'tool_calls' as const,
        toolCalls: msg.tool_calls.map((tc) => {
          const fn = (tc as { function: { name: string; arguments: string } }).function
          return { id: tc.id, name: fn.name, args: fn.arguments }
        }),
      }
      return res
    }

    const text = msg?.content || ''
    return { kind: 'text', text }
  }

  /**
   * 单轮 LLM 调用（流式）。逐 chunk yield。
   * 支持 AbortSignal 用于流式中断。
   */
  async *chatStream(messages: LlmMessage[], tools?: LlmToolDef[], signal?: AbortSignal): AsyncGenerator<StreamChunk> {
    const stream: any = await this.client.chat.completions.create({
      model: this.config.model,
      messages: messages as any,
      ...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
      max_tokens: outputCap(this.config.model),
      stream: true,
      stream_options: { include_usage: true } as any,
    }, signal ? { signal } : {})

    // 聚合流式工具调用参数（OpenAI 将 tool_calls 的 arguments 拆成多个 chunk）
    const toolCallAccumulators = new Map<number, { id?: string; name?: string; args: string }>()

    for await (const chunk of stream) {
      // 流式 usage（需 stream_options.include_usage，通常最后一块携带）
      this.lastPromptTokens = trackUsage((chunk as any).usage, 'text')
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
        yield { kind: 'done', finishReason: 'stop' }
        return
      }
      if (choice.finish_reason === 'tool_calls') {
        const toolCalls = Array.from(toolCallAccumulators.values())
          .filter((tc): tc is { id: string; name: string; args: string } => !!tc.id && !!tc.name)
          .map((tc) => ({ id: tc.id, name: tc.name, args: tc.args }))
        yield { kind: 'done', finishReason: 'tool_calls', toolCalls }
        return
      }
    }
  }
}
