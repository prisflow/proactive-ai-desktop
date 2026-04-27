import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AvatarEngineIn, AvatarEngineOut } from '@/avatar/engine.worker'
import type { PluginDispatchMessage, PAvatarPackResolved } from '@shared'
import { pavatarRendererLog } from '@/lib/pavatar-debug'

type EngineState = {
  ready: boolean
  animation: string
  frame: number
  overlay?: string
  error?: string
}

type MoodHistoryEntry = {
  id: string
  at: number
  kind: 'mood' | 'emote'
  /** mood id or emote name */
  label: string
}

const DEFAULT_STATE: EngineState = {
  ready: false,
  animation: 'idle',
  frame: 0,
}

const MAX_MOOD_HISTORY = 48

/** Single multiplier applied to both tile axes — preserves aspect ratio of each frame. */
const DISPLAY_SCALE_MIN = 0.35
const DISPLAY_SCALE_MAX = 1.6
const DISPLAY_SCALE_DEFAULT = 0.75

function formatHistoryTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  } catch {
    return String(ts)
  }
}

export default function AvatarWidget() {
  const workerRef = useRef<Worker | null>(null)
  const rafRef = useRef<number | null>(null)
  const [state, setState] = useState<EngineState>(DEFAULT_STATE)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const atlasRef = useRef<HTMLImageElement | null>(null)
  const idleRef = useRef<HTMLImageElement | null>(null)
  const atlasReadyRef = useRef(false)
  const idleReadyRef = useRef(false)

  const [pack, setPack] = useState<PAvatarPackResolved | null>(null)
  const [packChecked, setPackChecked] = useState(false)
  /** UI zoom only; manifest tile sizes define source crop geometry. */
  const [displayScale, setDisplayScale] = useState(DISPLAY_SCALE_DEFAULT)
  const [moodHistory, setMoodHistory] = useState<MoodHistoryEntry[]>([])
  const [railOpen, setRailOpen] = useState(true)
  /** null = 尚未从主进程拉取插件列表 */
  const [pavatarPluginEnabled, setPavatarPluginEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    const refresh = async () => {
      try {
        const list = await window.electronAPI.plugins.list?.()
        if (!list) {
          setPavatarPluginEnabled(true)
          return
        }
        const row = list.find((x) => x.id === 'com.proactiveai.pavatar')
        setPavatarPluginEnabled(row?.enabled ?? true)
      } catch {
        setPavatarPluginEnabled(true)
      }
    }
    void refresh()
    const off = window.electronAPI.plugins.onPreferencesChanged?.(() => {
      void refresh()
    })
    return () => off?.()
  }, [])

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

  const spriteSpec = useMemo(() => {
    const a = pack?.atlas
    if (!a) {
      return { cols: 1, rows: 1, tileW: 1, tileH: 1, offsetX: 0, offsetY: 0, scale: displayScale }
    }
    return {
      cols: a.cols,
      rows: a.rows,
      tileW: a.tileW,
      tileH: a.tileH,
      offsetX: 0,
      offsetY: 0,
      scale: displayScale,
    }
  }, [pack, displayScale])

  const idleSpec = useMemo(() => {
    const i = pack?.idle
    if (!i) {
      return { cols: 1, tileW: 1, tileH: 1, scale: displayScale }
    }
    return {
      cols: i.frames,
      tileW: i.frameW,
      tileH: i.frameH,
      scale: displayScale,
    }
  }, [pack, displayScale])

  const rowForAnimation = useMemo(() => {
    return (anim: string) => {
      const m = /^atlas_r(\d+)$/.exec(anim)
      if (m) return Number(m[1])
      return 0
    }
  }, [])

  useEffect(() => {
    if (pavatarPluginEnabled === null) return
    if (pavatarPluginEnabled === false) {
      setPack(null)
      setPackChecked(true)
      return
    }

    let off: (() => void) | undefined
    const api = window.electronAPI
    if (api?.pavatar?.getActivePack) {
      void api.pavatar
        .getActivePack()
        .then((p) => {
          pavatarRendererLog('getActivePack result', {
            hasPack: !!p,
            packId: p?.packId ?? null,
            version: p?.version ?? null,
          })
          if (!p) {
            pavatarRendererLog(
              'branch: no pack — widget stays hidden. Install under userData/pavatar-packs/<id>/<ver>/manifest.json'
            )
          }
          setPack(p)
        })
        .catch((e) => {
          console.error('[AvatarWidget] getActivePack failed', e)
          setPack(null)
        })
        .finally(() => setPackChecked(true))
      off = api.pavatar.onActivePackChanged?.(() => {
        void api.pavatar
          .getActivePack()
          .then((p) => {
            pavatarRendererLog('getActivePack after activePackChanged', p?.packId ?? null)
            setPack(p)
          })
          .catch((e) => console.error('[AvatarWidget] getActivePack failed', e))
      })
    } else {
      pavatarRendererLog('branch: window.electronAPI.pavatar missing — not running in Electron?')
      setPackChecked(true)
    }
    return () => off?.()
  }, [pavatarPluginEnabled])

  useEffect(() => {
    if (!pack) {
      atlasRef.current = null
      idleRef.current = null
      atlasReadyRef.current = false
      idleReadyRef.current = false
      return
    }

    const atlas = new Image()
    atlas.src = pack.atlasUrl
    atlas.decoding = 'async'
    atlas.onload = () => {
      atlasRef.current = atlas
      atlasReadyRef.current = true
    }
    atlas.onerror = () => {
      atlasReadyRef.current = false
      setState((s) => ({ ...s, error: 'Failed to load atlas image from pack' }))
    }

    const idle = new Image()
    idle.src = pack.idleUrl
    idle.decoding = 'async'
    idle.onload = () => {
      idleRef.current = idle
      idleReadyRef.current = true
    }
    idle.onerror = () => {
      idleReadyRef.current = false
      setState((s) => ({ ...s, error: 'Failed to load idle sheet from pack' }))
    }

    return () => {
      if (atlasRef.current === atlas) atlasRef.current = null
      if (idleRef.current === idle) idleRef.current = null
      atlasReadyRef.current = false
      idleReadyRef.current = false
    }
  }, [pack?.packId, pack?.version, pack?.atlasUrl, pack?.idleUrl])

  useEffect(() => {
    if (!pack) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      workerRef.current?.terminate()
      workerRef.current = null
      setState(DEFAULT_STATE)
      return
    }

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
      pack: { pack_id: pack.packId, version: pack.version },
      settings: { enabled: true },
      layout: {
        idleFrames: pack.idle.frames,
        atlasCols: pack.atlas.cols,
        atlasRows: pack.atlas.rows,
        expressions: pack.expressions,
      },
    }
    w.postMessage(init)

    const tick = () => {
      const wk = workerRef.current
      if (wk) {
        const now = Date.now()
        const last = (tick as any)._lastNowMs as number | undefined
        if (!last || now - last >= 33) {
          ;(tick as any)._lastNowMs = now
          const msg: AvatarEngineIn = { v: 1, type: 'TICK', now_ms: now }
          wk.postMessage(msg)
        }
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
  }, [pack?.packId, pack?.version])

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.plugins?.onDispatch) {
      pavatarRendererLog('branch: plugins.onDispatch missing')
      return
    }
    pavatarRendererLog('subscribed to plugins.onDispatch')
    const off = api.plugins.onDispatch((m: PluginDispatchMessage) => {
      if (!m || m.v !== 1) return
      if (m.pluginId !== 'com.proactiveai.pavatar') return

      if (m.type === 'AVATAR_SET_MOOD') {
        const row: MoodHistoryEntry = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          at: Date.now(),
          kind: 'mood',
          label: m.mood,
        }
        setMoodHistory((prev) => [row, ...prev].slice(0, MAX_MOOD_HISTORY))
      } else if (m.type === 'AVATAR_PLAY_EMOTE') {
        const row: MoodHistoryEntry = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          at: Date.now(),
          kind: 'emote',
          label: m.name,
        }
        setMoodHistory((prev) => [row, ...prev].slice(0, MAX_MOOD_HISTORY))
      }

      const wk = workerRef.current
      if (!wk) {
        pavatarRendererLog('dispatch ignored: worker not running (no pack?)', m.type)
        return
      }
      pavatarRendererLog('dispatch to worker', m.type, m)
      if (m.type === 'AVATAR_SET_MOOD') {
        const msg: AvatarEngineIn = { v: 1, type: 'SET_MOOD', mood: m.mood }
        wk.postMessage(msg)
        return
      }
      if (m.type === 'AVATAR_PLAY_EMOTE') {
        const msg: AvatarEngineIn = { v: 1, type: 'PLAY_EMOTE', name: m.name }
        wk.postMessage(msg)
      }
    })
    return () => off?.()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !pack) return

    const isIdleSheet = state.animation === 'idle_sheet'
    const img = isIdleSheet ? idleRef.current : atlasRef.current
    const ready = isIdleSheet ? idleReadyRef.current : atlasReadyRef.current
    if (!img || !ready) return

    let tileW: number
    let tileH: number
    let cols: number
    let sx: number
    let sy: number
    let scale: number

    if (isIdleSheet) {
      ;({ cols, tileW, tileH, scale } = idleSpec)
      const col = ((state.frame % cols) + cols) % cols
      sx = col * tileW
      sy = 0
    } else {
      const { cols: aCols, tileW: aW, tileH: aH, offsetX, offsetY, scale: aScale } = spriteSpec
      cols = aCols
      tileW = aW
      tileH = aH
      scale = aScale
      const row = rowForAnimation(state.animation)
      const col = ((state.frame % cols) + cols) % cols
      sx = offsetX + col * tileW
      sy = offsetY + row * tileH
    }

    const w = Math.round(tileW * scale)
    const h = Math.round(tileH * scale)

    canvas.width = w
    canvas.height = h

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, w, h)
    ctx.drawImage(img, sx, sy, tileW, tileH, 0, 0, w, h)
  }, [idleSpec, pack, rowForAnimation, spriteSpec, state.animation, state.frame])

  if (pavatarPluginEnabled === false) {
    return null
  }
  if (pavatarPluginEnabled === null) {
    return null
  }
  if (!packChecked || !pack) {
    return null
  }

  if (!railOpen) {
    return (
      <div
        className={cn(
          'flex h-full min-h-0 w-9 shrink-0 flex-col items-stretch',
          'border-l border-[color:var(--app-border-strong)] bg-[var(--app-surface)]'
        )}
      >
        <button
          type="button"
          onClick={() => setRailOpen(true)}
          className={cn(
            'flex flex-1 flex-col items-center gap-3 pt-3 text-[var(--app-muted)]',
            'hover:bg-[var(--app-input-bg)] hover:text-[var(--app-fg)]',
            'border-0 bg-transparent'
          )}
          aria-expanded={false}
          aria-label="展开形象栏"
          title="展开形象栏"
        >
          <ChevronLeft className="h-4 w-4 shrink-0 opacity-80" />
          <span
            className="text-[10px] font-medium leading-tight text-[var(--app-fg)] opacity-70"
            style={{ writingMode: 'vertical-rl' }}
          >
            形象
          </span>
        </button>
      </div>
    )
  }

  return (
    <aside
      className={cn(
        'flex h-full min-h-0 w-[min(15rem,28vw)] shrink-0 flex-col',
        'border-l border-[color:var(--app-border-strong)] bg-[var(--app-surface)]'
      )}
      aria-label="avatar-panel"
    >
      <div
        className={cn(
          'flex shrink-0 flex-col gap-2 border-b border-[color:var(--app-border-strong)] p-3',
          color
        )}
        title={state.error ? state.error : `avatar: ${state.animation}`}
      >
        <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--app-muted)]">
          <span className="truncate font-medium text-[var(--app-fg)]">形象</span>
          <div className="flex shrink-0 items-center gap-1">
            <span className="tabular-nums">f{state.frame}</span>
            <button
              type="button"
              onClick={() => setRailOpen(false)}
              className={cn(
                'rounded-md p-1 text-[var(--app-muted)]',
                'hover:bg-black/5 hover:text-[var(--app-fg)] dark:hover:bg-white/10'
              )}
              aria-expanded={true}
              aria-label="收起形象栏"
              title="收起形象栏"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <label className="flex items-center gap-2 text-[10px] text-[var(--app-muted)]">
          <span className="shrink-0">缩放</span>
          <input
            type="range"
            min={DISPLAY_SCALE_MIN}
            max={DISPLAY_SCALE_MAX}
            step={0.05}
            value={displayScale}
            onChange={(e) => setDisplayScale(Number(e.target.value))}
            className="h-1 min-w-0 flex-1 accent-[var(--app-fg)]"
          />
          <span className="w-8 shrink-0 tabular-nums">{displayScale.toFixed(2)}×</span>
        </label>

        <div className="flex justify-center rounded-xl border border-[color:var(--app-border-strong)] bg-[var(--app-input-bg)] p-2">
          <canvas
            ref={canvasRef}
            className="max-w-full"
            style={{ imageRendering: 'pixelated' }}
            aria-label={`avatar-${state.animation}-f${state.frame}`}
          />
        </div>

        <div className="text-[10px] text-[var(--app-muted)]">
          {state.error ? state.error : state.ready ? 'engine ready' : 'starting…'}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1 p-2">
        <div className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-[var(--app-muted)]">
          表情记录
        </div>
        <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-0.5 text-[11px]">
          {moodHistory.length === 0 ? (
            <li className="text-[var(--app-muted)]">助手在回复末尾带 [[AVATAR:…]] 时会记在这里</li>
          ) : (
            moodHistory.map((row) => (
              <li
                key={row.id}
                className="rounded-md border border-[color:var(--app-border-strong)] bg-[var(--app-input-bg)] px-2 py-1.5"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-medium text-[var(--app-fg)]">{row.label}</span>
                  <time
                    className="shrink-0 tabular-nums text-[10px] text-[var(--app-muted)]"
                    dateTime={new Date(row.at).toISOString()}
                  >
                    {formatHistoryTime(row.at)}
                  </time>
                </div>
                <div className="text-[10px] text-[var(--app-muted)]">
                  {row.kind === 'mood' ? '表情' : '动作'}
                </div>
              </li>
            ))
          )}
        </ul>
      </div>
    </aside>
  )
}
