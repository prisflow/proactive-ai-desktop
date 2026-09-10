import { useState } from 'react'
import { icons } from 'lucide-react'

/** 所有 Widget 原子组件共有的属性。 */
export interface AtomProps {
  className?: string
}

/** 交互动作：点击/提交 = 以组装文本发起一条普通用户消息。按钮永远可点，无任何可用性状态机。 */
export interface WidgetAction {
  type: 'send'
  /** 人类可读摘要；缺省时由 payload 聚合。 */
  text?: string
  /** 结构化数据：聚合为 `【组件交互】{title}\n{JSON 透传}` 回灌（LLM 对 JSON 鲁棒性最好）。 */
  payload?: Record<string, unknown>
}

/** 由 action 组装回灌文本：text 优先；payload 聚合为 JSON 透传。 */
export function buildActionText(action: WidgetAction, fallbackTitle?: string): string | null {
  if (action.type !== 'send') return null
  if (action.text) return action.text
  if (action.payload && Object.keys(action.payload).length > 0) {
    const title = fallbackTitle ? `【组件交互】${fallbackTitle}` : '【组件交互】'
    return `${title}\n${JSON.stringify(action.payload)}`
  }
  return fallbackTitle ?? null
}

/** WidgetButton 额外属性 */
interface WidgetButtonProps {
  content?: string
  action?: WidgetAction
  messageId?: string
}

/** 按钮。素色卡片风格。点击时若 action 存在则发送消息。按钮所属的 UI 消息存在即可交互（不要求最新）。 */
export function WidgetButton({ content, className, action, messageId }: AtomProps & WidgetButtonProps) {
  const handleClick = async () => {
    if (!action || action.type !== 'send') return
    const text = buildActionText(action, content)
    if (!text) return
    const { useChatStore } = await import('@/stores/chatStore')
    const { useConversationStore } = await import('@/stores/conversationStore')
    const convId = useConversationStore.getState().currentConversationId
    if (!convId) return
    // 该 widgetNode 消息仍存在于对话中即可点击（引擎可能在 UI 推送后又追加文字说明，
    // 若要求"必须是最新消息"会把这些按钮全部置灰）
    const msgs = useChatStore.getState().messages[convId] ?? []
    if (!msgs.some((m) => m.id === messageId && m.widgetNode)) return
    useChatStore.getState().sendMessage(convId, text)
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm text-black hover:bg-gray-800 hover:text-white hover:border-gray-600 ${className || ''}`}
    >
      {content}
    </button>
  )
}

/** 文本。仅控制字号，颜色和粗细统一跟随主题。保留换行与空白（支持多行剧情）。 */
export function WidgetText({ content, size = 'sm', className }: { content?: string; size?: 'xs' | 'sm' | 'md' | 'lg' } & AtomProps) {
  const s: Record<string, string> = { xs: 'text-[10px]', sm: 'text-xs', md: 'text-sm', lg: 'text-base' }
  return <span className={`${s[size] || s.sm} whitespace-pre-wrap break-words text-[var(--app-fg)] ${className || ''}`}>{content}</span>
}

/** 水平分割线。 */
export function WidgetDivider({ className }: AtomProps) {
  return <div className={`h-px w-full bg-[var(--app-border)] ${className || ''}`} />
}

// ==================== 展示组件 ====================

/** 图片。src 支持 data URI 或 URL，宽度自适应容器。 */
export function WidgetImage({ src, alt, width, className }: AtomProps & { src?: string; alt?: string; width?: number }) {
  if (!src) return null
  return <img src={src} alt={alt || ''} style={width ? { width } : undefined} className={`max-w-full rounded-lg ${className || ''}`} />
}

/** 进度条。任意进度语义（label + value/max）。 */
export function WidgetProgress({ label, value = 0, max = 100, color = 'default', className }: AtomProps & { label?: string; value?: number; max?: number; color?: 'default' | 'success' | 'warning' | 'danger' }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  const bar: Record<string, string> = {
    default: 'bg-[var(--app-accent,#6366f1)]',
    success: 'bg-emerald-500', warning: 'bg-amber-500', danger: 'bg-red-500',
  }
  return (
    <div className={`w-full ${className || ''}`}>
      {(label || max > 0) && (
        <div className="mb-0.5 flex justify-between text-[10px] text-[var(--app-fg-muted,inherit)] opacity-70">
          <span>{label}</span>
          <span>{value}/{max}</span>
        </div>
      )}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/20 dark:bg-white/20">
        <div className={`h-full rounded-full ${bar[color] || bar.default}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

/** 表格。columns 定义列（key 取值 + 表头），rows 为行数据数组。 */
export function WidgetTable({ columns, rows, className }: AtomProps & {
  columns?: Array<{ key: string; label?: string; width?: number }>
  rows?: Array<Record<string, unknown>>
  className?: string
}) {
  if (!columns?.length || !rows?.length) return null
  return (
    <div className={`w-full overflow-x-auto ${className || ''}`}>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={c.key || i} style={c.width ? { width: c.width } : undefined}
                className="border-b border-[var(--app-border)] px-2 py-1 text-left font-medium opacity-70">
                {c.label || c.key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-[var(--app-border)] last:border-0">
              {columns.map((c, ci) => (
                <td key={c.key || ci} className="px-2 py-1 align-top">{String(row[c.key] ?? '')}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** 卡片。带边框与内边距的语义化分组容器。标题可选；titleAlign 控制对齐（left/center）；
 * collapsible 时标题行右侧显示展开/收起箭头（defaultCollapsed 定初始态），折叠时正文不渲染。 */
export function WidgetCard({ title, titleAlign = 'left', collapsible, defaultCollapsed, children, className }: AtomProps & {
  title?: string
  titleAlign?: 'left' | 'center'
  collapsible?: boolean
  defaultCollapsed?: boolean
  children?: React.ReactNode
}) {
  const [collapsed, setCollapsed] = useState(!!collapsible && !!defaultCollapsed)
  const alignCls = titleAlign === 'center' ? 'text-center' : 'text-left'
  const showHeader = !!title || !!collapsible
  return (
    <div className={`w-full rounded-xl border border-[var(--app-border)] p-3 ${className || ''}`}>
      {showHeader && (
        <div className={`relative mb-1.5 flex min-h-5 items-center ${alignCls}`}>
          <div className={`flex-1 text-xs font-medium opacity-80 ${alignCls}`}>{title}</div>
          {collapsible && (
            <button
              type="button"
              onClick={() => setCollapsed(!collapsed)}
              className="absolute right-0 flex h-5 w-5 items-center justify-center rounded text-[var(--app-muted)] hover:bg-black/10 dark:hover:bg-white/10"
              aria-label={collapsed ? '展开' : '收起'}
            >
              <icons.ChevronDown size={14} className={`transition-transform ${collapsed ? '' : 'rotate-180'}`} />
            </button>
          )}
        </div>
      )}
      {!collapsed && <div className="flex flex-col gap-1">{children}</div>}
    </div>
  )
}

const BADGE_VARIANTS: Record<string, string> = {
  default: 'bg-black/10 dark:bg-white/10 border-black/25 dark:border-white/25 text-[var(--app-fg)]',
  plain: '',
  success: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-600 dark:text-emerald-400',
  warning: 'bg-amber-500/15 border-amber-500/40 text-amber-600 dark:text-amber-400',
  danger: 'bg-red-500/15 border-red-500/40 text-red-600 dark:text-red-400',
}

/** 状态标签。圆角方牌：variant 三件套 + 可选 lucide 图标前缀，与相邻文本垂直居中。
 * 默认文字单行（nowrap）；wrap = true 时允许折行（长描述徽章用）。颜色可由 className 全权定义（plain = 零色类）。 */
export function WidgetBadge({ text, icon, variant = 'default', wrap, className }: AtomProps & { text?: string; icon?: string; variant?: 'default' | 'plain' | 'success' | 'warning' | 'danger'; wrap?: boolean }) {
  if (!text && !icon) return null
  const I = icon ? (icons as Record<string, React.ComponentType<{ size?: number; className?: string }>>)[icon] : null
  const v = variant in BADGE_VARIANTS ? BADGE_VARIANTS[variant] : BADGE_VARIANTS.default
  return (
    <span className={`inline-flex items-center gap-1 ${wrap ? 'whitespace-normal' : 'whitespace-nowrap'} rounded-md border px-2 py-0.5 text-[11px] font-medium ${v} ${className || ''}`}>
      {I ? <I size={12} /> : null}
      {text}
    </span>
  )
}

/** 列表。有序/无序。 */
export function WidgetList({ items, ordered, className }: AtomProps & { items?: string[]; ordered?: boolean }) {
  if (!items?.length) return null
  const Tag = ordered ? 'ol' : 'ul'
  return (
    <Tag className={`flex flex-col gap-0.5 pl-4 text-xs ${ordered ? 'list-decimal' : 'list-disc'} ${className || ''}`}>
      {items.map((it, i) => <li key={i}>{it}</li>)}
    </Tag>
  )
}

/** 代码块。等宽字体 + 主题背景（不语法高亮，保持零依赖）。 */
export function WidgetCode({ lang, content, className }: AtomProps & { lang?: string; content?: string }) {
  if (!content) return null
  return (
    <div className={`w-full overflow-x-auto rounded-lg bg-black/85 p-2.5 ${className || ''}`}>
      {lang && <div className="mb-1 text-[10px] uppercase tracking-wide text-white/40">{lang}</div>}
      <pre className="text-xs leading-relaxed text-white/90"><code className="font-mono">{content}</code></pre>
    </div>
  )
}

/** lucide 图标。name 为 lucide 导出的图标组件名（如 'Sword'、'Flame'）。 */
export function WidgetIcon({ name, size = 16, color, className }: AtomProps & { name?: string; size?: number; color?: string }) {
  if (!name) return null
  const I = (icons as Record<string, React.ComponentType<{ size?: number; color?: string; className?: string }>>)[name]
  if (!I) return null
  return <I size={size} color={color} className={className} />
}

/** 占位指示。旋转圆环 + 可选标签。 */
export function WidgetLoading({ label, className }: AtomProps & { label?: string }) {
  return (
    <div className={`flex items-center gap-2 text-xs opacity-70 ${className || ''}`}>
      <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      {label}
    </div>
  )
}

// ==================== 输入组件 ====================

/** Form 字段定义。 */
export interface WidgetFormField {
  name: string
  label: string
  kind: 'select' | 'text' | 'number' | 'checkbox'
  options?: string[]
  placeholder?: string
  required?: boolean
  min?: number
  max?: number
  default?: string | number | boolean
}

const FIELD_CLASS = 'w-full rounded-lg border border-[var(--app-border)] bg-transparent px-2.5 py-1.5 text-xs text-[var(--app-fg)] outline-none focus:border-[var(--app-accent,#6366f1)]'

/** 表单。多控件聚合提交：点击提交时收集全部字段值进 action.payload 一次回灌。 */
export function WidgetForm({ title, fields, submitLabel = '提交', action, messageId, className }: AtomProps & {
  title?: string
  fields?: WidgetFormField[]
  submitLabel?: string
  action?: WidgetAction
  messageId?: string
}) {
  const [values, setValues] = useState<Record<string, string | number | boolean>>(() => {
    const init: Record<string, string | number | boolean> = {}
    for (const f of fields ?? []) {
      if (f.default !== undefined) init[f.name] = f.default
      else if (f.kind === 'checkbox') init[f.name] = false
      else if (f.kind === 'number') init[f.name] = f.min ?? 0
      else init[f.name] = ''
    }
    return init
  })

  if (!fields?.length) return null

  const set = (name: string, v: string | number | boolean) => setValues((prev) => ({ ...prev, [name]: v }))

  const submit = async () => {
    if (!action || action.type !== 'send') return
    const text = buildActionText({ type: 'send', text: action.text, payload: { ...(action.payload ?? {}), ...values } }, title ?? submitLabel)
    if (!text) return
    const { useChatStore } = await import('@/stores/chatStore')
    const { useConversationStore } = await import('@/stores/conversationStore')
    const convId = useConversationStore.getState().currentConversationId
    if (!convId) return
    const msgs = useChatStore.getState().messages[convId] ?? []
    if (!msgs.some((m) => m.id === messageId && m.widgetNode)) return
    useChatStore.getState().sendMessage(convId, text)
  }

  return (
    <div className={`w-full rounded-xl border border-[var(--app-border)] p-3 ${className || ''}`}>
      {title && <div className="mb-2 text-xs font-medium opacity-80">{title}</div>}
      <div className="flex flex-col gap-2">
        {fields.map((f) => (
          <label key={f.name} className="flex flex-col gap-1">
            <span className="text-[10px] opacity-70">{f.label}{f.required && ' *'}</span>
            {f.kind === 'select' ? (
              <select className={FIELD_CLASS} value={String(values[f.name] ?? '')} onChange={(e) => set(f.name, e.target.value)}>
                <option value="">请选择…</option>
                {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : f.kind === 'checkbox' ? (
              <input type="checkbox" className="h-4 w-4 accent-[var(--app-accent,#6366f1)]"
                checked={!!values[f.name]} onChange={(e) => set(f.name, e.target.checked)} />
            ) : (
              <input type={f.kind === 'number' ? 'number' : 'text'} className={FIELD_CLASS}
                placeholder={f.placeholder} min={f.min} max={f.max}
                value={String(values[f.name] ?? '')}
                onChange={(e) => set(f.name, f.kind === 'number' ? Number(e.target.value) : e.target.value)} />
            )}
          </label>
        ))}
        <button type="button" onClick={submit}
          className="mt-1 w-full rounded-lg bg-[var(--app-accent,#6366f1)] px-4 py-2 text-sm text-white hover:opacity-90">
          {submitLabel}
        </button>
      </div>
    </div>
  )
}

/** 确认对。确认/取消两个独立动作（危险操作的通用确认形态）。 */
export function WidgetConfirm({ title, content, confirmLabel = '确认', cancelLabel = '取消', confirmAction, cancelAction, messageId, className }: AtomProps & {
  title?: string
  content?: string
  confirmLabel?: string
  cancelLabel?: string
  confirmAction?: WidgetAction
  cancelAction?: WidgetAction
  messageId?: string
  className?: string
}) {
  return (
    <div className={`w-full rounded-xl border border-[var(--app-border)] p-3 ${className || ''}`}>
      {title && <div className="mb-1 text-xs font-medium">{title}</div>}
      {content && <div className="mb-2 text-xs opacity-70"><WidgetText content={content} /></div>}
      <div className="flex gap-2">
        <div className="flex-1"><WidgetButton content={confirmLabel} action={confirmAction} messageId={messageId} /></div>
        <div className="flex-1"><WidgetButton content={cancelLabel} action={cancelAction} messageId={messageId} className="opacity-70" /></div>
      </div>
    </div>
  )
}
