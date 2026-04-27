import OpenAI from 'openai'
import {
  ChatMessage,
  AIResponse,
  GlobalSettings,
  ConversationSettings,
  Trigger,
} from '../shared/types'
import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_MAX_TRIGGERS,
  DEFAULT_PROACTIVE_INTERVAL,
  buildSystemPrompt,
} from '../shared/config'
import { normalizeLocale } from '../shared/locale'
import {
  getFallbackRolePrompt,
  getImportantInfoSystemPrefix,
  modelEmptyResponseMessage,
} from '../shared/prompt-i18n'
import { pluginRegistry } from './plugins/registry'
import { pavatarMainLog } from './pavatar/debug-log'

export class ChatCore {
  /**
   * 发送消息并获取 AI 响应
   */
  async sendMessage(
    userMessage: string,
    history: ChatMessage[],
    importantInfo: string[],
    globalSettings: GlobalSettings,
    conversationSettings?: ConversationSettings,
    rolePrompt?: string
  ): Promise<AIResponse> {
    const apiKey = globalSettings.apiKey || ''
    const model = globalSettings.model || DEFAULT_MODEL
    const baseURL = globalSettings.baseURL || DEFAULT_BASE_URL

    const maxTriggers =
      conversationSettings?.maxTriggers ||
      globalSettings.defaultMaxTriggers ||
      DEFAULT_MAX_TRIGGERS
    const proactiveInterval =
      conversationSettings?.proactiveInterval ||
      globalSettings.defaultProactiveInterval ||
      DEFAULT_PROACTIVE_INTERVAL

    const locale = normalizeLocale(globalSettings.locale)
    const finalRolePrompt = rolePrompt || getFallbackRolePrompt(locale)
    let systemPrompt = buildSystemPrompt(finalRolePrompt, maxTriggers, locale)

    // 插件 system prompt hook（追加文本）
    const lenBeforePlugins = systemPrompt.length
    systemPrompt = await pluginRegistry.runSystemPromptBuild({
      systemPrompt,
      locale,
    })
    pavatarMainLog('ChatCore.sendMessage after runSystemPromptBuild', {
      systemPromptCharsBefore: lenBeforePlugins,
      systemPromptCharsAfter: systemPrompt.length,
      deltaChars: systemPrompt.length - lenBeforePlugins,
      hasPavatarInstructions:
        systemPrompt.includes('## 虚拟形象表情协议') ||
        systemPrompt.includes('## Avatar expression protocol'),
    })

    const settings = {
      recentMessagesCount: conversationSettings?.recentMessagesCount || 3,
      proactiveInterval,
    }

    const response = await this.callAI(
      userMessage,
      history,
      importantInfo,
      apiKey,
      model,
      baseURL,
      systemPrompt,
      settings,
      locale
    )

    return response
  }

  /**
   * 验证 API 配置是否有效
   */
  async validateConfig(config: GlobalSettings): Promise<boolean> {
    const apiKey = config.apiKey
    const baseURL = config.baseURL || DEFAULT_BASE_URL

    if (!apiKey) {
      throw new Error('API Key is required')
    }

    try {
      const client = new OpenAI({
        apiKey,
        baseURL,
      })

      await client.models.list()
      return true
    } catch (error) {
      console.error('Error validating config:', error)
      throw error
    }
  }

  /**
   * 调用 AI API
   */
  private async callAI(
    userMessage: string,
    history: ChatMessage[],
    importantInfo: string[],
    apiKey: string,
    modelId: string,
    baseURL: string,
    systemPrompt: string,
    settings: { recentMessagesCount?: number; proactiveInterval?: number },
    locale: ReturnType<typeof normalizeLocale>
  ): Promise<AIResponse> {
    const client = new OpenAI({
      apiKey,
      baseURL,
    })

    const recentMessagesCount = settings.recentMessagesCount || 3

    const messages = this.buildMessages(
      systemPrompt,
      history,
      importantInfo,
      recentMessagesCount,
      locale
    )
    messages.push({ role: 'user', content: userMessage })

    const response = await client.chat.completions.create({
      model: modelId,
      messages,
    })

    const content = response?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || content.trim().length === 0) {
      // 某些代理/网关在异常情况下可能返回 choices=null 或空数组
      return {
        reply: modelEmptyResponseMessage(locale),
        triggers: [],
        next_api_call_seconds: settings.proactiveInterval || DEFAULT_PROACTIVE_INTERVAL,
        important_info: [],
      }
    }

    let resultText = content || '{}'

    resultText = resultText.trim()
    if (resultText.startsWith('```')) {
      const firstLineEnd = resultText.indexOf('\n')
      if (firstLineEnd !== -1) {
        resultText = resultText.substring(firstLineEnd + 1)
      }
    }
    if (resultText.endsWith('```')) {
      resultText = resultText.substring(0, resultText.length - 3)
    }
    resultText = resultText.trim()

    return this.parseModelContentToResponse(
      resultText,
      settings.proactiveInterval || DEFAULT_PROACTIVE_INTERVAL
    )
  }

  /**
   * 将模型输出解析为 AIResponse。模型可能返回纯自然语言、带前缀的 JSON、或畸形结构；
   * 任意解析失败时降级为整段原文作为 reply，不向调用方抛 JSON异常。
   */
  private parseModelContentToResponse(
    resultText: string,
    fallbackInterval: number
  ): AIResponse {
    const fallback = (): AIResponse => ({
      reply: resultText,
      triggers: [],
      next_api_call_seconds: fallbackInterval,
      important_info: [],
    })

    const tryParseJson = (text: string): unknown => {
      try {
        return JSON.parse(text)
      } catch {
        /* ignore */
      }
      const start = text.indexOf('{')
      const end = text.lastIndexOf('}')
      if (start === -1 || end === -1 || end <= start) return null
      try {
        return JSON.parse(text.slice(start, end + 1))
      } catch {
        return null
      }
    }

    const raw = tryParseJson(resultText)
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      return fallback()
    }

    const o = raw as Record<string, unknown>

    let reply = ''
    if (typeof o.reply === 'string') {
      reply = o.reply
    } else if (o.reply != null) {
      reply = String(o.reply)
    }

    const triggers: Trigger[] = []
    if (Array.isArray(o.triggers)) {
      for (const t of o.triggers) {
        if (
          t !== null &&
          typeof t === 'object' &&
          !Array.isArray(t) &&
          typeof (t as Trigger).seconds === 'number' &&
          typeof (t as Trigger).message === 'string'
        ) {
          triggers.push({
            seconds: (t as Trigger).seconds,
            message: (t as Trigger).message,
          })
        }
      }
    }

    const important_info = Array.isArray(o.important_info)
      ? o.important_info.filter((x): x is string => typeof x === 'string')
      : []

    const nextRaw = o.next_api_call_seconds
    const next_api_call_seconds =
      typeof nextRaw === 'number' &&
      Number.isFinite(nextRaw) &&
      nextRaw > 0
        ? Math.floor(nextRaw)
        : fallbackInterval

    return {
      reply,
      triggers,
      next_api_call_seconds,
      important_info,
    }
  }

  /**
   * 构建消息列表
   */
  private buildMessages(
    systemPrompt: string,
    history: ChatMessage[],
    importantInfo: string[],
    recentMessagesCount: number = 3,
    locale: ReturnType<typeof normalizeLocale> = 'zh-CN'
  ) {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = []

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt })
    }

    if (importantInfo.length > 0) {
      messages.push({
        role: 'system',
        content: `${getImportantInfoSystemPrefix(locale)}${importantInfo.join('; ')}`,
      })
    }

    const recentCount = recentMessagesCount || 3
    for (const msg of history.slice(-recentCount)) {
      messages.push({
        role: msg.role,
        content: msg.content,
      })
    }

    return messages
  }
}
