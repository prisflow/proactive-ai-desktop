/**
 * Runtime —— 对话运行时。串联 tool / llm / store。
 *
 * 不创建自己的 ContextManager 或 ToolManager 实例。
 * 从全局 contextRegistry 和 toolRegistry 读取，订阅变更。
 * activeContextId 是 per-conversation 状态，由 Runtime 管理。
 *
 * 主循环（无事件总线，直接循环驱动）：
 *   run(玩家输入) → agentLoop：
 *     组装（稳定前缀+历史）→ LLM → stop 结束 / tool_calls：
 *       并行/按序执行工具 → transformPrompt 唯一转换点（{success, instruction, result:{text?,ui?}}）
 *       → 内存同步 + pendingDb 收集 → 循环后统一落库（assistant 先、tool 结果后）
 *       → instruction 生成状态 user 文本进历史
 *       → 回到循环头；host_yield 终止 → pushTurnDone 复位前端
 *
 * 文本回复不走工具：LLM 直接流式输出（finish_reason: stop），直接落库 + 推前端。
 *
 * 上下文隔离（v2）：
 *   histories: Map<contextId, LlmMessage[]> —— 各上下文独立历史（'main' 恒驻留）
 *   切换由 host_enter/exit_subcontext 工具驱动：
 *     enter：占位 tool 消息立即应答（协议闭合，OpenAI 要求 tool_calls 后紧跟 tool 应答）
 *     exit： 子上下文历史（含压缩兜底 + DB 持久化）LLM 总结成新消息注入主上下文历史
 */
import { contextRegistry } from './context'
import type { ContextDefinition } from './context'
import { toolRegistry } from './tool'
import { composeContextMessages } from './chat-composer'
import { LlmProvider, systemNote, type LlmConfig, type LlmMessage, type LlmToolDef } from '../llm'
import { logService, uniqueRunId } from '../../services/logger'
import { conversationStore } from '../../services/store'
import type { MessageRecord } from '../../services/store/database'
import { getMainWindow } from '../../window'
import type { AgentStreamPushV1 } from '../../../shared/types/stream'
import { resolveCompaction } from './compaction/config'
import { compactHistory, persistSummary } from './compaction/summarizer'
import { MODEL_SPECS, DEFAULT_CONTEXT_WINDOW, DEFAULT_OUTPUT_LIMIT } from '@shared/constants'
import type { RuntimeHost } from './runtime/host'
import { SubcontextManager } from './runtime/subcontext'
import { ToolRunner } from './runtime/tool-runner'

/** 单轮内工具连续失败上限：达到即终止本轮，防 LLM 死循环重试烧 token。 */
const MAX_TOOL_FAILURES = 5

export class Runtime implements RuntimeHost {
  private llm: LlmProvider
  /** 本会话使用的模型名（查 MODEL_SPECS 计算压缩阈值）。 */
  private model: string
  /** 各上下文的独立历史。'main' 恒存在；子上下文进入时创建、退出时折叠归档。 */
  histories: Map<string, LlmMessage[]> = new Map()
  activeContextId: string = 'main'
  private abortController = new AbortController()
  private unsubscribeCtx?: () => void
  private unsubscribeTools?: () => void
  /** run() 串行锁：同一 Runtime 的 agentLoop 一次只跑一个（防并发消息竞态 history）。 */
  private loopTail: Promise<void> = Promise.resolve()
  /** 子上下文切换（Runtime 拆分子模块）。 */
  private subcontext: SubcontextManager
  /** 工具执行链（Runtime 拆分子模块）。 */
  private tools: ToolRunner

  constructor(
    public readonly conversationId: string,
    llmConfig: LlmConfig,
  ) {
    this.model = llmConfig.model
    this.llm = new LlmProvider(llmConfig)
    // 拆分子模块注入（组合模式，host 接口避免循环依赖）
    this.subcontext = new SubcontextManager(this, this.llm)
    this.tools = new ToolRunner(this, this.subcontext)

    // 订阅全局注册表变更：新插件注册的上下文和工具自动可见
    this.unsubscribeCtx = contextRegistry.onChange(() => {
      logService.log('info', undefined, {
        runId: uniqueRunId('runtime'),
        name: 'registry.context.changed',
        message: `context registry updated, visible: ${contextRegistry.listSubContexts().join(', ') || 'none'}`,
      })
    })
    this.unsubscribeTools = toolRegistry.onChange(() => {
      logService.log('info', undefined, {
        runId: uniqueRunId('runtime'),
        name: 'registry.tool.changed',
        message: `tool registry updated, count: ${toolRegistry.listAll().length}`,
      })
    })
  }

  /** 当前活跃上下文的定义。 */
  get activeDef(): ContextDefinition | undefined {
    return contextRegistry.get(this.activeContextId)
  }

  /** 是否在子上下文中。 */
  private get isInSubContext(): boolean {
    return this.activeContextId !== 'main'
  }

  /** 当前活跃上下文的独立历史。 */
  private getActiveHistory(): LlmMessage[] {
    let h = this.histories.get(this.activeContextId)
    if (!h) {
      h = []
      this.histories.set(this.activeContextId, h)
    }
    return h
  }

  /** 向指定上下文历史追加消息（DB 落库由调用方负责）。 */
  pushHistory(contextId: string, msg: LlmMessage): void {
    let h = this.histories.get(contextId)
    if (!h) {
      h = []
      this.histories.set(contextId, h)
    }
    h.push(msg)
  }

  /** 从 store 按 contextId 分别加载已有对话历史，重建 histories。 */
  init(): void {
    this.histories.clear()
    const mainRecords = conversationStore.getMessagesByContext(this.conversationId, 'main')
    this.histories.set('main', this.rebuildHistory(mainRecords))
    // 子上下文历史（中断/未退出场景恢复）
    for (const ctxId of contextRegistry.listSubContexts()) {
      const records = conversationStore.getMessagesByContext(this.conversationId, ctxId)
      if (records.length) {
        this.histories.set(ctxId, this.rebuildHistory(records))
      }
    }
    // 若最后一次活动在子上下文（DB 无直接标记，按最后一条消息的 contextId 判断），恢复为活跃
    const all = conversationStore.getMessages(this.conversationId)
    for (let i = all.length - 1; i >= 0; i--) {
      const cid = all[i].contextId
      if (cid && cid !== 'main' && contextRegistry.has(cid)) {
        this.activeContextId = cid
        break
      }
      if (!cid) break
    }
    logService.log('info', undefined, {
      runId: uniqueRunId('runtime'),
      name: 'runtime.init',
      message: `histories: ${Array.from(this.histories.keys()).join(', ')}, active: ${this.activeContextId}`,
    })
  }

  /** 从消息记录重建 LlmMessage[]（压缩标记跳过、工具配对恢复）。 */
  private rebuildHistory(records: MessageRecord[]): LlmMessage[] {
    // 压缩标记：最后一个 compact-marker 及其之前的消息已被摘要覆盖，跳过不恢复
    let startIdx = 0
    for (let i = records.length - 1; i >= 0; i--) {
      const ex = records[i].extraData as { kind?: string } | null
      if (ex?.kind === 'compact-marker') {
        startIdx = i + 1
        break
      }
    }
    const out: LlmMessage[] = []
    for (let i = startIdx; i < records.length; i++) {
      const rec = records[i]
      if (rec.role === 'user') {
        out.push({ role: 'user', content: rec.content })
      } else {
        // context → 可能是 tool 结果、assistant 文本、UI 或 tool_calls 记录
        const extra = rec.extraData as
          | {
              kind?: string
              toolCallId?: string
              uiRender?: { component?: string; props?: Record<string, unknown>; children?: unknown[] }
              finishReason?: string
              toolCalls?: Array<{ id: string; name: string; arguments: string }>
              events?: unknown[]
            }
          | null
        if (extra?.kind === 'compact-marker') {
          // 压缩标记消息不恢复
          continue
        }
        if (extra?.kind === 'tool-result' && extra.toolCallId) {
          // tool 结果按原语义恢复（与 assistant.tool_calls 配对）
          out.push({ role: 'tool', tool_call_id: extra.toolCallId, content: rec.content })
        } else if (extra?.kind === 'event-status') {
          // 工具执行状态：系统注入文本，以 user + 【系统提示】标注恢复（不用 assistant——
          // thinking 模式编造 assistant 会被 API 拒绝）
          out.push(systemNote(rec.content))
        } else if (extra?.finishReason === 'tool_calls' && extra?.toolCalls?.length) {
          // 恢复带 tool_calls 的 assistant，保持后续 tool 消息可配对（落库统一 OpenAI 格式 arguments）
          out.push({
            role: 'assistant',
            content: rec.content,
            tool_calls: extra.toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function' as const,
              function: { name: tc.name, arguments: tc.arguments },
            })),
          })
        } else if (extra?.uiRender) {
          // uiRender 落库在 assistant(tool_calls) 与 tool-result 之间（flow 渲染先落库），
          // tool-result 已含完整 UI 文本化——这里直接跳过，不恢复。
          // 不得编造成独立 assistant 插入：会打断 assistant(tool_calls)→tool 配对，OpenAI 400。
        } else {
          // 纯文本 context（assistant 文本）
          out.push({ role: 'assistant', content: rec.content })
        }
      }
    }
    // 孤儿补全：检测未闭合的 tool 配对，补中断消息闭合，并同步落库（DB 与内存一致）
    // - assistant(tool_calls) 无对应 tool 应答（崩溃残留）→ 补 [工具调用已中断] tool 消息 + 落库
    // - 孤儿 tool（无对应 assistant.tool_calls，DB 顺序错乱/残缺）→ 从内存移除 + 删除 DB 记录
    const answeredToolIds = new Set<string>()
    const assistantCallIds = new Set<string>()
    for (const m of out) {
      if (m.role === 'tool' && m.tool_call_id) answeredToolIds.add(m.tool_call_id)
      if (m.role === 'assistant' && m.tool_calls) for (const tc of m.tool_calls) assistantCallIds.add(tc.id)
    }
    const healedOut: LlmMessage[] = []
    const recordsByToolCallId = new Map<string, MessageRecord>()
    for (const rec of records) {
      const extra = rec.extraData as { toolCallId?: string } | null
      if (extra?.toolCallId) recordsByToolCallId.set(extra.toolCallId, rec)
    }
    for (const m of out) {
      healedOut.push(m)
      if (m.role === 'assistant' && m.tool_calls) {
        for (const tc of m.tool_calls) {
          if (!answeredToolIds.has(tc.id)) {
            // 补中断 tool 消息（内存 + 落库，保证 DB 回放配对完整）
            healedOut.push({ role: 'tool', tool_call_id: tc.id, content: '[工具调用已中断，未执行]' })
            answeredToolIds.add(tc.id)
            conversationStore.addMessage(this.conversationId, {
              role: 'context',
              content: '[工具调用已中断，未执行]',
              contextId: this.activeContextId,
              extraData: { kind: 'tool-result', toolName: 'host_recover', toolCallId: tc.id },
            })
          }
        }
      }
    }
    // 孤儿 tool（无对应 assistant.tool_calls）：内存移除 + DB 删除
    for (const m of healedOut) {
      if (m.role === 'tool' && m.tool_call_id && !assistantCallIds.has(m.tool_call_id)) {
        const rec = recordsByToolCallId.get(m.tool_call_id)
        if (rec) {
          conversationStore.deleteMessage(rec.id)
        }
      }
    }
    const finalOut = healedOut.filter((m) => !(m.role === 'tool' && m.tool_call_id && !assistantCallIds.has(m.tool_call_id)))
    return finalOut
  }

  /** 销毁 Runtime，取消订阅。 */
  destroy(): void {
    this.abortController.abort()
    this.unsubscribeCtx?.()
    this.unsubscribeTools?.()
  }

  /** 当前 AbortSignal（图执行器透传，保证 abort 能中断图内 LLM 调用）。 */
  getAbortSignal(): AbortSignal {
    return this.abortController.signal
  }

  /** 当前活跃上下文的对话历史快照（供 flow 节点继承公共历史：剧情感知 + 前缀共享）。 */
  getHistory(): LlmMessage[] {
    return [...this.getActiveHistory()]
  }

  /** 中断当前 LLM 流式响应。abort 后保证前端忙状态复位（即使总线空闲无活跃流）。 */
  abort(): void {
    this.abortController.abort()
    this.pushTurnDone()
    logService.log('info', undefined, {
      runId: uniqueRunId('runtime'),
      name: 'runtime.abort',
      message: `interrupted conversation ${this.conversationId}`,
    })
  }

  /**
   * 回合结束信号：推 done:true 复位前端 busy。
   * 由 agentLoop 结束时触发，abort 时也会调用（幂等，双推无害）。
   */
  private pushTurnDone(): void {
    const w = getMainWindow()
    w?.webContents.send('chat:stream', {
      kind: 'stream',
      conversationId: this.conversationId,
      runId: uniqueRunId('stream'),
      delta: '',
      done: true,
    } satisfies AgentStreamPushV1)
  }

  /** 上下文切换信号：推给前端渲染"已进入/已回到"分隔标签（实时对话不经过 IPC 全量拉取）。 */
  pushContextSwitch(contextId?: string): void {
    const w = getMainWindow()
    w?.webContents.send('chat:stream', {
      kind: 'context-switch',
      conversationId: this.conversationId,
      runId: uniqueRunId('ctx'),
      contextId: contextId ?? null,
    } satisfies AgentStreamPushV1)
  }

  /** 用户输入入口：落库 + 进历史 → 立即返回记录，agentLoop 后台串行执行（delta 实时推送前端）。 */
  async run(userText: string): Promise<MessageRecord> {
    this.abortController = new AbortController()
    const record = conversationStore.addMessage(this.conversationId, {
      role: 'user',
      content: userText,
      contextId: this.activeContextId,
      extraData: null,
    })
    this.pushHistory(this.activeContextId, { role: 'user', content: userText })

    // 首次消息自动重命名：截取前 30 字
    const conv = conversationStore.get(this.conversationId)
    if (conv && conv.title === '新对话') {
      conversationStore.update(this.conversationId, { title: userText.slice(0, 30) })
    }

    // 后台跑 agentLoop（不 await）：chatSendApi 立即返回用户记录，前端先显示用户消息，
    // 流式 delta 经 webContents 实时推送追加在用户消息之后；loopTail 串行链保证多消息顺序。
    const prev = this.loopTail
    this.loopTail = (async () => {
      await prev
      try {
        await this.agentLoop()
      } catch (e) {
        logService.log('error', 'error', {
          runId: uniqueRunId('runtime'),
          name: 'runtime.agentLoop',
          conversationId: this.conversationId,
          message: e instanceof Error ? e.message : String(e),
        })
      }
    })()
    return record
  }

  /**
   * 主循环（无事件总线，直接循环驱动）：
   *   组装 → LLM 流式 → stop 结束 / tool_calls 执行工具 → instruction 回灌 → 循环头；
   *   host_yield 或 abort 终止 → pushTurnDone 复位前端。
   */
  private async agentLoop(): Promise<void> {
    try {
      while (!this.abortController.signal.aborted) {
        // 压缩层：token 预算触发（估算请求超预算即压缩），压缩后前缀回归稳定，缓存高命中
        await this.compactIfNeeded()

        const tail = this.activeDef?.initialPrompt ?? 'You are a helpful AI assistant.'
        const messages = composeContextMessages({
          conversationId: this.conversationId,
          contextId: this.activeContextId,
          history: this.getActiveHistory(),
          tail,
        })
        const toolDefs = this.buildToolDefs()

        const llmRunId = uniqueRunId('llm')
        logService.log('info', 'start', {
          runId: llmRunId,
          name: 'runtime.llm',
          conversationId: this.conversationId,
          data: { historyLen: this.getActiveHistory().length, toolsCount: toolDefs.length, context: this.activeContextId },
        })

        const { finishReason, fullText, toolCalls } = await this.streamOnce(messages, toolDefs, llmRunId)

        logService.log('info', 'end', {
          runId: llmRunId,
          name: 'runtime.llm',
          conversationId: this.conversationId,
          data: { finishReason, textLen: fullText.length },
        })

        if (finishReason === 'stop') break

        if (finishReason === 'tool_calls' && toolCalls?.length) {
          // 内存同步 assistant(tool_calls)（不落库——落库等工具全部执行完/中断后统一做，
          // 保证 assistant 先落、tool 结果后落且顺序正确；崩溃在工具执行中则内存有、DB 无，重启无孤儿）
          const assistantMsg: LlmMessage = {
            role: 'assistant',
            content: fullText,
            tool_calls: toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function' as const,
              function: { name: tc.name, arguments: tc.args },
            })),
          }
          this.pushHistory(this.activeContextId, assistantMsg)
          // 待落库记录：assistant + 各工具结果，循环后统一写 DB
          const pendingDb: Array<Omit<MessageRecord, 'id' | 'createdAt' | 'conversationId'>> = [{
            role: 'context',
            content: fullText,
            contextId: this.activeContextId,
            extraData: {
              finishReason: 'tool_calls',
              toolCalls: toolCalls.map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.args })),
            },
          }]
          // 按序执行本轮全部工具（host_yield 收轮信号最后执行，避免前序工具被跳过成孤儿）
          const ordered = [...toolCalls].sort((a, b) => (a.name === 'host_yield' ? 1 : 0) - (b.name === 'host_yield' ? 1 : 0))
          let yielded = false
          let failCount = 0
          for (const tc of ordered) {
            // 中断检查：已 abort 则不再执行剩余工具，补中断 tool 消息保持配对
            if (this.abortController.signal.aborted) {
              this.pushHistory(this.activeContextId, { role: 'tool', tool_call_id: tc.id, content: '[工具调用已中断，未执行]' })
              pendingDb.push({
                role: 'context',
                content: '[工具调用已中断，未执行]',
                contextId: this.activeContextId,
                extraData: { kind: 'tool-result', toolName: tc.name, toolCallId: tc.id },
              })
              continue
            }
            const r = await this.handleToolCall(tc, llmRunId, pendingDb)
            if (r === 'stop') { yielded = true; break }
            if (r === 'fail') failCount++
          }
          // 统一落库：assistant(tool_calls) 先落，再 tool-result/event-status（顺序与内存一致，配对完整）
          for (const rec of pendingDb) {
            conversationStore.addMessage(this.conversationId, rec)
          }
          // 连续失败达上限：终止本轮，防 LLM 死循环重试（如突破前置不满足反复触发）
          if (failCount >= MAX_TOOL_FAILURES) {
            logService.log('error', 'error', {
              runId: uniqueRunId('runtime'),
              name: 'runtime.agentLoop',
              conversationId: this.conversationId,
              message: `工具连续失败 ${failCount} 次，终止本轮`,
            })
            break
          }
          if (yielded) break
          continue
        }

        // abort / error / incomplete：结束本轮
        break
      }
    } finally {
      // 无论正常收轮还是异常跳出，都推送回合结束信号复位前端 busy
      this.pushTurnDone()
    }
  }

  /**
   * 单次 LLM 流式调用：逐 chunk 推前端，stop/tool_calls 落库 assistant 消息。
   * @returns 结束原因、累计文本、tool_calls（tool_calls 时）
   */
  private async streamOnce(
    messages: LlmMessage[],
    toolDefs: LlmToolDef[],
    llmRunId: string,
  ): Promise<{ finishReason: 'stop' | 'tool_calls' | 'abort' | 'error' | 'incomplete'; fullText: string; toolCalls: Array<{ id: string; name: string; args: string }> | null }> {
    const stream = this.llm.chatStream(messages, toolDefs, this.abortController.signal)
    let fullText = ''
    let finishReason: 'stop' | 'tool_calls' | 'abort' | 'error' | 'incomplete' = 'incomplete'
    let toolCalls: Array<{ id: string; name: string; args: string }> | null = null
    // streamRunId 同时用作前端流式消息的 id，必须唯一（防同毫秒双流碰撞）
    const streamRunId = uniqueRunId('stream')

    try {
      for await (const chunk of stream) {
        if (chunk.kind === 'delta') {
          fullText += chunk.delta
          const w = getMainWindow()
          w?.webContents.send('chat:stream', {
            kind: 'stream',
            conversationId: this.conversationId,
            runId: streamRunId,
            delta: chunk.delta,
            done: false,
          } satisfies AgentStreamPushV1)
        }

        if (chunk.kind === 'done') {
          if (chunk.finishReason === 'stop') {
            finishReason = 'stop'
            // 落库先行（DB 真相源）→ 内存同步
            conversationStore.addMessage(this.conversationId, {
              role: 'context',
              content: fullText,
              contextId: this.activeContextId,
              extraData: { rawResponse: { content: fullText, finishReason: 'stop' } },
            })
            this.pushHistory(this.activeContextId, { role: 'assistant', content: fullText })
          }
          if (chunk.finishReason === 'tool_calls') {
            finishReason = 'tool_calls'
            toolCalls = chunk.toolCalls ?? null
            // 不在此落库 assistant(tool_calls)：等工具执行完（或中断）后由 agentLoop 统一落库，
            // 避免"模型发出调用后、工具执行前被关闭"产生孤儿（assistant 无 tool 应答）
          }
          break
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logService.log('error', 'error', {
        runId: uniqueRunId('runtime'),
        parentRunId: llmRunId,
        name: 'runtime.llm.stream',
        conversationId: this.conversationId,
        message: msg,
      })
      const w = getMainWindow()
      w?.webContents.send('chat:stream', {
        kind: 'error',
        conversationId: this.conversationId,
        runId: streamRunId,
        message: msg,
      } satisfies AgentStreamPushV1)
    }

    // OpenAI SDK 在 abort 时吞掉 AbortError（streaming.ts:93），补处理：保留已收文本正常收尾
    if (this.abortController.signal.aborted) {
      finishReason = 'abort'
      if (fullText) {
        conversationStore.addMessage(this.conversationId, {
          role: 'context',
          content: fullText,
          contextId: this.activeContextId,
          extraData: { rawResponse: { content: fullText, finishReason: 'abort' } },
        })
        this.pushHistory(this.activeContextId, { role: 'assistant', content: fullText })
      }
      const w = getMainWindow()
      w?.webContents.send('chat:stream', {
        kind: 'stream',
        conversationId: this.conversationId,
        runId: streamRunId,
        delta: '',
        done: true,
      } satisfies AgentStreamPushV1)
    }

    return { finishReason, fullText, toolCalls }
  }

  /**
   * 压缩层：token 预算触发（估算请求超预算即压缩）。
   * 压缩产物：head LLM 摘要（覆盖写入 summarySlot）+ keepTokens 尾部保留。
   * 摘要超预算时自动"摘要的摘要"（旧摘要 + 新 head 合并，旧摘要丢弃）。
   * 压缩失败不截断历史（保留原样，本轮放弃，下次再试）。
   */
  private async compactIfNeeded(): Promise<void> {
    const history = this.getActiveHistory()
    if (history.length === 0) return
    const cfg = resolveCompaction(this.activeDef?.compaction)
    // 触发判据：上次请求的真实输入 token（provider usage）超过阈值（window - output）。
    // 阈值远离窗口（1M - 128K = 872K），晚一轮压缩也安全；每次请求保留完整输出空间。
    const spec = MODEL_SPECS[this.model] ?? { window: DEFAULT_CONTEXT_WINDOW, output: DEFAULT_OUTPUT_LIMIT }
    const threshold = spec.window - spec.output
    if (this.llm.lastPromptTokens <= threshold) return

    logService.log('info', undefined, {
      runId: uniqueRunId('runtime'),
      name: 'runtime.compact',
      message: `compacting: lastPromptTokens=${this.llm.lastPromptTokens}, threshold=${threshold}, history=${history.length}`,
    })

    let summary: string
    let kept: LlmMessage[]
    try {
      const res = await compactHistory(this.conversationId, this.activeContextId, cfg, this.llm, history)
      summary = res.summary
      kept = res.kept
    } catch {
      // 压缩失败：保留原历史，放弃本轮压缩（不截断，防数据丢失）
      return
    }
    persistSummary(this.conversationId, this.activeContextId, cfg, summary)
    this.histories.set(this.activeContextId, kept)
    conversationStore.addMessage(this.conversationId, {
      role: 'context',
      content: '[此前对话已压缩进摘要]',
      contextId: this.activeContextId,
      extraData: { kind: 'compact-marker' },
    })
  }

  /** 从当前活跃上下文的 toolNames 构建 LlmToolDef[]（委托 ToolRunner）。 */
  private buildToolDefs(): LlmToolDef[] {
    return this.tools.buildToolDefs()
  }

  /**
   * 处理单个工具调用（委托 ToolRunner）：执行 → transformPrompt → 内存同步 → 收集待落库。
   * @returns 'stop'=收轮（host_yield）；'fail'=工具失败（供 agentLoop 计数防死循环）；'ok'=成功
   */
  private async handleToolCall(
    tc: { id: string; name: string; args: string },
    llmRunId: string,
    pendingDb: Array<Omit<MessageRecord, 'id' | 'createdAt' | 'conversationId'>>,
  ): Promise<'stop' | 'fail' | 'ok'> {
    return this.tools.handleToolCall(tc, llmRunId, pendingDb)
  }
}
