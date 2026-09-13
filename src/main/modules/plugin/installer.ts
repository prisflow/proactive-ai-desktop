import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import AdmZip from 'adm-zip'
import type { PluginManifest } from './types'
import { isSemver, semverGt } from './types'
import type { PluginImportResult, PluginExportResult } from '@shared/types/plugin'
import { logService, uniqueRunId } from '../../services/logger'
import { pluginLoader } from './loader'
/**
 * 插件安装器 —— zip 包导入/导出与落盘。
 *
 * 包格式（<plugin>.zip，两种形态均支持）：
 *   目录型包：plugin.json + 入口 + 全部分层文件（.js/.md，与开发工具产物同构）
 *   平铺包（历史兼容）：plugin.json + 单入口 .js
 *
 * 安装策略（与 PluginLoader 扫描对齐）：
 * - 目录型包 → userData/plugins/<manifest.id>/（写盘期间抑制 watcher，写完显式装载）
 * - 平铺包 → userData/plugins/<entry>.js + <entry>.json（watcher 自动拾取）
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

    // 4. 落盘：判定包形态——
    //    多文件（entry 之外还有 .js/.md）= 目录型包 → plugins/<manifest.id>/（与开发工具产物同构）
    //    单文件 = 平铺包（历史兼容）→ plugins/<entry>.js + <entry>.json
    await fsp.mkdir(pluginsDir, { recursive: true })
    const safeName = (n: string) => !n.includes('/') && !n.includes('\\') && n !== '.' && n !== '..'
    const payload = entries.filter(
      (e) => !e.isDirectory && e.entryName !== 'plugin.json' && safeName(e.entryName) && /\.(js|md)$/.test(e.entryName),
    )
    const multiFile = payload.length > 1
    if (multiFile) {
      // 目录型安装：目录名 = manifest.id（白名单校验，防路径注入）
      if (!/^[a-z][a-z0-9_]*$/i.test(manifest.id)) return { ok: false, error: 'manifest.id 含非法字符，无法作为目录名' }
      const targetDir = path.join(pluginsDir, manifest.id)
      if (fs.existsSync(targetDir)) return { ok: false, error: `插件 ${manifest.id} 已存在（请先卸载旧版本再导入）` }
      // 写盘期间抑制 watcher（防半成品装载），写完显式装载
      pluginLoader.markDevWriting(manifest.id)
      await fsp.mkdir(targetDir, { recursive: true })
      for (const e of payload) {
        const dest = path.join(targetDir, e.entryName)
        if (!dest.startsWith(targetDir + path.sep)) continue // 双保险（safeName 已拦）
        await fsp.writeFile(dest, e.getData())
      }
      await fsp.writeFile(path.join(targetDir, 'plugin.json'), JSON.stringify(manifest, null, 2))
      pluginLoader.loadEntryNow(path.join(targetDir, entryName))
      logService.log('info', undefined, {
        runId: uniqueRunId('plugin'),
        name: 'installer.import',
        message: `imported plugin package ${manifest.id} v${manifest.version} (${payload.length} files) -> ${targetDir}`,
      })
    } else {
      // 平铺安装（单文件包，历史兼容）
      const entryOut = path.join(pluginsDir, entryName)
      const manifestOut = path.join(pluginsDir, `${path.basename(entryName, '.js')}.json`)
      await fsp.writeFile(entryOut, code)
      await fsp.writeFile(manifestOut, JSON.stringify(manifest, null, 2))
      logService.log('info', undefined, {
        runId: uniqueRunId('plugin'),
        name: 'installer.import',
        message: `imported plugin ${manifest.id} v${manifest.version} -> ${entryOut}`,
      })
    }

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

/** 读插件简况（目录型优先，平铺兜底）。不存在返回 null。 */
export function getPluginBrief(
  pluginId: string,
  pluginsDir: string,
): { id: string; name: string; version: string; flat: boolean } | null {
  try {
    const dirManifest = path.join(pluginsDir, pluginId, 'plugin.json')
    if (fs.existsSync(dirManifest)) {
      const m = JSON.parse(fs.readFileSync(dirManifest, 'utf-8')) as PluginManifest
      return { id: m.id ?? pluginId, name: m.name ?? pluginId, version: m.version ?? '0.0.0', flat: false }
    }
    const flatMan = path.join(pluginsDir, `${pluginId}.json`)
    const flatJs = path.join(pluginsDir, `${pluginId}.js`)
    if (fs.existsSync(flatMan) && fs.existsSync(flatJs)) {
      const m = JSON.parse(fs.readFileSync(flatMan, 'utf-8')) as PluginManifest
      return { id: m.id ?? pluginId, name: m.name ?? pluginId, version: m.version ?? '0.0.0', flat: true }
    }
    return null
  } catch {
    return null
  }
}

/** 导出插件为 zip（目录型：plugin.json + 全部分层 .js + intent.md；平铺型：转标准包）。 */
export function exportPluginToZip(pluginId: string, pluginsDir: string, savePath: string): PluginExportResult {
  try {
    const brief = getPluginBrief(pluginId, pluginsDir)
    if (!brief) return { ok: false, error: `插件不存在：${pluginId}` }
    const zip = new AdmZip()
    let files = 0
    const add = (name: string, data: Buffer | string) => {
      zip.addFile(name, typeof data === 'string' ? Buffer.from(data, 'utf-8') : data)
      files++
    }
    if (!brief.flat) {
      const dir = path.join(pluginsDir, pluginId)
      add('plugin.json', fs.readFileSync(path.join(dir, 'plugin.json')))
      for (const f of fs.readdirSync(dir)) {
        if (f === 'plugin.json') continue
        if (!/\.(js|md)$/.test(f)) continue // intent.md 含在内；数据/杂项不入包
        add(f, fs.readFileSync(path.join(dir, f)))
      }
    } else {
      const manifestRaw = fs.readFileSync(path.join(pluginsDir, `${pluginId}.json`), 'utf-8')
      const manifest = JSON.parse(manifestRaw) as PluginManifest
      add('plugin.json', manifestRaw)
      add(manifest.entry ?? `${pluginId}.js`, fs.readFileSync(path.join(pluginsDir, `${pluginId}.js`)))
    }
    zip.writeZip(savePath)
    logService.log('info', undefined, {
      runId: uniqueRunId('plugin'),
      name: 'installer.export',
      message: `exported plugin ${pluginId} (${files} files) -> ${savePath}`,
    })
    return { ok: true, path: savePath }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logService.log('error', 'error', {
      runId: uniqueRunId('plugin'),
      name: 'installer.export',
      message: `export failed: ${msg}`,
    })
    return { ok: false, error: `导出失败：${msg}` }
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

      // 目标不存在 → 首启 seed；已存在 → 内置版本更新时覆盖（官方内置升级通道，
      // 用户手改/降级的版本因 semver 不大于已装版本而不被触碰）
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
      } else {
        // 双双存在：比对版本，内置更新则覆盖 entry + manifest
        try {
          const installed = JSON.parse(await fsp.readFile(manifestOut, 'utf-8')) as PluginManifest
          if (isSemver(installed.version) && isSemver(manifest.version) && semverGt(manifest.version, installed.version)) {
            await fsp.copyFile(entrySrc, entryOut)
            await fsp.writeFile(manifestOut, JSON.stringify(manifest, null, 2))
            logService.log('info', undefined, {
              runId: uniqueRunId('plugin'),
              name: 'installer.builtin',
              message: `upgraded builtin plugin ${id} ${installed.version} -> ${manifest.version}`,
            })
          }
        } catch {
          // 已装 manifest 损坏：按不覆盖处理，不破坏用户目录
        }
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
