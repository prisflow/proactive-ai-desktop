import { app } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import type { PluginManifestV1 } from '../../shared/types'
import { parsePluginManifestJson, PluginManifestError } from './plugin-manifest'

export interface DiscoveredPlugin {
  dir: string
  manifest: PluginManifestV1
  /** 校验/解析失败时的说明；此时 manifest 可能为目录名推断的占位 */
  loadError?: string
}

function manifestFromDirNames(pluginId: string, version: string): PluginManifestV1 {
  return {
    schema_version: 1,
    id: pluginId,
    version,
    name: pluginId,
    main: 'main.cjs',
    min_app_version: '0.0.0',
    permissions: [],
    hooks: [],
    tools: [],
  }
}

async function tryReadManifest(dir: string): Promise<{ ok: true; m: PluginManifestV1 } | { ok: false; err: string }> {
  try {
    const raw = await fs.readFile(path.join(dir, 'plugin.json'), 'utf8')
    const m = parsePluginManifestJson(raw, dir)
    return { ok: true, m }
  } catch (e) {
    const msg = e instanceof PluginManifestError ? e.message : String(e)
    return { ok: false, err: msg }
  }
}

async function scanPluginRoot(pluginsRoot: string): Promise<DiscoveredPlugin[]> {
  const out: DiscoveredPlugin[] = []
  const base = pluginsRoot
  let pluginIds
  try {
    pluginIds = await fs.readdir(base, { withFileTypes: true })
  } catch {
    return out
  }
  for (const idEnt of pluginIds) {
    if (!idEnt.isDirectory()) continue
    const idPath = path.join(base, idEnt.name)
    let versions
    try {
      versions = await fs.readdir(idPath, { withFileTypes: true })
    } catch {
      continue
    }
    for (const vEnt of versions) {
      if (!vEnt.isDirectory()) continue
      const dir = path.join(idPath, vEnt.name)
      const parsed = await tryReadManifest(dir)
      if (!parsed.ok) {
        out.push({
          dir,
          manifest: manifestFromDirNames(idEnt.name, vEnt.name),
          loadError: parsed.err,
        })
        continue
      }
      const m = parsed.m
      if (m.id !== idEnt.name) {
        out.push({
          dir,
          manifest: m,
          loadError: `plugin.json id "${m.id}" does not match directory "${idEnt.name}"`,
        })
        continue
      }
      if (m.version !== vEnt.name) {
        out.push({
          dir,
          manifest: m,
          loadError: `plugin.json version "${m.version}" does not match directory "${vEnt.name}"`,
        })
        continue
      }
      out.push({ dir, manifest: m })
    }
  }
  return out
}

/** 同 id 多版本时保留字典序最大的版本（简单策略） */
function pickLatestPerId(discovered: DiscoveredPlugin[]): DiscoveredPlugin[] {
  const map = new Map<string, DiscoveredPlugin>()
  for (const d of discovered) {
    const cur = map.get(d.manifest.id)
    if (!cur || d.manifest.version.localeCompare(cur.manifest.version) > 0) {
      map.set(d.manifest.id, d)
    }
  }
  return [...map.values()].sort((a, b) => a.manifest.id.localeCompare(b.manifest.id))
}

/** 插件包仓库根目录（单一路径）：`userData/plugins/packages/<id>/<version>/...` */
export function getInstalledPluginsRoot(userDataDir: string): string {
  return path.join(userDataDir, 'plugins', 'packages')
}

export async function discoverInstalledPlugins(): Promise<DiscoveredPlugin[]> {
  const root = getInstalledPluginsRoot(app.getPath('userData'))
  try {
    await fs.mkdir(root, { recursive: true })
  } catch {
    /* ignore */
  }
  return pickLatestPerId(await scanPluginRoot(root))
}
