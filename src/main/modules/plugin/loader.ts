import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import { pathToFileURL } from 'url'
import { logService, uniqueRunId } from '../../services/logger'
import { contextRegistry } from '../conversations/context/context-manager'
import { toolRegistry } from '../conversations/tool/tool-manager'
import { pluginStorageService, conversationStore } from '../../services/store'
import { flowHost, type FlowDefinition } from '../conversations/flow/flow-host'
import { runtimeManager } from '../conversations/runtime-manager'
import { memorySet, memoryGet, memorySearch, memoryRemove } from '../conversations/tool/memory-store'
import { promptInjectionStore } from '../conversations/compaction/config'
import type { ContextCompactionConfig } from '../conversations/context/types'
import { getMainWindow } from '../../window'
import type { Plugin, PluginSetupAPI } from './types'

/**
 * PluginLoader —— 守护进程。
 *
 * 启动时扫描 plugins/ 目录，动态 import() 所有 .js 文件。
 * 持续 fs.watch 监听变更：新增 → 加载；删除 → 卸载；修改 → 重载。
 *
 * 插件通过 setup(api) 注册上下文和工具到全局注册表。
 * 注册表通过 Observer 通知所有 Runtime 感知变更。
 */
export class PluginLoader {
  private watcher?: fs.FSWatcher
  private loaded = new Map<string, Plugin>()  // filePath → Plugin
  private pluginContexts = new Map<string, string[]>()  // pluginId → 注册的 contextIds
  private pluginTools = new Map<string, string[]>()  // pluginId → 注册成功的工具名

  /**
   * 启动守护进程：扫描目录 + 开始监听。
   * @param pluginsDir - 插件目录路径
   */
  async start(pluginsDir: string): Promise<void> {
    await this.ensureDir(pluginsDir)
    await this.scan(pluginsDir)
    this.startWatching(pluginsDir)
    logService.log('info', undefined, {
      runId: uniqueRunId('plugin'),
      name: 'loader.start',
      message: `watching: ${pluginsDir}, loaded: ${this.loaded.size}`,
    })
  }

  /** 停止监听。 */
  stop(): void {
    this.watcher?.close()
    this.watcher = undefined
  }

  /** 确保目录存在。 */
  private async ensureDir(dir: string): Promise<void> {
    try {
      await fsp.mkdir(dir, { recursive: true })
    } catch {
      // 忽略，后续扫描会处理
    }
  }

  /** 一次性扫描目录，加载所有 .js 文件。 */
  private async scan(dir: string): Promise<void> {
    let entries: string[]
    try {
      entries = await fsp.readdir(dir)
    } catch {
      return
    }
    for (const file of entries) {
      if (!file.endsWith('.js')) continue
      await this.loadPlugin(path.join(dir, file))
    }
  }

  /** 加载单个插件文件。 */
  private async loadPlugin(filePath: string): Promise<void> {
    if (this.loaded.has(filePath)) return

    try {
      // 清除缓存以支持热重载
      delete require.cache[require.resolve(filePath)]
    } catch {
      // 首次加载无缓存，忽略
    }

    let mod: { default?: Plugin } | Plugin
    try {
      // ESM loader 要求 file:// URL（Windows 绝对路径直接传给 import() 会报 protocol 'c:' 错误）
      mod = await import(pathToFileURL(filePath).href)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logService.log('error', 'error', {
        runId: uniqueRunId('plugin'),
        name: 'loader.import',
        message: `failed to import ${filePath}: ${msg}`,
      })
      return
    }

    const plugin = (mod as { default?: Plugin }).default ?? (mod as unknown as Plugin)
    if (!plugin || typeof plugin.setup !== 'function') {
      logService.log('warn', undefined, {
        runId: uniqueRunId('plugin'),
        name: 'loader.load',
        message: `invalid plugin format: ${filePath}`,
      })
      return
    }

    const api = this.createAPI(plugin.id)
    try {
      plugin.setup(api)
      this.loaded.set(filePath, plugin)
      logService.log('info', undefined, {
        runId: uniqueRunId('plugin'),
        name: 'loader.load',
        message: `loaded: ${plugin.id} v${plugin.version}`,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logService.log('error', 'error', {
        runId: uniqueRunId('plugin'),
        name: 'loader.setup',
        message: `setup failed for ${plugin.id}: ${msg}`,
      })
    }
  }

  /** 卸载单个插件文件关联的上下文和工具。 */
  private unloadPlugin(filePath: string): void {
    const plugin = this.loaded.get(filePath)
    if (!plugin) return

    // 按注册记录精确卸载工具（不依赖命名前缀约定：
    // 插件工具名（如 game_turn / memory_set）无需携带插件 ID 前缀）
    for (const toolName of this.pluginTools.get(plugin.id) ?? []) {
      toolRegistry.unregister(toolName)
    }
    this.pluginTools.delete(plugin.id)

    // 卸载该插件注册的上下文（含 toolNames 等定义），保证热重载后重新注册的是新定义
    for (const ctxId of this.pluginContexts.get(plugin.id) ?? []) {
      contextRegistry.unregister(ctxId)
    }
    this.pluginContexts.delete(plugin.id)

    this.loaded.delete(filePath)
    logService.log('info', undefined, {
      runId: uniqueRunId('plugin'),
      name: 'loader.unload',
      message: `unloaded: ${plugin.id}`,
    })
  }

  /** 开始监听目录变更。 */
  private startWatching(dir: string): void {
    try {
      this.watcher = fs.watch(dir, (eventType, filename) => {
        if (!filename || !filename.endsWith('.js')) return
        const filePath = path.join(dir, filename)

        if (eventType === 'rename') {
          // 文件新增或删除
          fs.stat(filePath, (err) => {
            if (err) {
              // 文件不存在 → 删除
              this.unloadPlugin(filePath)
            } else {
              // 文件存在 → 新增
              this.loadPlugin(filePath)
            }
          })
        } else if (eventType === 'change') {
          // 文件修改 → 重载
          this.unloadPlugin(filePath)
          this.loadPlugin(filePath)
        }
      })
    } catch (e) {
      logService.log('warn', undefined, {
        runId: uniqueRunId('plugin'),
        name: 'loader.watch',
        message: `failed to watch ${dir}: ${e instanceof Error ? e.message : String(e)}`,
      })
    }
  }

  /**
   * 解析记忆读写的默认作用域：插件显式传 conversationId/contextId 优先；
   * 缺省回退到当前活跃会话（如果有）。
   */
  private resolveMemoryScope(opts?: { conversationId?: string; contextId?: string }): { conversationId?: string; contextId: string } {
    if (opts?.conversationId) {
      return { conversationId: opts.conversationId, contextId: opts?.contextId ?? 'main' }
    }
    const active = runtimeManager.getActiveConversationId()
    return { conversationId: active, contextId: opts?.contextId ?? 'main' }
  }

  /** 创建插件安装 API，桥接到全局注册表与持久化存储。 */
  private createAPI(pluginId: string): PluginSetupAPI {
    return {
      registerContext: (def) => {
        const ok = contextRegistry.register(def)
        // 记录归属，供 unloadPlugin 卸载时注销
        if (ok) {
          const list = this.pluginContexts.get(pluginId) ?? []
          list.push(def.contextId)
          this.pluginContexts.set(pluginId, list)
        }
        return ok
      },
      registerTool: (def) => {
        const ok = toolRegistry.register(def)
        // 记录归属，供 unloadPlugin 精确卸载
        if (ok) {
          const list = this.pluginTools.get(pluginId) ?? []
          list.push(def.name)
          this.pluginTools.set(pluginId, list)
        }
        return ok
      },
      storage: {
        get: () => pluginStorageService.get(pluginId),
        set: (data) => pluginStorageService.set(pluginId, data),
      },
      memory: {
        set: (slot, data, opts) => {
          const { conversationId, contextId } = this.resolveMemoryScope(opts)
          if (!conversationId) return
          memorySet(conversationId, contextId, slot, data)
        },
        get: (slot, opts) => {
          const { conversationId, contextId } = this.resolveMemoryScope(opts)
          if (!conversationId) return null
          return memoryGet(conversationId, contextId, slot)?.data ?? null
        },
        search: (query, opts) => {
          const { conversationId, contextId } = this.resolveMemoryScope(opts)
          if (!conversationId) return []
          return memorySearch(conversationId, contextId, query).map((r) => ({ slot: r.slot, data: r.data }))
        },
        remove: (slot, opts) => {
          const { conversationId, contextId } = this.resolveMemoryScope(opts)
          if (!conversationId) return false
          return memoryRemove(conversationId, contextId, slot)
        },
      },
      prompts: {
        inject: (where, text, opts) => {
          promptInjectionStore.inject(opts?.contextId ?? 'main', where, text)
        },
        remove: (where, text, opts) => {
          promptInjectionStore.remove(opts?.contextId ?? 'main', where, text)
        },
      },
      compaction: {
        configure: (cfg, opts) => {
          const contextId = opts?.contextId ?? 'main'
          const def = contextRegistry.get(contextId)
          if (!def) return
          // 合并现有配置（registry 定义不可变，浅拷贝后覆盖）
          const merged: ContextCompactionConfig = { ...def.compaction, ...cfg }
          contextRegistry.register({ ...def, compaction: merged })
        },
      },
      llm: {
        generate: (input) => flowHost.generate(input),
      },
      flow: {
        register: (def) => flowHost.register(def as FlowDefinition),
        run: (name, input, opts) => {
          const conversationId = opts?.conversationId ?? ''
          // 透传所属 Runtime 的 abort 信号：用户 abort 时中断图内 LLM 调用
          const signal = runtimeManager.get(conversationId)?.getAbortSignal()
          // 继承公共历史：flow 节点组装时把主上下文 history 拼入 system（剧情感知 + 前缀共享）
          const history = conversationId ? runtimeManager.get(conversationId)?.getHistory() ?? [] : []
          // 收集最后一次渲染树，挂到返回的 state.__render 供插件 transformPrompt 做 UI 文本化
          let renderTree: unknown = null
          return flowHost.run(name, input, (payload) => {
            // 渲染：落库（供前端回放）+ 推前端；UI 文本化由各工具的 transformPrompt 从渲染树自做
            renderTree = payload
            if (conversationId) {
              conversationStore.addMessage(conversationId, {
                role: 'context',
                content: `[UI: ${payload.component}]`,
                contextId: opts?.contextId ?? null,
                extraData: { uiRender: payload },
              })
            }
            const w = getMainWindow()
            w?.webContents.send('chat:stream', {
              kind: 'ui_render',
              conversationId,
              runId: uniqueRunId('ui'),
              component: payload.component,
              props: payload.props,
              children: payload.children,
            })
          }, { conversationId: opts?.conversationId, contextId: opts?.contextId, signal, history }).then((res) => {
            // 渲染树挂到返回 state（插件 transformPrompt 读取做 UI 文本化）
            if (res.ok && renderTree && res.state && typeof res.state === 'object') {
              return { ...res, state: { ...res.state, __render: renderTree } }
            }
            return res
          })
        },
      },
    }
  }
}

/** 全局单例。 */
export const pluginLoader = new PluginLoader()
