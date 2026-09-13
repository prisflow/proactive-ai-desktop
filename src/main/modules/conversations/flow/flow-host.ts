/**
 * FlowHost —— 回合执行器（工具层以下的实现设施）。
 *
 * 图（Flow）是工具的 run() 内部实现：插件把原工具的内容拆分为
 * 「LLM 生成节点 + 静态记账节点 + 渲染终止节点」，宿主按节点链执行，
 * 提供 LLM 生成（api.llm.generate）、校验重试、渲染推送与失败降级。
 *
 * 边界（不可越界）：
 * - 节点不得调用其他工具（toolRegistry 对图不可见）
 * - 节点不得入队总线事件（事件是工具协议层的事）
 * - 图执行器不感知对话 history，LLM 节点的上下文由插件基于游戏 state 提供
 */

import type { LlmProvider, LlmMessage } from '../../llm'
import { validateToolInput } from '../tool/schema-validate'
import { composeContextMessages } from '../chat-composer'
import { logService, uniqueRunId } from '../../../services/logger'

/** 图执行时的共享上下文：输入、节点间产物、状态、渲染通道。 */
export interface FlowCtx {
  /** 所属对话 ID（插件 ledger 按对话分键）。 */
  conversationId?: string
  /** 所属上下文 ID。 */
  contextId?: string
  /** 所属 Runtime 的 abort 信号（abort 时中断图内 LLM 调用）。 */
  signal?: AbortSignal
  /** 继承的公共历史（主上下文 history 快照，供 LLM 节点剧情感知 + 前缀共享）。 */
  history?: LlmMessage[]
  /** 工具传入的原始参数（如玩家消息文本）。 */
  input: unknown
  /** 插件自有游戏状态（llm/static 节点可读写）。 */
  state: Record<string, unknown>
  /** 节点间共享产物（叙事、事件、抉择等，由 assign/static 写入）。 */
  data: Record<string, unknown>
  /** 渲染推送通道（宿主实现：落库 + webContents.send）。 */
  push: (payload: { kind: 'ui_render'; component: string; props: Record<string, unknown>; children?: unknown[] }) => void
  /** 是否已执行渲染。 */
  rendered: boolean
}

/** LLM 生成节点：宿主调用 LLM，schema 校验失败自动重试。 */
export interface LlmNode {
  type: 'llm'
  /** 系统提示（可基于 state 由插件在定义时组装）。 */
  system: string
  /** 用户输入（函数签名：从 ctx 动态生成；纯函数签名避免联合推断导致参数 any）。 */
  input: (ctx: FlowCtx) => string
  /** 结构化输出 schema（JSON Schema）；缺省时 LLM 输出纯文本。 */
  schema?: Record<string, unknown>
  /** 结果存入 ctx.data 的键（缺省为 system 前 16 字符，无稳定语义，建议显式指定）。 */
  assign?: string
  /** 校验失败最大重试次数（默认 2）。 */
  maxTries?: number
  /** 自我评审提示（0.7.0 路线图落地）：输出通过 schema 校验后，按此提示让 LLM 评审输出质量，
   *  不通过（verdict.pass === false）则把评审结论回喂并重新生成，受 maxRetries 约束。 */
  reviewPrompt?: string
  /** 评审不通过的最大重新生成次数（默认 1）。 */
  maxRetries?: number
  /** 单次 LLM 输出 token 上限（覆盖默认 4096；大输出场景如世界生成需提高以免截断）。 */
  maxTokens?: number
}

/** 静态节点：纯函数（校验/记账/门控），可返回错误字符串中止图。 */
export interface StaticNode {
  type: 'static'
  /** 同步执行。返回错误字符串则图终止；返回 void 则继续。 */
  fn: (ctx: FlowCtx) => string | void
}

/** 渲染终止节点：构造 UI 数据并推送，标记 ctx.rendered。 */
export interface RenderNode {
  type: 'render'
  /** 构造 UI 数据结构。 */
  build: (ctx: FlowCtx) => { component: string; props: Record<string, unknown>; children?: unknown[] }
}

/** 条件分支节点：when 为 true 走 then，否则走 else。 */
export interface ConditionNode {
  type: 'condition'
  when: (ctx: FlowCtx) => boolean
  then: FlowNode[]
  else?: FlowNode[]
}

export type FlowNode = LlmNode | StaticNode | RenderNode | ConditionNode

/** 图定义。 */
export interface FlowDefinition {
  /** 图名称。 */
  name: string
  /** 节点链（render 节点应放在必经路径上，渲染必达由图拓扑保证）。 */
  nodes: FlowNode[]
  /** 图执行结束后必须已渲染（默认 true）；未渲染则整体失败。 */
  requireRender?: boolean
}

/** 图执行结果。 */
export interface FlowResult {
  ok: boolean
  error?: string
  data: Record<string, unknown>
  state: Record<string, unknown>
  rendered: boolean
}

/**
 * 图执行器。注册图定义，提供 run() 顺序执行节点链。
 * LLM 生成通过注入的 generate 实现（宿主 LlmProvider + schema 校验 + 重试）。
 */
export class FlowHost {
  private flows = new Map<string, FlowDefinition>()
  private generateImpl: LlmProvider | null = null

  /** 注册图定义。同名冲突：warn + 覆盖（reload 幂等——静默 false 会让热重载后旧定义钉死，"改了不生效"）。
   *  定义结构非法时 throw 精确原因（setup 失败 → plugin_reload 错误原文回喂 LLM 自修）——
   *  注册零校验会让坏定义潜伏到执行时才炸（2026-09-12 bookstore_love：render 节点字段名写错，试跑"全绿"实为 UI 从未渲染）。 */
  register(def: FlowDefinition): boolean {
    const problem = this.validateFlowDef(def)
    if (problem) throw new Error(problem)
    if (this.flows.has(def.name)) {
      logService.log('warn', undefined, {
        runId: uniqueRunId('flow'),
        name: 'flow.register',
        message: `duplicate flow, replaced: ${def.name}`,
      })
    }
    this.flows.set(def.name, def)
    return true
  }

  /** FlowDefinition 结构校验。合法返回 null，非法返回精确原因。 */
  private validateFlowDef(def: FlowDefinition): string | null {
    if (!def || typeof def !== 'object') return 'flow 定义缺失'
    if (typeof def.name !== 'string' || !def.name) return 'flow 缺少 name'
    if (!Array.isArray(def.nodes)) return `flow "${def.name}": nodes 必须是数组`
    for (let i = 0; i < def.nodes.length; i++) {
      const n = def.nodes[i] as { type?: unknown; system?: unknown; input?: unknown; fn?: unknown; build?: unknown; when?: unknown; then?: unknown }
      const at = `flow "${def.name}" nodes[${i}]`
      if (!n || typeof n !== 'object') return `${at} 不是对象`
      switch (n.type) {
        case 'llm':
          if (typeof n.system !== 'string' || !n.system) return `${at}: llm 节点缺少 system`
          if (typeof n.input !== 'function') return `${at}: llm 节点缺少 input 函数`
          break
        case 'static':
          if (typeof n.fn !== 'function') return `${at}: static 节点缺少 fn 函数`
          break
        case 'render':
          if (typeof n.build !== 'function') return `${at}: render 节点缺少 build 函数（注意字段名是 build，不是 render）`
          break
        case 'condition':
          if (typeof n.when !== 'function') return `${at}: condition 节点缺少 when 函数`
          if (!Array.isArray(n.then)) return `${at}: condition 节点缺少 then 数组`
          break
        default:
          return `${at}: 未知节点类型 "${String(n.type)}"（合法值：llm/static/render/condition）`
      }
    }
    return null
  }

  /** 注销图定义（插件卸载/重载时由 loader 调用，防旧定义钉死）。 */
  unregister(name: string): boolean {
    return this.flows.delete(name)
  }

  /** 注入宿主 LLM（应用启动时由 loader 调用，配置变更后重建）。 */
  setLlmProvider(provider: LlmProvider | null): void {
    this.generateImpl = provider
  }

  /**
   * 宿主 LLM 生成（供 api.llm.generate 转调）。
   * 提供 schema 时要求 JSON 输出并校验，失败自动回喂重试。
   */
  async generate(input: {
    system: string
    input: string
    schema?: Record<string, unknown>
    maxTries?: number
    /** 自我评审提示（0.7.0 路线图落地）：输出按此提示评审，不通过回喂重新生成 */
    reviewPrompt?: string
    /** 评审不通过的最大重新生成次数（默认 1） */
    maxRetries?: number
  }): Promise<{ ok: true; text: string; data: unknown } | { ok: false; error: string }> {
    if (!this.generateImpl) return { ok: false, error: 'LLM provider 未就绪（请检查 API Key 配置）' }
    const node: LlmNode = {
      type: 'llm',
      system: input.system,
      input: () => input.input,
      schema: input.schema,
      maxTries: input.maxTries,
      reviewPrompt: input.reviewPrompt,
      maxRetries: input.maxRetries,
    }
    return this.generateWithRetry(node, input.input, undefined, undefined)
  }

  /**
   * 执行一张图。
   * @param name 图名
   * @param input 工具传入的参数
   * @param push 渲染推送通道
   * @param opts 会话上下文（注入 FlowCtx，供插件 ledger 分键 + abort 信号透传）
   */
  async run(
    name: string,
    input: unknown,
    push: FlowCtx['push'],
    opts?: { conversationId?: string; contextId?: string; signal?: AbortSignal; history?: LlmMessage[] },
  ): Promise<FlowResult> {
    const flow = this.flows.get(name)
    if (!flow) return { ok: false, error: `flow not found: ${name}`, data: {}, state: {}, rendered: false }

    const ctx: FlowCtx = {
      conversationId: opts?.conversationId,
      contextId: opts?.contextId,
      signal: opts?.signal,
      history: opts?.history,
      input,
      state: {},
      data: {},
      push,
      rendered: false,
    }

    const err = await this.executeNodes(flow.nodes, ctx)
    if (err) return { ok: false, error: err, data: ctx.data, state: ctx.state, rendered: ctx.rendered }

    const requireRender = flow.requireRender !== false
    if (requireRender && !ctx.rendered) {
      return { ok: false, error: 'flow finished without render node', data: ctx.data, state: ctx.state, rendered: false }
    }
    return { ok: true, data: ctx.data, state: ctx.state, rendered: ctx.rendered }
  }

  private async executeNodes(nodes: FlowNode[], ctx: FlowCtx): Promise<string | null> {
    for (const node of nodes) {
      const err = await this.executeNode(node, ctx)
      if (err) return err
    }
    return null
  }

  private async executeNode(node: FlowNode, ctx: FlowCtx): Promise<string | null> {
    switch (node.type) {
      case 'llm': {
        if (!this.generateImpl) return 'LLM provider 未就绪（请检查 API Key 配置）'
        if (ctx.signal?.aborted) return '已中断（abort）'
        const userInput = node.input(ctx)
        const key = node.assign ?? node.system.slice(0, 16)
        const result = await this.generateWithRetry(node, userInput, ctx.signal, ctx.contextId, ctx.conversationId, ctx.history)
        if (!result.ok) return result.error
        ctx.data[key] = result.data
        return null
      }
      case 'static': {
        const err = node.fn(ctx)
        return typeof err === 'string' && err.length > 0 ? err : null
      }
      case 'render': {
        const ui = node.build(ctx)
        ctx.rendered = true
        ctx.push({ kind: 'ui_render', component: ui.component, props: ui.props, children: ui.children })
        return null
      }
      case 'condition': {
        const branch = node.when(ctx) ? node.then : node.else
        if (!branch) return null
        return this.executeNodes(branch, ctx)
      }
      default:
        return `未知节点类型：${String((node as { type?: unknown }).type)}（合法值：llm/static/render/condition）`
    }
  }

  /** LLM 生成 + schema 校验 + 错误回喂重试（pydantic 式）。支持 abort 中断。
   * 消息统一三段骨架（与调度器同构，共享稳定层 + 公共聊天记录前缀）：
   *   [system] 共享稳定层（world_setting + game_lore）
   *   [...公共聊天记录（主上下文 history 原样消息数组，线性增长 → 前缀共享命中）]
   *   [user]   尾部指令块：节点 PROMPT + 输入 + schema（节点特有，放最后）
   */
  private async generateWithRetry(
    node: LlmNode,
    userInput: string,
    signal?: AbortSignal,
    contextId?: string,
    conversationId?: string,
    history?: LlmMessage[],
  ): Promise<{ ok: true; text: string; data: unknown } | { ok: false; error: string }> {
    const provider = this.generateImpl!
    const maxTries = node.maxTries ?? 2
    // 尾部指令块：节点 PROMPT + json 指令 + schema + 节点输入（各节点不同，放末尾不影响共享前缀）
    const jsonDirective = '你必须只输出一个 JSON 对象，不要包含任何其他文本或代码块标记。不适用的可选字段必须整个省略该键，禁止填 null；禁止复述下述结构定义本身。'
    const tailBlock = node.schema
      ? `${node.system}\n\n${jsonDirective}JSON 必须符合以下结构：${JSON.stringify(node.schema)}\n\n${userInput}`
      : `${node.system}\n\n${userInput}`

    const messages: LlmMessage[] =
      composeContextMessages({
        conversationId: conversationId ?? '',
        contextId: contextId ?? 'main',
        history: history ?? [],
        tail: tailBlock,
      })

    let lastError = '生成失败'
    let reviewCount = 0
    const maxReview = node.maxRetries ?? 1
    for (let i = 0; i <= maxTries; i++) {
      if (signal?.aborted) return { ok: false, error: '已中断（abort）' }
      let res: Awaited<ReturnType<LlmProvider['chat']>>
      try {
        res = await provider.chat(
          messages as LlmMessage[],
          undefined,
          signal,
          node.maxTokens,
          node.schema ? { type: 'json_object' } : undefined,
          contextId,
        )
      } catch (e) {
        // LLM 调用异常（网络/API 错误/abort）：回喂失败信息重试，不让异常中断整张图
        lastError = `LLM 调用失败：${e instanceof Error ? e.message : String(e)}`
        messages.push({ role: 'user', content: `调用失败：${lastError}。请重试。` })
        continue
      }
      if (res.kind === 'tool_calls') {
        lastError = '模型返回了工具调用（图内 LLM 节点不允许工具调用），请直接输出内容'
        messages.push({ role: 'assistant', content: '' })
        messages.push({ role: 'user', content: `输出不合法：${lastError}。请重新输出符合要求的内容。` })
        continue
      }
      if (!node.schema) {
        if (!node.reviewPrompt) return { ok: true, text: res.text, data: res.text }
        // reviewPrompt 自我评审（0.7.0 路线图）：不通过则回喂评审结论重新生成
        reviewCount++
        const verdict = await this.reviewStage(node.reviewPrompt, res.text, signal)
        if (!verdict || verdict.pass) return { ok: true, text: res.text, data: res.text } // 评审器故障 fail-open
        if (reviewCount > maxReview) {
          return { ok: false, error: `LLM 节点「${node.system.slice(0, 20)}…」评审未通过（重试 ${maxReview} 次后）：${verdict.problems.join('；')}` }
        }
        lastError = `评审未通过：${verdict.problems.join('；')}`
        messages.push({ role: 'assistant', content: res.text })
        messages.push({ role: 'user', content: `你的输出未通过质量评审：${verdict.problems.join('；')}。请针对以上问题修正后重新输出。` })
        continue
      } else {
        const parsed = this.parseJsonOutput(res.text)
        if (parsed === null) {
          lastError = `输出不是合法 JSON：${res.text.slice(0, 120)}`
        } else {
          const schemaErr = this.validateSchema(node.schema, parsed)
          if (!schemaErr) {
            if (!node.reviewPrompt) return { ok: true, text: res.text, data: parsed }
            reviewCount++
            const verdict = await this.reviewStage(node.reviewPrompt, res.text, signal)
            if (!verdict || verdict.pass) return { ok: true, text: res.text, data: parsed } // 评审器故障 fail-open
            if (reviewCount > maxReview) {
              return { ok: false, error: `LLM 节点「${node.system.slice(0, 20)}…」评审未通过（重试 ${maxReview} 次后）：${verdict.problems.join('；')}` }
            }
            lastError = `评审未通过：${verdict.problems.join('；')}`
            messages.push({ role: 'assistant', content: res.text })
            messages.push({ role: 'user', content: `你的输出未通过质量评审：${verdict.problems.join('；')}。请针对以上问题修正后重新输出。` })
            continue
          }
          lastError = `JSON 校验失败：${schemaErr}`
        }
      }
      // 回喂错误，让模型修正后重试
      messages.push({ role: 'assistant', content: res.text })
      messages.push({ role: 'user', content: `输出不合法：${lastError}。请重新输出符合要求的内容。` })
    }
    return { ok: false, error: `LLM 节点「${node.system.slice(0, 20)}…」连续 ${maxTries + 1} 次输出不合法：${lastError}` }
  }

  /**
   * reviewPrompt 评审阶段：按评审提示让 LLM 审查输出。
   * @returns verdict（pass/problems）；null = 评审器自身失败（网络/解析）——fail-open 放行，不阻塞生成。
   */
  private async reviewStage(
    reviewPrompt: string,
    outputText: string,
    signal?: AbortSignal,
  ): Promise<{ pass: boolean; problems: string[] } | null> {
    try {
      const res = await this.generateImpl!.chat(
        [
          { role: 'system', content: reviewPrompt },
          { role: 'user', content: `请评审以下输出：\n\n${outputText}` },
        ] as LlmMessage[],
        undefined,
        signal,
      )
      if (res.kind !== 'text') return null
      const parsed = this.parseJsonOutput(res.text)
      if (parsed === null) return null
      const verdict = parsed as { pass?: unknown; problems?: unknown }
      return {
        pass: verdict.pass === true,
        problems: Array.isArray(verdict.problems) ? verdict.problems.map(String) : [],
      }
    } catch {
      return null
    }
  }

  /** 从 LLM 输出中提取 JSON（容忍 ```json 包裹、前后多余文字）。 */
  private parseJsonOutput(text: string): unknown {
    const trimmed = text.trim()
    const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed)
    const candidates = [fenced ? fenced[1] : trimmed]
    // 退一步：提取首个 { 到末尾最后一个 } 之间的内容（容忍前缀/后缀文字）
    const first = trimmed.indexOf('{')
    const last = trimmed.lastIndexOf('}')
    if (first >= 0 && last > first) candidates.push(trimmed.slice(first, last + 1))
    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate)
      } catch {
        /* 尝试下一个候选 */
      }
    }
    return null
  }

  /** JSON Schema 校验（复用工具参数校验器）。 */
  private validateSchema(schema: Record<string, unknown>, data: unknown): string | null {
    return validateToolInput(schema, data)
  }
}

/** 全局单例。 */
export const flowHost = new FlowHost()
