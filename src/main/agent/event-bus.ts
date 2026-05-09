import type { AgentEventEnvelope } from '../../shared/agent-events'
import { validateAgentEventEnvelope } from '../../shared/agent-events'
import type { HookRegistry } from './hook-registry'

export type EventHandler = (envelope: AgentEventEnvelope) => void | Promise<void>

export class AgentEventBus {
  private consumer: EventHandler | null = null
  /** 串行执行 consumer，避免 idle / 用户事件与长耗时 invoke 交叉导致局面竞态 */
  private drain: Promise<void> = Promise.resolve()

  constructor(private hooks: HookRegistry) {}

  setConsumer(fn: EventHandler): void {
    this.consumer = fn
  }

  /**
   * 入队：校验 → 触发钩子 → 排入 drain 链串行消费。
   * 只保证"已入队"，不等待消费者处理完毕（否则在 consumer 内部再次 enqueue 会死锁）。
   */
  async enqueue(raw: unknown): Promise<boolean> {
    const validated = validateAgentEventEnvelope(raw)
    if (!validated) {
      console.warn('[agent-bus] invalid envelope', raw)
      return false
    }
    await this.hooks.invokeAll('event.validate', { envelope: validated })
    await this.hooks.invokeAll('event.afterEnqueue', { envelope: validated })

    const job = this.drain.then(async () => {
      if (this.consumer) {
        await Promise.resolve(this.consumer(validated))
      }
    })
    this.drain = job.catch((e) => {
      console.error('[agent-bus] consumer failed', e)
    })
    // 不 await job —— 入队即返回，消费由 drain 链异步串行完成
    return true
  }
}
