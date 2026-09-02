/**
 * Token 估算（对齐 opencode chars/4 基线 + 中文校准）。
 * 仅用于压缩的尾部切分（selectTail 的 keepTokens 预算），不用于触发——
 * 压缩触发使用 provider 返回的真实 usage（见 Runtime.compactIfNeeded）。
 * 中文校准：CJK 字符 ≈ 1 token/字（DeepSeek/GPT 中文 tokenizer 实测区间），
 * 其余字符沿用 chars/4——纯 chars/4 对中文偏低 2~4 倍，导致尾部实际 token 超预算。
 */
/** 估算单段文本的 token 数。 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  let cjk = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    if (cp >= 0x4e00 && cp <= 0x9fff) cjk++
  }
  const other = text.length - cjk
  return Math.max(1, Math.round(cjk + other / 4))
}