import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { PluginContext } from './context'
import type { PluginHooks, PluginToolExport } from '../../shared/types'

export type PluginFactory = (ctx: PluginContext) => {
  hooks?: Partial<PluginHooks>
  tools?: PluginToolExport[]
  dispose?: () => void | Promise<void>
}

function assertEntryInsidePluginDir(entryAbs: string, pluginRootAbs: string): void {
  const root = path.resolve(pluginRootAbs)
  const entry = path.resolve(entryAbs)
  if (entry === root || entry.startsWith(root + path.sep)) return
  throw new Error('main entry escapes plugin directory')
}

function readPackageTypeModule(pluginDir: string): boolean {
  try {
    const raw = fs.readFileSync(path.join(pluginDir, 'package.json'), 'utf8')
    const pkg = JSON.parse(raw) as { type?: string }
    return pkg?.type === 'module'
  } catch {
    return false
  }
}

/**
 * 加载插件入口：支持
 * - `.cjs` 或 未声明 `type:module` 的 `.js`：`createRequire`（CJS）
 * - `.mjs` 或 `package.json` 中 `"type":"module"` 的 `.js`：`import()`（ESM）
 */
export async function loadPluginFactory(
  pluginDir: string,
  mainRelative: string
): Promise<PluginFactory> {
  const entry = path.resolve(pluginDir, mainRelative)
  assertEntryInsidePluginDir(entry, pluginDir)

  const lower = entry.toLowerCase()
  const isMjs = lower.endsWith('.mjs')
  const isCjs = lower.endsWith('.cjs')
  const isJs = lower.endsWith('.js')
  const packageIsModule = readPackageTypeModule(pluginDir)

  const useDynamicImport = isMjs || (isJs && packageIsModule && !isCjs)

  if (useDynamicImport) {
    const href = pathToFileURL(entry).href
    const mod = (await import(href)) as {
      default?: PluginFactory
      createPlugin?: PluginFactory
    }
    const fn = mod.default ?? mod.createPlugin
    if (typeof fn !== 'function') {
      throw new Error(
        'ESM plugin must default-export or export named createPlugin() factory'
      )
    }
    return fn
  }

  const req = createRequire(path.join(pluginDir, 'plugin.json'))
  const factory = req(entry) as unknown
  if (typeof factory !== 'function') {
    throw new Error('CJS plugin must module.exports a factory function')
  }
  return factory as PluginFactory
}
