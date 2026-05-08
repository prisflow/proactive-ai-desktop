import type {
  PostToolUseContext,
  PreToolUseContext,
  ToolActor,
  PluginToolCallRecord,
} from '../../shared/types'

const DEFAULT_TOOL_TIMEOUT_MS = 8000
const DIAG_RING_MAX = 32

type RegisteredTool = {
  pluginId?: string
  inputSchema?: Record<string, unknown>
  run: (input: unknown, meta: ToolCallMeta) => Promise<unknown>
}

export interface ToolCallMeta {
  actor: ToolActor
  conversationId?: string
  requestId?: string
}

export interface ToolRuntimeDeps {
  runPreToolUseChain: (ctx: PreToolUseContext) => Promise<{
    blocked: boolean
    reason?: string
    args: unknown
  }>
  runPostToolUseChain: (ctx: PostToolUseContext) => Promise<void>
  showToast: (payload: { type: 'info' | 'success' | 'warning' | 'error'; text: string }) => void
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}_timeout`)), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      }
    )
  })
}

export class ToolRuntime {
  private readonly tools = new Map<string, RegisteredTool>()
  private readonly recent: PluginToolCallRecord[] = []

  constructor(private readonly deps: ToolRuntimeDeps) {
    this.registerHostTools()
  }

  private pushDiag(rec: PluginToolCallRecord): void {
    this.recent.push(rec)
    while (this.recent.length > DIAG_RING_MAX) this.recent.shift()
  }

  getRecentToolCalls(): PluginToolCallRecord[] {
    return [...this.recent]
  }

  /** 由插件加载逻辑注册（name 须全局唯一） */
  registerTool(
    name: string,
    def: RegisteredTool,
    opts?: { replace?: boolean }
  ): void {
    if (!opts?.replace && this.tools.has(name)) {
      console.warn('[tool-runtime] duplicate tool name, skip:', name)
      return
    }
    this.tools.set(name, def)
  }

  unregisterTool(name: string): void {
    this.tools.delete(name)
  }

  clearPluginTools(pluginId: string): void {
    for (const [name, t] of this.tools) {
      if (t.pluginId === pluginId) this.tools.delete(name)
    }
  }

  private registerHostTools(): void {
    this.registerTool(
      'host.ui.showToast',
      {
        pluginId: 'host',
        run: async (input) => {
          const o = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
          const type =
            o.type === 'success' || o.type === 'warning' || o.type === 'error' ? o.type : 'info'
          const text = typeof o.text === 'string' ? o.text : String(o.text ?? '')
          this.deps.showToast({ type, text: text.slice(0, 2000) })
          return { ok: true }
        },
      },
      { replace: true }
    )
  }

  listToolNames(): string[] {
    return [...this.tools.keys()].sort()
  }

  getToolSchema(name: string): Record<string, unknown> | undefined {
    return this.tools.get(name)?.inputSchema
  }

  getToolSchemas(): Array<{ name: string; schema?: Record<string, unknown> }> {
    return [...this.tools.entries()]
      .filter(([name]) => name !== 'host.ui.showToast')
      .map(([name, t]) => ({ name, schema: t.inputSchema }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async call(
    toolName: string,
    input: unknown,
    meta: ToolCallMeta,
    timeoutMs: number = DEFAULT_TOOL_TIMEOUT_MS
  ): Promise<{ ok: true; result: unknown } | { ok: false; error: string; blocked?: boolean }> {
    const tool = this.tools.get(toolName)
    if (!tool) {
      const err = 'unknown_tool'
      this.pushDiag({
        toolName,
        pluginId: undefined,
        ok: false,
        durationMs: 0,
        at: Date.now(),
        error: err,
      })
      return { ok: false, error: err }
    }

    const t0 = Date.now()
    try {
      const pre = await this.deps.runPreToolUseChain({
        toolName,
        args: input,
        actor: meta.actor,
        requestId: meta.requestId,
        conversationId: meta.conversationId,
      })
      if (pre.blocked) {
        this.pushDiag({
          toolName,
          pluginId: tool.pluginId,
          ok: false,
          durationMs: Date.now() - t0,
          at: Date.now(),
          error: pre.reason || 'blocked',
          blocked: true,
        })
        return { ok: false, error: pre.reason || 'blocked', blocked: true }
      }

      const result = await withTimeout(
        Promise.resolve(tool.run(pre.args, meta)),
        timeoutMs,
        toolName
      )
      const durationMs = Date.now() - t0
      await this.deps.runPostToolUseChain({
        toolName,
        args: pre.args,
        result,
        actor: meta.actor,
        durationMs,
        requestId: meta.requestId,
        conversationId: meta.conversationId,
      })
      this.pushDiag({
        toolName,
        pluginId: tool.pluginId,
        ok: true,
        durationMs,
        at: Date.now(),
      })
      return { ok: true, result }
    } catch (e) {
      const durationMs = Date.now() - t0
      const err = e instanceof Error ? e.message : String(e)
      await this.deps.runPostToolUseChain({
        toolName,
        args: input,
        result: undefined,
        error: err,
        actor: meta.actor,
        durationMs,
        requestId: meta.requestId,
        conversationId: meta.conversationId,
      })
      this.pushDiag({
        toolName,
        pluginId: tool.pluginId,
        ok: false,
        durationMs,
        at: Date.now(),
        error: err,
      })
      return { ok: false, error: err }
    }
  }
}
