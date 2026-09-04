/**
 * Relay 通道控制 IPC —— 设置页手动连接用。
 * - relay:status → 当前状态（off/connecting/online）+ 最近一次连接失败原因
 * - relay:connect → 手动连接（url + code，deviceId 自动生成并持久化；url 留空用官方默认中继）
 * - relay:disconnect → 断开
 * 设计：连接只由用户在设置页手动触发，应用启动不做任何自动连接。
 */
import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import { relayClient } from './relay-client'
import { globalConfigStore } from '../services/store'
import { DEFAULT_RELAY_URL } from '../../shared/constants'
/** 本机局域网 IPv4（第一个非回环地址；找不到则回环兜底）。 */
function lanIp(): string {
  for (const nets of Object.values(networkInterfaces())) {
    for (const net of nets ?? []) {
      if (net.family === 'IPv4' && !net.internal) return net.address
    }
  }
  return '127.0.0.1'
}

/**
 * 从持久化配置拼手机访问链接。
 * 中继地址的回环 host（127.0.0.1/localhost）自动替换为局域网 IP（手机可直达）。
 */
function phoneLinkFromConfig(config: { relayUrl: string | null; relayCode: string | null; relayDeviceId: string | null }): string | null {
  if (!config.relayUrl || !config.relayCode || !config.relayDeviceId) return null
  try {
    const base = new URL(config.relayUrl.replace(/^ws/, 'http').replace(/\/relay\/?$/, ''))
    if (base.hostname === '127.0.0.1' || base.hostname === 'localhost') {
      base.hostname = lanIp()
    }
    return `${base.origin}/?device=${encodeURIComponent(config.relayDeviceId)}&code=${encodeURIComponent(config.relayCode)}`
  } catch {
    return null
  }
}

export function registerRelayIpc(): void {
  ipcMain.handle('relay:status', () => {
    return { state: relayClient.state, lastError: relayClient.lastError ?? null }
  })

  ipcMain.handle('relay:link', async () => {
    return { link: relayClient.state === 'online' ? phoneLinkFromConfig(await globalConfigStore.get()) : null }
  })

  ipcMain.handle('relay:connect', async (_ev, url: string, code: string) => {
    // 地址留空 → 使用官方默认中继
    const trimmedUrl = (url ?? '').trim() || DEFAULT_RELAY_URL
    const trimmedCode = (code ?? '').trim()
    if (!trimmedCode) {
      return { ok: false, error: '配对码不能为空' }
    }
    let config = await globalConfigStore.get()
    let deviceId = config.relayDeviceId
    if (!deviceId) {
      deviceId = randomUUID()
      config = await globalConfigStore.set({ relayDeviceId: deviceId })
    }
    await globalConfigStore.set({ relayUrl: trimmedUrl, relayCode: trimmedCode })
    relayClient.connect(trimmedUrl, deviceId, trimmedCode)
    return { ok: true, deviceId }
  })

  ipcMain.handle('relay:disconnect', async () => {
    const config = await globalConfigStore.get()
    await globalConfigStore.set({ relayUrl: null, relayCode: null })
    relayClient.disconnect()
    return { ok: true, deviceId: config.relayDeviceId }
  })
}
