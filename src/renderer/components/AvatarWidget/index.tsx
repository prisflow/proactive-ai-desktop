import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { AvatarEngineIn, AvatarEngineOut } from '@/avatar/engine.worker'

type EngineState = {
  ready: boolean
  animation: string
  frame: number
  overlay?: string
  error?: string
}

const DEFAULT_STATE: EngineState = {
  ready: false,
  animation: 'idle',
  frame: 0,
}

export default function AvatarWidget() {
  const workerRef = useRef<Worker | null>(null)
  const rafRef = useRef<number | null>(null)
  const [state, setState] = useState<EngineState>(DEFAULT_STATE)

  const color = useMemo(() => {
    switch (state.animation) {
      case 'happy':
        return 'bg-emerald-500/20 border-emerald-500/40'
      case 'angry':
        return 'bg-red-500/20 border-red-500/40'
      case 'confused':
        return 'bg-amber-500/20 border-amber-500/40'
      default:
        return 'bg-slate-500/15 border-[color:var(--app-border-strong)]'
    }
  }, [state.animation])

  useEffect(() => {
    const w = new Worker(new URL('../../avatar/engine.worker.ts', import.meta.url), {
      type: 'module',
    })
    workerRef.current = w

    const onMsg = (ev: MessageEvent<AvatarEngineOut>) => {
      const msg = ev.data
      if (msg.v !== 1) return
      if (msg.type === 'READY') {
        setState((s) => ({ ...s, ready: true, error: undefined }))
        return
      }
      if (msg.type === 'STATE') {
        setState((s) => ({
          ...s,
          ready: true,
          animation: msg.animation,
          frame: msg.frame,
          overlay: msg.overlay,
        }))
        return
      }
      if (msg.type === 'ERROR') {
        setState((s) => ({ ...s, error: `${msg.code}: ${msg.message}` }))
        return
      }
    }

    w.addEventListener('message', onMsg as any)

    const init: AvatarEngineIn = {
      v: 1,
      type: 'INIT',
      pack: { pack_id: 'demo', version: '0.0.0' },
      settings: { enabled: true },
    }
    w.postMessage(init)

    const tick = () => {
      const wk = workerRef.current
      if (wk) {
        const msg: AvatarEngineIn = { v: 1, type: 'TICK', now_ms: Date.now() }
        wk.postMessage(msg)
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      w.removeEventListener('message', onMsg as any)
      w.terminate()
      workerRef.current = null
    }
  }, [])

  // 先做骨架：像素资源接入前，用一个“像素风占位”展示状态机是否跑通
  return (
    <div className="pointer-events-none absolute bottom-4 right-4 z-20">
      <div
        className={cn(
          'pointer-events-auto select-none rounded-2xl border shadow-xl backdrop-blur',
          'w-[124px] h-[124px] p-3',
          'bg-[var(--app-surface)]',
          color
        )}
        title={state.error ? state.error : `avatar: ${state.animation}`}
      >
        <div className="flex h-full flex-col justify-between">
          <div className="flex items-center justify-between text-[11px] text-[var(--app-muted)]">
            <span className="truncate">Avatar</span>
            <span className="tabular-nums">f{state.frame}</span>
          </div>

          <div className="grid place-items-center">
            <div
              className={cn(
                'grid place-items-center rounded-xl border',
                'w-[70px] h-[70px]',
                'bg-[var(--app-input-bg)] border-[color:var(--app-border-strong)]'
              )}
            >
              <div className="text-center leading-tight">
                <div className="text-lg">■</div>
                <div className="text-[11px] text-[var(--app-muted)]">
                  {state.animation}
                </div>
                {state.overlay && (
                  <div className="mt-1 text-[10px] text-[var(--app-muted)]">
                    +{state.overlay}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="text-[10px] text-[var(--app-muted)]">
            {state.ready ? 'engine ready' : 'starting…'}
          </div>
        </div>
      </div>
    </div>
  )
}

