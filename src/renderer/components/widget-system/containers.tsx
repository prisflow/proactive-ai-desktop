import type { AtomProps } from './atoms'

/** 水平行布局容器。子元素沿主轴横向排列。 */
export function WidgetRow({ children, className }: AtomProps & { children?: React.ReactNode }) {
  return <div className={`flex flex-row items-center gap-2 ${className || ''}`}>{children}</div>
}

/** 垂直列布局容器。子元素沿主轴纵向排列。 */
export function WidgetColumn({ children, className }: AtomProps & { children?: React.ReactNode }) {
  return <div className={`flex flex-col gap-1 ${className || ''}`}>{children}</div>
}
