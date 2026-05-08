import { app } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import type {
  ChatMessage,
  PluginHooks,
  PluginListEntry,
  PluginExportResult,
  PluginManifestV1,
  PreToolUseContext,
  PostToolUseContext,
  PluginToolExport,
  PluginDispatchMessage,
} from '../../shared/types'
import type { HookHandler } from '../agent/hook-registry'
import { configStore } from '../config-store'
import { messageStore } from '../message-store'
import { pluginPreferencesStore } from '../plugin-preferences-store'
import {
  createPluginContext,
  type PluginContext,
  type PluginPermission,
} from './context'
import { discoverInstalledPlugins } from './discovery'
import { getActiveAssetPackResolved } from '../plugin-assets/pack-store'
import { appVersionMeetsMin } from './plugin-manifest'
import { ToolRuntime } from './tool-runtime'
import { loadPluginFactory } from './load-plugin-entry'

const HOOK_TIMEOUT_MS = 500

const KNOWN_PERMISSIONS = new Set<PluginPermission>([
  'messages.read',
  'fs.writesDownloads',
  'clipboard.write',
  'config.read',
  'ui.dispatch',
  'assets.readActive',
])

function filterPermissions(fromManifest: string[]): PluginPermission[] {
  const out: PluginPermission[] = []
  for (const p of fromManifest) {
    if (KNOWN_PERMISSIONS.has(p as PluginPermission)) {
      out.push(p as PluginPermission)
    }
  }
  return out
}

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

type PluginRecord = {
  manifest: PluginManifestV1
  dir: string
  ctx: PluginContext
  hooks: Partial<PluginHooks>
  tools: PluginToolExport[]
  dispose?: () => Promise<void>
  /** 合并 discovery.loadError、版本检查、加载 main 失败等（含非致命提示） */
  loadError?: string
  /** 为 true 时不执行 hooks / tools（仅展示列表与错误） */
  execBlocked: boolean
}

type AgentBridge = {
  enqueueEvent: (envelope: unknown) => Promise<boolean>
  registerHook: (mountPoint: string, handler: HookHandler) => () => void
}

export class PluginRegistry {
  private dispatchToRenderer: ((message: PluginDispatchMessage) => void) | null = null
  private toastToRenderer:
    | ((payload: { v: 1; type: 'info' | 'success' | 'warning' | 'error'; text: string }) => void)
    | null = null
  private records: Map<string, PluginRecord> = new Map()
  private agentBridge: AgentBridge | null = null
  toolRuntime: ToolRuntime

  constructor() {
    this.toolRuntime = new ToolRuntime({
      runPreToolUseChain: (ctx) => this.runPreToolUseChain(ctx),
      runPostToolUseChain: (ctx) => this.runPostToolUseChain(ctx),
      showToast: (p) => {
        try {
          this.toastToRenderer?.({ v: 1, ...p })
        } catch (e) {
          console.error('[plugin] showToast', e)
        }
      },
    })
  }

  setRendererDispatcher(fn: (message: PluginDispatchMessage) => void): void {
    this.dispatchToRenderer = fn
  }

  setToastDispatcher(
    fn: (payload: { v: 1; type: 'info' | 'success' | 'warning' | 'error'; text: string }) => void
  ): void {
    this.toastToRenderer = fn
  }

  setAgentBridge(bridge: AgentBridge): void {
    this.agentBridge = bridge
  }

  async initPlugins(): Promise<void> {
    for (const r of this.records.values()) {
      try {
        await r.dispose?.()
      } catch (e) {
        console.error('[plugin] dispose', r.manifest.id, e)
      }
    }
    this.records.clear()
    for (const name of this.toolRuntime.listToolNames()) {
      if (name !== 'host.ui.showToast') this.toolRuntime.unregisterTool(name)
    }

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
      dispatchToRenderer: (message: PluginDispatchMessage) => {
        try {
          this.dispatchToRenderer?.(message)
        } catch (e) {
          console.error('[plugin] dispatchToRenderer', e)
        }
      },
      getActiveAssetPackResolved: (pluginId: string) => getActiveAssetPackResolved(pluginId),
      getAgentBridge: () => this.agentBridge,
    }

    const discovered = await discoverInstalledPlugins()

    const appVer = app.getVersion()

    for (const disc of discovered) {
      const { manifest, dir, loadError: discErr } = disc
      const issues: string[] = []
      if (discErr) issues.push(discErr)
      const fatalVersion = !appVersionMeetsMin(appVer, manifest.min_app_version)
      if (fatalVersion) {
        issues.push(`app ${appVer} < min_app_version ${manifest.min_app_version}`)
      }
      const fatalManifest = !!discErr

      const perms = filterPermissions(manifest.permissions)
      const ctx = createPluginContext(manifest.id, perms, deps)

      let hooks: Partial<PluginHooks> = {}
      let tools: PluginToolExport[] = []
      let dispose: (() => Promise<void>) | undefined
      let toolRegistrationAllowed = false
      let execBlocked = fatalVersion || fatalManifest

      const mainFile = (manifest.main || '').trim()
      const canLoadLogic = !fatalVersion && !fatalManifest

      if (canLoadLogic && mainFile && dir) {
        try {
          const factory = await loadPluginFactory(dir, mainFile)
          const exp = factory(ctx)
          hooks = exp.hooks || {}
          tools = Array.isArray(exp.tools) ? exp.tools : []
          toolRegistrationAllowed = true
          if (exp.dispose) {
            dispose = async () => {
              await Promise.resolve(exp.dispose!())
            }
          }
        } catch (e) {
          issues.push(e instanceof Error ? e.message : String(e))
          execBlocked = true
        }
      } else if (canLoadLogic && (!mainFile || !dir)) {
        issues.push('missing main entry or plugin directory')
        execBlocked = true
      }

      const mergedError = issues.length ? issues.join('; ') : undefined

      const rec: PluginRecord = {
        manifest,
        dir,
        ctx,
        hooks,
        tools,
        dispose,
        loadError: mergedError,
        execBlocked,
      }
      this.records.set(manifest.id, rec)

      if (toolRegistrationAllowed && tools.length > 0) {
        for (const t of tools) {
          const fullName = t.name.includes('.') ? t.name : `${manifest.id}.${t.name}`
          this.toolRuntime.registerTool(fullName, {
            pluginId: manifest.id,
            inputSchema: t.inputSchema,
            run: (input) => t.run(input),
          })
        }
      }
    }

    pluginPreferencesStore.pruneToInstalledPluginIds(new Set(this.records.keys()))
    const prefs = pluginPreferencesStore.get()
    console.log('[plugins] init', {
      ids: [...this.records.keys()],
      enabled: prefs.enabled,
      toolNames: this.toolRuntime.listToolNames(),
    })
  }

  listPlugins(): PluginListEntry[] {
    const prefs = pluginPreferencesStore.get()
    const out: PluginListEntry[] = []
    for (const rec of this.records.values()) {
      const m = rec.manifest
      const ui = m.ui
      const settingsN = ui?.settingsSections?.length ?? 0
      const railN = ui?.rightRailPanels?.length ?? 0
      out.push({
        id: m.id,
        name: m.name,
        version: m.version,
        enabled: prefs.enabled.includes(m.id),
        error: rec.loadError,
        permissions: [...m.permissions],
        hooksDeclared: [...m.hooks],
        toolsDeclared: [...m.tools, ...rec.tools.map((t) => t.name)],
        ui: {
          settingsSectionCount: settingsN,
          rightRailPanelCount: railN,
        },
      })
    }
    return out.sort((a, b) => a.id.localeCompare(b.id))
  }

  getManifest(pluginId: string): PluginManifestV1 | null {
    return this.records.get(pluginId)?.manifest ?? null
  }

  hasPlugin(pluginId: string): boolean {
    return this.records.has(pluginId)
  }

  setEnabled(pluginId: string, enabled: boolean): void {
    pluginPreferencesStore.setPluginEnabled(pluginId, enabled)
  }

  private enabledSortedIds(): string[] {
    const prefs = pluginPreferencesStore.get()
    return [...this.records.keys()]
      .filter((id) => prefs.enabled.includes(id))
      .sort((a, b) => a.localeCompare(b))
  }

  async runPreToolUseChain(
    ctx: PreToolUseContext
  ): Promise<{ blocked: boolean; reason?: string; args: unknown }> {
    let args = ctx.args
    for (const id of this.enabledSortedIds()) {
      const rec = this.records.get(id)
      if (rec?.execBlocked) continue
      const fn = rec?.hooks.preToolUse
      if (!fn) continue
      try {
        const r = await withTimeout(
          Promise.resolve(fn({ ...ctx, args })),
          HOOK_TIMEOUT_MS
        )
        if (r && typeof r === 'object' && 'blocked' in r && (r as { blocked?: boolean }).blocked) {
          return {
            blocked: true,
            reason: (r as { reason?: string }).reason,
            args,
          }
        }
        if (
          r &&
          typeof r === 'object' &&
          'args' in r &&
          (r as { args?: unknown }).args !== undefined
        ) {
          args = (r as { args: unknown }).args
        }
      } catch (e) {
        console.error(`[plugin ${id}] preToolUse`, e)
      }
    }
    return { blocked: false, args }
  }

  async runPostToolUseChain(ctx: PostToolUseContext): Promise<void> {
    for (const id of this.enabledSortedIds()) {
      const rec = this.records.get(id)
      if (rec?.execBlocked) continue
      const fn = rec?.hooks.postToolUse
      if (!fn) continue
      try {
        await withTimeout(Promise.resolve(fn(ctx)), HOOK_TIMEOUT_MS)
      } catch (e) {
        console.error(`[plugin ${id}] postToolUse`, e)
      }
    }
  }

  async runMessageSend(message: string): Promise<string> {
    let out = message
    for (const id of this.enabledSortedIds()) {
      const fn = this.records.get(id)?.hooks.onMessageSend
      if (!fn) continue
      if (this.records.get(id)?.execBlocked) continue
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
      if (this.records.get(id)?.execBlocked) continue
      try {
        const next = await withTimeout(Promise.resolve(fn(out)), HOOK_TIMEOUT_MS)
        if (typeof next === 'string') out = next
      } catch (e) {
        console.error(`[plugin ${id}] onMessageReceive`, e)
      }
    }
    return out
  }

  async runMemoryUpdate(importantInfo: string[]): Promise<void> {
    if (importantInfo.length === 0) return
    for (const id of this.enabledSortedIds()) {
      const fn = this.records.get(id)?.hooks.onMemoryUpdate
      if (!fn) continue
      if (this.records.get(id)?.execBlocked) continue
      try {
        await withTimeout(Promise.resolve(fn(importantInfo)), HOOK_TIMEOUT_MS)
      } catch (e) {
        console.error(`[plugin ${id}] onMemoryUpdate`, e)
      }
    }
  }

  async runSystemPromptBuild(input: {
    systemPrompt: string
    locale?: 'zh-CN' | 'en-US'
    conversationId?: string
  }): Promise<string> {
    let out = input.systemPrompt || ''
    for (const id of this.enabledSortedIds()) {
      const fn = this.records.get(id)?.hooks.onSystemPromptBuild
      if (!fn) continue
      if (this.records.get(id)?.execBlocked) continue
      try {
        const extra = await withTimeout(Promise.resolve(fn(input)), HOOK_TIMEOUT_MS)
        if (typeof extra === 'string' && extra.trim().length > 0) {
          out = `${out}\n\n${extra.trim()}`
        }
      } catch (e) {
        console.error(`[plugin ${id}] onSystemPromptBuild`, e)
      }
    }
    return out
  }

  async exportConversationMarkdown(
    conversationId: string
  ): Promise<PluginExportResult> {
    void conversationId
    return { ok: false, error: 'not_implemented' }
  }

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

  getDiagnostics() {
    return { recentToolCalls: this.toolRuntime.getRecentToolCalls() }
  }
}

export const pluginRegistry = new PluginRegistry()
