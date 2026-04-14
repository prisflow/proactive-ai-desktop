export type AvatarPackResolved = {
  pack_id: string
  version: string
}

export type AvatarSettings = {
  enabled: boolean
}

export type AvatarEngineIn =
  | { v: 1; type: 'INIT'; pack: AvatarPackResolved; settings: AvatarSettings }
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
let frame = 0
let lastTick = 0
let overlay: string | undefined
let overlayUntil = 0

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
  if (overlay && now >= overlayUntil) {
    overlay = undefined
  }
  // 低频 demo 动画：每 120ms 前进一步
  if (dt >= 120) {
    frame = (frame + 1) % 4
  }
  post({ v: 1, type: 'STATE', animation: mood, frame, overlay })
}

self.onmessage = (ev: MessageEvent<AvatarEngineIn>) => {
  const msg = ev.data
  try {
    if (msg.v !== 1) return
    if (msg.type === 'INIT') {
      ready = true
      mood = 'idle'
      frame = 0
      lastTick = 0
      overlay = undefined
      overlayUntil = 0
      post({ v: 1, type: 'READY' })
      return
    }
    if (!ready) return
    switch (msg.type) {
      case 'SET_MOOD':
        mood = msg.mood || 'idle'
        frame = 0
        break
      case 'PLAY_EMOTE':
        setOverlay(msg.name, Date.now(), 600)
        break
      case 'ON_ASSISTANT_MESSAGE':
        if (/\?/.test(msg.text)) {
          mood = 'confused'
          setOverlay('question', Date.now(), 900)
        }
        break
      case 'ON_TRIGGER':
        mood = 'happy'
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

