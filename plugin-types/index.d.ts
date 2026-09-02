/**
 * @prisflow/proactiveai-plugin-types
 *
 * ProactiveAI 宿主插件 API 的类型契约。
 * 本文件为自包含声明（不 import 宿主相对路径），可独立发布 npm。
 *
 * 发布：push 到 main 且 plugin-types/ 有变更时，
 * 由 .github/workflows/publish-plugin-types.yml 触发；
 * 仓库已在 npmjs 侧配置 trusted publishing（OIDC 自动认证，无需 NPM_TOKEN）。
 *
 * 使用：
 *   npm i -D @prisflow/proactiveai-plugin-types
 *
 * 插件入口（单 JS 文件，CJS）：
 *   const plugin = {
 *     id: 'my-plugin',
 *     name: '我的插件',
 *     version: '1.0.0',
 *     setup(api) { api.registerContext(...); api.registerTool(...); },
 *   }
 *   module.exports = plugin
 *
 * 分发：zip 包内 plugin.json + 入口 js（见 PluginManifest）。
 */

/** semver 版本号。 */
export type SemVer = string

/** 插件定义。单 JS 文件，`module.exports = { id, name, version, setup }`。 */
export interface Plugin {
  /** 插件唯一 ID（与 plugin.json id 一致）。 */
  id: string
  /** 人类可读名称。 */
  name: string
  /** semver 版本号。 */
  version: string
  /** 描述。 */
  description?: string
  /** 安装钩子：宿主加载文件后调用，在此注册上下文/工具/Flow 等。 */
  setup(api: PluginSetupAPI): void
}

/** 插件包元数据（zip 根目录 plugin.json）。 */
export interface PluginManifest {
  /** 插件唯一 ID，必须与 JS 内 plugin.id 一致。 */
  id: string
  /** 展示名。 */
  name: string
  /** semver 版本号，必须与 JS 内 version 一致。 */
  version: string
  /** 描述。 */
  description?: string
  /** zip 内入口文件名（默认 'index.js'）。 */
  entry?: string
  /** 宿主最低版本（大于则拒绝安装）。 */
  minAppVersion?: string
  /** 作者。 */
  author?: string
  /** 下载来源（如 COS 地址），展示用。 */
  homepage?: string
}

/** 上下文角色。 */
export type ContextRole = 'main' | 'sub'

/** 压缩层配置（per-context，未配置字段走全局默认）。 */
export interface ContextCompactionConfig {
  /** 压缩器系统提示词。 */
  summaryPrompt?: string
  /** 摘要写入的记忆 slot 名（缺省 'summary'）。 */
  summarySlot?: string
  /** 摘要头部标签文本（如 【剧情史】）。 */
  summaryLabel?: string
  /** 触发压缩的 token 预算。已弃用——触发改为 provider 真实 usage > 窗口-输出上限，不再读取该字段。 */
  tokenBudget?: number
  /** 压缩后保留的最近消息估算 token 数（缺省 8000）。 */
  keepTokens?: number
  /** 稳定前缀构建：可追加自定义记忆 slot（world_setting 等）。 */
  prefixSlots?: string[]
  /** 是否启用再压缩（摘要超预算时摘要的摘要）。缺省 true。 */
  allowResummarize?: boolean
}

/** 上下文注册描述 —— 插件或内置模块注册时提供。 */
export interface ContextDefinition {
  /** 上下文唯一 ID。 */
  contextId: string
  /** 上下文角色。 */
  role: ContextRole
  /** 进入此上下文时注入到系统提示的文本。 */
  initialPrompt?: string
  /** 供主上下文 host_enter_subcontext 选路时展示的简短描述。 */
  description?: string
  /** 此上下文中可见的工具名列表。 */
  toolNames?: string[]
  /** 压缩层配置（per-context）。 */
  compaction?: ContextCompactionConfig
}

/** 工具调用上下文（调用方传入）。conversationId/contextId 恒有值（工具都在会话+上下文内执行）。 */
export interface ToolCallMeta {
  conversationId: string
  contextId: string
  /** 触发本次工具调用的 LLM 轮次 runId（日志链路树）。 */
  parentRunId?: string
}

/** 工具执行结果。 */
export type ToolResult =
  | { ok: true; result: unknown }
  | { ok: false; error: string }

/** transformPrompt 的产出：工具结果转换为 LLM 历史与事件回灌的统一形态。 */
export interface ToolPromptResult {
  success: { toolName: string; error?: string }
  instruction?: string
  result?: { text?: string; ui?: string }
}

/** 静默工具：执行后不入事件总线，无需 transformPrompt。 */
export interface SilentToolDef {
  name: string
  description: string
  inputSchema?: Record<string, unknown>
  run: (input: Record<string, unknown>, meta: ToolCallMeta) => ToolResult | Promise<ToolResult>
  silent: true
  transformPrompt?: undefined
}

/** 非静默工具：执行后产生事件入总线，必须提供 transformPrompt。 */
export interface NonSilentToolDef {
  name: string
  description: string
  inputSchema?: Record<string, unknown>
  run: (input: Record<string, unknown>, meta: ToolCallMeta) => ToolResult | Promise<ToolResult>
  silent?: false
  transformPrompt: (result: ToolResult) => ToolPromptResult
}

/** 工具定义 —— 注册时需满足对应的 silent/transformPrompt 约束。 */
export type ToolDefinition = SilentToolDef | NonSilentToolDef

/** LLM API 连接配置（与宿主对齐：baseURL 未配置为 null）。 */
export interface LlmConfig {
  apiKey: string
  model: string
  baseURL: string | null
}

/** LLM 消息（OpenAI Chat Completion 单条）。 */
export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_call_id?: string
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
}

/** OpenAI tools 参数中的单个工具定义。 */
export interface LlmToolDef {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

/** LLM 单次调用结果。 */
export type LlmResult =
  | { kind: 'text'; text: string }
  | {
      kind: 'tool_calls'
      toolCalls: Array<{ id: string; name: string; args: string }>
    }

/** 流式推送中的数据块。 */
export type StreamChunk =
  | { kind: 'delta'; delta: string }
  | { kind: 'done'; finishReason: 'stop' }
  | { kind: 'done'; finishReason: 'tool_calls'; toolCalls: Array<{ id: string; name: string; args: string }> }

/** 图执行共享上下文（Flow 节点）。 */
export interface FlowCtx {
  conversationId?: string
  contextId?: string
  signal?: AbortSignal
  history?: LlmMessage[]
  input: unknown
  state: Record<string, unknown>
  data: Record<string, unknown>
  push: (payload: { kind: 'ui_render'; component: string; props: Record<string, unknown>; children?: unknown[] }) => void
  rendered: boolean
}

/** LLM 生成节点。 */
export interface LlmNode {
  type: 'llm'
  system: string
  input: (ctx: FlowCtx) => string
  schema?: Record<string, unknown>
  /** 结果存入 ctx.data 的键（缺省为 system 前 16 字符，无稳定语义，建议显式指定）。 */
  assign?: string
  maxTries?: number
  maxTokens?: number
}

/** 静态节点：纯函数（校验/记账/门控）。 */
export interface StaticNode {
  type: 'static'
  fn: (ctx: FlowCtx) => string | void
}

/** 渲染终止节点。 */
export interface RenderNode {
  type: 'render'
  build: (ctx: FlowCtx) => { component: string; props: Record<string, unknown>; children?: unknown[] }
}

/** 条件分支节点。 */
export interface ConditionNode {
  type: 'condition'
  when: (ctx: FlowCtx) => boolean
  then: FlowNode[]
  else?: FlowNode[]
}

/** Flow 节点联合。 */
export type FlowNode = LlmNode | StaticNode | RenderNode | ConditionNode

/** 图定义。 */
export interface FlowDefinition {
  name: string
  nodes: FlowNode[]
  requireRender?: boolean
}

/** 图执行结果。 */
export interface FlowResult {
  ok: boolean
  error?: string
  data: Record<string, unknown>
  state: Record<string, unknown>
  rendered: boolean
}

/** 插件 setup(api) 拿到的宿主 API。 */
export interface PluginSetupAPI {
  /** 注册一个子上下文到全局 ContextRegistry。 */
  registerContext(def: ContextDefinition): boolean
  /** 注册一个工具到全局 ToolRegistry。 */
  registerTool(def: ToolDefinition): boolean
  /** 插件持久化存储（SQLite plugin_data 表，按插件 ID 一行，值任意 JSON）。 */
  storage: {
    /** 读取插件持久化数据，无记录返回 null。 */
    get(): unknown
    /** 整体覆盖写入插件持久化数据。 */
    set(data: unknown): void
  }
  /**
   * 头部稳定层注入（三段式 system 稳定前缀）。
   * 向当前会话+上下文的头部注入固定/慢变文本（如世界状态卡），
   * 宿主组装 LLM 请求时自动读入稳定前缀（慢变 → 缓存恒命中）。
   * 归属自动取自宿主执行上下文，插件无需传会话 ID。
   */
  prompts: {
    /** 注入/更新头部稳定层文本（覆盖该会话+上下文的注入位）。 */
    set(text: string): void
    /** 移除已注入的文本。 */
    remove(text: string): void
  }
  /** 宿主 LLM 能力：结构化生成（schema 校验失败自动重试）。 */
  llm: {
    generate(input: {
      system: string
      input: string
      schema?: Record<string, unknown>
      maxTries?: number
    }): Promise<{ ok: true; text: string; data: unknown } | { ok: false; error: string }>
  }
  /** 回合执行器（图）：工具的 run() 内部实现设施。 */
  flow: {
    /** 注册一张图（节点链）。 */
    register(def: FlowDefinition): boolean
    /** 执行一张图，渲染经 push 通道推送并落库。会话归属自动取自执行上下文。 */
    run(
      name: string,
      input: unknown
    ): Promise<FlowResult>
  }
}
