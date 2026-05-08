export type HookMountPoint =
  | 'event.validate'
  | 'event.afterEnqueue'
  | 'orchestrator.beforeHandle'
  | 'orchestrator.afterHandle'
  | 'model.beforeCall'
  | 'model.afterOutput'
  | 'subagent.beforeStart'
  | 'subagent.streamChunk'
  | 'subagent.afterFinished'
  | 'memory.beforeDialogueWrite'
  | 'memory.afterDialogueWrite'
  | 'memory.beforeWorldWrite'
  | 'memory.afterWorldWrite'
  | 'ipc.beforeSendStream'
  | string

export type HookContext = Record<string, unknown>

export type HookHandler = (ctx: HookContext) => void | Promise<void>

export class HookRegistry {
  private handlers = new Map<string, HookHandler[]>()

  register(mountPoint: HookMountPoint, handler: HookHandler): () => void {
    const key = String(mountPoint)
    const list = this.handlers.get(key) || []
    list.push(handler)
    this.handlers.set(key, list)
    return () => {
      const L = this.handlers.get(key)
      if (!L) return
      const i = L.indexOf(handler)
      if (i >= 0) L.splice(i, 1)
    }
  }

  async invokeAll(mountPoint: HookMountPoint, ctx: HookContext): Promise<void> {
    const key = String(mountPoint)
    const list = this.handlers.get(key) || []
    for (const h of list) {
      await Promise.resolve(h(ctx))
    }
  }
}
