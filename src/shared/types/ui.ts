/**
 * Widget 原子组件类型枚举。
 * 每个值对应 `components/widget-system/atoms.tsx` 中的一个渲染组件。
 *
 * 交互模型：Button / Form / Confirm 携带 action——点击 = 以组装文本发起一条普通用户消息
 * （走完整会话管线：历史、落库、流式）。按钮永远可点，无任何可用性状态机。
 *
 * 回喂文本化约定（transformPrompt 侧将渲染树转述给 LLM 时遵循）：
 * - Progress → `[进度] {label}: {value}/{max}`
 * - Table    → `[表格] 列: a|b|c; 行数: N`
 * - Form     → `[表单] {title} 字段: {label}(类型)…，提交后内容回灌`
 * - Badge    → `[状态] {text}`；Image → `[图片: {alt}]`；其余组件按内容直述
 */
export type WidgetNodeType =
  | 'Row'
  | 'Column'
  | 'Text'
  | 'Button'
  | 'Divider'
  | 'Image'
  | 'Progress'
  | 'Table'
  | 'Card'
  | 'Badge'
  | 'List'
  | 'Code'
  | 'Form'
  | 'Confirm'
  | 'Icon'
  | 'Loading'

/**
 * Widget 渲染树中的一个节点。
 * 通过递归嵌套 children 构造任意 UI 结构，由 `renderWidgetNode()` 递归渲染。
 */
export interface WidgetNode {
  /** 当前节点的组件类型。 */
  type: WidgetNodeType
  /**
   * 节点属性。不同 `type` 有不同 props 约定（见 `components/widget-system/atoms.tsx` 中的对应组件注释）：
   * Text 接受 `content`、`size`；Button 接受 `content`、`action`；Progress 接受 `label`、`value`、`max` 等。
   */
  props: Record<string, unknown> | null
  /** 子节点列表。Row/Column/Card 等容器组件通过 children 实现嵌套布局。 */
  children: WidgetNode[] | null
}
