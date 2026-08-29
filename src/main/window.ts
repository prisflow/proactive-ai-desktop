import { BrowserWindow } from 'electron'
import path from 'path'
import { logService, uniqueRunId } from './services/logger'

/** Electron console-message 事件的结构化参数。 */
interface ConsoleMessage {
  /** console 级别：0=debug/log, 1=info, 2=warn, 3=error */
  level: number
  /** 日志文本内容 */
  message: string
  /** 调用 console 的源文件行号 */
  line: number
  /** 调用 console 的源文件标识 */
  sourceId: string
}

const WINDOW_TITLE = 'ProactiveAI'

let mainWindow: BrowserWindow | null = null

/** 模块级私有单例，避免冗余信息暴露 **/
export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function createWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: WINDOW_TITLE,
    frame: false,
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 12, y: 14 } }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  // 渲染进程 console 日志回传到 LogService
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const msg: ConsoleMessage = { level, message, line, sourceId }
    const LEVEL_MAP = ['info', 'info', 'warn', 'error'] as const
    const lvl = LEVEL_MAP[msg.level] ?? 'info'
    const prefix = msg.sourceId ? `[renderer:${msg.sourceId.split('/').pop()}:${msg.line}]` : '[renderer]'
    const runId = `renderer_${Date.now()}`
    logService.append({ ts: Date.now(), level: lvl, runId, source: 'renderer', name: prefix, message: msg.message })
  })

  // 渲染进程崩溃/无响应诊断：闪退排查（崩溃前渲染层来不及写日志，靠这里记录原因）
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logService.log('error', 'error', {
      runId: uniqueRunId('runtime'),
      name: 'window.render-process-gone',
      message: `renderer gone: ${details.reason} (exitCode=${details.exitCode})`,
      data: { reason: details.reason, exitCode: details.exitCode },
    })
  })
  mainWindow.webContents.on('unresponsive', () => {
    logService.log('warn', undefined, {
      runId: uniqueRunId('runtime'),
      name: 'window.unresponsive',
      message: 'renderer unresponsive',
    })
  })

  mainWindow.on('closed', () => { mainWindow = null })

  return mainWindow
}
