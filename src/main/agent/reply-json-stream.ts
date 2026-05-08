/**
 * 主模型约定输出 JSON：`{ "reply": "...", "important_info": [...] }`。
 * 流式阶段只展示 `reply` 字符串内的可见文本，不把 JSON 骨架推给 UI。
 */
export function extractReplyDisplayPrefix(accumulated: string): string {
  const m = accumulated.match(/"reply"\s*:\s*"/)
  if (!m || m.index === undefined) return ''

  let i = m.index + m[0].length
  let out = ''

  while (i < accumulated.length) {
    const c = accumulated[i]!
    if (c === '"') break

    if (c === '\\') {
      i++
      if (i >= accumulated.length) break
      const e = accumulated[i]!
      if (e === 'u') {
        const hex = accumulated.slice(i + 1, i + 5)
        if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
          return out
        }
        out += String.fromCharCode(parseInt(hex, 16))
        i += 5
        continue
      }
      switch (e) {
        case 'n':
          out += '\n'
          break
        case 'r':
          out += '\r'
          break
        case 't':
          out += '\t'
          break
        case '"':
          out += '"'
          break
        case '\\':
          out += '\\'
          break
        case '/':
          out += '/'
          break
        case 'b':
          out += '\b'
          break
        case 'f':
          out += '\f'
          break
        default:
          out += e
      }
      i++
      continue
    }

    out += c
    i++
  }

  return out
}
