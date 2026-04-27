export type AvatarPackResolved = {
  pack_id: string
  version: string
}

export type AvatarSettings = {
  enabled: boolean
}

export type AvatarEngineIn =
  | {
      v: 1
      type: 'INIT'
      pack: AvatarPackResolved
      settings: AvatarSettings
      layout?: {
        idleFrames: number
        atlasCols: number
        atlasRows: number
        /** mood id -> atlas cell */
        expressions?: Record<string, { row: number; col: number }>
      }
    }
  | { v: 1; type: 'SET_MOOD'; mood: string }
  | { v: 1; type: 'PLAY_EMOTE'; name: string }
  | { v: 1; type: 'TICK'; now_ms: number }
  | { v: 1; type: 'ON_ASSISTANT_MESSAGE'; text: string }
  | { v: 1; type: 'ON_TRIGGER'; text: string }

export type AvatarEngineOut =
  | { v: 1; type: 'READY' }
  | { v: 1; type: 'STATE'; animation: string; frame: number; overlay?: string }
  | { v: 1; type: 'ERROR'; code: string; message: string }

let ready = false
let mood = 'idle'
// NOTE: `frame` here means "expression column index" (tile index), NOT animation frames.
let frame = 0
let lastTick = 0
let overlay: string | undefined
let overlayUntil = 0
let moodUntil = 0

let lastPostedAt = 0
let lastPostedKey = ''

let nextIdleChangeAt = 0
let idleCol = 0

let blinking = false
let blinkUntil = 0
let nextBlinkAt = 0

// Idle animation sheet frames (方案2) — overridden by INIT.layout.idleFrames when provided
let idleSheetFrames = 8
let atlasCols = 8
let atlasRows = 4
let expressions: Record<string, { row: number; col: number }> | undefined
// Use a paced sequence to avoid "carousel" feel.
// This assumes the sheet includes a couple of blink/variant frames; we hold neutral longer.
const IDLE_SEQUENCE: number[] = [
  0, 0, 0, 0, 0, // hold neutral
  1, // quick blink-ish
  0, 0, 0, 0, // hold
  5, // small variation (e.g. sweat), brief
  0, 0, 0, 0, // hold
  7, // another blink-ish, brief
  0, 0, 0, 0, 0, 0, // longer hold
]
const IDLE_STEP_MS = 140
let idleSeqIdx = 0
let idleAccMs = 0

function clampInt(n: number, min: number, max: number) {
  if (n < min) return min
  if (n > max) return max
  return n | 0
}

function pseudoRand01(seed: number) {
  // Deterministic-ish jitter without storing RNG state.
  const x = Math.sin(seed * 99991) * 10000
  return x - Math.floor(x)
}

function nowJitterMs(now: number, base: number, span: number) {
  return base + Math.floor(pseudoRand01(now) * span)
}

function setMood(next: string, now: number) {
  mood = next || 'idle'
  moodUntil = mood === 'idle' ? 0 : now + 1400
  // Reset transient timers when mood changes.
  blinking = false
  blinkUntil = 0
  nextBlinkAt = now + nowJitterMs(now, 2200, 2200)
  nextIdleChangeAt = now + nowJitterMs(now, 7000, 6000)
}

function chooseIdleCol(now: number) {
  // "Normal expression rotation": keep it subtle and slow.
  // This sheet has many expressions; start with a small safe subset.
  const cols = [0, 2, 7, 0, 0, 1]
  const i = clampInt(Math.floor(pseudoRand01(now) * cols.length), 0, cols.length - 1)
  return cols[i]
}

function atlasCellForMood(m: string): { row: number; col: number } {
  const hit = expressions?.[m]
  if (hit) {
    return { row: clampInt(hit.row, 0, Math.max(0, atlasRows - 1)), col: clampInt(hit.col, 0, Math.max(0, atlasCols - 1)) }
  }
  // Fallback mapping (legacy): row fixed to 0, col heuristic
  const col = (() => {
    switch (m) {
      case 'happy':
        return 2
      case 'angry':
        return 4
      case 'confused':
        return 3
      default:
        return idleCol
    }
  })()
  return { row: 0, col: clampInt(col, 0, Math.max(0, atlasCols - 1)) }
}

function post(msg: AvatarEngineOut) {
  ;(self as any).postMessage(msg)
}

function setOverlay(name: string, now: number, durationMs: number) {
  overlay = name
  overlayUntil = now + durationMs
}

function onTick(now: number) {
  if (!ready) return
  if (!lastTick) lastTick = now
  const dt = now - lastTick
  lastTick = now
  if (mood !== 'idle' && moodUntil > 0 && now >= moodUntil) {
    setMood('idle', now)
  }
  if (overlay && now >= overlayUntil) {
    overlay = undefined
  }

  // Default idle: slow rotation among "normal" expressions.
  if (mood === 'idle' && now >= nextIdleChangeAt) {
    idleCol = chooseIdleCol(now)
    nextIdleChangeAt = now + nowJitterMs(now, 7000, 6000)
  }

  // Occasional blink (briefly switch to a "closed eyes" tile if available).
  if (!blinking && now >= nextBlinkAt) {
    blinking = true
    blinkUntil = now + 140
  }
  if (blinking && now >= blinkUntil) {
    blinking = false
    nextBlinkAt = now + nowJitterMs(now, 2200, 2200)
  }

  let animation: string = mood

  if (mood === 'idle') {
    // 方案2：idle 使用“动画 sheet”而不是 atlas 表情轮播
    idleAccMs += dt
    while (idleAccMs >= IDLE_STEP_MS) {
      idleAccMs -= IDLE_STEP_MS
      idleSeqIdx = (idleSeqIdx + 1) % IDLE_SEQUENCE.length
    }
    animation = 'idle_sheet'
    frame = IDLE_SEQUENCE[idleSeqIdx] % Math.max(1, idleSheetFrames)
  } else {
    // Non-idle: show a stable expression on atlas.
    // Blink: try a nearby tile (often "eyes closed") but keep bounded.
    const cell = atlasCellForMood(mood)
    const col = blinking ? clampInt(cell.col + 1, 0, Math.max(0, atlasCols - 1)) : cell.col
    // Encode row into animation string for renderer: "atlas_r<row>"
    animation = `atlas_r${cell.row}`
    frame = col
  }

  const key = `${animation}|${frame}|${overlay || ''}`
  const shouldPost = key !== lastPostedKey || now - lastPostedAt >= 100
  if (shouldPost) {
    lastPostedAt = now
    lastPostedKey = key
    post({ v: 1, type: 'STATE', animation, frame, overlay })
  }
}

self.onmessage = (ev: MessageEvent<AvatarEngineIn>) => {
  const msg = ev.data
  try {
    if (msg.v !== 1) return
    if (msg.type === 'INIT') {
      ready = true
      const now = Date.now()
      idleCol = 0
      idleSheetFrames = Math.max(1, msg.layout?.idleFrames ?? 8)
      atlasCols = Math.max(1, msg.layout?.atlasCols ?? 8)
      atlasRows = Math.max(1, msg.layout?.atlasRows ?? 4)
      expressions = msg.layout?.expressions
      setMood('idle', now)
      frame = idleCol
      lastTick = 0
      lastPostedAt = 0
      lastPostedKey = ''
      overlay = undefined
      overlayUntil = 0
      moodUntil = 0
      nextIdleChangeAt = now + nowJitterMs(now, 7000, 6000)
      nextBlinkAt = now + nowJitterMs(now, 2200, 2200)
      idleSeqIdx = 0
      idleAccMs = 0
      post({ v: 1, type: 'READY' })
      return
    }
    if (!ready) return
    switch (msg.type) {
      case 'SET_MOOD':
        setMood(msg.mood || 'idle', Date.now())
        break
      case 'PLAY_EMOTE':
        setOverlay(msg.name, Date.now(), 600)
        break
      case 'ON_ASSISTANT_MESSAGE':
        if (/\?/.test(msg.text)) {
          setMood('confused', Date.now())
          setOverlay('question', Date.now(), 900)
        }
        break
      case 'ON_TRIGGER':
        setMood('happy', Date.now())
        setOverlay('spark', Date.now(), 900)
        break
      case 'TICK':
        onTick(msg.now_ms)
        break
    }
  } catch (e: any) {
    post({
      v: 1,
      type: 'ERROR',
      code: 'engine_exception',
      message: e?.message || String(e),
    })
  }
}

