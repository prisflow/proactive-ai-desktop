import { app, Tray, Menu, nativeImage } from 'electron'
import path from 'path'
import { getMainWindow } from './window'

// 务必保留引用，否则会被GC回收
let tray: Tray | null = null

/**
 * 创建系统托盘图标和上下文菜单。
 * 点击后最小化到托盘而非关闭，保留在后台运行。
 */
export function createTray(): void {
  if (tray) return

  // 托盘图标
  const iconPath = path.join(__dirname, '../../build/icon.png')
  const icon = nativeImage.createFromPath(iconPath)
  tray = new Tray(icon.resize({ width: 16, height: 16 }))

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => {
        const win = getMainWindow()
        if (win) {
          win.show()
          win.focus()
        }
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.quit()
      },
    },
  ])

  tray.setToolTip('ProactiveAI')
  tray.setContextMenu(contextMenu)

  // 点击托盘图标显示窗口
  tray.on('click', () => {
    const win = getMainWindow()
    if (win) {
      win.show()
      win.focus()
    }
  })
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
}
