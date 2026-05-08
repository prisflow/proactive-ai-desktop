import type { PluginManifestV1 } from '../../shared/types'

const SCHEMA = 1

export class PluginManifestError extends Error {
  constructor(
    message: string,
    public readonly pluginDir?: string
  ) {
    super(message)
    this.name = 'PluginManifestError'
  }
}

export function parsePluginManifestJson(
  raw: string,
  pluginDir?: string
): PluginManifestV1 {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    throw new PluginManifestError('plugin.json is not valid JSON', pluginDir)
  }
  if (!data || typeof data !== 'object') {
    throw new PluginManifestError('plugin.json must be an object', pluginDir)
  }
  const m = data as Record<string, unknown>
  const schema = m.schema_version
  if (schema !== SCHEMA) {
    throw new PluginManifestError(
      `unsupported schema_version: ${String(schema)} (expected ${SCHEMA})`,
      pluginDir
    )
  }
  if (typeof m.id !== 'string' || !m.id.trim()) {
    throw new PluginManifestError('missing id', pluginDir)
  }
  if (typeof m.version !== 'string' || !m.version.trim()) {
    throw new PluginManifestError('missing version', pluginDir)
  }
  if (typeof m.name !== 'string' || !m.name.trim()) {
    throw new PluginManifestError('missing name', pluginDir)
  }
  const main = m.main === undefined || m.main === null ? '' : String(m.main)
  const minApp =
    typeof m.min_app_version === 'string' && m.min_app_version.trim()
      ? m.min_app_version.trim()
      : '0.0.0'

  const permissions = Array.isArray(m.permissions)
    ? m.permissions.filter((x): x is string => typeof x === 'string')
    : []
  const hooks = Array.isArray(m.hooks)
    ? m.hooks.filter((x): x is string => typeof x === 'string')
    : []
  const tools = Array.isArray(m.tools)
    ? m.tools.filter((x): x is string => typeof x === 'string')
    : []

  return {
    schema_version: SCHEMA,
    id: m.id.trim(),
    version: m.version.trim(),
    name: m.name.trim(),
    slug: typeof m.slug === 'string' ? m.slug.trim() : undefined,
    description: typeof m.description === 'string' ? m.description : undefined,
    author: typeof m.author === 'string' ? m.author : undefined,
    main,
    min_app_version: minApp,
    permissions,
    hooks,
    tools,
    ui: (m.ui && typeof m.ui === 'object' ? m.ui : undefined) as PluginManifestV1['ui'],
    configSchema:
      m.configSchema && typeof m.configSchema === 'object'
        ? (m.configSchema as Record<string, unknown>)
        : undefined,
  }
}

/** Semver-ish compare: a >= b */
export function appVersionMeetsMin(appVersion: string, minVersion: string): boolean {
  const pa = appVersion.split('.').map((x) => parseInt(x, 10) || 0)
  const pb = minVersion.split('.').map((x) => parseInt(x, 10) || 0)
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const a = pa[i] ?? 0
    const b = pb[i] ?? 0
    if (a > b) return true
    if (a < b) return false
  }
  return true
}
