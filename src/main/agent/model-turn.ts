import OpenAI from 'openai'
import {
  ChatMessage,
  AIResponse,
  GlobalSettings,
  ConversationSettings,
} from '../../shared/types'
import { DEFAULT_BASE_URL, DEFAULT_MODEL } from '../../shared/config'
import { buildSystemPrompt } from '../../shared/config'
import { normalizeLocale } from '../../shared/locale'
import {
  getFallbackRolePrompt,
  getImportantInfoSystemPrefix,
  modelEmptyResponseMessage,
} from '../../shared/prompt-i18n'
import { pluginRegistry } from '../plugins/registry'
import type { HookRegistry } from './hook-registry'
import { extractReplyDisplayPrefix } from './reply-json-stream'
import type { AgentTraceLogger } from './tracing'

/** 防止模型单次回复过长；可按需在设置中暴露 */
const MAIN_STREAM_MAX_TOKENS = 4096

export type ToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type ToolCallResult = {
  toolCall: ToolCall
  result: { ok: true; result: unknown } | { ok: false; error: string; blocked?: boolean }
}

export class ModelTurn {
  constructor(private hooks: HookRegistry, private traceLogger?: AgentTraceLogger) {}

  async validateConfig(config: GlobalSettings): Promise<boolean> {
    const apiKey = config.apiKey
    const baseURL = config.baseURL || DEFAULT_BASE_URL
    if (!apiKey) throw new Error('API Key is required')
    const client = new OpenAI({ apiKey, baseURL })
    await client.models.list()
    return true
  }

  /**
   * 流式主模型调用；增量回调；结束时解析 JSON 提取 important_info
   */
  async streamMainTurn(
    userMessage: string,
    history: ChatMessage[],
    importantInfo: string[],
    globalSettings: GlobalSettings,
    conversationSettings: ConversationSettings | undefined,
    rolePrompt: string | undefined,
    onDelta: (text: string) => void,
    previousToolResults?: ToolCallResult[]
  ): Promise<AIResponse> {
    const runId = `llm_stream_${Date.now()}`
    await this.traceLogger?.log('llm', 'start', {
      runId,
      name: 'streamMainTurn',
      inputs: { model: globalSettings.model, userMessageLength: userMessage.length },
    })

    try {
      const apiKey = globalSettings.apiKey || ''
      const model = globalSettings.model || DEFAULT_MODEL
      const baseURL = globalSettings.baseURL || DEFAULT_BASE_URL
      const locale = normalizeLocale(globalSettings.locale)
      const finalRolePrompt = rolePrompt || getFallbackRolePrompt(locale)
      let systemPrompt = buildSystemPrompt(finalRolePrompt)

      systemPrompt = await pluginRegistry.runSystemPromptBuild({
        systemPrompt,
        locale,
      })

      await this.hooks.invokeAll('model.beforeCall', {
        userMessage,
        systemPromptLength: systemPrompt.length,
      })

      const client = new OpenAI({ apiKey, baseURL })
      const recentMessagesCount = conversationSettings?.recentMessagesCount || 3
      const messages = this.buildMessages(
        systemPrompt,
        history,
        importantInfo,
        recentMessagesCount,
        locale
      )

      if (previousToolResults && previousToolResults.length > 0) {
        messages.push({
          role: 'assistant',
          content: null,
          tool_calls: previousToolResults.map((tcr) => ({
            id: tcr.toolCall.id,
            type: tcr.toolCall.type,
            function: {
              name: tcr.toolCall.function.name,
              arguments: tcr.toolCall.function.arguments,
            },
          })),
        })
        for (const tcr of previousToolResults) {
          messages.push({
            role: 'tool',
            tool_call_id: tcr.toolCall.id,
            content: tcr.result.ok
              ? JSON.stringify(tcr.result.result)
              : JSON.stringify({ error: tcr.result.error, blocked: tcr.result.blocked }),
          })
        }
      }

      messages.push({ role: 'user', content: userMessage })

      const stream = await client.chat.completions.create({
        model,
        messages,
        stream: true,
        max_tokens: MAIN_STREAM_MAX_TOKENS,
      })

      let acc = ''
      let lastReplyPrefix = ''
      for await (const chunk of stream) {
        const d = chunk.choices[0]?.delta?.content
        if (typeof d === 'string' && d.length > 0) {
          acc += d
          const prefix = extractReplyDisplayPrefix(acc)
          if (prefix.length > lastReplyPrefix.length) {
            onDelta(prefix.slice(lastReplyPrefix.length))
            lastReplyPrefix = prefix
          }
        }
      }

      const parsed = this.parseModelContentToResponse(acc.trim(), locale)
      await this.hooks.invokeAll('model.afterOutput', {
        reply: parsed.reply,
        importantInfo: parsed.important_info,
      })

      await this.traceLogger?.log('llm', 'end', {
        runId,
        name: 'streamMainTurn',
        outputs: { replyLength: parsed.reply.length, importantInfoCount: parsed.important_info.length },
      })

      return parsed
    } catch (e) {
      await this.traceLogger?.log('llm', 'error', {
        runId,
        name: 'streamMainTurn',
        error: e instanceof Error ? e.message : String(e),
      })
      throw e
    }
  }

  private parseModelContentToResponse(
    resultText: string,
    locale: ReturnType<typeof normalizeLocale>
  ): AIResponse {
    const fallback = (): AIResponse => ({
      reply: resultText,
      important_info: [],
    })

    const tryParseJson = (text: string): unknown => {
      try {
        return JSON.parse(text)
      } catch {
        /* ignore */
      }
      let t = text.trim()
      if (t.startsWith('```')) {
        const firstLineEnd = t.indexOf('\n')
        if (firstLineEnd !== -1) t = t.substring(firstLineEnd + 1)
      }
      if (t.endsWith('```')) t = t.substring(0, t.length - 3)
      t = t.trim()
      const start = t.indexOf('{')
      const end = t.lastIndexOf('}')
      if (start === -1 || end === -1 || end <= start) return null
      try {
        return JSON.parse(t.slice(start, end + 1))
      } catch {
        return null
      }
    }

    if (!resultText) {
      return {
        reply: modelEmptyResponseMessage(locale),
        important_info: [],
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

    const important_info = Array.isArray(o.important_info)
      ? o.important_info.filter((x): x is string => typeof x === 'string')
      : []

    return { reply, important_info }
  }

  private buildMessages(
    systemPrompt: string,
    history: ChatMessage[],
    importantInfo: string[],
    recentMessagesCount: number,
    locale: ReturnType<typeof normalizeLocale>
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
      messages.push({ role: msg.role, content: msg.content })
    }
    return messages
  }

  /** 子智能体：系统提示由主智能体下发；输出纯文本流（不做 JSON 解析） */
  async streamSubagentPlain(
    subagentSystemPrompt: string,
    userTask: string,
    globalSettings: GlobalSettings,
    onDelta: (text: string) => void
  ): Promise<{ reply: string }> {
    const apiKey = globalSettings.apiKey || ''
    const model = globalSettings.model || DEFAULT_MODEL
    const baseURL = globalSettings.baseURL || DEFAULT_BASE_URL
    const client = new OpenAI({ apiKey, baseURL })

    await this.hooks.invokeAll('subagent.beforeStart', {
      systemChars: subagentSystemPrompt.length,
      taskChars: userTask.length,
    })

    const stream = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: subagentSystemPrompt },
        { role: 'user', content: userTask },
      ],
      stream: true,
      max_tokens: MAIN_STREAM_MAX_TOKENS,
    })

    let acc = ''
    for await (const chunk of stream) {
      const d = chunk.choices[0]?.delta?.content
      if (typeof d === 'string' && d.length > 0) {
        acc += d
        onDelta(d)
        await this.hooks.invokeAll('subagent.streamChunk', { length: d.length })
      }
    }

    await this.hooks.invokeAll('subagent.afterFinished', { replyLength: acc.length })
    return { reply: acc }
  }
}
