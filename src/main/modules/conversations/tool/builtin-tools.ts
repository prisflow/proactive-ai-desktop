import type { ToolDefinition, ToolResult, ToolPromptResult } from './types'
import { contextRegistry } from '../context/context-manager'
import { memorySet, memoryGet, memorySearch, memoryRemove } from './memory-store'

interface EnterResult { contextId: string; reason: string }
interface ExitResult { exited: true }
interface UiRenderResult { component: string; props: Record<string, unknown>; children?: unknown[] }

/** 工具失败时的统一 transformPrompt 产出形态。 */
function failPrompt(toolName: string, error: string): ToolPromptResult {
  return { success: { toolName, error } }
}

/** 工具成功且仅有文本结果时的统一产出形态。 */
function textPrompt(toolName: string, text: string): ToolPromptResult {
  return { success: { toolName }, result: { text } }
}

/**
 * 内置工具定义。所有工具均为纯验证 + 意图产出，无副作用。
 *
 * host_ 工具的结果入 bus 后，由 Runtime 的 consume() 统一回灌 LLM：
 * - enter_subcontext → Runtime 切换 activeContextId
 * - exit_subcontext → Runtime 恢复 activeContextId = 'main'
 * - render_ui → transformPrompt 产出 ui 文本进历史，树落库+推前端由统一结果处理路径完成
 *
 * 文本回复不走工具：LLM 直接流式输出（finish_reason: stop），
 * 由 consume() 的 stop 分支统一存库 + 推前端。
 *
 * contextRegistry 仅用于只读验证（检查 contextId 是否存在）。
 */
export function createBuiltinTools(): ToolDefinition[] {
  return [
    {
      name: 'host_enter_subcontext',
      description:
        '进入一个子上下文。切换后可用的工具和系统提示会变化。' +
        '调用方必须在已经注册的子上下文 ID 中选择一个，并说明玩家进入该子上下文的意图/请求（reason，作为该子上下文的首条用户消息）。' +
        '注意：此工具仅在主上下文可用。',
      inputSchema: {
        type: 'object',
        properties: {
          contextId: {
            type: 'string',
            description: '要进入的子上下文 ID',
          },
          reason: {
            type: 'string',
            description: '玩家进入该子上下文的意图/请求（将作为该子上下文的首条用户消息呈现给模型）',
          },
        },
        required: ['contextId', 'reason'],
      },
      silent: true,
      run: (input) => {
        const ctxId = typeof input.contextId === 'string' ? input.contextId : undefined
        const reason = typeof input.reason === 'string' ? input.reason.trim() : ''
        if (!ctxId) {
          return { ok: false, error: 'contextId is required' }
        }
        if (!reason) {
          return { ok: false, error: 'reason is required（请说明玩家进入该子上下文的意图）' }
        }
        if (!contextRegistry.has(ctxId)) {
          return { ok: false, error: `unknown context: ${ctxId}` }
        }
        return { ok: true, result: { contextId: ctxId, reason } satisfies EnterResult }
      },
    },
    {
      name: 'host_exit_subcontext',
      description:
        '退出当前子上下文，回到主上下文。退出后重新使用主上下文的事件和工具集。' +
        '注意：此工具仅在子上下文中可用。',
      inputSchema: { type: 'object', properties: {} },
      silent: true,
      run: () => {
        return { ok: true, result: { exited: true } satisfies ExitResult }
      },
    },
    {
      name: 'host_yield',
      description:
        '结束本轮并等待用户下一条消息。不产生新事件，总线排空后空闲。' +
        '仅当本轮已完成所需工具调用或判定无需调用时使用。',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      silent: true,
      run: () => {
        return { ok: true, result: { yield: true } }
      },
    },
    {
      name: 'host_memory_set',
      description: '写入通用记忆（按会话+上下文隔离）。slot 为键（同会话同上下文内覆盖），data 为内容，type 可选 world/character/faction 等，importance 默认为 normal。',
      inputSchema: {
        type: 'object',
        properties: {
          slot: { type: 'string', minLength: 1, description: '记忆键' },
          data: { type: 'string', minLength: 1, description: '记忆内容' },
          type: { type: 'string', description: '记忆类型' },
          importance: { type: 'string', enum: ['core', 'normal'], description: '重要度' },
        },
        required: ['slot', 'data'],
      },
      silent: false,
      transformPrompt: (result: ToolResult) => {
        if (!result.ok) return failPrompt('host_memory_set', result.error)
        const d = result.result as { slot?: string } | undefined
        return textPrompt('host_memory_set', `[记忆已写入] ${d?.slot ?? ''}`)
      },
      run: (input, meta) => {
        const conversationId = meta.conversationId
        const contextId = meta.contextId
        if (!conversationId) return { ok: false, error: 'conversationId 缺失' } as ToolResult
        const slot = String((input as Record<string, unknown>).slot || '').trim()
        const data = String((input as Record<string, unknown>).data || '').trim()
        if (!slot || !data) return { ok: false, error: 'slot/data 不能为空' } as ToolResult
        const type = typeof (input as Record<string, unknown>).type === 'string' ? String((input as Record<string, unknown>).type) : 'note'
        const importance = (input as Record<string, unknown>).importance === 'core' ? 'core' : 'normal'
        try {
          memorySet(conversationId, contextId, slot, data, type, importance)
          return { ok: true, result: { slot } } as ToolResult
        } catch (e) {
          return { ok: false, error: String(e) } as ToolResult
        }
      },
    },
    {
      name: 'host_memory_get',
      description: '读取单条通用记忆。按 slot 精确读取当前会话+上下文的记忆。',
      inputSchema: {
        type: 'object',
        properties: { slot: { type: 'string', minLength: 1 } },
        required: ['slot'],
      },
      silent: false,
      transformPrompt: (result: ToolResult) => {
        if (!result.ok) return failPrompt('host_memory_get', result.error)
        const d = result.result as { data?: string; slot?: string } | undefined
        return textPrompt('host_memory_get', d?.data ? `[记忆] ${d.slot}: ${d.data}` : '[记忆] 未找到')
      },
      run: (input, meta) => {
        const conversationId = meta.conversationId
        const contextId = meta.contextId
        const slot = String((input as Record<string, unknown>).slot || '').trim()
        try {
          const row = memoryGet(conversationId, contextId, slot)
          if (!row) return { ok: true, result: { slot, data: null } } as ToolResult
          return { ok: true, result: row } as ToolResult
        } catch (e) { return { ok: false, error: String(e) } as ToolResult }
      },
    },
    {
      name: 'host_memory_search',
      description: '搜索通用记忆。按关键词模糊匹配当前会话+上下文的所有记忆，返回 slot/data 列表。',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string', description: '关键词，为空则返回全部' } },
        required: [],
      },
      silent: false,
      transformPrompt: (result: ToolResult) => {
        if (!result.ok) return failPrompt('host_memory_search', result.error)
        const d = result.result as { items?: Array<{ slot: string; data: string }> } | undefined
        if (!d?.items?.length) return textPrompt('host_memory_search', '[记忆] 暂无')
        return textPrompt('host_memory_search', `[记忆] 共${d.items.length}条：` + d.items.map((i) => `${i.slot}: ${String(i.data).slice(0, 80)}`).join(' | '))
      },
      run: (input, meta) => {
        const conversationId = meta.conversationId
        const contextId = meta.contextId
        const query = typeof (input as Record<string, unknown>).query === 'string' ? String((input as Record<string, unknown>).query).trim() : ''
        try {
          const rows = memorySearch(conversationId, contextId, query)
          return { ok: true, result: { items: rows } } as ToolResult
        } catch (e) { return { ok: false, error: String(e) } as ToolResult }
      },
    },
    {
      name: 'host_memory_remove',
      description: '删除通用记忆。按 slot 删除当前会话+上下文的记忆。',
      inputSchema: {
        type: 'object',
        properties: { slot: { type: 'string', minLength: 1 } },
        required: ['slot'],
      },
      silent: false,
      transformPrompt: (result: ToolResult) => {
        if (!result.ok) return failPrompt('host_memory_remove', result.error)
        return textPrompt('host_memory_remove', `[记忆已删除] ${(result.result as { slot?: string })?.slot ?? ''}`)
      },
      run: (input, meta) => {
        const conversationId = meta.conversationId
        const contextId = meta.contextId
        const slot = String((input as Record<string, unknown>).slot || '').trim()
        try {
          const ok = memoryRemove(conversationId, contextId, slot)
          if (!ok) return { ok: false, error: `记忆 ${slot} 不存在` } as ToolResult
          return { ok: true, result: { slot } } as ToolResult
        } catch (e) { return { ok: false, error: String(e) } as ToolResult }
      },
    },
    {
      name: 'host_render_ui',
      description:
        '向用户展示交互式 UI 组件。\n' +
        '可用组件类型：\n' +
        '- Row：横向排列布局，className 可用 flex/gap/justify-* 等 Tailwind 类\n' +
        '  props: { className?: string }\n' +
        '- Column：纵向排列布局，className 可用 flex-col/gap-* 等 Tailwind 类\n' +
        '  props: { className?: string }\n' +
        '- Text：文本展示\n' +
        '  props: { content?: string（文本内容）, size?: "xs"|"sm"|"md"|"lg"（字号）, className?: string }\n' +
        '- Button：可点击按钮，点击后发送 action.text 到对话\n' +
        '  props: { content?: string（按钮文字）, action?: { type: "send", text: string（点击后发送的文本） }, className?: string（仅限布局类，不可传颜色相关类） }\n' +
        '- Divider：水平分割线\n' +
        '  props: { className?: string }\n' +
        'Row 和 Column 通过 children 数组传入嵌套子组件，children 每项为 { component, props?, children? }。\n' +
        'className 接受标准 Tailwind 布局类名（如 gap-* / mt-* / w-* 等），不可传颜色相关类。只在需要覆盖默认样式时传入。',
      inputSchema: {
        type: 'object',
        properties: {
          component: {
            type: 'string',
            enum: ['Row', 'Column', 'Text', 'Button', 'Divider'],
            description: 'UI 组件类型',
          },
          props: {
            type: 'object',
            description: '组件属性。参见 description 中各组件 props 说明',
            properties: {
              content: { type: 'string', description: 'Text/Button 的文本内容' },
              size: { type: 'string', enum: ['xs', 'sm', 'md', 'lg'], description: 'Text 的字号' },
              className: { type: 'string', description: '覆盖默认样式的 Tailwind 类名' },
              action: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['send'], description: '动作类型' },
                  text: { type: 'string', description: '点击按钮后发送的文本' },
                },
                required: ['type', 'text'],
                description: '仅 Button 组件可用。按钮点击后自动将 text 作为用户消息发送到对话',
              },
            },
          },
          children: {
            type: 'array',
            description: '子组件列表，每项为 { component: string, props?: object, children?: array }。仅 Row/Column 支持',
            items: {
              type: 'object',
              properties: {
                component: { type: 'string', enum: ['Row', 'Column', 'Text', 'Button', 'Divider'] },
                props: { type: 'object' },
                children: { type: 'array' },
              },
              required: ['component'],
            },
          },
        },
        required: ['component'],
      },
      silent: false,
      // render_ui 也是普通工具：transformPrompt 把渲染树文本化为 ui 产物进历史；
      // 树的落库 + 前端推送由统一结果处理路径完成（Runtime 结果处理，非 consume 静态分支）
      transformPrompt: (result: ToolResult) => {
        if (!result.ok) return failPrompt('host_render_ui', result.error)
        const data = result.result as UiRenderResult
        const uiText = formatUiTree(data)
        return { success: { toolName: 'host_render_ui' }, result: { ui: uiText } }
      },
      run: (input) => {
        const component = typeof input.component === 'string' ? input.component : undefined
        if (!component || !['Row', 'Column', 'Text', 'Button', 'Divider'].includes(component)) {
          return { ok: false, error: 'component is required and must be one of: Row, Column, Text, Button, Divider' }
        }
        return {
          ok: true,
          result: {
            component,
            props: typeof input.props === 'object' && input.props !== null
              ? (input.props as Record<string, unknown>)
              : {},
            children: Array.isArray(input.children) ? input.children : undefined,
          } satisfies UiRenderResult,
        }
      },
    },
  ]
}

/** 渲染树 → LLM 可读文本（transformPrompt 的 ui 产物）。 */
function formatUiTree(tree: UiRenderResult): string {
  const fmt = (chs: unknown[] | undefined): string => {
    if (!chs?.length) return ''
    return chs.map((c) => {
      const n = c as { component: string; props?: Record<string, unknown>; children?: unknown[] }
      const propsStr = n.props
        ? Object.entries(n.props)
            .filter(([k]) => k !== 'className')
            .map(([k, v]) => `${k}=${v}`)
            .join(' ')
        : ''
      const childStr = n.children?.length ? ` [${fmt(n.children)}]` : ''
      return `${n.component}(${propsStr})${childStr}`
    }).join(', ')
  }
  const childrenText = fmt(tree.children)
  return `[UI:${tree.component}]${childrenText ? ` ${childrenText}` : ''}`
}
