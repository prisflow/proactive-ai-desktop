/**
 * Relay 通道 —— 宿主出站 WebSocket 客户端（连用户自建的中继服务器）。
 * PC 主动出站连接（天然穿 NAT），服务器纯转发：手机 Web ↔ 本机宿主。
 *
 * 消息协议（与 proactive-ai-relay 仓库 server.mjs 对应）：
 * - 收 {type:'ready'}                      服务器确认注册
 * - 收 {type:'status-request'}             手机要会话列表 → status-reply
 * - 收 {type:'history-request', cid}       手机要历史 → history-reply
 * - 收 {type:'message', cid, text}         手机发消息 → sendMessage（agentLoop）
 * - 发 {type:'push', conversationId, event}宿主事件推送（transport 订阅 → 手机 SSE）
 */
import WebSocket from 'ws'
import { transport } from './transport'
import type { AgentStreamPushV1 } from '../../shared/types/stream'

type RelayMessage =
  | { type: 'ready' }
  | { type: 'status-request' }
  | { type: 'history-request'; conversationId: string }
  | { type: 'message'; requestId: string; conversationId: string; text: string }

class RelayClient {
  private ws: WebSocket | null = null
  private url = ''
  private device = ''
  private code = ''
  private unsubscribe: (() => void) | null = null
  private retryTimer: NodeJS.Timeout | null = null
  private retryDelay = 3000
  private online = false
  /** 当前连接状态（供设置页显示）。 */
  state: 'off' | 'connecting' | 'online' = 'off'
  private onStateChange: (() => void) | null = null

  get isConnected(): boolean {
    return this.online
  }

  /** 设置连接状态变更回调（设置页刷新用）。 */
  setStateListener(fn: (() => void) | null): void {
    this.onStateChange = fn
  }

  private setState(s: 'off' | 'connecting' | 'online'): void {
    this.state = s
    this.online = s === 'online'
    this.onStateChange?.()
  }

  /** 连接中继服务器（自动持久重连）。url 如 wss://play.example.com/relay。 */
  connect(url: string, device: string, code: string): void {
    this.disconnect()
    this.url = url
    this.device = device
    this.code = code
    this.retryDelay = 3000
    this.setState('connecting')
    this.open()
  }

  /** 断开并停止重连。 */
  disconnect(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    this.unsubscribe?.()
    this.unsubscribe = null
    this.ws?.removeAllListeners()
    this.ws?.close()
    this.ws = null
    this.setState('off')
  }

  private open(): void {
    const ws = new WebSocket(`${this.url}?device=${encodeURIComponent(this.device)}&code=${encodeURIComponent(this.code)}`)
    this.ws = ws

    ws.on('open', () => {
      // 注册 transport：宿主事件 → 服务器 → 手机
      this.unsubscribe = transport.subscribe((event: AgentStreamPushV1) => {
        this.send({ type: 'push', conversationId: event.conversationId, event })
      })
    })

    ws.on('message', (raw) => {
      this.handleMessage(raw.toString())
    })

    ws.on('close', () => {
      if (this.ws !== ws) return
      this.ws = null
      this.unsubscribe?.()
      this.unsubscribe = null
      this.setState('connecting')
      // 指数退避重连（上限 30s）
      this.retryTimer = setTimeout(() => this.open(), this.retryDelay)
      this.retryDelay = Math.min(this.retryDelay * 2, 30000)
    })

    ws.on('error', () => {
      // 错误由 close 兜底清理与重连
      try { ws.close() } catch { /* ignore */ }
    })
  }

  private send(obj: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj))
    }
  }

  private handleMessage(raw: string): void {
    let msg: RelayMessage
    try {
      msg = JSON.parse(raw) as RelayMessage
    } catch {
      return
    }
    switch (msg.type) {
      case 'ready':
        this.setState('online')
        this.retryDelay = 3000
        break
      case 'status-request': {
        // 手机要会话列表（并发冲高时动态加载，避免静态 import 拖慢主链）
        void import('../services/store').then(({ conversationStore }) => {
          const conversations = conversationStore.list()
          this.send({ type: 'status-reply', data: conversations })
        })
        break
      }
      case 'history-request': {
        // 与 PC 端 conversations:getMessages 完全相同的转换（role 归一/内部消息过滤/widgetNode 重建）
        void Promise.all([
          import('../services/store'),
          import('../modules/conversations/to-chat-message'),
        ]).then(([{ conversationStore }, { toChatMessages }]) => {
          const records = conversationStore.getMessages(msg.conversationId)
          this.send({ type: 'history-reply', conversationId: msg.conversationId, data: toChatMessages(records) })
        })
        break
      }
      case 'message': {
        // 手机发消息 → agentLoop（与 chat:send 同链路）；落库后回 ack 携带真实 messageId
        const requestId = (msg as { requestId?: string }).requestId
        void import('../modules/conversations/send-message').then(async ({ sendMessage }) => {
          try {
            const record = await sendMessage(msg.conversationId, msg.text)
            this.send({ type: 'message-ack', requestId, messageId: record.id })
          } catch (e) {
            this.send({ type: 'message-ack', requestId, error: e instanceof Error ? e.message : String(e) })
          }
        })
        break
      }
    }
  }
}

export const relayClient = new RelayClient()