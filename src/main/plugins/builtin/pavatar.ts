import type { PluginHooks } from '../../../shared/types'
import type { PluginContext, PluginPermission } from '../context'
import { getActivePAvatarPackResolved } from '../../pavatar/pack-store'
import { pavatarMainLog } from '../../pavatar/debug-log'

const PLUGIN_ID = 'com.proactiveai.pavatar' as const

const DEFAULT_ALLOWED: readonly string[] = [
  'idle',
  'happy',
  'angry',
  'confused',
  'sad',
  'surprised',
  'thinking',
  'sleepy',
] as const

async function allowedExpressionIds(): Promise<string[]> {
  const pack = await getActivePAvatarPackResolved()
  const keys = pack?.expressions ? Object.keys(pack.expressions) : []
  if (keys.length > 0) return keys.sort((a, b) => a.localeCompare(b))
  return [...DEFAULT_ALLOWED]
}

function parseAvatarTag(text: string): { cleaned: string; mood?: string } {
  const re = /\[\[\s*AVATAR\s*:\s*([a-zA-Z0-9_-]+)\s*\]\]\s*$/
  const m = text.match(re)
  if (!m) return { cleaned: text }
  const mood = m[1]
  const cleaned = text.replace(re, '').trimEnd()
  return { cleaned, mood }
}

export const pavatarBuiltin: {
  id: typeof PLUGIN_ID
  name: string
  version: string
  permissions: PluginPermission[]
  buildHooks: (ctx: PluginContext) => Partial<PluginHooks>
} = {
  id: PLUGIN_ID,
  name: '2D 虚拟形象',
  version: '0.1.0',
  permissions: ['ui.dispatch'],
  buildHooks: (ctx) => {
    const hooks: Partial<PluginHooks> = {}

    hooks.onSystemPromptBuild = async ({ locale }) => {
      const allowed = await allowedExpressionIds()
      const list = allowed.join(', ')
      if (locale === 'en-US') {
        return [
          '## Avatar expression protocol',
          `- Choose exactly ONE expression id from: ${list}`,
          '- Append one single line at the VERY END of the reply field:',
          '  [[AVATAR:<expression_id>]]',
          '- Do not add anything after the tag line.',
          '- If unsure, use [[AVATAR:idle]].',
        ].join('\n')
      }
      return [
        '## 虚拟形象表情协议',
        `- 你必须从以下表情 id 中选择且只选择 1 个：${list}`,
        '- 并且把它作为“最后一行”追加到 reply 文本末尾，格式如下：',
        '  [[AVATAR:<expression_id>]]',
        '- 标签行之后不要再输出任何内容。',
        '- 不确定就用 [[AVATAR:idle]]。',
      ].join('\n')
    }

    hooks.onMessageReceive = async (reply) => {
      const { cleaned, mood } = parseAvatarTag(reply)
      const allowed = await allowedExpressionIds()
      const willDispatch = !!(mood && allowed.includes(mood))
      pavatarMainLog('pavatar hook onMessageReceive', {
        replyEndsWithTag: !!mood,
        mood: mood ?? null,
        allowed: willDispatch,
        dispatching: willDispatch,
      })
      if (mood && allowed.includes(mood)) {
        ctx.dispatchToRenderer?.({
          v: 1,
          pluginId: PLUGIN_ID,
          type: 'AVATAR_SET_MOOD',
          mood,
          durationMs: 1400,
        })
      }
      return cleaned
    }

    return hooks
  },
}

