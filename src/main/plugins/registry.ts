import { app } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import type { ChatMessage, PluginHooks, PluginListEntry, PluginExportResult, Trigger } from '../../shared/types'
import { configStore } from '../config-store'
import { messageStore } from '../message-store'
import { pluginPreferencesStore } from '../plugin-preferences-store'
import {
  createPluginContext,
  type PluginContext,
  type PluginPermission,
} from './context'
// NOTE: builtin plugins removed for now. Keep runtime skeleton only.

const HOOK_TIMEOUT_MS = 500

interface BuiltinRecord {
  id: string
  name: string
  version: string
  permissions: PluginPermission[]
  buildHooks: (ctx: PluginContext) => Partial<PluginHooks>
}

const BUILTINS: BuiltinRecord[] = []

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('plugin_hook_timeout')), ms)
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

export class PluginRegistry {
  private records: Map<
    string,
    { meta: BuiltinRecord; ctx: PluginContext; hooks: Partial<PluginHooks> }
  > = new Map()

  initBuiltins(): void {
    this.records.clear()
    const getPublic = () => {
      const c = configStore.get()
      const { apiKey: _omit, ...rest } = c
      return rest as Omit<typeof c, 'apiKey'> & { apiKey?: undefined }
    }
    const deps = {
      getMessages: (cid: string) => messageStore.getByConversation(cid),
      writeToDownloads: async (filename: string, content: string) => {
        const dir = app.getPath('downloads')
        const full = path.join(dir, filename)
        await fs.writeFile(full, content, 'utf8')
      },
      getPublicSettings: getPublic,
    }

    for (const meta of BUILTINS) {
      const ctx = createPluginContext(meta.permissions, deps)
      const hooks = meta.buildHooks(ctx)
      this.records.set(meta.id, { meta, ctx, hooks })
    }
  }

  listPlugins(): PluginListEntry[] {
    const prefs = pluginPreferencesStore.get()
    return BUILTINS.map((meta) => ({
      id: meta.id,
      name: meta.name,
      version: meta.version,
      enabled: prefs.enabled.includes(meta.id),
      builtin: true,
    }))
  }

  setEnabled(pluginId: string, enabled: boolean): void {
    pluginPreferencesStore.setPluginEnabled(pluginId, enabled)
  }

  private enabledSortedIds(): string[] {
    const prefs = pluginPreferencesStore.get()
    return BUILTINS.map((b) => b.id)
      .filter((id) => prefs.enabled.includes(id))
      .sort((a, b) => a.localeCompare(b))
  }

  async runMessageSend(message: string): Promise<string> {
    let out = message
    for (const id of this.enabledSortedIds()) {
      const fn = this.records.get(id)?.hooks.onMessageSend
      if (!fn) continue
      try {
        const next = await withTimeout(Promise.resolve(fn(out)), HOOK_TIMEOUT_MS)
        if (typeof next === 'string') out = next
      } catch (e) {
        console.error(`[plugin ${id}] onMessageSend`, e)
      }
    }
    return out
  }

  async runMessageReceive(reply: string): Promise<string> {
    let out = reply
    const ids = this.enabledSortedIds().reverse()
    for (const id of ids) {
      const fn = this.records.get(id)?.hooks.onMessageReceive
      if (!fn) continue
      try {
        const next = await withTimeout(Promise.resolve(fn(out)), HOOK_TIMEOUT_MS)
        if (typeof next === 'string') out = next
      } catch (e) {
        console.error(`[plugin ${id}] onMessageReceive`, e)
      }
    }
    return out
  }

  async runOnTrigger(t: Trigger): Promise<void> {
    for (const id of this.enabledSortedIds()) {
      const fn = this.records.get(id)?.hooks.onTrigger
      if (!fn) continue
      try {
        await withTimeout(Promise.resolve(fn(t)), HOOK_TIMEOUT_MS)
      } catch (e) {
        console.error(`[plugin ${id}] onTrigger`, e)
      }
    }
  }

  async runMemoryUpdate(importantInfo: string[]): Promise<void> {
    if (importantInfo.length === 0) return
    for (const id of this.enabledSortedIds()) {
      const fn = this.records.get(id)?.hooks.onMemoryUpdate
      if (!fn) continue
      try {
        await withTimeout(Promise.resolve(fn(importantInfo)), HOOK_TIMEOUT_MS)
      } catch (e) {
        console.error(`[plugin ${id}] onMemoryUpdate`, e)
      }
    }
  }

  async exportConversationMarkdown(
    conversationId: string
  ): Promise<PluginExportResult> {
    void conversationId
    return { ok: false, error: 'not_implemented' }
  }

  /** 将 history 中最后一条 user 的 content 替换为模型侧应看到的文本 */
  patchHistoryLastUserContent(
    history: ChatMessage[],
    content: string
  ): ChatMessage[] {
    const next = history.map((m) => ({ ...m }))
    for (let i = next.length - 1; i >= 0; i--) {
      if (next[i].role === 'user') {
        next[i] = { ...next[i], content }
        break
      }
    }
    return next
  }
}

export const pluginRegistry = new PluginRegistry()
