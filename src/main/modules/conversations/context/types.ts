/** 上下文角色 */
export type ContextRole = 'main' | 'sub'

/** 压缩层配置（per-context，未配置字段走全局默认，见 compaction/config.ts）。 */
export interface ContextCompactionConfig {
  /** 压缩器系统提示词。缺省用宿主通用默认。 */
  summaryPrompt?: string
  /** 摘要写入的记忆 slot 名。缺省 'summary'（通用）。 */
  summarySlot?: string
  /** 摘要头部标签文本（如 cultivation 的 【剧情史】）。缺省无标签。 */
  summaryLabel?: string
  /** 触发压缩的 token 预算（估算）。缺省 60000。 */
  tokenBudget?: number
  /** 压缩后保留的最近消息估算 token 数。缺省 8000（opencode keep.tokens）。 */
  keepTokens?: number
  /** 稳定前缀构建：可追加自定义记忆 slot（world_setting 等）。 */
  prefixSlots?: string[]
  /** 是否启用再压缩（摘要超预算时摘要的摘要）。缺省 true。 */
  allowResummarize?: boolean
}

/**
 * 上下文注册描述 —— 插件或内置模块注册时提供。
 * 注册到全局 ContextRegistry，所有 Runtime 共享。
 */
export interface ContextDefinition {
  /** 上下文唯一 ID */
  contextId: string
  /** 上下文角色 */
  role: ContextRole
  /** 进入此上下文时注入到系统提示的文本 */
  initialPrompt?: string
  /** 供主上下文 host_enter_subcontext 选路时展示的简短描述（不含完整协议，避免泄露） */
  description?: string
  /** 此上下文中可见的工具名列表 */
  toolNames?: string[]
  /** 压缩层配置（per-context，未配置走全局默认） */
  compaction?: ContextCompactionConfig
}
