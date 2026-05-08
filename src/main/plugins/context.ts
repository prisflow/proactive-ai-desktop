import type {
  AssetPackResolved,
  ChatMessage,
  GlobalSettings,
  ActiveAssetPackSnapshot,
} from '../../shared/types'
import type { HookHandler } from '../agent/hook-registry'

export type PluginPermission =
  | 'messages.read'
  | 'fs.writesDownloads'
  | 'clipboard.write'
  | 'config.read'
  | 'ui.dispatch'
  /** 读取当前激活资源包元数据（插件私域） */
  | 'assets.readActive'
  /** 访问智能体总线与全局钩子 */
  | 'agent.access'

export interface PluginContext {
  getMessages?: (conversationId: string) => ChatMessage[]
  writeToDownloads?: (filename: string, content: string) => Promise<void>
  clipboardWrite?: (text: string) => Promise<void>
  getPublicSettings?: () => Omit<GlobalSettings, 'apiKey'> & { apiKey?: undefined }
  dispatchToRenderer?: (message: import('../../shared/types').PluginDispatchMessage) => void
  assets?: {
    getActive: () => Promise<ActiveAssetPackSnapshot | null>
  }
  /** 智能体总线与全局钩子（信封校验失败时 enqueue 返回 false；需要 agent.access 权限） */
  agent?: {
    enqueueEvent: (envelope: unknown) => Promise<boolean>
    registerHook: (mountPoint: string, handler: HookHandler) => () => void
  }
}

export interface PluginContextDeps {
  getMessages: (conversationId: string) => ChatMessage[]
  writeToDownloads: (filename: string, content: string) => Promise<void>
  clipboardWrite: (text: string) => Promise<void>
  getPublicSettings: () => Omit<GlobalSettings, 'apiKey'> & { apiKey?: undefined }
  dispatchToRenderer: (message: import('../../shared/types').PluginDispatchMessage) => void
  getActiveAssetPackResolved: (pluginId: string) => Promise<AssetPackResolved | null>
  getAgentBridge?: () => {
    enqueueEvent: (envelope: unknown) => Promise<boolean>
    registerHook: (mountPoint: string, handler: HookHandler) => () => void
  } | null
}

export function createPluginContext(
  pluginId: string,
  permissions: PluginPermission[],
  deps: PluginContextDeps
): PluginContext {
  const ctx: PluginContext = {}
  const set = new Set(permissions)
  if (set.has('messages.read')) {
    ctx.getMessages = deps.getMessages
  }
  if (set.has('fs.writesDownloads')) {
    ctx.writeToDownloads = deps.writeToDownloads
  }
  if (set.has('clipboard.write')) {
    ctx.clipboardWrite = deps.clipboardWrite
  }
  if (set.has('config.read')) {
    ctx.getPublicSettings = deps.getPublicSettings
  }
  if (set.has('ui.dispatch')) {
    ctx.dispatchToRenderer = deps.dispatchToRenderer
  }
  if (set.has('assets.readActive')) {
    ctx.assets = {
      getActive: async () => {
        const p = await deps.getActiveAssetPackResolved(pluginId)
        if (!p) return null
        return {
          packId: p.packId,
          version: p.version,
          expressions: p.expressions,
        }
      },
    }
  }
  if (set.has('agent.access')) {
    const bridge = deps.getAgentBridge?.() ?? null
    if (bridge) {
      ctx.agent = {
        enqueueEvent: (envelope) => bridge.enqueueEvent(envelope),
        registerHook: (mountPoint, handler) => bridge.registerHook(mountPoint, handler),
      }
    }
  }
  return ctx
}
