/**
 * 工具执行链（Runtime 拆分子模块）：
 *   buildToolDefs —— 按上下文可见性规则组装 LLM tools 参数
 *   handleToolCall —— 单个工具调用：执行 → transformPrompt 唯一转换点 → 内存同步 → 收集待落库
 *   emitToolResult —— 工具结果统一出口（来源唯一 = transformPrompt 产物）
 */
import { contextRegistry } from '../context'
import { toolRegistry } from '../tool'
import type { ToolDefinition, ToolResult, ToolPromptResult } from '../tool'
import { systemNote, type LlmMessage, type LlmToolDef } from '../../llm'
import { logService, uniqueRunId } from '../../../services/logger'
import { getMainWindow } from '../../../window'
import type { AgentStreamPushV1 } from '../../../../shared/types/stream'
import type { RuntimeHost, PendingDbRecord } from './host'
import type { SubcontextManager } from './subcontext'

/** host_render_ui 的产物：组件树（与 builtin-tools.ts 的 UiRenderResult 同构）。 */
interface UiRenderResult {
  component: string
  props: Record<string, unknown>
  children?: unknown[]
}

export class ToolRunner {
  constructor(private host: RuntimeHost, private subcontext: SubcontextManager) {}

  /** 从当前活跃上下文的 toolNames 构建 LlmToolDef[]。内置工具按上下文可见性规则过滤。 */
  buildToolDefs(): LlmToolDef[] {
    const hostTools: string[] = []
    for (const name of toolRegistry.listAll()) {
      if (!name.startsWith('host_')) continue
      if (name === 'host_enter_subcontext' && this.host.activeContextId !== 'main') continue
      if (name === 'host_exit_subcontext' && this.host.activeContextId === 'main') continue
      hostTools.push(name)
    }

    const contextTools = this.host.activeDef?.toolNames ?? toolRegistry.listAll()
    const nonHostTools = contextTools.filter((n) => !n.startsWith('host_'))

    return [...new Set([...hostTools, ...nonHostTools])]
      .map((name) => toolRegistry.get(name))
      .filter((def): def is ToolDefinition => def !== undefined)
      .map((def) => {
        let parameters = def.inputSchema ?? { type: 'object', properties: {} }
        if (def.name === 'host_enter_subcontext') {
          parameters = {
            type: 'object',
            properties: {
              contextId: {
                type: 'string',
                description: contextRegistry.describeSubContexts(),
              },
            },
            required: ['contextId'],
          }
        }
        return {
          type: 'function' as const,
          function: {
            name: def.name,
            description: def.description,
            parameters,
          },
        }
      })
  }

  /**
   * 处理单个工具调用：执行 → transformPrompt 唯一转换点 → 内存同步 → 收集待落库（由 agentLoop 统一落库）。
   * assistant(tool_calls) 已由 agentLoop 统一内存 + 落库（一条消息含全部调用）。
   * host_enter/exit_subcontext 同步切换 activeContextId，下一轮循环自动使用新上下文。
   * instruction（成功/失败）生成状态 user 文本回灌，驱动下一轮循环。
   *
   * @param pendingDb 待落库记录收集数组（agentLoop 传入，循环后统一写 DB，保证顺序 assistant→tool）
   * @returns 'stop'=收轮（host_yield）；'fail'=工具失败（供 agentLoop 计数防死循环）；'ok'=成功
   */
  async handleToolCall(
    tc: { id: string; name: string; args: string },
    llmRunId: string,
    pendingDb: PendingDbRecord[],
  ): Promise<'stop' | 'fail' | 'ok'> {
    const def = toolRegistry.get(tc.name)

    // 参数解析防御：LLM 偶尔产出残缺 JSON，失败不中断，回喂 LLM 修正后重试
    let args: Record<string, unknown>
    try {
      args = JSON.parse(tc.args)
    } catch {
      const msg = `[工具参数解析失败，请修正后重试] ${tc.args.slice(0, 300)}`
      // 非静默工具：失败回灌；tool 消息带错误文本（防空 content 拒绝）
      if (def && !def.silent) {
        const failPrompt: ToolPromptResult = {
          success: { toolName: tc.name, error: msg },
          result: { text: msg },
        }
        this.emitToolResult(tc, failPrompt, pendingDb)
      }
      logService.log('warn', undefined, {
        runId: uniqueRunId('runtime'),
        parentRunId: llmRunId,
        name: 'tool.args-parse-failed',
        message: `${tc.name}: ${msg}`,
      })
      return 'fail'
    }

    // 执行前 schema 校验在 toolRegistry.call 内部完成，失败返回 {ok:false}
    const result = await toolRegistry.call(tc.name, args, {
      conversationId: this.host.conversationId,
      contextId: this.host.activeContextId,
      parentRunId: llmRunId,
    })

    // 上下文切换：enter/exit 成功后同步切换 activeContextId（循环自动用新上下文继续）
    if (result.ok) {
      if (tc.name === 'host_enter_subcontext') {
        const data = result.result as { contextId: string; reason: string }
        await this.subcontext.enter(tc, data.contextId, data.reason, llmRunId, pendingDb)
        return 'ok'
      }
      if (tc.name === 'host_exit_subcontext') {
        await this.subcontext.exit(tc, llmRunId, pendingDb)
        return 'ok'
      }
      // host_render_ui：把组件树推送前端渲染 + 收集待落库（回放），与 flow render 节点走同一条 ui_render 通道
      if (tc.name === 'host_render_ui') {
        const ui = result.result as UiRenderResult
        const w = getMainWindow()
        w?.webContents.send('chat:stream', {
          kind: 'ui_render',
          conversationId: this.host.conversationId,
          runId: uniqueRunId('ui'),
          component: ui.component,
          props: ui.props ?? {},
          children: (ui.children ?? null) as import('../../../../shared/types/ui').WidgetNode[] | null,
        } satisfies AgentStreamPushV1)
        pendingDb.push({
          role: 'context',
          content: `[UI: ${ui.component}]`,
          contextId: this.host.activeContextId,
          extraData: { uiRender: ui },
        })
      }
    }

    // transformPrompt 唯一转换点：产出 {success, instruction?, result:{text?,ui?}}；无 def 时兜底
    const prompt: ToolPromptResult = def?.transformPrompt
      ? def.transformPrompt(result)
      : result.ok
        ? { success: { toolName: tc.name }, result: { text: JSON.stringify(result.result) } }
        : { success: { toolName: tc.name, error: (result as { error: string }).error } }

    // 静默工具（host_yield 等）：push tool 消息保持配对 + 收集待落库（由 agentLoop 统一落库，顺序 assistant→tool），收轮信号由上层处理
    if (def?.silent) {
      const content = result.ok
        ? JSON.stringify(result.result)
        : `[错误] ${(result as { error: string }).error}`
      this.host.pushHistory(this.host.activeContextId, { role: 'tool', tool_call_id: tc.id, content })
      pendingDb.push({
        role: 'context',
        content,
        contextId: this.host.activeContextId,
        extraData: { kind: 'tool-result', toolName: tc.name, toolCallId: tc.id },
      })
      return tc.name === 'host_yield' ? 'stop' : 'ok'
    }

    // 内存同步 + 收集待落库（不落库，由 agentLoop 统一写 DB）——同一来源（transformPrompt 产物）
    this.emitToolResult(tc, prompt, pendingDb)
    return prompt.success.error ? 'fail' : 'ok'
  }

  /**
   * 工具结果统一出口：来源唯一 = transformPrompt 产物。
   * 只同步内存（tool 消息 + assistant 状态）+ 收集待落库记录（由 agentLoop 工具循环后统一落库，
   * 保证 assistant(tool_calls) 先落、tool-result/event-status 后落，且崩溃时内存数据不落库不产生孤儿）。
   * instruction（成功）或 error（失败）生成状态文本作为下一轮循环起点；
   * 无 instruction 且无 error 时状态文本为空（不落占位，避免污染历史）。
   * @param pendingDb 待落库记录收集数组（由 agentLoop 传入，循环后统一写 DB）
   */
  private emitToolResult(
    tc: { id: string; name: string; args: string },
    prompt: ToolPromptResult,
    pendingDb: PendingDbRecord[],
  ): void {
    const s = prompt.success
    // 状态文本：error → 失败回灌；无 error → 仅 instruction（无 instruction 则空）
    const statusText = s.error
      ? `工具 ${s.toolName} 执行失败：${s.error}。请重试该工具或改用其他工具。`
      : (prompt.instruction ?? '')

    const parts: string[] = []
    if (prompt.result?.text) parts.push(prompt.result.text)
    if (prompt.result?.ui) parts.push(prompt.result.ui)
    // tool 消息 content 兜底：空文本（工具无可见结果）时用状态文本，防 OpenAI 空 content 拒绝
    const toolContent = parts.join('\n') || statusText

    const ctxIdForDb = this.host.activeContextId

    // 收集待落库（不立即写 DB）：顺序 tool-result → event-status，由 agentLoop 统一在 assistant 之后落
    if (toolContent) {
      pendingDb.push({
        role: 'context',
        content: toolContent,
        contextId: ctxIdForDb,
        extraData: { kind: 'tool-result', toolName: s.toolName, toolCallId: tc.id },
      })
    }
    // 状态文本非空才落库/入历史（无 instruction 不落占位）
    if (statusText) {
      pendingDb.push({
        role: 'context',
        content: statusText,
        contextId: ctxIdForDb,
        extraData: { kind: 'event-status', toolName: s.toolName },
      })
    }

    // 内存同步（缓存）
    this.host.pushHistory(this.host.activeContextId, {
      role: 'tool',
      tool_call_id: tc.id,
      content: toolContent,
    })
    // instruction（或失败回灌）以 user + 【系统提示】标注落内存（systemNote 包装；
    // 不用 assistant——thinking 模式编造 assistant 会被 API 拒绝）
    if (statusText) {
      this.host.pushHistory(this.host.activeContextId, systemNote(statusText))
    }
  }
}