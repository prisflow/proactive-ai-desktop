export interface GlobalSettings {
  apiKey: string
  model: string
  baseURL?: string
  /** 界面与下发给模型的系统提示语言 */
  locale?: 'zh-CN' | 'en-US'
  defaultTemplateName?: string
  defaultProactiveInterval?: number
  defaultMaxTriggers?: number
  proactiveEnabled?: boolean
  theme?: 'light' | 'dark' | 'auto'
  fontSize?: number
}

export interface UserSettings {
  templateName?: string
  proactiveInterval?: number
  recentMessagesCount?: number
  proactiveEnabled?: boolean
  importantInfoThreshold?: number
  theme?: 'light' | 'dark' | 'auto'
  fontSize?: number
}

export interface UserConfig extends GlobalSettings {
  settings?: UserSettings
}

export type ChatResponse = AIResponse

export interface ConversationSettings {
  templateName?: string
  proactiveInterval?: number
  recentMessagesCount?: number
  proactiveEnabled?: boolean
}

export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  settings?: ConversationSettings
  /**
   * 会话级记忆（从 AIResponse.important_info 归档）
   */
  memory?: string[]
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  isProactive?: boolean
}

/** 主模型单轮结构化输出（无 triggers） */
export interface AIResponse {
  reply: string
  important_info: string[]
}

/** Main → Renderer：流式增量（SSE 语义，走 IPC） */
export type AgentStreamPushV1 =
  | {
      v: 1
      kind: 'stream'
      conversationId: string
      runId: string
      role: 'assistant'
      delta: string
      done: boolean
      /** 子智能体流时标注 */
      streamKind?: 'main' | 'subagent'
    }
  | {
      v: 1
      kind: 'message'
      conversationId: string
      message: ChatMessage
    }
  | {
      v: 1
      kind: 'error'
      conversationId?: string
      message: string
    }

export interface PromptTemplate {
  id: string
  name: string
  rolePrompt: string
  isBuiltIn: boolean
  createdAt: number
  updatedAt: number
}

export type ToolActor = 'user' | 'agent' | 'system'

export interface PreToolUseContext {
  toolName: string
  args: unknown
  actor: ToolActor
  requestId?: string
  conversationId?: string
}

/** 返回 blocked 可拦截本次 tool（v1 治理钩子） */
export type PreToolUseResult = { blocked?: true; reason?: string; args?: unknown }

export interface PostToolUseContext {
  toolName: string
  args: unknown
  result?: unknown
  error?: string
  actor: ToolActor
  durationMs: number
  requestId?: string
  conversationId?: string
}

export interface PluginHooks {
  onMessageSend?: (message: string) => string | Promise<string>
  onMessageReceive?: (reply: string) => string | Promise<string>
  onMemoryUpdate?: (importantInfo: string[]) => void | Promise<void>
  /**
   * system prompt 构建钩子：返回要追加到 system prompt 的文本（空/undefined 表示不修改）。
   * 这是“提示词注入”的标准扩展点（插件与未来的 RAG 都在这里拼接）。
   */
  onSystemPromptBuild?: (input: {
    systemPrompt: string
    locale?: 'zh-CN' | 'en-US'
    conversationId?: string
  }) => string | void | Promise<string | void>
  onConfigChange?: (config: Record<string, any>) => void | Promise<void>
  onInit?: () => void | Promise<void>
  onDestroy?: () => void | Promise<void>
  /** Tool 调用前（治理/审计；可阻断） */
  preToolUse?: (
    ctx: PreToolUseContext
  ) => void | PreToolUseResult | Promise<void | PreToolUseResult>
  /** Tool 调用后 */
  postToolUse?: (ctx: PostToolUseContext) => void | Promise<void>
}

export interface Plugin {
  name: string
  version: string
  description?: string
  author?: string
  hooks: PluginHooks
  config?: Record<string, any>
}

export type PluginDispatchMessage =
  | { v: 1; pluginId: string; type: 'AVATAR_SET_MOOD'; mood: string; durationMs?: number }
  | { v: 1; pluginId: string; type: 'AVATAR_PLAY_EMOTE'; name: string; durationMs?: number }

/** 主进程通过 ctx.assets.getActive() 暴露给插件的快照（无 URL / 绝对路径） */
export type ActiveAssetPackSnapshot = {
  packId: string
  version: string
  expressions?: Record<string, { row: number; col: number }>
}

export type AssetPackManifestV1 = {
  v: 1
  packId: string
  version: string
  name: string
  author?: string
  license?: string
  /**
   * 表情 id → atlas 网格坐标（0-based）。
   * 若省略，则渲染层 worker 使用内置默认映射（兼容旧 pack）。
   */
  expressions?: Record<string, { row: number; col: number }>
  idle: {
    kind: 'sheet'
    /** relative path under pack dir */
    src: string
    frameW: number
    frameH: number
    frames: number
    fps: number
  }
  atlas: {
    /** relative path under pack dir */
    src: string
    cols: number
    rows: number
    tileW: number
    tileH: number
  }
}

export type AssetPackResolved = {
  packId: string
  version: string
  name: string
  author?: string
  license?: string
  expressions?: Record<string, { row: number; col: number }>
  /** absolute directory path on disk (main process only) */
  dir?: string
  /** URLs accessible from renderer (plugin-asset://...) */
  idleUrl: string
  atlasUrl: string
  idle: AssetPackManifestV1['idle']
  atlas: AssetPackManifestV1['atlas']
}

/** plugin.json v1（与 doc/插件生态系统-v1 对齐） */
export interface PluginManifestV1 {
  schema_version: 1
  id: string
  version: string
  name: string
  slug?: string
  description?: string
  author?: string
  /** 入口脚本名，相对插件目录；空字符串表示由宿主内置实现加载 */
  main: string
  min_app_version: string
  permissions: string[]
  hooks: string[]
  tools: string[]
  ui?: {
    settingsSections?: Array<Record<string, unknown>>
    rightRailPanels?: Array<Record<string, unknown>>
  }
  configSchema?: Record<string, unknown>
}

/** 插件入口导出的 tool（主进程侧 run 已绑定 ctx） */
export interface PluginToolExport {
  name: string
  inputSchema?: Record<string, unknown>
  run: (input: unknown) => unknown | Promise<unknown>
}

/** 设置页 / IPC：插件列表项 */
export interface PluginListEntry {
  id: string
  name: string
  version: string
  enabled: boolean
  /** 加载或校验失败时由主进程填充 */
  error?: string
  permissions?: string[]
  hooksDeclared?: string[]
  toolsDeclared?: string[]
  ui?: {
    settingsSectionCount: number
    rightRailPanelCount: number
  }
}

export interface PluginToolCallRecord {
  toolName: string
  pluginId?: string
  ok: boolean
  durationMs: number
  at: number
  error?: string
  blocked?: boolean
}

export interface PluginDiagnostics {
  recentToolCalls: PluginToolCallRecord[]
}

/** plugins:exportConversation 返回 */
export interface PluginExportResult {
  ok: boolean
  /** 写入下载目录的文件名（非完整路径） */
  filename?: string
  error?: string
}
