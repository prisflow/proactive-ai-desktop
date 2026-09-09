/**
 * TrayMenu —— 托盘弹出菜单（宿主自绘，替代原生 Menu；与插件菜单同视觉风格）。
 * 动作经 preload 的 trayMenu 通道发往主进程（tray.ts 处理：显示窗口/退出）。
 */
type TrayAction = 'show' | 'quit'

const api = window.electronAPI.trayMenu

function item(label: string, act: TrayAction): React.ReactNode {
  return (
    <div
      className="whitespace-nowrap rounded-md px-3 py-1.5 text-xs text-[#f5f5f5] cursor-pointer hover:bg-white/12"
      onClick={() => api?.action(act)}
    >
      {label}
    </div>
  )
}

export default function TrayMenu() {
  return (
    <div className="rounded-xl border border-white/8 bg-[rgba(34,34,38,0.96)] p-[5px] shadow-[0_6px_20px_rgba(0,0,0,0.45)]">
      {item('显示窗口', 'show')}
      <div className="my-1 h-px mx-2 bg-white/10" />
      {item('退出', 'quit')}
    </div>
  )
}
