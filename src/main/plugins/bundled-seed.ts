import { app } from 'electron'
import fs from 'fs/promises'
import fssync from 'fs'
import path from 'path'

/**
 * Single plugin store path:
 * `userData/plugins/packages/<pluginId>/<version>/...`
 *
 * Bundled plugins are shipped under:
 * - packaged: `process.resourcesPath/bundled-plugins`
 * - dev: `<repo>/resources/bundled-plugins`
 *
 * On startup, we *seed* bundled plugins into the user store using the same on-disk layout.
 * Runtime discovery only scans the user store.
 */
export function userPluginStoreRoot(): string {
  return path.join(app.getPath('userData'), 'plugins', 'packages')
}

function bundledPluginsSourceDir(): string | null {
  try {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'bundled-plugins')
    }
    // Compiled main lives in `out/main`; project root is two levels up.
    return path.join(__dirname, '..', '..', 'resources', 'bundled-plugins')
  } catch {
    return null
  }
}

async function listBundledPluginDirs(root: string): Promise<Array<{ id: string; version: string; dir: string }>> {
  const out: Array<{ id: string; version: string; dir: string }> = []
  let ids: fssync.Dirent[] = []
  try {
    ids = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return out
  }
  for (const idEnt of ids) {
    if (!idEnt.isDirectory()) continue
    const idPath = path.join(root, idEnt.name)
    let versions: fssync.Dirent[] = []
    try {
      versions = await fs.readdir(idPath, { withFileTypes: true })
    } catch {
      continue
    }
    for (const vEnt of versions) {
      if (!vEnt.isDirectory()) continue
      const dir = path.join(idPath, vEnt.name)
      if (!fssync.existsSync(path.join(dir, 'plugin.json'))) continue
      out.push({ id: idEnt.name, version: vEnt.name, dir })
    }
  }
  return out
}

/**
 * Seeds bundled plugins into the user plugin store.
 * - Does not overwrite existing (id,version) in user store.
 */
export async function seedBundledPluginsIfNeeded(): Promise<void> {
  const srcRoot = bundledPluginsSourceDir()
  if (!srcRoot || !fssync.existsSync(srcRoot)) return
  const destRoot = userPluginStoreRoot()
  await fs.mkdir(destRoot, { recursive: true })

  const bundled = await listBundledPluginDirs(srcRoot)
  for (const p of bundled) {
    const dest = path.join(destRoot, p.id, p.version)
    if (fssync.existsSync(path.join(dest, 'plugin.json'))) continue
    await fs.mkdir(path.dirname(dest), { recursive: true })
    await fs.cp(p.dir, dest, { recursive: true })
  }
}

