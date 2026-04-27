export interface GlobalSettings {
  apiKey: string
  model: string
  baseURL?: string
  /** 界面与下发给模型的系统提示语言 */
  locale?: 'zh-CN' | 'en-US'
  defaultTemplateName?: string
  defaultMaxTriggers?: number
  defaultProactiveInterval?: number
  proactiveEnabled?: boolean
  theme?: 'light' | 'dark' | 'auto'
  fontSize?: number
}

export interface UserSettings {
  templateName?: string
  proactiveInterval?: number
  recentMessagesCount?: number
  proactiveEnabled?: boolean
  maxTriggers?: number
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
  maxTriggers?: number
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

export interface AIResponse {
  reply: string
  triggers: Trigger[]
  next_api_call_seconds: number
  important_info: string[]
}

export interface Trigger {
  seconds: number
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

export interface PluginHooks {
  onMessageSend?: (message: string) => string | Promise<string>
  onMessageReceive?: (reply: string) => string | Promise<string>
  onTrigger?: (trigger: Trigger) => void | Promise<void>
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
  | { v: 1; pluginId: 'com.proactiveai.pavatar'; type: 'AVATAR_SET_MOOD'; mood: string; durationMs?: number }
  | { v: 1; pluginId: 'com.proactiveai.pavatar'; type: 'AVATAR_PLAY_EMOTE'; name: string; durationMs?: number }

export type PAvatarPackManifestV1 = {
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

export type PAvatarPackResolved = {
  packId: string
  version: string
  name: string
  author?: string
  license?: string
  expressions?: Record<string, { row: number; col: number }>
  /** absolute directory path on disk (main process only) */
  dir?: string
  /** URLs accessible from renderer (pavatar://...) */
  idleUrl: string
  atlasUrl: string
  idle: PAvatarPackManifestV1['idle']
  atlas: PAvatarPackManifestV1['atlas']
}

/** 设置页 / IPC：插件列表项（一期仅内置） */
export interface PluginListEntry {
  id: string
  name: string
  version: string
  enabled: boolean
  builtin: boolean
  /** 加载或校验失败时由主进程填充 */
  error?: string
}

/** plugins:exportConversation 返回 */
export interface PluginExportResult {
  ok: boolean
  /** 写入下载目录的文件名（非完整路径） */
  filename?: string
  error?: string
}
