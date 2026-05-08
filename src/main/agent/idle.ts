import { CORE_EVENT, createAgentEvent } from '../../shared/agent-events'
import type { AgentEventBus } from './event-bus'

const IDLE_BASE_INTERVAL_MS = 5000
const IDLE_MAX_INTERVAL_MS = 300_000 // 5 分钟上限
const IDLE_BACKOFF_FACTOR = 2

export interface IdleSamplerHandle {
  /** 重置退避（用户活动/消息时调用） */
  reset: () => void
  /** 停止采样 */
  stop: () => void
}

export function startIdleSampler(bus: AgentEventBus): IdleSamplerHandle {
  let currentInterval = IDLE_BASE_INTERVAL_MS
  let timerId: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  function scheduleNext(): void {
    if (stopped) return
    timerId = setTimeout(async () => {
      await bus.enqueue(
        createAgentEvent({
          type: CORE_EVENT.IDLE_SAMPLE,
          source: 'kernel',
          payload: { currentInterval },
        })
      )
      // 每次发出后指数退避
      currentInterval = Math.min(currentInterval * IDLE_BACKOFF_FACTOR, IDLE_MAX_INTERVAL_MS)
      scheduleNext()
    }, currentInterval)
  }

  function reset(): void {
    currentInterval = IDLE_BASE_INTERVAL_MS
    if (timerId !== null) {
      clearTimeout(timerId)
      timerId = null
    }
    scheduleNext()
  }

  function stop(): void {
    stopped = true
    if (timerId !== null) {
      clearTimeout(timerId)
      timerId = null
    }
  }

  scheduleNext()

  return { reset, stop }
}
