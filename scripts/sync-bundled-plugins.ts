/**
 * 构建/开发前：把「随包插件」同步到 resources/bundled-plugins/
 *
 * 优先级：
 * 1. BUILTIN_PLUGIN_GITHUB=owner/repo
 * 2. BUILTIN_PLUGIN_REPO=本地路径（离线开发）
 * 3. BUILTIN_PLUGIN_GITHUB_FALLBACK=owner/repo
 * 4. 内置默认源 BUILTIN_PLUGIN_GITHUB_DEFAULT（可选覆盖），否则 tobegold574/proactive-ai-pavatar-plugin
 *
 * ref 为 v 开头的 tag（默认 v0.1.0）时：从 GitHub **Releases** 下载 zip 资产（非 codeload 源码包）。
 * 可设 BUILTIN_PLUGIN_RELEASE_ASSET 覆盖资产文件名。
 * ref 为分支名（如 main）时：走 codeload 分支源码 zip。
 *
 * 不再扫描桌面仓库同级的本地克隆目录（统一走 GitHub 或显式本地路径）。
 */
import fs from 'fs/promises'
import fssync from 'fs'
import path from 'path'
import {
  installPluginFromGithub,
  installPluginFromUrl,
  githubReleaseAssetUrl,
  parseGithubPluginSpec,
} from '../src/main/plugins/install-from-github'

const root = process.cwd()
const bundledParent = path.join(root, 'resources', 'bundled-plugins')

/** 发布在 GitHub 的默认示例插件（可被 BUILTIN_PLUGIN_GITHUB_DEFAULT 覆盖） */
const BUILTIN_PLUGIN_REPO_DEFAULT = 'tobegold574/proactive-ai-pavatar-plugin'

/** 未设置 BUILTIN_PLUGIN_REF 时默认拉取的版本（对应 Releases 上的 tag） */
const BUILTIN_PLUGIN_REF_DEFAULT = 'v0.1.0'

/** tag 安装时 Releases 资产文件名（可被 BUILTIN_PLUGIN_RELEASE_ASSET 覆盖） */
function releaseAssetZipName(ref: string): string {
  const fromEnv = process.env.BUILTIN_PLUGIN_RELEASE_ASSET?.trim()
  if (fromEnv) return fromEnv
  const ver = ref.trim().replace(/^v/i, '')
  return `com.proactiveai.pavatar-${ver}.zip`
}

/** 复制插件包到内置目录，跳过 node_modules / .git（与 GitHub zip 内容一致） */
async function copyLocalPluginRepo(repoRoot: string): Promise<void> {
  const manifestPath = path.join(repoRoot, 'plugin.json')
  const raw = await fs.readFile(manifestPath, 'utf8')
  const manifest = JSON.parse(raw) as { id: string; version: string }
  const id = String(manifest.id || '').trim()
  const version = String(manifest.version || '').trim()
  if (!id || !version) {
    throw new Error('local plugin.json missing id/version')
  }
  const dest = path.join(bundledParent, id, version)
  await fs.mkdir(path.dirname(dest), { recursive: true })
  await fs.rm(dest, { recursive: true, force: true })
  await fs.mkdir(dest, { recursive: true })
  const skip = new Set(['node_modules', '.git'])
  const top = await fs.readdir(repoRoot, { withFileTypes: true })
  for (const e of top) {
    if (skip.has(e.name)) continue
    const from = path.join(repoRoot, e.name)
    const to = path.join(dest, e.name)
    await fs.cp(from, to, { recursive: true })
  }
  console.log('[sync-bundled-plugins] local', repoRoot, '->', dest)
}

async function syncFromGithub(spec: string, ref: string): Promise<void> {
  const p = parseGithubPluginSpec(spec)
  if (!p) {
    console.warn('[sync-bundled-plugins] invalid github spec, skip:', spec)
    return
  }
  const isTag = /^v\d/i.test(ref.trim())
  const r = isTag
    ? await installPluginFromUrl({
        url: githubReleaseAssetUrl(p.owner, p.repo, ref.trim(), releaseAssetZipName(ref)),
        pluginsParentDir: bundledParent,
      })
    : await installPluginFromGithub({
        owner: p.owner,
        repo: p.repo,
        ref,
        pluginsParentDir: bundledParent,
      })
  if (!r.ok) {
    console.warn('[sync-bundled-plugins] github install failed, skip:', r.error)
    return
  }
  console.log('[sync-bundled-plugins] github', spec, ref, '->', r.destDir)
}

async function main(): Promise<void> {
  const gh = process.env.BUILTIN_PLUGIN_GITHUB?.trim()
  const ghFallback = process.env.BUILTIN_PLUGIN_GITHUB_FALLBACK?.trim()
  const ref = process.env.BUILTIN_PLUGIN_REF?.trim() || BUILTIN_PLUGIN_REF_DEFAULT
  const local = process.env.BUILTIN_PLUGIN_REPO?.trim()
  const defaultRepo =
    process.env.BUILTIN_PLUGIN_GITHUB_DEFAULT?.trim() || BUILTIN_PLUGIN_REPO_DEFAULT

  await fs.mkdir(bundledParent, { recursive: true })

  if (gh) {
    await syncFromGithub(gh, ref)
    return
  }

  if (local && fssync.existsSync(path.join(local, 'plugin.json'))) {
    await copyLocalPluginRepo(local)
    return
  }

  if (ghFallback) {
    console.log('[sync-bundled-plugins] using BUILTIN_PLUGIN_GITHUB_FALLBACK')
    await syncFromGithub(ghFallback, ref)
    return
  }

  console.log('[sync-bundled-plugins] using default GitHub repo:', defaultRepo)
  await syncFromGithub(defaultRepo, ref)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
