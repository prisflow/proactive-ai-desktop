import AdmZip from 'adm-zip'
import fs from 'fs/promises'
import fssync from 'fs'
import path from 'path'
import os from 'os'

/** 解析 `owner/repo` 或 `https://github.com/owner/repo` */
export function parseGithubPluginSpec(input: string): { owner: string; repo: string } | null {
  const s = input.trim().replace(/\/+$/, '')
  if (!s) return null
  const full = s.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$)/i)
  if (full) {
    const repo = full[2].replace(/\.git$/i, '')
    if (!isSafeGithubSegment(full[1]) || !isSafeGithubSegment(repo)) return null
    return { owner: full[1], repo }
  }
  const short = s.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/)
  if (short && isSafeGithubSegment(short[1]) && isSafeGithubSegment(short[2])) {
    return { owner: short[1], repo: short[2] }
  }
  return null
}

function isSafeGithubSegment(s: string): boolean {
  return s.length > 0 && s.length <= 200 && !s.includes('..') && s !== '.' && s !== '..'
}

/**
 * GitHub 源码 zip（codeload）。
 * @param ref 分支名（如 main）、tag（如 v0.1.0）、或已带前缀的 `refs/heads/...` / `refs/tags/...`
 */
export function githubArchiveZipUrl(owner: string, repo: string, ref: string): string {
  const r = ref.trim()
  if (r.startsWith('refs/')) {
    return `https://codeload.github.com/${owner}/${repo}/zip/${r}`
  }
  return `https://codeload.github.com/${owner}/${repo}/zip/refs/heads/${encodeURIComponent(r)}`
}

export function githubArchiveZipUrlForTag(owner: string, repo: string, tag: string): string {
  return `https://codeload.github.com/${owner}/${repo}/zip/refs/tags/${encodeURIComponent(tag.trim())}`
}

async function downloadToBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} ${url}`)
  }
  return Buffer.from(await res.arrayBuffer())
}

export function githubReleaseAssetUrl(owner: string, repo: string, tag: string, assetName: string): string {
  return `https://github.com/${owner}/${repo}/releases/download/${encodeURIComponent(tag.trim())}/${encodeURIComponent(
    assetName.trim()
  )}`
}

/** 在解压后的根目录下查找含 plugin.json 的插件根（兼容 GitHub zip 顶层单目录） */
export function findPluginRootInExtractedDir(rootDir: string): string | null {
  const manifestAtRoot = path.join(rootDir, 'plugin.json')
  if (fssync.existsSync(manifestAtRoot)) return rootDir
  let entries: fssync.Dirent[]
  try {
    entries = fssync.readdirSync(rootDir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const sub = path.join(rootDir, e.name)
    if (fssync.existsSync(path.join(sub, 'plugin.json'))) return sub
  }
  return null
}

export type InstallPluginResult =
  | { ok: true; pluginId: string; version: string; destDir: string }
  | { ok: false; error: string }

/**
 * 从 GitHub 下载 zip 并安装到 `pluginsParentDir/<id>/<version>/`（与 discover 约定一致）。
 */
export async function installPluginFromGithub(opts: {
  owner: string
  repo: string
  /** 默认 main；若以 v 开头且含数字，按 tag 拉取 */
  ref?: string
  pluginsParentDir: string
}): Promise<InstallPluginResult> {
  const ref = (opts.ref ?? 'main').trim()
  let url: string
  if (/^v\d/i.test(ref)) {
    url = githubArchiveZipUrlForTag(opts.owner, opts.repo, ref)
  } else {
    url = githubArchiveZipUrl(opts.owner, opts.repo, ref)
  }

  let zipBuf: Buffer
  try {
    zipBuf = await downloadToBuffer(url)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: `download_failed: ${msg}` }
  }

  return installPluginFromZipBuffer(zipBuf, opts.pluginsParentDir)
}

/** 从任意可下载的 zip URL 安装（推荐：GitHub Releases 资产） */
export async function installPluginFromUrl(opts: {
  url: string
  pluginsParentDir: string
}): Promise<InstallPluginResult> {
  let zipBuf: Buffer
  try {
    zipBuf = await downloadToBuffer(opts.url)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: `download_failed: ${msg}` }
  }
  return installPluginFromZipBuffer(zipBuf, opts.pluginsParentDir)
}

export async function installPluginFromZipBuffer(
  zipBuffer: Buffer,
  pluginsParentDir: string
): Promise<InstallPluginResult> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'pa-plugin-'))
  try {
    const zip = new AdmZip(zipBuffer)
    zip.extractAllTo(tmp, true)
    const pluginRoot = findPluginRootInExtractedDir(tmp)
    if (!pluginRoot) {
      return { ok: false, error: 'archive_missing_plugin_json' }
    }
    let manifest: { id?: string; version?: string }
    try {
      const raw = await fs.readFile(path.join(pluginRoot, 'plugin.json'), 'utf8')
      manifest = JSON.parse(raw) as { id?: string; version?: string }
    } catch {
      return { ok: false, error: 'invalid_plugin_json' }
    }
    if (typeof manifest.id !== 'string' || typeof manifest.version !== 'string') {
      return { ok: false, error: 'manifest_missing_id_or_version' }
    }
    const id = manifest.id.trim()
    const version = manifest.version.trim()
    if (!id || !version) {
      return { ok: false, error: 'manifest_empty_id_or_version' }
    }

    const dest = path.join(pluginsParentDir, id, version)
    await fs.mkdir(path.dirname(dest), { recursive: true })
    await fs.rm(dest, { recursive: true, force: true })
    await fs.cp(pluginRoot, dest, { recursive: true })

    return { ok: true, pluginId: id, version, destDir: dest }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
  }
}
