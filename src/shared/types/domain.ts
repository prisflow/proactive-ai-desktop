/**
 * 全局应用设置，由 Main 进程持久化，Renderer 通过 IPC 读写。
 * 数据模型层：未设置 = null（默认值合并由前端显示 / 后端请求时各自兜底，不进本模型）。
 */
import type { WidgetNode } from './ui'

export interface GlobalSettings {
  /** LLM API Key。未配置为 null。明文存储于本地配置文件中，后续建议接入系统密钥链。 */
  apiKey: string | null
  /** LLM 模型名。未设置（用默认模型）为 null。 */
  model: string | null
  /** 自定义 API 端点 URL。未设置（用默认地址）为 null。 */
  baseURL: string | null
  /** 界面语言 & 日期格式 locale。未设置为 null。 */
  locale: 'zh-CN' | 'en-US' | null
  /** 界面主题：亮色 / 暗色 / 跟随系统。未设置为 null。 */
  theme: 'light' | 'dark' | 'auto' | null
  /** 消息区域字体大小（px）。未设置为 null。 */
  fontSize: number | null
  /** 中继服务器地址（如 wss://play.example.com/relay）。未启用为 null。 */
  relayUrl: string | null
  /** 中继配对码（手机访问需 device + code 双匹配）。未设置为 null。 */
  relayCode: string | null
  /** 中继设备 ID（PC 端持久标识，自动生成）。未设置为 null。 */
  relayDeviceId: string | null
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
  contextId: string | null
  /** 消息种类：'context-switch' = 上下文切换分隔标签（不渲染气泡）。 */
  kind: 'context-switch' | null
  widgetNode: WidgetNode | null
}
