/* eslint-disable no-console */
const fs = require('node:fs')
const path = require('node:path')
const { PNG } = require('pngjs')

function clampByte(n) {
  if (n < 0) return 0
  if (n > 255) return 255
  return n | 0
}

function parseArgs(argv) {
  const out = {
    input: undefined,
    output: undefined,
    mode: 'clean',
    threshold: 18,
    feather: 0,
  }

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--input' || a === '-i') out.input = argv[++i]
    else if (a === '--output' || a === '-o') out.output = argv[++i]
    else if (a === '--mode') out.mode = argv[++i]
    else if (a === '--threshold') out.threshold = Number(argv[++i])
    else if (a === '--feather') out.feather = Number(argv[++i])
    else if (a === '--help' || a === '-h') out.help = true
  }
  return out
}

function usage() {
  console.log(
    [
      'Usage:',
      '  node scripts/make-transparent-sprites.cjs --input <in.png> --output <out.png> [--mode clean|shadow] [--threshold N] [--feather N]',
      '',
      'Notes:',
      '  - Treats near-black pixels as background and makes them transparent.',
      '  - mode=clean: more aggressive (clean edges, may remove faint shadows)',
      '  - mode=shadow: preserves shadows more (may keep a tiny dark outline)',
      '',
      'Defaults:',
      '  --mode clean --threshold 18 --feather 0',
    ].join('\n')
  )
}

function alphaForPixel(r, g, b, mode, threshold) {
  // "distance to black" heuristic; assume black/dark background.
  const v = Math.max(r, g, b)

  if (mode === 'shadow') {
    // Keep more semi-dark pixels.
    // Map [0..threshold] -> [0..~160], then ramp to 255 quickly.
    if (v <= threshold) return clampByte((v / Math.max(1, threshold)) * 120)
    if (v <= threshold * 2) return clampByte(120 + ((v - threshold) / Math.max(1, threshold)) * 135)
    return 255
  }

  // clean mode: kill near-black hard, keep others opaque.
  if (v <= threshold) return 0
  if (v <= threshold * 2) return clampByte(((v - threshold) / Math.max(1, threshold)) * 255)
  return 255
}

function computeBBox(png) {
  let minX = png.width
  let minY = png.height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const idx = (png.width * y + x) << 2
      const a = png.data[idx + 3]
      if (a === 0) continue
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  if (maxX === -1) return null
  return { minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

function main() {
  const args = parseArgs(process.argv)
  if (args.help || !args.input || !args.output) {
    usage()
    process.exit(args.help ? 0 : 2)
  }

  const inputPath = path.resolve(args.input)
  const outputPath = path.resolve(args.output)
  const mode = args.mode === 'shadow' ? 'shadow' : 'clean'
  const threshold = Number.isFinite(args.threshold) ? Math.max(0, Math.min(80, args.threshold)) : 18
  const feather = Number.isFinite(args.feather) ? Math.max(0, Math.min(3, args.feather | 0)) : 0

  const buf = fs.readFileSync(inputPath)
  const png = PNG.sync.read(buf)

  // 1) Compute alpha based on near-black detection
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const idx = (png.width * y + x) << 2
      const r = png.data[idx + 0]
      const g = png.data[idx + 1]
      const b = png.data[idx + 2]
      const a = png.data[idx + 3]
      if (a === 0) continue
      const na = alphaForPixel(r, g, b, mode, threshold)
      png.data[idx + 3] = na
    }
  }

  // 2) Optional feather: dilate alpha slightly to reduce tiny holes
  if (feather > 0) {
    const src = Buffer.from(png.data)
    const w = png.width
    const h = png.height
    const radius = feather

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (w * y + x) << 2
        let best = src[idx + 3]
        if (best === 255) continue
        for (let dy = -radius; dy <= radius; dy++) {
          const yy = y + dy
          if (yy < 0 || yy >= h) continue
          for (let dx = -radius; dx <= radius; dx++) {
            const xx = x + dx
            if (xx < 0 || xx >= w) continue
            const j = (w * yy + xx) << 2
            const a2 = src[j + 3]
            if (a2 > best) best = a2
            if (best === 255) break
          }
          if (best === 255) break
        }
        png.data[idx + 3] = best
      }
    }
  }

  const bbox = computeBBox(png)
  if (bbox) {
    console.log(`[bbox] non-transparent: x=${bbox.minX}..${bbox.maxX} y=${bbox.minY}..${bbox.maxY} w=${bbox.w} h=${bbox.h}`)
  } else {
    console.log('[bbox] image became fully transparent (check threshold).')
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, PNG.sync.write(png))
  console.log(`[ok] wrote ${outputPath}`)
  console.log(`[info] mode=${mode} threshold=${threshold} feather=${feather}`)
}

main()

