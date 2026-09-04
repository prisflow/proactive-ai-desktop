/**
 * 推送分发器 —— agentLoop 的全部输出事件统一入口。
 * 默认通道：Electron 主窗口 IPC（PC 本体前端，保持原行为）。
 * 附加通道：Relay（公网中继，见 relay-client；手机/任意浏览器经云服务器访问）。
 * 各通道订阅后自行负责序列化与连接管理。
 */
import { getMainWindow } from '../window'
import type { AgentStreamPushV1 } from '../../shared/types/stream'

type Sink = (event: AgentStreamPushV1) => void

class Transport {
  private sinks = new Set<Sink>()

  /** 订阅附加通道（LAN/Relay）。返回取消订阅函数。 */
  subscribe(sink: Sink): () => void {
    this.sinks.add(sink)
    return () => this.sinks.delete(sink)
  }

  /** 推送一条事件：先走主窗口 IPC（原行为），再广播给附加通道。 */
  push(event: AgentStreamPushV1): void {
    const w = getMainWindow()
    w?.webContents.send('chat:stream', event)
    for (const sink of this.sinks) {
      try {
        sink(event)
      } catch {
        // 附加通道异常不影响主链路
      }
    }
  }
}

export const transport = new Transport()