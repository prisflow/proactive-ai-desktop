/**
 * RuntimeManager —— 管理对话维度的 Runtime 实例。
 * 每个活跃对话独享一个 Runtime（bus / context / tool / history）。
 */
import { Runtime } from './runtime'
import type { LlmConfig } from '../llm'

export class RuntimeManager {
  private runtimes = new Map<string, Runtime>()

  getOrCreate(conversationId: string, llmConfig: LlmConfig): Runtime {
    let rt = this.runtimes.get(conversationId)
    if (!rt) {
      rt = new Runtime(conversationId, llmConfig)
      rt.init()
      this.runtimes.set(conversationId, rt)
    }
    return rt
  }

  get(conversationId: string): Runtime | undefined {
    return this.runtimes.get(conversationId)
  }

  destroy(conversationId: string): void {
    const rt = this.runtimes.get(conversationId)
    if (rt) rt.destroy()
    this.runtimes.delete(conversationId)
  }
}

/** 全局单例：loader 与 ipc 共享，保证 abort 信号能定位到对应 Runtime。 */
export const runtimeManager = new RuntimeManager()
