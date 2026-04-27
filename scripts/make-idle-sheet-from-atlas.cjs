/* eslint-disable no-console */
const fs = require('node:fs')
const path = require('node:path')
const { PNG } = require('pngjs')

function parseArgs(argv) {
  const out = { input: undefined, output: undefined, frames: 8 }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--input' || a === '-i') out.input = argv[++i]
    else if (a === '--output' || a === '-o') out.output = argv[++i]
    else if (a === '--frames') out.frames = Number(argv[++i])
    else if (a === '--help' || a === '-h') out.help = true
  }
  return out
}

function usage() {
  console.log(
    [
      'Usage:',
      '  node scripts/make-idle-sheet-from-atlas.cjs --input <characters.transparent.png> --output <idle.sheet.png> [--frames N]',
      '',
      'What it does:',
      '  - Crops a few "calm/eyes-closed" tiles from row 0 and stitches them',
      '    into a horizontal idle animation sheet (placeholder).',
      '',
      'Defaults:',
      '  --frames 8',
    ].join('\n')
  )
}

function blit(dst, src, dx, dy, sx, sy, w, h) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = ((src.width * (sy + y) + (sx + x)) << 2) >>> 0
      const di = ((dst.width * (dy + y) + (dx + x)) << 2) >>> 0
      dst.data[di + 0] = src.data[si + 0]
      dst.data[di + 1] = src.data[si + 1]
      dst.data[di + 2] = src.data[si + 2]
      dst.data[di + 3] = src.data[si + 3]
    }
  }
}

function main() {
  const args = parseArgs(process.argv)
  if (args.help || !args.input || !args.output) {
    usage()
    process.exit(args.help ? 0 : 2)
  }

  const inputPath = path.resolve(args.input)
  const outputPath = path.resolve(args.output)
  const frames = Number.isFinite(args.frames) ? Math.max(2, Math.min(16, args.frames | 0)) : 8

  const buf = fs.readFileSync(inputPath)
  const atlas = PNG.sync.read(buf)

  // Assumptions for current atlas:
  // - 8 columns x 4 rows
  // - each tile 192x192
  const tileW = 192
  const tileH = 192

  const sheet = new PNG({ width: tileW * frames, height: tileH })

  // Use a subtle pattern that looks like idle breathing:
  // alternate between neutral (c0) and closed-eyes smile (c1), with a small hold.
  const cols = [0, 0, 1, 0, 0, 0, 1, 0]
  const row = 0

  for (let i = 0; i < frames; i++) {
    const col = cols[i % cols.length]
    const sx = col * tileW
    const sy = row * tileH
    const dx = i * tileW
    blit(sheet, atlas, dx, 0, sx, sy, tileW, tileH)
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, PNG.sync.write(sheet))
  console.log(`[ok] wrote ${outputPath} (${frames} frames)`)
}

main()

