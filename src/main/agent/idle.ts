import { CORE_EVENT, createAgentEvent } from '../../shared/agent-events'
import type { AgentEventBus } from './event-bus'

const IDLE_BASE_INTERVAL_MS = 20000
const IDLE_MAX_INTERVAL_MS = 300_000 // 5 分钟上限，达到后不再继续入队
const IDLE_BACKOFF_FACTOR = 2

export interface IdleSamplerHandle {
  /** 重置退避（用户消息时调用） */
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
    // 达到上限后不再入队，等 reset() 重新开始
    if (currentInterval > IDLE_MAX_INTERVAL_MS) return
    timerId = setTimeout(async () => {
      await bus.enqueue(
        createAgentEvent({
          type: CORE_EVENT.IDLE_SAMPLE,
          source: 'kernel',
          payload: { currentInterval },
        })
      )
      // 每次发出后指数退避
      currentInterval = currentInterval * IDLE_BACKOFF_FACTOR
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
