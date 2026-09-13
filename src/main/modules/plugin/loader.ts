import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import { logService, uniqueRunId } from '../../services/logger'
import { contextRegistry } from '../conversations/context/context-manager'
import { toolRegistry } from '../conversations/tool/tool-manager'
import { pluginStorageService, conversationStore } from '../../services/store'
import { flowHost, type FlowDefinition } from '../conversations/flow/flow-host'
import { runtimeManager } from '../conversations/runtime-manager'
import { getExecutionContext } from '../conversations/exec-context'
import { headInjectionStore } from '../conversations/head-injection'
import { transport } from '../../transport/transport'
import type { Plugin, PluginSetupAPI } from './types'

/**
 * PluginLoader —— 守护进程。
 *
 * 启动时扫描 plugins/ 目录：平铺 .js（兼容）+ 目录型（<dir>/plugin.json + entry），
 * 动态 import() 加载；fs.watch（recursive + 防抖）监听变更实现热重载。
 *
 * 插件通过 setup(api) 注册上下文/工具/流到全局注册表，
 * 注册表通过 Observer 通知所有 Runtime 感知变化。
 */
export class PluginLoader {
  private watcher?: fs.FSWatcher
  private loaded = new Map<string, Plugin>()  // entryPath → Plugin
  private pluginContexts = new Map<string, string[]>()  // pluginId → 注册的 contextIds
  private pluginTools = new Map<string, string[]>()  // pluginId → 注册成功的工具名
  private pluginFlows = new Map<string, string[]>()  // pluginId → 注册的 flow 图名（防旧定义钉死在 flowHost）
  private pluginsDir = ''
  /** 防抖重载计时器（filePath → timeout）——目录型插件多文件写入合并为一次重载。 */
  private reloadTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /** 开发写入抑制：plugin_* 工具写入期间标记插件（pluginId → 过期时间戳），watcher 跳过热重载。
   *  装载时机完全交由 plugin_reload——生成中间态（骨架 index + 新分层）不再触发半成品装载。 */
  private devWritingUntil = new Map<string, number>()
  /** 试跑渲染捕获：plugin_test 执行期间把 flow 推送的 UI 树收入缓冲（供输出评审）。 */
  private devCapture: unknown[] | null = null

  /** 插件根目录（userData/plugins）。 */
  getPluginsDir(): string {
    return this.pluginsDir
  }

  /** 标记插件处于开发写入态（60s 安全过期；plugin_* 工具每次写入刷新）。 */
  markDevWriting(pluginId: string): void {
    this.devWritingUntil.set(pluginId, Date.now() + 60_000)
  }

  /** 开始捕获 flow 渲染推送（plugin_test 输出评审用）。 */
  beginRenderCapture(): void {
    this.devCapture = []
  }

  /** 结束捕获并返回本次收集的渲染树（未开启捕获时返回空数组）。 */
  endRenderCapture(): unknown[] {
    const buf = this.devCapture ?? []
    this.devCapture = null
    return buf
  }

  /** 该插件（或平铺文件名）是否处于开发写入态。 */
  private isDevWriting(key: string): boolean {
    const until = this.devWritingUntil.get(key)
    if (!until) return false
    if (Date.now() > until) {
      this.devWritingUntil.delete(key)
      return false
    }
    return true
  }

  /**
   * 启动守护进程：扫描目录 + 开始监听。
   * @param pluginsDir - 插件目录路径
   */
  async start(pluginsDir: string): Promise<void> {
    this.pluginsDir = pluginsDir
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

  /** 立即装载一个插件入口（平铺 .js 或目录型 entry）。 */
  loadEntryNow(entryPath: string): void {
    void this.loadPlugin(entryPath)
  }

  /**
   * 按 pluginId 热重载：定位 entry → 卸载 + 重新装载。
   * 真实等待装载结果：ok = setup/装载成功；error = 报错原文（供 LLM 自修循环）。
   * 未装载（如首次装载失败不在 this.loaded）的插件按 manifest 兜底定位 entry（仅 .js）。
   */
  async reloadEntryById(pluginId: string): Promise<{ ok: boolean; error?: string }> {
    let entryPath = this.findEntryById(pluginId)
    if (!entryPath) {
      // 未装载：从 manifest 兜底定位 entry（只接受 .js）
      const manifestPath = path.join(this.pluginsDir, pluginId, 'plugin.json')
      if (fs.existsSync(manifestPath)) {
        try {
          const man = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { entry?: string }
          const rel = man.entry ?? 'index.js'
          if (!rel.endsWith('.js')) {
            return { ok: false, error: `manifest.entry 必须是 .js（本宿主零构建，不加载 .ts）：${rel}` }
          }
          const resolved = path.join(this.pluginsDir, pluginId, rel)
          if (fs.existsSync(resolved)) entryPath = resolved
        } catch {
          // manifest 解析失败按未装载处理
        }
      }
    }
    if (!entryPath) {
      return { ok: false, error: `插件未装载且无法定位 entry：${pluginId}（确认 plugins/${pluginId}/plugin.json 与 index.js 存在）` }
    }
    this.unloadPlugin(entryPath)
    try {
      // 清除模块缓存（entry 自身 + 目录型插件目录内全部模块）
      try {
        delete require.cache[require.resolve(entryPath)]
      } catch {
        // 首次加载无缓存
      }
      const pluginDir = path.dirname(entryPath)
      if (path.resolve(pluginDir) !== path.resolve(this.pluginsDir)) {
        const prefix = pluginDir + path.sep
        for (const key of Object.keys(require.cache)) {
          if (key.startsWith(prefix)) delete require.cache[key]
        }
      }
      // 真实等待装载结果：setup/装载报错原样返回给调用方（plugin_reload → LLM 自修）
      const res = await this.loadPlugin(entryPath)
      // 装载成功 → 解除开发写入抑制（watcher 恢复对该插件的监听）
      if (res.ok) this.devWritingUntil.delete(pluginId)
      return res
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  /** 按 pluginId 定位已装载插件的 entry 路径。 */
  private findEntryById(pluginId: string): string | null {
    for (const [fp, pl] of this.loaded) {
      if (pl.id === pluginId) return fp
    }
    return null
  }

  /** 已装载插件的注册面信息（工具名/上下文名）。 */
  getLoadedInfo(pluginId: string): { id: string; name: string; version: string; tools: string[]; contexts: string[] } | null {
    for (const plugin of this.loaded.values()) {
      if (plugin.id !== pluginId) continue
      return {
        id: plugin.id,
        name: plugin.name,
        version: plugin.version,
        tools: [...(this.pluginTools.get(pluginId) ?? [])],
        contexts: [...(this.pluginContexts.get(pluginId) ?? [])],
      }
    }
    return null
  }

  /**
   * 执行 flow（渲染落库 + 推送）。供插件 API（api.flow.run）与测试工具（plugin_test）共用。
   * @param scope 会话归属（conversationId + contextId）
   */
  runFlow(
    name: string,
    input: unknown,
    scope: { conversationId: string; contextId: string },
  ): Promise<{
    ok: boolean
    error?: string
    data: Record<string, unknown>
    state: Record<string, unknown>
    rendered: boolean
  }> {
    const conversationId = scope.conversationId
    const contextId = scope.contextId
    // 透传所属 Runtime 的 abort 信号：用户 abort 时中断图内 LLM 调用
    const signal = conversationId ? runtimeManager.get(conversationId)?.getAbortSignal() : undefined
    // 继承公共历史：flow 节点组装时把上下文 history 拼入 system（剧情感知 + 前缀共享）
    const history = conversationId ? runtimeManager.get(conversationId)?.getHistory() ?? [] : []
    // 收集最后一次渲染树，挂到返回的 state.__render 供插件 transformPrompt 做 UI 文本化
    let renderTree: unknown = null
    return flowHost.run(name, input, (payload) => {
      // 渲染：落库（供前端回放）+ 推前端；UI 文本化由各工具的 transformPrompt 从渲染树自做
      renderTree = payload
      // 试跑捕获：plugin_test 执行期间的渲染树收入缓冲（输出评审输入）
      if (this.devCapture) this.devCapture.push(payload)
      if (conversationId) {
        conversationStore.addMessage(conversationId, {
          role: 'context',
          content: `[UI: ${payload.component}]`,
          contextId,
          extraData: { uiRender: payload },
        })
      }
      transport.push({
        kind: 'ui_render',
        conversationId,
        runId: uniqueRunId('ui'),
        component: payload.component,
        props: payload.props,
        children: (payload.children ?? null) as import('../../../shared/types/ui').WidgetNode[] | null,
      })
    }, { conversationId, contextId, signal, history }).then((res) => {
      // 渲染树挂到返回 state（插件 transformPrompt 读取做 UI 文本化）
      if (res.ok && renderTree && res.state && typeof res.state === 'object') {
        return { ...res, state: { ...res.state, __render: renderTree } }
      }
      return res
    })
  }

  /** 已安装插件清单（读 pluginsDir 下的 .json 元数据 + 目录型 + 加载状态）。 */
  listInstalled(): Array<{ id: string; name: string; version: string; description?: string; entry: string; loaded: boolean }> {
    const out: Array<{ id: string; name: string; version: string; description?: string; entry: string; loaded: boolean }> = []
    if (!this.pluginsDir) return out
    try {
      const entries = fs.readdirSync(this.pluginsDir, { withFileTypes: true })
      const seen = new Set<string>()
      // 1. 平铺 .json manifest（读 json 元数据）
      for (const ent of entries) {
        if (ent.isDirectory() || !ent.name.endsWith('.json')) continue
        const entryName = `${ent.name.slice(0, -5)}.js`
        const entryPath = path.join(this.pluginsDir, entryName)
        if (!fs.existsSync(entryPath)) continue
        seen.add(entryName)
        try {
          const man = JSON.parse(fs.readFileSync(path.join(this.pluginsDir, ent.name), 'utf-8')) as {
            id: string; name: string; version: string; description?: string; entry?: string
          }
          out.push({
            id: man.id,
            name: man.name,
            version: man.version,
            description: man.description,
            entry: man.entry ?? entryName,
            loaded: this.loaded.has(path.join(this.pluginsDir, man.entry ?? entryName)),
          })
        } catch {
          // 单个 json 解析失败跳到兜底
        }
      }
      // 2. 目录型：<dir>/plugin.json + entry
      for (const ent of entries) {
        if (!ent.isDirectory()) continue
        const manifestPath = path.join(this.pluginsDir, ent.name, 'plugin.json')
        if (!fs.existsSync(manifestPath)) continue
        try {
          const man = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
            id: string; name: string; version: string; description?: string; entry?: string
          }
          const entryRel = `${ent.name}/${man.entry ?? 'index.js'}`
          seen.add(entryRel)
          out.push({
            id: man.id,
            name: man.name,
            version: man.version,
            description: man.description,
            entry: entryRel,
            loaded: this.loaded.has(path.join(this.pluginsDir, ent.name, man.entry ?? 'index.js')),
          })
        } catch {
          // 单个 json 解析失败跳过
        }
      }
      // 3. 无 manifest 的裸 .js：从已加载的 plugin 对象拿元数据
      for (const ent of entries) {
        if (ent.isDirectory() || !ent.name.endsWith('.js')) continue
        if (seen.has(ent.name)) continue
        const filePath = path.join(this.pluginsDir, ent.name)
        const loadedPlugin = this.loaded.get(filePath)
        if (loadedPlugin) {
          out.push({
            id: loadedPlugin.id,
            name: loadedPlugin.name,
            version: loadedPlugin.version,
            description: loadedPlugin.description,
            entry: ent.name,
            loaded: true,
          })
        } else {
          out.push({
            id: path.basename(ent.name, '.js'),
            name: path.basename(ent.name, '.js'),
            version: '?',
            entry: ent.name,
            loaded: false,
          })
        }
      }
    } catch {
      // 目录不可读返回空
    }
    return out
  }

  /**
   * 卸载插件：先注销其上下文/工具（卸载注册表），再删除入口与关联清单。
   * 平铺：entry.js + entry.json；目录型：<dir>/entry.js + <dir>/plugin.json（残留辅助文件一并清理）。
   */
  uninstallPlugin(entryName: string): { ok: boolean; error?: string } {
    const filePath = path.join(this.pluginsDir, entryName)
    if (this.loaded.has(filePath)) {
      this.unloadPlugin(filePath)
    }
    try {
      // 目录型（<dir>/<file>.js，pluginsDir 一级子目录且带 plugin.json）：整目录递归删除
      // （含 intent.md 等附属文件；仅一级子目录，防深路径误删）
      const dir = path.dirname(filePath)
      const isDirPlugin =
        path.resolve(dir) !== path.resolve(this.pluginsDir) &&
        path.dirname(dir) === path.resolve(this.pluginsDir) &&
        fs.existsSync(path.join(dir, 'plugin.json'))
      if (isDirPlugin) {
        fs.rmSync(dir, { recursive: true, force: true })
      } else {
        // 平铺：删 entry + 同名 .json manifest
        fs.unlinkSync(filePath)
        try {
          fs.unlinkSync(filePath.replace(/\.js$/, '.json'))
        } catch {
          // json 不存在也正常
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { ok: false, error: `删除入口失败：${msg}` }
    }
    logService.log('info', undefined, {
      runId: uniqueRunId('plugin'),
      name: 'loader.uninstall',
      message: `uninstalled: ${entryName}`,
    })
    return { ok: true }
  }

  /** 确保目录存在。 */
  private async ensureDir(dir: string): Promise<void> {
    try {
      await fsp.mkdir(dir, { recursive: true })
    } catch {
      // 忽略，后续扫描会处理
    }
  }

  /** 一次性扫描目录：平铺 .js + 目录型（<dir>/plugin.json + entry）。 */
  private async scan(dir: string): Promise<void> {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      if (ent.isDirectory()) {
        const manifestPath = path.join(dir, ent.name, 'plugin.json')
        if (!fs.existsSync(manifestPath)) continue
        try {
          const man = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { entry?: string }
          await this.loadPlugin(path.join(dir, ent.name, man.entry ?? 'index.js'))
        } catch {
          // 跳过解析失败的目录
        }
        continue
      }
      if (!ent.name.endsWith('.js')) continue
      await this.loadPlugin(path.join(dir, ent.name))
    }
  }

  /** 加载单个插件入口（平铺 .js 或目录型 entry）。返回装载结果（错误透传）。 */
  private async loadPlugin(filePath: string): Promise<{ ok: boolean; error?: string }> {
    if (this.loaded.has(filePath)) return { ok: true }

    // 多文件插件：清除插件目录内全部模块缓存（目录型热重载；平铺插件仅 entry 自身）
    const pluginDir = path.dirname(filePath)
    if (path.resolve(pluginDir) !== path.resolve(this.pluginsDir)) {
      const prefix = pluginDir + path.sep
      for (const key of Object.keys(require.cache)) {
        if (key.startsWith(prefix)) delete require.cache[key]
      }
    }

    try {
      // 清除 entry 自身缓存以支持热重载
      delete require.cache[require.resolve(filePath)]
    } catch {
      // 首次加载无缓存，忽略
    }

    let mod: { default?: Plugin } | Plugin
    try {
      // 必须用 require（CommonJS 契约）。禁止改回 import()：import 有独立于 require.cache 的
      // URL 模块缓存，上面的缓存清除对它无效——热重载会永远加载首次求值的旧模块
      // （2026-09-11 runaway 事故：每次 reload 执行的都是骨架模板，插件工具全部丢失）。
      mod = require(filePath)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logService.log('error', 'error', {
        runId: uniqueRunId('plugin'),
        name: 'loader.import',
        message: `failed to import ${filePath}: ${msg}`,
      })
      return { ok: false, error: msg }
    }

    const plugin = (mod as { default?: Plugin }).default ?? (mod as unknown as Plugin)
    if (!plugin || typeof plugin.setup !== 'function') {
      const error = `invalid plugin format: ${filePath}`
      logService.log('warn', undefined, {
        runId: uniqueRunId('plugin'),
        name: 'loader.load',
        message: error,
      })
      return { ok: false, error }
    }
    // manifest 元数据回填：`{ setup }` 极简导出（缺 id/version）也能被 getLoadedInfo/卸载正确跟踪
    if (!plugin.id || !plugin.version) {
      const manifest = this.readManifest(pluginDir)
      if (manifest?.id && !plugin.id) plugin.id = manifest.id
      if (manifest?.version && !plugin.version) plugin.version = manifest.version
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
      return { ok: true }
    } catch (e) {
      // setup 半途失败（如 flow 注册校验抛错）：反注册已注册的工具/上下文/flow，防残留污染下次装载
      this.unregisterRegistrations(plugin.id)
      const msg = e instanceof Error ? e.message : String(e)
      logService.log('error', 'error', {
        runId: uniqueRunId('plugin'),
        name: 'loader.setup',
        message: `setup failed for ${plugin.id}: ${msg}`,
      })
      return { ok: false, error: msg }
    }
  }

  /** 读目录内 manifest（plugin.json），不存在/解析失败返回 null。 */
  private readManifest(dir: string): { id?: string; version?: string; entry?: string } | null {
    try {
      const p = path.join(dir, 'plugin.json')
      if (!fs.existsSync(p)) return null
      return JSON.parse(fs.readFileSync(p, 'utf-8')) as { id?: string; version?: string }
    } catch {
      return null
    }
  }

  /** 卸载单个插件文件关联的上下文和工具。 */
  /** 按归属清单反注册某插件的工具/上下文/flow（unloadPlugin 与 setup 半途失败共用）。 */
  private unregisterRegistrations(pluginId: string): void {
    for (const toolName of this.pluginTools.get(pluginId) ?? []) {
      toolRegistry.unregister(toolName)
    }
    this.pluginTools.delete(pluginId)
    for (const ctxId of this.pluginContexts.get(pluginId) ?? []) {
      contextRegistry.unregister(ctxId)
    }
    this.pluginContexts.delete(pluginId)
    for (const flowName of this.pluginFlows.get(pluginId) ?? []) {
      flowHost.unregister(flowName)
    }
    this.pluginFlows.delete(pluginId)
  }

  private unloadPlugin(filePath: string): void {
    const plugin = this.loaded.get(filePath)
    if (!plugin) return

    // 按注册记录精确反注册工具/上下文/flow（不依赖命名前缀约定）
    this.unregisterRegistrations(plugin.id)

    this.loaded.delete(filePath)
    logService.log('info', undefined, {
      runId: uniqueRunId('plugin'),
      name: 'loader.unload',
      message: `unloaded: ${plugin.id}`,
    })
  }

  /** 变更文件所属的已装载插件 entry（目录型：目录内任一文件变化 → 重载该插件入口）。 */
  private findLoadedEntryForFile(filePath: string): string | null {
    const dir = path.dirname(filePath)
    for (const fp of this.loaded.keys()) {
      if (path.dirname(fp) === dir) return fp
    }
    return null
  }

  /** 变更文件 → 所属插件 entry：一级子目录取 plugin.json 的 entry（仅 .js），根级平铺取文件本身。
   *  防止把 constants.js 等分层模块当插件入口装载（"invalid plugin format" 噪音）。 */
  private resolveEntryForFile(filePath: string): string {
    const dir = path.dirname(filePath)
    if (path.resolve(dir) !== path.resolve(this.pluginsDir) && path.dirname(dir) === path.resolve(this.pluginsDir)) {
      const manifest = this.readManifest(dir)
      const rel = manifest?.entry ?? 'index.js'
      if (rel.endsWith('.js')) return path.join(dir, rel)
    }
    return filePath
  }

  /** 防抖重载：多文件写入（目录型插件生成/修改）合并为一次重载。 */
  private scheduleReload(filePath: string): void {
    // 开发写入抑制：plugin_* 工具刚写过的插件跳过 watcher 重载（防半成品装载与日志噪音）
    const relTop = path.relative(this.pluginsDir, filePath).split(path.sep)[0]
    if (this.isDevWriting(relTop)) return
    const prev = this.reloadTimers.get(filePath)
    if (prev) clearTimeout(prev)
    const t = setTimeout(() => {
      this.reloadTimers.delete(filePath)
      fs.stat(filePath, (err) => {
        if (err) {
          // 文件已删除 → 若属某已装载插件则卸载之
          const entry = this.findLoadedEntryForFile(filePath)
          if (entry) this.unloadPlugin(entry)
          return
        }
        const entry = this.findLoadedEntryForFile(filePath)
        if (entry) {
          this.unloadPlugin(entry)
          this.loadPlugin(entry)
        } else {
          // 全新文件 → 归位到所属插件的 entry 再装载（不把分层模块当入口）
          const candidate = this.resolveEntryForFile(filePath)
          this.unloadPlugin(candidate)
          this.loadPlugin(candidate)
        }
      })
    }, 300)
    this.reloadTimers.set(filePath, t)
  }

  /** 开始监听目录变更（recursive：目录型插件的子目录文件也纳入）。 */
  private startWatching(dir: string): void {
    try {
      this.watcher = fs.watch(dir, { recursive: true }, (eventType, filename) => {
        if (!filename || !filename.endsWith('.js')) return
        const filePath = path.join(dir, filename)
        this.scheduleReload(filePath)
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
   * 读取当前执行上下文（工具/flow 执行期间由宿主注入）。
   * 无执行上下文（如插件 setup 期间）返回 null——调用方需跳过。
   */
  private currentScope(): { conversationId: string; contextId: string } | null {
    const ctx = getExecutionContext()
    if (!ctx || !ctx.conversationId) return null
    return ctx
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
        // 记录归属，供 unloadPlugin 精确卸载（去重：duplicate-replace 场景下同名会重复到达）
        if (ok) {
          const list = this.pluginTools.get(pluginId) ?? []
          if (!list.includes(def.name)) list.push(def.name)
          this.pluginTools.set(pluginId, list)
        }
        return ok
      },
      storage: {
        get: () => pluginStorageService.get(pluginId),
        set: (data) => pluginStorageService.set(pluginId, data),
      },
      prompts: {
        set: (text) => {
          const scope = this.currentScope()
          if (!scope) return
          headInjectionStore.set(scope.conversationId, scope.contextId, text)
        },
        remove: (text) => {
          const scope = this.currentScope()
          if (!scope) return
          headInjectionStore.remove(scope.conversationId, scope.contextId, text)
        },
      },
      llm: {
        generate: (input) => flowHost.generate(input),
      },
      flow: {
        register: (def) => {
          const ok = flowHost.register(def as FlowDefinition)
          // 记录归属，供 unloadPlugin 注销（duplicate-replace 场景下同名会重复到达，去重）
          if (ok) {
            const list = this.pluginFlows.get(pluginId) ?? []
            if (!list.includes(def.name)) list.push(def.name)
            this.pluginFlows.set(pluginId, list)
          }
          return ok
        },
        run: (name, input) => {
          // 会话归属从执行上下文自动获取（工具执行期间由宿主注入）
          const scope = this.currentScope()
          if (!scope) return Promise.resolve({ ok: false as const, error: 'no execution context', data: {}, state: {}, rendered: false })
          const p = this.runFlow(name, input, scope)
          // 兜底 catch：插件 fire-and-forget（未 await）时拒绝不再逃逸成 unhandledRejection；
          // 返回原 promise——正确 await 的调用方仍收到完整错误
          p.catch((e) => {
            logService.log('warn', undefined, {
              runId: uniqueRunId('flow'),
              name: 'flow.run',
              message: `flow "${name}" 未被 await 的失败：${e instanceof Error ? e.message : String(e)}`,
            })
          })
          return p
        },
      },
    }
  }
}

/** 全局单例。 */
export const pluginLoader = new PluginLoader()
