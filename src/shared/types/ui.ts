/**
 * Widget 原子组件类型枚举。
 * 每个值对应 `components/widget-system/atoms.tsx` 中的一个渲染组件。
 */
export type WidgetNodeType =
  | 'Row'
  | 'Column'
  | 'Text'
  | 'Button'
  | 'Divider'

/**
 * Widget 布局树中的一个节点。
 * 通过递归嵌套 children 构建完整的 UI 组件树，由 `renderWidgetNode()` 递归渲染。
 */
export interface WidgetNode {
  /** 当前节点的组件类型。 */
  type: WidgetNodeType
  /**
   * 节点属性。不同 `type` 有不同 props 合约，由 `components/widget-system/atoms.tsx` 中的对应组件解析。
   * 例如 Text 会用 `content`、`size`、`color`，Button 会用 `content`、`variant` 等。
   */
  props?: Record<string, unknown>
  /** 子节点列表。Row/Column 等容器类型通过 children 实现嵌套布局。 */
  children?: WidgetNode[]
}
