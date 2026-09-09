/**
 * 托盘：图标 + 对话弹出菜单（React 渲染 tray.html，与主菜单同视觉风格）。
 * 交互约定 → 左键显示主窗口；右键弹出 → 点击自绘菜单（显示窗口/退出），失焦自动关闭。
 */
import { app, Tray, nativeImage, screen, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import { TRAY_MENU } from '@shared/constants'
import { getMainWindow } from './window'

// 务必保留引用，否则会被GC回收
let tray: Tray | null = null
let menuWin: BrowserWindow | null = null

/** 弹出/收起托盘菜单（QQ 式定位：以右键点击点为菜单左下角，向右上生长，贴边夹取）。 */
function toggleMenuPopover(cx: number, cy: number): void {
  if (!tray) return
  if (menuWin && menuWin.isVisible()) {
    menuWin.hide()
    return
  }
  if (!menuWin) {
    menuWin = new BrowserWindow({
      width: TRAY_MENU.width,
      height: TRAY_MENU.height,
      frame: false,
      transparent: true,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      hasShadow: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        nodeIntegration: false,
        contextIsolation: true,
      },
    })
    menuWin.setMenuBarVisibility(false)
    // 渲染面 = 宿主 React 工程的 tray 入口（与宿主同构建同版本）：dev 走 dev server，prod 加载构建产物
    if (process.env.ELECTRON_RENDERER_URL) {
      void menuWin.loadURL(`${process.env.ELECTRON_RENDERER_URL}/tray.html`)
    } else {
      void menuWin.loadFile(path.join(__dirname, '../renderer/tray.html'))
    }
    menuWin.on('blur', () => menuWin?.hide())
    menuWin.on('closed', () => { menuWin = null })
  }
  const { workArea } = screen.getPrimaryDisplay()
  const x = Math.max(workArea.x + 8, Math.min(cx, workArea.x + workArea.width - TRAY_MENU.width - 8))
  let y = cy - TRAY_MENU.height
  if (y < workArea.y + 8) y = workArea.y + 8
  menuWin.setPosition(Math.round(x), Math.round(y))
  menuWin.show()
  menuWin.focus()
}

/**
 * 创建系统托盘图标和弹出菜单。
 * 点击后最小化到托盘而非关闭，保留在后台运行。
 */
export function createTray(): void {
  if (tray) return

  // 托盘图标：
  // - 打包后：extraResources 把 resources/ 复制为 resources/resources/，app.getAppPath()=resources/app.asar，
  //   用 .. 回父目录再进 resources/（即 resources/resources/icon.png）。
  // - 开发时：app.getAppPath()=项目根，resources/icon.png 指向项目内副本。
  const iconPath = app.isPackaged
    ? path.join(app.getAppPath(), '..', 'resources', 'icon.png')
    : path.join(app.getAppPath(), 'resources', 'icon.png')
  const icon = nativeImage.createFromPath(iconPath)
  tray = new Tray(icon.resize({ width: 16, height: 16 }))

  // 自绘菜单动作
  ipcMain.on('tray-menu:action', (_ev, action: string) => {
    if (menuWin) menuWin.hide()
    if (action === 'show') {
      const win = getMainWindow()
      if (win) {
        win.show()
        win.focus()
      }
    } else if (action === 'quit') {
      app.quit()
    }
  })

  tray.setToolTip('ProactiveAI')

  // 右键：弹出自绘菜单（以点击点为菜单左下角）
  tray.on('right-click', () => {
    const pt = screen.getCursorScreenPoint()
    toggleMenuPopover(pt.x, pt.y)
  })

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
  if (menuWin) {
    menuWin.destroy()
    menuWin = null
  }
  if (tray) {
    tray.destroy()
    tray = null
  }
}
