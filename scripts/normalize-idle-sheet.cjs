/* eslint-disable no-console */
const fs = require('node:fs')
const path = require('node:path')
const { PNG } = require('pngjs')

function parseArgs(argv) {
  const out = {
    input: undefined,
    output: undefined,
    frames: 8,
    dstTile: 192,
    cropSize: 352,
    padBottom: 2,
  }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--input' || a === '-i') out.input = argv[++i]
    else if (a === '--output' || a === '-o') out.output = argv[++i]
    else if (a === '--frames') out.frames = Number(argv[++i])
    else if (a === '--dstTile') out.dstTile = Number(argv[++i])
    else if (a === '--crop') out.cropSize = Number(argv[++i])
    else if (a === '--padBottom') out.padBottom = Number(argv[++i])
    else if (a === '--help' || a === '-h') out.help = true
  }
  return out
}

function usage() {
  console.log(
    [
      'Usage:',
      '  node scripts/normalize-idle-sheet.cjs --input <idle_characters.png> --output <idle.sheet.png>',
      '',
      'What it does:',
      '  - Splits a horizontal N-frame idle sheet',
      '  - Finds per-frame bounding boxes (non-transparent)',
      '  - Aligns frames by baseline (feet) + horizontal center',
      '  - Crops to a square (default 352x352) and scales to 192x192 with nearest-neighbor',
      '',
      'Options:',
      '  --frames 8 --dstTile 192 --crop 352 --padBottom 2',
    ].join('\n')
  )
}

function clampInt(n, min, max) {
  if (n < min) return min
  if (n > max) return max
  return n | 0
}

function getAlpha(png, x, y) {
  const i = ((png.width * y + x) << 2) >>> 0
  return png.data[i + 3]
}

function bboxNonTransparent(png, x0, y0, w, h) {
  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = getAlpha(png, x0 + x, y0 + y)
      if (a === 0) continue
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  if (maxX === -1) return null
  return { minX, minY, maxX, maxY }
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

function scaleNearest(src, dstW, dstH) {
  const dst = new PNG({ width: dstW, height: dstH })
  for (let y = 0; y < dstH; y++) {
    const sy = clampInt(Math.floor((y / dstH) * src.height), 0, src.height - 1)
    for (let x = 0; x < dstW; x++) {
      const sx = clampInt(Math.floor((x / dstW) * src.width), 0, src.width - 1)
      const si = ((src.width * sy + sx) << 2) >>> 0
      const di = ((dst.width * y + x) << 2) >>> 0
      dst.data[di + 0] = src.data[si + 0]
      dst.data[di + 1] = src.data[si + 1]
      dst.data[di + 2] = src.data[si + 2]
      dst.data[di + 3] = src.data[si + 3]
    }
  }
  return dst
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
  const dstTile = Number.isFinite(args.dstTile) ? Math.max(32, Math.min(512, args.dstTile | 0)) : 192
  const cropSize = Number.isFinite(args.cropSize) ? Math.max(64, Math.min(1024, args.cropSize | 0)) : 352
  const padBottom = Number.isFinite(args.padBottom) ? clampInt(args.padBottom | 0, 0, 32) : 2

  const src = PNG.sync.read(fs.readFileSync(inputPath))
  const frameW = Math.floor(src.width / frames)
  const frameH = src.height

  if (frameW * frames !== src.width) {
    console.log(`[warn] width ${src.width} not divisible by frames=${frames}, using frameW=${frameW}`)
  }

  const bboxes = []
  let globalBaseline = -1
  for (let f = 0; f < frames; f++) {
    const fx = f * frameW
    const bb = bboxNonTransparent(src, fx, 0, frameW, frameH)
    if (!bb) {
      bboxes.push(null)
      continue
    }
    bboxes.push(bb)
    const baseline = bb.maxY
    if (baseline > globalBaseline) globalBaseline = baseline
  }

  if (globalBaseline < 0) {
    throw new Error('no non-transparent pixels found')
  }

  // Build output sheet (horizontal)
  const out = new PNG({ width: dstTile * frames, height: dstTile })

  for (let f = 0; f < frames; f++) {
    const bb = bboxes[f]
    if (!bb) continue

    const fx = f * frameW
    const bbCenterX = fx + Math.floor((bb.minX + bb.maxX) / 2)
    const bbBaselineY = bb.maxY

    // Crop square aligned by baseline
    const cropBottom = clampInt((globalBaseline - bbBaselineY) + bbBaselineY + padBottom, 0, frameH - 1)
    let cropTop = cropBottom - cropSize + 1
    cropTop = clampInt(cropTop, 0, Math.max(0, frameH - cropSize))

    let cropLeft = bbCenterX - Math.floor(cropSize / 2)
    cropLeft = clampInt(cropLeft, fx, fx + frameW - cropSize)

    const crop = new PNG({ width: cropSize, height: cropSize })
    blit(crop, src, 0, 0, cropLeft, cropTop, cropSize, cropSize)

    const scaled = scaleNearest(crop, dstTile, dstTile)
    blit(out, scaled, f * dstTile, 0, 0, 0, dstTile, dstTile)

    console.log(
      `[frame ${f}] bb=(${bb.minX},${bb.minY})..(${bb.maxX},${bb.maxY}) ` +
        `cropLeft=${cropLeft - fx} cropTop=${cropTop} cropSize=${cropSize}`
    )
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, PNG.sync.write(out))
  console.log(`[ok] wrote ${outputPath} (${frames}x${dstTile}x${dstTile})`)
}

main()

