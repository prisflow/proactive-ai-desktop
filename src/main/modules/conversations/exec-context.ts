/**
 * 执行上下文（AsyncLocalStorage）。
 * 宿主在工具 / flow 执行入口注入"当前会话 + 上下文"归属，
 * 插件 API（memory/flow）内部自动读取，插件无需显式传 conversationId / contextId。
 * 语义：会话是上下文的上层，插件即上下文，落库归属是宿主的职责。
 */
import { AsyncLocalStorage } from 'node:async_hooks'

export interface ExecutionContext {
  conversationId: string
  contextId: string
}

const storage = new AsyncLocalStorage<ExecutionContext>()

/** 在指定执行上下文内运行 fn（async 链跨 await 保持）。 */
export function withExecutionContext<T>(ctx: ExecutionContext, fn: () => T): T {
  return storage.run(ctx, fn)
}

/** 读取当前执行上下文；非工具/flow 执行期间（如插件 setup）返回 null。 */
export function getExecutionContext(): ExecutionContext | null {
  return storage.getStore() ?? null
}