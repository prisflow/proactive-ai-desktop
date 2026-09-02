/**
 * Runtime 内部契约：拆分子模块（ToolRunner / SubcontextManager）对宿主 Runtime 的可见状态与操作。
 * 组合模式：Runtime 实现该接口并注入子模块，避免子模块反向 import Runtime 类（防循环依赖）。
 */
import type { ContextDefinition } from '../context'
import type { LlmMessage } from '../../llm'

/** 待落库记录（agentLoop 工具循环后统一写 DB，保证顺序 assistant→tool）。 */
export type PendingDbRecord = Omit<
  import('../../../services/store/database').MessageRecord,
  'id' | 'createdAt' | 'conversationId'
>

export interface RuntimeHost {
  /** 会话 ID（全链路日志/落库归属）。 */
  conversationId: string
  /** 当前活跃上下文 ID（'main' 或子上下文）。可写——enter/exit 同步切换。 */
  activeContextId: string
  /** 各上下文独立历史（'main' 恒驻留；子上下文退出时折叠）。 */
  histories: Map<string, LlmMessage[]>
  /** 当前活跃上下文的定义。 */
  readonly activeDef: ContextDefinition | undefined
  /** 写入指定上下文历史（内存缓存，DB 由调用方先行/统一落库）。 */
  pushHistory(contextId: string, msg: LlmMessage): void
  /** 推送上下文切换标签（前端渲染"已进入/已回到"分隔）。 */
  pushContextSwitch(contextId?: string): void
}