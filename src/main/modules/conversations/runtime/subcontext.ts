/**
 * 子上下文切换管理器（Runtime 拆分子模块）。
 * enter/exit 由 host_enter/exit_subcontext 工具成功路径驱动（ToolRunner 调用），
 * 操作宿主的历史 / 挂起区 / 活跃上下文。单层语义：同时只允许一个子上下文。
 */
import { systemNote, type LlmMessage, type LlmProvider } from '../../llm'
import { logService, uniqueRunId } from '../../../services/logger'
import type { RuntimeHost, PendingDbRecord } from './host'

/** 退出子上下文时的总结注入提示词（移交视角：注入主上下文，需明确退出关系，防主上下文误以为仍在子上下文）。 */
const CONTEXT_SUMMARY_SYSTEM =
  '你是对话总结器。子上下文即将退出，对话即将切回主上下文。' +
  '请把子上下文期间的对话总结为一份「移交报告」，注入主上下文供后续参考。' +
  '要求：开头注明"已退出子上下文，回到主上下文"，让主上下文明确当前不在子上下文中；' +
  '以旁观视角陈述，不要以子上下文内的角色口吻继续对话，也不要输出"继续游戏"之类的进行时指示；' +
  '保留：这段对话做了什么、关键状态变化、玩家的目标与未竟事项；' +
  '只归纳事实，不输出评论；输出纯文本，200字以内。'

export class SubcontextManager {
  constructor(private host: RuntimeHost, private llm: LlmProvider) {}

  /**
   * 进入子上下文（host_enter_subcontext 成功路径）：
   *  1. 重置挂起区，创建子上下文历史
   *  2. 切换 activeContextId
   *  3. 立即以占位 tool 消息应答（协议闭合：OpenAI 要求 tool_calls 后紧跟 tool 应答，
   *     且中间不能插入其他消息——不能"挂起"到退出时再补）
   *  占位消息归属 main（发起 enter 的上下文）：enter 的 assistant(tool_calls) 落库在 main，
   *  占位与之配对；子上下文历史从后续消息开始，不出现孤儿 tool 消息。
   *
   *  reason（模型调用时传入的玩家进入意图）作为子上下文历史首条 user 消息——
   *  子上下文首轮请求 history 非空，模型知道玩家想干什么，不会因"无工具可调"直接收轮。
   */
  async enter(
    tc: { id: string; name: string; args: string },
    contextId: string,
    reason: string,
    llmRunId: string,
    pendingDb: PendingDbRecord[],
  ): Promise<void> {
    // 已在该子上下文或已有子上下文活跃：单层语义，拒绝
    if (this.host.activeContextId !== 'main') {
      const msg = `已在子上下文 ${this.host.activeContextId} 中，需先 host_exit_subcontext 退出`
      logService.log('warn', undefined, {
        runId: uniqueRunId('runtime'),
        parentRunId: llmRunId,
        name: 'context.enter-rejected',
        message: msg,
      })
      this.host.pushHistory(this.host.activeContextId, { role: 'tool', tool_call_id: tc.id, content: `[错误] ${msg}` })
      return
    }

    this.host.histories.set(contextId, reason.trim() ? [{ role: 'user', content: reason.trim() }] : [])
    this.host.activeContextId = contextId

    logService.log('info', undefined, {
      runId: uniqueRunId('runtime'),
      parentRunId: llmRunId,
      name: 'context.switch',
      message: `active context → ${contextId}, reason: ${(reason || '(empty)').slice(0, 60)}`,
    })

    // 占位 tool 应答（协议闭合），归属 main：与 enter 的 assistant(tool_calls)（落库 main）配对；
    // 收集待落库（agentLoop 统一落库，顺序 assistant→tool）
    const placeholder = JSON.stringify({ entered: true, contextId })
    this.host.pushHistory('main', { role: 'tool', tool_call_id: tc.id, content: placeholder })
    pendingDb.push({
      role: 'context',
      content: placeholder,
      contextId: 'main',
      extraData: { kind: 'tool-result', toolName: tc.name, toolCallId: tc.id },
    })
    // 实时推送切换标签（前端不经过 IPC 全量拉取）
    this.host.pushContextSwitch(contextId)
  }

  /**
   * 退出子上下文（host_exit_subcontext 成功路径）：
   *  1. 子上下文期间对话 LLM 总结
   *  2. 总结作为新消息注入主上下文历史（role:user，天然触发尾部裁剪兜底，协议安全）
   *  3. 折叠子上下文历史，回到 main
   */
  async exit(
    tc: { id: string; name: string; args: string },
    llmRunId: string,
    pendingDb: PendingDbRecord[],
  ): Promise<void> {
    const subCtxId = this.host.activeContextId
    // 占位 tool 应答（协议闭合，与 enter 对称），归属子上下文：exit 的 assistant(tool_calls) 落库在子上下文；
    // 收集待落库（agentLoop 统一落库，顺序 assistant→tool）
    const placeholder = JSON.stringify({ exited: true })
    this.host.pushHistory(this.host.activeContextId, { role: 'tool', tool_call_id: tc.id, content: placeholder })
    pendingDb.push({
      role: 'context',
      content: placeholder,
      contextId: subCtxId,
      extraData: { kind: 'tool-result', toolName: tc.name, toolCallId: tc.id },
    })

    // 子上下文期间对话总结（LLM 失败降级为最后一条 assistant 文本）。
    // 素材 = 子上下文历史（而非镜像）：有压缩兜底（compactIfNeeded 作用于活跃上下文）+
    // DB 持久化恢复（重启后 histories 完整），总结素材天然有界且跨重启不丢。
    let summary: string
    const subHistory = this.host.histories.get(subCtxId) ?? []
    try {
      summary = await this.summarize(subHistory)
    } catch {
      summary = subHistory.length
        ? (subHistory[subHistory.length - 1].content || '[子上下文期间无新内容]')
        : '[子上下文期间无新内容]'
    }
    logService.log('info', undefined, {
      runId: uniqueRunId('runtime'),
      parentRunId: llmRunId,
      name: 'context.exit-summary',
      message: `subcontext ${subCtxId} → main, summary: ${summary.slice(0, 120)}`,
    })

    // 注入主上下文历史（systemNote 包装的 user 消息：标明系统来源，非玩家发言）
    this.host.pushHistory('main', systemNote('[context-switch: 你已回到主上下文]'))
    this.host.pushHistory('main', systemNote(`[子上下文总结]\n${summary}`))
    pendingDb.push({
      role: 'context',
      content: '[context-switch: 你已回到主上下文]',
      contextId: 'main',
      extraData: { kind: 'event-status', toolName: tc.name },
    })
    pendingDb.push({
      role: 'context',
      content: summary,
      contextId: 'main',
      extraData: { kind: 'event-status', toolName: tc.name },
    })

    // 折叠子上下文历史
    this.host.histories.delete(subCtxId)
    this.host.activeContextId = 'main'
    logService.log('info', undefined, {
      runId: uniqueRunId('runtime'),
      parentRunId: llmRunId,
      name: 'context.switch',
      message: `active context → main`,
    })
    // 实时推送切换标签（回到主上下文）
    this.host.pushContextSwitch()
  }

  /** 把子上下文期间消息总结为紧凑摘要（供主上下文继续对话参考）。 */
  private async summarize(messages: LlmMessage[]): Promise<string> {
    const text = messages.map((m) => `[${m.role}] ${m.content || ''}`).join('\n')
    if (!text.trim()) return '[子上下文期间无新内容]'
    const res = await this.llm.chat([
      { role: 'system', content: CONTEXT_SUMMARY_SYSTEM },
      { role: 'user', content: text },
    ])
    if (res.kind === 'text' && res.text.trim()) return res.text.trim()
    throw new Error('subcontext summary failed')
  }
}