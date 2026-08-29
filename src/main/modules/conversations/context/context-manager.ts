import { logService, uniqueRunId } from '../../../services/logger'
import type { ContextDefinition } from './types'

/**
 * ContextRegistry —— 全局上下文注册表（单例）。
 *
 * 纯数据存储：维护"有哪些上下文存在"，不持有运行时状态。
 * activeContextId 由各 Runtime per-conversation 管理。
 *
 * Observer 模式：当上下文列表变更时通知所有订阅者（Runtime）。
 * 插件通过 PluginLoader 动态注册新上下文后，所有 Runtime 自动感知。
 */
export class ContextRegistry {
  private defs = new Map<string, ContextDefinition>()
  private listeners = new Set<() => void>()

  /**。
   * 注册一个上下文定义。不可重复注册。
   * 注册成功后通知所有订阅者。
   */
  register(def: ContextDefinition): boolean {
    if (this.defs.has(def.contextId)) {
      logService.log('warn', undefined, {
        runId: uniqueRunId('context'),
        name: 'context.register',
        message: `duplicate register: ${def.contextId}`,
      })
      return false
    }
    this.defs.set(def.contextId, def)
    logService.log('info', undefined, {
      runId: uniqueRunId('context'),
      name: 'context.register',
      message: `registered: ${def.contextId}`,
      data: { role: def.role, tools: def.toolNames?.length },
    })
    this.notifyAll()
    return true
  }

  /** 获取指定上下文的定义。 */
  get(id: string): ContextDefinition | undefined {
    return this.defs.get(id)
  }

  /**
   * 卸载一个上下文定义。主上下文 'main' 不可卸载。
   * 卸载后通知所有订阅者。正在使用该上下文的 Runtime 会回退到默认提示。
   */
  unregister(contextId: string): boolean {
    if (contextId === 'main') return false
    const removed = this.defs.delete(contextId)
    if (removed) {
      logService.log('info', undefined, {
        runId: uniqueRunId('context'),
        name: 'context.unregister',
        message: `unregistered: ${contextId}`,
      })
      this.notifyAll()
    }
    return removed
  }

  /** 判断指定上下文是否已注册。 */
  has(id: string): boolean {
    return this.defs.has(id)
  }

  /** 列出所有已注册的子上下文 ID（排除 'main'）。 */
  listSubContexts(): string[] {
    return Array.from(this.defs.keys()).filter(id => id !== 'main')
  }

  /**
   * 订阅上下文列表变更。
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

  /** 返回所有子上下文的人类可读描述，供 host_enter_subcontext 动态注入。 */
  describeSubContexts(): string {
    const subs = this.listSubContexts()
    if (subs.length === 0) return '当前没有可用子上下文，直接回复用户即可。'
    return subs.map((id) => {
      const def = this.get(id)
      const desc = (def as { description?: string })?.description
      if (desc) return `${id}(${desc})`
      return id
    }).join('; ')
  }
}

/** 全局单例，所有 Runtime 共享。 */
export const contextRegistry = new ContextRegistry()
