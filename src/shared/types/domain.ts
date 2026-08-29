/**
 * 全局应用设置，由 Main 进程持久化，Renderer 通过 IPC 读写。
 */
export interface GlobalSettings {
  /** LLM API Key。明文存储于本地配置文件中，后续建议接入系统密钥链。 */
  apiKey: string
  /** LLM 模型名。 */
  model: string
  /** 自定义 API 端点 URL。留空时使用默认地址。 */
  baseURL?: string
  /** 界面语言 & 日期格式 locale。 */
  locale?: 'zh-CN' | 'en-US'
  /** 界面主题：亮色 / 暗色 / 跟随系统。 */
  theme?: 'light' | 'dark' | 'auto'
  /** 消息区域字体大小（px），默认 16。 */
  fontSize?: number
}

/** 对话元数据。 */
export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

/**
 * 单条聊天消息。
 * role 只有 user 和 assistant 两种。tool 执行过程由框架内部处理，不暴露到前端会话消息中。
 * widgetNode 存在时表示这是一条交互式 UI 消息，content 可能为空。
 */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  /** 产生该消息的上下文 ID（null = 主上下文，旧数据兼容）。 */
  contextId?: string | null
  /** 消息种类：'context-switch' = 上下文切换分隔标签（不渲染气泡）。 */
  kind?: 'context-switch'
  widgetNode?: import('./ui').WidgetNode
}
