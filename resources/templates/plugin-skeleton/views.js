/**
 * 表现层：把状态渲染成 WidgetNode 树（buildScreen 模式）。只读状态，禁止修改数据。
 * 可用组件：Row/Column/Text/Button/Divider/Card/Badge/List/Progress/Table/Image/Code/Icon/Loading/Form/Confirm
 * 颜色仅使用宿主调色板契约内的类（见宿主 index.css 的 @source inline 色板）。
 */
function createViews(rules) {
  return {
    /** 示例：主屏。 */
    buildScreen(w) {
      return {
        component: 'Column',
        props: { className: 'gap-2' },
        children: [
          { component: 'Text', props: { content: '插件已就绪', size: 'lg' } },
        ],
      }
    },
  }
}

module.exports = { createViews }
