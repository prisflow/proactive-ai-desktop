import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import AdmZip from 'adm-zip'
import type { PluginManifest } from './types'
import { isSemver } from './types'
import type { PluginImportResult } from '@shared/types/plugin'
import { logService, uniqueRunId } from '../../services/logger'
/**
 * 插件安装器 —— zip 包导入与落盘。
 *
 * 包格式（<plugin>.zip）：
 *   plugin.json     元数据（必填，见 PluginManifest）
 *   <entry>.js      入口单文件（CJS，module.exports = { id, name, version, setup }）
 *
 * 安装策略（与 PluginLoader 顶层扫描对齐）：
 *   将 entry.js 平铺写入 userData/plugins/<entry>.js，plugin.json 写入
 *   userData/plugins/<entry>.json —— loader 的 fs.watch 扫描顶层 .js 即自动加载，
 *   无需修改 loader 的目录/加载逻辑。
 */

/** 校验 plugin.json 内容。返回错误信息或 null（合法）。 */
export function validateManifest(m: unknown): string | null {
  if (!m || typeof m !== 'object') return 'plugin.json 缺失或不是对象'
  const man = m as Record<string, unknown>
  if (typeof man.id !== 'string' || !man.id.trim()) return 'plugin.json 缺少 id'
  if (typeof man.name !== 'string' || !man.name.trim()) return 'plugin.json 缺少 name'
  if (typeof man.version !== 'string' || !isSemver(man.version)) return 'plugin.json version 不是合法 semver'
  if (man.entry !== undefined && (typeof man.entry !== 'string' || !man.entry.endsWith('.js') || man.entry.includes('/') || man.entry.includes('\\')))
    return 'plugin.json entry 必须是以 .js 结尾的文件名（不允许路径）'
  if (man.minAppVersion !== undefined && (typeof man.minAppVersion !== 'string' || !isSemver(man.minAppVersion)))
    return 'plugin.json minAppVersion 不是合法 semver'
  return null
}

/** 从 zip 字节解析、校验并落盘插件。返回结果。 */
export async function importPluginFromZip(zipPath: string, pluginsDir: string): Promise<PluginImportResult> {
  try {
    if (!fs.existsSync(zipPath)) return { ok: false, error: '文件不存在' }

    const zip = new AdmZip(zipPath)
    const entries = zip.getEntries()
    if (!entries.length) return { ok: false, error: 'zip 包为空' }

    // 1. 解析 plugin.json
    const manifestEntry = entries.find((e) => e.entryName === 'plugin.json' && !e.isDirectory)
    if (!manifestEntry) return { ok: false, error: 'zip 包缺少 plugin.json' }
    let manifest: PluginManifest
    try {
      manifest = JSON.parse(manifestEntry.getData().toString('utf-8')) as PluginManifest
    } catch {
      return { ok: false, error: 'plugin.json 不是合法 JSON' }
    }
    const manErr = validateManifest(manifest)
    if (manErr) return { ok: false, error: manErr }

    // 2. 定位 entry 文件（默认 index.js；禁止目录穿越——entry 只允许顶层文件名）
    const entryName = manifest.entry ?? 'index.js'
    if (entryName.includes('/') || entryName.includes('\\') || path.basename(entryName) !== entryName)
      return { ok: false, error: 'entry 不允许包含路径' }
    const entryEntry = entries.find((e) => e.entryName === entryName && !e.isDirectory)
    if (!entryEntry) return { ok: false, error: `zip 包缺少入口文件 ${entryName}` }

    // 3. 读入 entry 源码（用于后续校验 id/version 与 JS 内定义一致）
    const code = entryEntry.getData().toString('utf-8')
    if (!code.includes("module.exports")) return { ok: false, error: '入口文件不是 CJS 插件（缺少 module.exports）' }

    // 4. 落盘：entry.js + plugin.json 平铺到 pluginsDir
    await fsp.mkdir(pluginsDir, { recursive: true })
    const entryOut = path.join(pluginsDir, entryName)
    const manifestOut = path.join(pluginsDir, `${path.basename(entryName, '.js')}.json`)
    await fsp.writeFile(entryOut, code)
    await fsp.writeFile(manifestOut, JSON.stringify(manifest, null, 2))

    logService.log('info', undefined, {
      runId: uniqueRunId('plugin'),
      name: 'installer.import',
      message: `imported plugin ${manifest.id} v${manifest.version} -> ${entryOut}`,
    })

    return {
      ok: true,
      plugin: {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
      },
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logService.log('error', 'error', {
      runId: uniqueRunId('plugin'),
      name: 'installer.import',
      message: `import failed: ${msg}`,
    })
    return { ok: false, error: `导入失败：${msg}` }
  }
}

/**
 * 内置插件同步（首启复制）。
 *
 * 把 resources/plugins/<id>/ 下的 plugin.json + entry.js 复制到 userData/plugins/
 * （仅当目标文件不存在时，不覆盖用户版本）。loader 的顶层扫描/热加载会自动捡起，
 * 无需运行时特殊分支。打包时需把 resources/plugins 纳入 extraResources。
 */
export async function syncBuiltinPlugins(builtinDir: string, pluginsDir: string): Promise<void> {
  try {
    if (!fs.existsSync(builtinDir)) return
    const ids = (await fsp.readdir(builtinDir)).filter((d) => {
      try { return fs.statSync(path.join(builtinDir, d)).isDirectory() } catch { return false }
    })

    for (const id of ids) {
      const pluginDir = path.join(builtinDir, id)
      const manifestPath = path.join(pluginDir, 'plugin.json')
      if (!fs.existsSync(manifestPath)) continue
      let manifest: PluginManifest
      try {
        manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf-8')) as PluginManifest
      } catch {
        logService.log('warn', undefined, {
          runId: uniqueRunId('plugin'),
          name: 'installer.builtin',
          message: `builtin plugin ${id}: plugin.json parse failed, skip`,
        })
        continue
      }
      const entryName = manifest.entry ?? 'index.js'
      const entrySrc = path.join(pluginDir, entryName)
      if (!fs.existsSync(entrySrc)) continue

      await fsp.mkdir(pluginsDir, { recursive: true })
      const entryOut = path.join(pluginsDir, entryName)
      const manifestOut = path.join(pluginsDir, `${path.basename(entryName, '.js')}.json`)

      // 仅当目标不存在时复制（首启 seed；不覆盖用户后续安装/修改的版本）
      if (!fs.existsSync(entryOut)) {
        await fsp.copyFile(entrySrc, entryOut)
        await fsp.writeFile(manifestOut, JSON.stringify(manifest, null, 2))
        logService.log('info', undefined, {
          runId: uniqueRunId('plugin'),
          name: 'installer.builtin',
          message: `seeded builtin plugin ${id} v${manifest.version} -> ${entryOut}`,
        })
      } else if (!fs.existsSync(manifestOut)) {
        // entry 已存在（如早前手动放置）但缺 manifest：补写元数据，不覆盖 entry
        await fsp.writeFile(manifestOut, JSON.stringify(manifest, null, 2))
        logService.log('info', undefined, {
          runId: uniqueRunId('plugin'),
          name: 'installer.builtin',
          message: `backfilled manifest for builtin plugin ${id} -> ${manifestOut}`,
        })
      }
    }
  } catch (e) {
    logService.log('warn', undefined, {
      runId: uniqueRunId('plugin'),
      name: 'installer.builtin',
      message: `syncBuiltinPlugins failed: ${e instanceof Error ? e.message : String(e)}`,
    })
  }
}
