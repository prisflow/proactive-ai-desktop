import { app, protocol } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import type { AssetPackManifestV1, AssetPackResolved } from '../../shared/types'
import { pluginPreferencesStore } from '../plugin-preferences-store'
import {
  isPluginAssetsDebug,
  pluginAssetsMainLog,
  pluginAssetsMainVerbose,
} from './debug-log'

const PACKS_ROOT = 'plugin-asset-packs'
const MANIFEST_NAME = 'manifest.json'

function packsRootDir(): string {
  return path.join(app.getPath('userData'), PACKS_ROOT)
}

/** 资源包 manifest 的 packId 须与插件 id 一致或为 `${pluginId}.xxx`，禁止跨插件误用其它 pack（如 demo）。 */
function packMatchesPlugin(pluginId: string, p: AssetPackResolved): boolean {
  return p.packId === pluginId || p.packId.startsWith(`${pluginId}.`)
}

function pickLatestMatchingPack(candidates: AssetPackResolved[]): AssetPackResolved | null {
  if (candidates.length === 0) return null
  return [...candidates].sort((a, b) => {
    const idCmp = a.packId.localeCompare(b.packId)
    if (idCmp !== 0) return idCmp
    return b.version.localeCompare(a.version, undefined, { numeric: true })
  })[0]
}

async function safeReadJson(file: string): Promise<any | null> {
  try {
    const raw = await fs.readFile(file, 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function isManifestV1(x: any): x is AssetPackManifestV1 {
  if (
    !(
      x &&
      x.v === 1 &&
      typeof x.packId === 'string' &&
      typeof x.version === 'string' &&
      typeof x.name === 'string' &&
      x.idle &&
      x.idle.kind === 'sheet' &&
      typeof x.idle.src === 'string' &&
      typeof x.idle.frameW === 'number' &&
      typeof x.idle.frameH === 'number' &&
      typeof x.idle.frames === 'number' &&
      typeof x.idle.fps === 'number' &&
      x.atlas &&
      typeof x.atlas.src === 'string' &&
      typeof x.atlas.cols === 'number' &&
      typeof x.atlas.rows === 'number' &&
      typeof x.atlas.tileW === 'number' &&
      typeof x.atlas.tileH === 'number'
    )
  ) {
    return false
  }
  if (x.expressions != null) {
    if (typeof x.expressions !== 'object' || Array.isArray(x.expressions)) return false
    for (const [k, v] of Object.entries(x.expressions)) {
      if (!/^[a-zA-Z0-9_-]+$/.test(k)) return false
      if (!v || typeof v !== 'object' || Array.isArray(v)) return false
      const row = (v as any).row
      const col = (v as any).col
      if (typeof row !== 'number' || typeof col !== 'number') return false
    }
  }
  return true
}

export async function ensurePluginAssetPacksDir(): Promise<string> {
  const dir = packsRootDir()
  await fs.mkdir(dir, { recursive: true })
  return dir
}

export async function scanPluginAssetPacks(): Promise<AssetPackResolved[]> {
  const root = await ensurePluginAssetPacksDir()
  pluginAssetsMainLog('scanPluginAssetPacks root', root)
  const out: AssetPackResolved[] = []

  let packIds: string[] = []
  try {
    packIds = (await fs.readdir(root, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    packIds = []
  }

  for (const packId of packIds) {
    const packDir = path.join(root, packId)
    let versions: string[] = []
    try {
      versions = (await fs.readdir(packDir, { withFileTypes: true }))
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
    } catch {
      versions = []
    }

    for (const version of versions) {
      const vdir = path.join(packDir, version)
      const manifestPath = path.join(vdir, MANIFEST_NAME)
      const json = await safeReadJson(manifestPath)
      if (!isManifestV1(json)) continue
      const m = json as AssetPackManifestV1
      const idleUrl = `plugin-asset://${encodeURIComponent(m.packId)}/${encodeURIComponent(
        m.version
      )}/${m.idle.src.replace(/\\/g, '/')}`
      const atlasUrl = `plugin-asset://${encodeURIComponent(m.packId)}/${encodeURIComponent(
        m.version
      )}/${m.atlas.src.replace(/\\/g, '/')}`
      out.push({
        packId: m.packId,
        version: m.version,
        name: m.name,
        author: m.author,
        license: m.license,
        expressions: m.expressions,
        dir: vdir,
        idleUrl,
        atlasUrl,
        idle: m.idle,
        atlas: m.atlas,
      })
    }
  }

  out.sort((a, b) => `${a.packId}@${a.version}`.localeCompare(`${b.packId}@${b.version}`))
  pluginAssetsMainLog('scanPluginAssetPacks done', {
    validPackCount: out.length,
    packs: out.map((p) => `${p.packId}@${p.version}`),
  })
  return out
}

export async function getActiveAssetPackResolved(
  pluginId: string
): Promise<AssetPackResolved | null> {
  const pid = String(pluginId || '').trim()
  const cfg = pluginPreferencesStore.getPluginConfig(pid)
  const activeId = typeof cfg.activePackId === 'string' ? cfg.activePackId.trim() : ''
  const activeVer = typeof cfg.activePackVersion === 'string' ? cfg.activePackVersion.trim() : ''
  const packs = await scanPluginAssetPacks()
  const hit =
    activeId && activeVer ? packs.find((p) => p.packId === activeId && p.version === activeVer) : undefined

  let picked: AssetPackResolved | null = hit ?? null
  let branch: string

  if (hit) {
    branch = 'config_match'
  } else if (activeId || activeVer) {
    picked = null
    branch = 'config_miss'
  } else if (!pid) {
    picked = null
    branch = 'no_plugin_id'
  } else {
    const scoped = packs.filter((p) => packMatchesPlugin(pid, p))
    picked = pickLatestMatchingPack(scoped)
    branch =
      picked != null
        ? 'plugin_scoped_pack'
        : packs.length > 0
          ? 'no_pack_for_this_plugin'
          : 'no_complete_packs_on_disk'
  }

  pluginAssetsMainLog('getActiveAssetPackResolved', {
    pluginId: pid,
    configActive: { packId: activeId || '(empty)', version: activeVer || '(empty)' },
    branch,
    picked: picked ? `${picked.packId}@${picked.version}` : null,
  })
  return picked
}

export function registerPluginAssetProtocol(): void {
  protocol.registerFileProtocol('plugin-asset', async (request, callback) => {
    try {
      const url = new URL(request.url)
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
      const host = decodeURIComponent(url.host || '')
      const packId = host || parts.shift() || ''
      const version = parts.shift() || ''
      const rel = parts.join('/')
      if (!packId || !version || !rel) {
        pluginAssetsMainLog('protocol reject bad url', { url: request.url, packId, version, rel })
        callback({ error: -6 })
        return
      }
      const full = path.join(packsRootDir(), packId, version, rel)
      pluginAssetsMainVerbose('protocol serve', { full })
      if (isPluginAssetsDebug()) {
        try {
          await fs.access(full)
        } catch {
          pluginAssetsMainLog('protocol file MISSING', { full, url: request.url })
        }
      }
      callback({ path: full })
    } catch (e) {
      pluginAssetsMainLog('protocol exception', e)
      callback({ error: -2 })
    }
  })
}
