import { app, protocol } from 'electron'
import { existsSync } from 'fs'
import fs from 'fs/promises'
import path from 'path'
import type { PAvatarPackManifestV1, PAvatarPackResolved } from '../../shared/types'
import { pluginPreferencesStore } from '../plugin-preferences-store'
import { isPavatarDebug, pavatarMainLog, pavatarMainVerbose } from './debug-log'

const PACKS_ROOT = 'pavatar-packs'
const MANIFEST_NAME = 'manifest.json'
/** Shipped demo pack: always refreshed from `resources/pavatar-bundled` so repo art updates apply. */
const BUNDLED_DEMO_PACK_ID = 'com.proactiveai.demo'
const BUNDLED_DEMO_VERSION = '1.0.0'

function packsRootDir(): string {
  return path.join(app.getPath('userData'), PACKS_ROOT)
}

/** Dev: repo `resources/pavatar-bundled`. Packaged: `extraResources` → `process.resourcesPath/pavatar-bundled`. */
function bundledPacksSourceDir(): string | null {
  try {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'pavatar-bundled')
    }
    // Compiled main lives in `out/main`; project root is two levels up (not three).
    return path.join(__dirname, '..', '..', 'resources', 'pavatar-bundled')
  } catch {
    return null
  }
}

/**
 * Ensures the shipped demo pack exists under userData (overwrites that version only).
 * Other pack folders under `pavatar-packs/` are left untouched.
 */
export async function syncBundledPavatarPackIfNeeded(): Promise<void> {
  await ensurePAvatarPacksDir()
  const root = bundledPacksSourceDir()
  if (!root || !existsSync(root)) {
    pavatarMainLog('syncBundledPavatarPack: missing bundled source dir', root)
    return
  }
  const rel = path.join(BUNDLED_DEMO_PACK_ID, BUNDLED_DEMO_VERSION)
  const from = path.join(root, rel)
  if (!existsSync(from)) {
    pavatarMainLog('syncBundledPavatarPack: bundled demo path missing', from)
    return
  }
  const to = path.join(packsRootDir(), rel)
  await fs.mkdir(path.dirname(to), { recursive: true })
  await fs.cp(from, to, { recursive: true })
  const staleDemo = path.join(packsRootDir(), BUNDLED_DEMO_PACK_ID, '1.0.1')
  if (existsSync(staleDemo)) {
    await fs.rm(staleDemo, { recursive: true, force: true })
    pavatarMainLog('syncBundledPavatarPack: removed stale demo 1.0.1')
  }
  pavatarMainLog('syncBundledPavatarPack: refreshed demo pack', { from, to })
}

async function safeReadJson(file: string): Promise<any | null> {
  try {
    const raw = await fs.readFile(file, 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

// 返回true表示是v1版本的manifest（当成这个类型）
function isManifestV1(x: any): x is PAvatarPackManifestV1 {
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

export async function ensurePAvatarPacksDir(): Promise<string> {
  const dir = packsRootDir()
  await fs.mkdir(dir, { recursive: true })
  return dir
}

export async function scanPAvatarPacks(): Promise<PAvatarPackResolved[]> {
  const root = await ensurePAvatarPacksDir()
  pavatarMainLog('scanPAvatarPacks root', root)
  const out: PAvatarPackResolved[] = []

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
      const m = json as PAvatarPackManifestV1
      const idleUrl = `pavatar://${encodeURIComponent(m.packId)}/${encodeURIComponent(
        m.version
      )}/${m.idle.src.replace(/\\/g, '/')}`
      const atlasUrl = `pavatar://${encodeURIComponent(m.packId)}/${encodeURIComponent(
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
  pavatarMainLog('scanPAvatarPacks done', {
    validPackCount: out.length,
    packs: out.map((p) => `${p.packId}@${p.version}`),
  })
  return out
}

export async function getActivePAvatarPackResolved(): Promise<PAvatarPackResolved | null> {
  const cfg = pluginPreferencesStore.getPluginConfig('com.proactiveai.pavatar')
  const activeId = typeof cfg.activePackId === 'string' ? cfg.activePackId : ''
  const activeVer = typeof cfg.activePackVersion === 'string' ? cfg.activePackVersion : ''
  const packs = await scanPAvatarPacks()
  const hit = packs.find((p) => p.packId === activeId && p.version === activeVer)
  const picked = hit || (packs[0] ?? null)
  const branch = hit
    ? 'config_match'
    : packs.length > 0
      ? 'fallback_first_pack'
      : 'no_packs_on_disk'
  pavatarMainLog('getActivePAvatarPackResolved', {
    configActive: { packId: activeId || '(empty)', version: activeVer || '(empty)' },
    branch,
    picked: picked ? `${picked.packId}@${picked.version}` : null,
  })
  return picked
}

export function registerPAvatarProtocol(): void {
  // pavatar://<packId>/<version>/<relpath>
  protocol.registerFileProtocol('pavatar', async (request, callback) => {
    try {
      const url = new URL(request.url)
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
      const host = decodeURIComponent(url.host || '')
      const packId = host || parts.shift() || ''
      const version = parts.shift() || ''
      const rel = parts.join('/')
      if (!packId || !version || !rel) {
        pavatarMainLog('protocol reject bad url', { url: request.url, packId, version, rel })
        callback({ error: -6 }) // FILE_NOT_FOUND
        return
      }
      const full = path.join(packsRootDir(), packId, version, rel)
      pavatarMainVerbose('protocol serve', { full })
      if (isPavatarDebug()) {
        try {
          await fs.access(full)
        } catch {
          pavatarMainLog('protocol file MISSING', { full, url: request.url })
        }
      }
      callback({ path: full })
    } catch (e) {
      pavatarMainLog('protocol exception', e)
      callback({ error: -2 }) // FAILED
    }
  })
}

