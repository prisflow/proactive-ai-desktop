import fs from 'fs/promises'
import path from 'path'
import { app } from 'electron'

export interface WorldStateV1 {
  v: 1
  lastUserActivityAt: number
  lastAssistantMessageAt?: number
  proactiveCooldownUntil?: number
  activeSubagentRunId?: string
}

const defaultState = (): WorldStateV1 => ({
  v: 1,
  lastUserActivityAt: Date.now(),
})

export class WorldStateStore {
  private filePath: string
  private cache: Map<string, WorldStateV1> = new Map()
  private writeChain: Promise<void> = Promise.resolve()

  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'world-state.json')
  }

  private async loadAll(): Promise<Map<string, WorldStateV1>> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8')
      const o = JSON.parse(raw) as Record<string, WorldStateV1>
      const m = new Map<string, WorldStateV1>()
      for (const [k, v] of Object.entries(o)) {
        if (v && typeof v === 'object' && v.v === 1) m.set(k, v)
      }
      return m
    } catch {
      return new Map()
    }
  }

  async get(conversationId: string): Promise<WorldStateV1> {
    if (this.cache.has(conversationId)) {
      return { ...this.cache.get(conversationId)! }
    }
    const all = await this.loadAll()
    this.cache = all
    return { ...(all.get(conversationId) || defaultState()) }
  }

  async patch(
    conversationId: string,
    patch: Partial<WorldStateV1> & { activeSubagentRunId?: string | null }
  ): Promise<WorldStateV1> {
    const cur = await this.get(conversationId)
    const next: WorldStateV1 = { ...cur, ...patch, v: 1 }
    if (patch.activeSubagentRunId === null) {
      delete (next as { activeSubagentRunId?: string }).activeSubagentRunId
    }
    this.cache.set(conversationId, next)
    this.writeChain = this.writeChain.then(() => this.flush())
    await this.writeChain
    return next
  }

  private async flush(): Promise<void> {
    const obj: Record<string, WorldStateV1> = {}
    for (const [k, v] of this.cache) obj[k] = v
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    await fs.writeFile(this.filePath, JSON.stringify(obj, null, 2), 'utf-8')
  }
}
