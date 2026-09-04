/**
 * 用户消息发送入口（chat:send IPC 与 Web 通道共用）。
 * 从配置读取 LLM 参数 → 获取/创建会话 Runtime → 执行 agentLoop（流式推送经 transport）。
 */
import { globalConfigStore } from '../../services/store'
import { runtimeManager } from './runtime-manager'
import { DEFAULT_MODEL, DEFAULT_BASE_URL } from '../../../shared/constants'
import type { LlmConfig } from '../llm'
import type { MessageRecord } from '../../services/store/database'

export async function sendMessage(conversationId: string, text: string): Promise<MessageRecord> {
  const config = await globalConfigStore.get()
  const llmConfig: LlmConfig = {
    apiKey: config.apiKey ?? '',
    model: config.model ?? DEFAULT_MODEL,
    baseURL: config.baseURL ?? DEFAULT_BASE_URL,
  }
  const rt = runtimeManager.getOrCreate(conversationId, llmConfig)
  return rt.run(text)
}