/* eslint-disable no-console */
/**
 * Regenerates placeholder idle.sheet.png + atlas.png (192px grid) under …/1.0.0/.
 * WARNING: overwrites the shipped real-art demo if you run this; use only to reset placeholders.
 */
const fs = require('node:fs')
const path = require('node:path')
const { PNG } = require('pngjs')

const TILE = 192
const COLS = 8
const ROWS = 4
const IDLE_FRAMES = 8

function fillRect(data, stride, x0, y0, w, h, r, g, b, a = 255) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((y0 + y) * stride + (x0 + x)) << 2
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = a
    }
  }
}

function main() {
  const root = path.join(__dirname, '../resources/pavatar-bundled/com.proactiveai.demo/1.0.0')
  fs.mkdirSync(root, { recursive: true })

  const aw = TILE * COLS
  const ah = TILE * ROWS
  const atlas = new PNG({ width: aw, height: ah })
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const n = row * COLS + col
      const r = (n * 29) & 255
      const g = (n * 53) & 255
      const b = (n * 91) & 255
      fillRect(atlas.data, aw, col * TILE, row * TILE, TILE, TILE, r, g, b, 255)
    }
  }
  fs.writeFileSync(path.join(root, 'atlas.png'), PNG.sync.write(atlas)) // same name as shipped manifest

  const iw = TILE * IDLE_FRAMES
  const ih = TILE
  const idle = new PNG({ width: iw, height: ih })
  for (let f = 0; f < IDLE_FRAMES; f++) {
    const base = 120 + f * 12
    fillRect(idle.data, iw, f * TILE, 0, TILE, TILE, base, (base * 2) & 255, 80 + f * 15, 255)
  }
  fs.writeFileSync(path.join(root, 'idle.sheet.png'), PNG.sync.write(idle))

  const manifest = {
    v: 1,
    packId: 'com.proactiveai.demo',
    version: '1.0.0',
    name: '内置演示包（色块占位，布局同旧 Kenney 管线）',
    author: 'ProactiveAI',
    license: 'MIT',
    idle: {
      kind: 'sheet',
      src: 'idle.sheet.png',
      frameW: TILE,
      frameH: TILE,
      frames: IDLE_FRAMES,
      fps: 8,
    },
    atlas: {
      src: 'atlas.png',
      cols: COLS,
      rows: ROWS,
      tileW: TILE,
      tileH: TILE,
    },
    expressions: {
      idle: { row: 0, col: 0 },
      happy: { row: 0, col: 1 },
      angry: { row: 1, col: 0 },
      confused: { row: 1, col: 1 },
      sad: { row: 2, col: 0 },
      surprised: { row: 2, col: 1 },
      thinking: { row: 3, col: 0 },
      sleepy: { row: 3, col: 1 },
    },
  }
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2))
  fs.writeFileSync(
    path.join(root, 'README.txt'),
    [
      'Replace atlas.png / idle.sheet.png with your own art (keep paths in manifest.json).',
      'Old repo assets were removed per no-bundled-fallback policy; this pack is re-seeded for dev.',
    ].join('\n')
  )
  console.log('Wrote', root)
}

main()
