/** 工具调用上下文，由调用方传入。 */
export interface ToolCallMeta {
  conversationId?: string
  contextId?: string
  /** 触发本次工具调用的 LLM 轮次 runId，用于日志链路树（parentRunId）。 */
  parentRunId?: string
}

/**
 * 工具执行结果。
 * 异步工具在执行结束时通过执行结果回传此结果。
 */
export type ToolResult =
  | { ok: true; result: unknown }
  | { ok: false; error: string }

/**
 * transformPrompt 的产出：工具结果转换为 LLM 历史与事件回灌的统一形态。
 * - success：执行状态（工具名 + 错误，无 error 即成功），供下一轮循环回喂 LLM
 * - instruction：下一步行动建议（可选），随成功状态回喂 LLM，辅助约束后续工具选择
 * - result.text：工具产生的文本结果
 * - result.ui：UI 工具的完整文本化 UI 结果
 * - 两者皆空：工具功能已在副作用内完成，无 LLM 可见结果
 */
export interface ToolPromptResult {
  success: { toolName: string; error?: string }
  instruction?: string
  result?: { text?: string; ui?: string }
}

/**
 * 静默工具：执行后不入总线，无需 transformPrompt。
 */
interface SilentToolDef {
  name: string
  description: string
  inputSchema?: Record<string, unknown>
  run: (input: Record<string, unknown>, meta: ToolCallMeta) => ToolResult | Promise<ToolResult>
  silent: true
  transformPrompt?: undefined
}

/**
 * 非静默工具：执行后产生事件入总线，必须提供 transformPrompt。
 */
export interface NonSilentToolDef {
  name: string
  description: string
  inputSchema?: Record<string, unknown>
  run: (input: Record<string, unknown>, meta: ToolCallMeta) => ToolResult | Promise<ToolResult>
  silent?: false
  transformPrompt: (result: ToolResult) => ToolPromptResult
}

/** 工具定义——注册时需满足对应的 silent/transformPrompt 约束。 */
export type ToolDefinition = SilentToolDef | NonSilentToolDef
