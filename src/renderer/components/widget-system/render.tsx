import type { WidgetNode } from '@shared'
import {
  WidgetButton, WidgetText, WidgetDivider,
  WidgetImage, WidgetProgress, WidgetTable, WidgetCard, WidgetBadge,
  WidgetList, WidgetCode, WidgetForm, WidgetConfirm, WidgetIcon, WidgetLoading,
} from './atoms'
import { WidgetRow, WidgetColumn } from './containers'

/**
 * 组件类型到渲染组件的映射表。
 * key 为 WidgetNodeType 枚举值，value 为对应 React 组件。
 */
const ATOMS: Record<string, React.ComponentType<Record<string, unknown>>> = {
  Row: WidgetRow, Column: WidgetColumn,
  Text: WidgetText, Button: WidgetButton, Divider: WidgetDivider,
  Image: WidgetImage, Progress: WidgetProgress, Table: WidgetTable,
  Card: WidgetCard, Badge: WidgetBadge, List: WidgetList, Code: WidgetCode,
  Form: WidgetForm, Confirm: WidgetConfirm,
  Icon: WidgetIcon, Loading: WidgetLoading,
}

/**
 * 递归渲染 Widget 节点树。
 * @param node - Widget 节点
 * @param messageId - 所属消息的 ID（供 WidgetButton 判定是否为可交互 UI）
 * @param index - 同级兄弟节点中的序号，用作 React key
 * @param parentKey - 父级 key 前缀，保证 key 唯一
 */
export function renderWidgetNode(node: WidgetNode, messageId: string, index: number, parentKey = ''): React.ReactNode {
  const { type, props = {}, children } = node
  const resolvedType = type || (node as unknown as Record<string, unknown>).component as string
  const C = ATOMS[resolvedType]
  if (!C) {
    console.warn('[widget] unknown type:', resolvedType, 'available:', Object.keys(ATOMS))
    return null
  }
  const key = `${parentKey}-${resolvedType}-${index}`
  return (
    <C key={key} messageId={messageId} {...props}>
      {children?.map((c, i) => renderWidgetNode(c, messageId, i, key))}
    </C>
  )
}
