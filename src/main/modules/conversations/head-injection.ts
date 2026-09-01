/**
 * 会话级头部注入存储（PluginSetupAPI.prompts 的落点）。
 * key 形如 `${conversationId}:${contextId}`，value 为注入文本列表。
 * 宿主组装三段式稳定层时读取（chat-composer.loadStablePrefix）。
 * 会话隔离：每个会话+上下文的注入相互独立（多会话世界状态不串档）。
 * 更新语义：set 覆盖注入位（慢变内容更新时替换旧文本，不累积）。
 */
class HeadInjectionStore {
  private map = new Map<string, string[]>()

  private key(conversationId: string, contextId: string): string {
    return `${conversationId}:${contextId}`
  }

  /** 注入/更新：覆盖该会话+上下文的注入文本（保持单文本位语义）。 */
  set(conversationId: string, contextId: string, text: string): void {
    if (!text) return
    this.map.set(this.key(conversationId, contextId), [text])
  }

  /** 从注入位移除指定文本（列表内精确移除，空则删除该键）。 */
  remove(conversationId: string, contextId: string, text: string): void {
    const k = this.key(conversationId, contextId)
    const list = this.map.get(k)
    if (!list) return
    const next = list.filter((t) => t !== text)
    if (next.length) this.map.set(k, next)
    else this.map.delete(k)
  }

  /** 读取该会话+上下文的注入文本（按注入顺序）。 */
  get(conversationId: string, contextId: string): string[] {
    return this.map.get(this.key(conversationId, contextId)) ?? []
  }
}

/** 全局单例。 */
export const headInjectionStore = new HeadInjectionStore()