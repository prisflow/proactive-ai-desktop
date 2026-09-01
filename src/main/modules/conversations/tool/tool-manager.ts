import { logService, uniqueRunId } from '../../../services/logger'
import { validateToolInput } from './schema-validate'
import { withExecutionContext } from '../exec-context'
import type { ToolDefinition, ToolCallMeta, ToolResult } from './types'

/**
 * ToolRegistry —— 全局工具注册表（单例）。
 *
 * 维护"有哪些工具存在" + 提供调度执行。
 * 与 ContextRegistry 平行，互不依赖。
 *
 * Observer 模式：当工具列表变更时通知所有订阅者（Runtime）。
 */
export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>()
  private listeners = new Set<() => void>()

  /**
   * 注册一个工具。同名不可重复注册。
   * 注册成功后通知所有订阅者。
   */
  register(def: ToolDefinition): boolean {
    if (this.tools.has(def.name)) {
      logService.log('warn', undefined, {
        runId: uniqueRunId('tool'),
        name: 'tool.register',
        message: `duplicate tool: ${def.name}`,
      })
      return false
    }
    this.tools.set(def.name, def)
    logService.log('info', undefined, {
      runId: uniqueRunId('tool'),
      name: 'tool.register',
      message: `registered: ${def.name}`,
    })
    this.notifyAll()
    return true
  }

  /** 卸载一个工具。不可卸载内置工具（host. 前缀）。 */
  unregister(name: string): boolean {
    if (name.startsWith('host_')) return false
    const removed = this.tools.delete(name)
    if (removed) {
      logService.log('info', undefined, {
        runId: uniqueRunId('tool'),
        name: 'tool.unregister',
        message: `unregistered: ${name}`,
      })
      this.notifyAll()
    }
    return removed
  }

  /**
   * 调用一个工具。
   * 返回执行结果，不生产事件。
   */
  async call(name: string, input: unknown, meta: ToolCallMeta): Promise<ToolResult> {
    const def = this.tools.get(name)
    if (!def) {
      logService.log('warn', undefined, {
        runId: uniqueRunId('tool'),
        name: 'tool.call',
        message: `tool not found: ${name}`,
      })
      return { ok: false, error: `tool not found: ${name}` }
    }

    const runId = uniqueRunId('tool')

    // 执行前 JSON Schema 校验：拦截 LLM 参数幻觉，失败直接返回错误（由 Runtime 回喂重试）
    if (def.inputSchema) {
      const schemaErr = validateToolInput(def.inputSchema, input)
      if (schemaErr) {
        logService.log('warn', undefined, {
          runId,
          parentRunId: meta.parentRunId,
          name,
          message: `input rejected by schema: ${schemaErr}`,
        })
        return { ok: false, error: `参数校验失败：${schemaErr}` }
      }
    }

    logService.log('info', 'start', {
      runId,
      parentRunId: meta.parentRunId,
      name: name,
      source: 'tool',
      conversationId: meta.conversationId,
      data: { input, conversationId: meta.conversationId, contextId: meta.contextId },
    })

    try {
      // 注入执行上下文：插件 API（memory/flow）从 ALS 自动读取会话归属
      const result = await Promise.resolve(
        withExecutionContext(
          { conversationId: meta.conversationId ?? '', contextId: meta.contextId ?? 'main' },
          () => def.run(input as Record<string, unknown>, meta),
        ),
      )
      // 失败时带 error 文本（flow/rules 返回的 {ok:false, error} 是正常返回值，非异常，不经过 catch）
      logService.log('info', 'end', {
        runId,
        parentRunId: meta.parentRunId,
        name: name,
        conversationId: meta.conversationId,
        data: result.ok ? { ok: true } : { ok: false, error: (result as { error: string }).error },
      })
      return result
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logService.log('error', 'error', {
        runId,
        parentRunId: meta.parentRunId,
        name: name,
        conversationId: meta.conversationId,
        message: msg,
        stack: e instanceof Error ? e.stack : undefined,
      })
      return { ok: false, error: msg }
    }
  }

  /** 获取工具定义。 */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name)
  }

  /** 判断工具是否已注册。 */
  has(name: string): boolean {
    return this.tools.has(name)
  }

  /** 列出所有已注册的工具名。 */
  listAll(): string[] {
    return Array.from(this.tools.keys())
  }

  /**
   * 订阅工具列表变更。
   * @returns 取消订阅函数
   */
  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private notifyAll(): void {
    for (const cb of this.listeners) {
      try { cb() } catch { /* 订阅者异常不影响注册流程 */ }
    }
  }
}

/** 全局单例，所有 Runtime 共享。 */
export const toolRegistry = new ToolRegistry()
