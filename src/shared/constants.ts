export const DEFAULT_MODEL = "deepseek-v4-flash"

export const DEFAULT_BASE_URL = "https://api.deepseek.com"

/** 上下文窗口兜底（模型不在 MODEL_SPECS 映射内时）。 */
export const DEFAULT_CONTEXT_WINDOW = 1_000_000

/** 输出上限兜底（模型不在 MODEL_SPECS 映射内时）。 */
export const DEFAULT_OUTPUT_LIMIT = 128_000

/**
 * 模型规格映射（输入窗口 + 输出上限）。
 * 压缩触发阈值 = window - output（保证每轮有完整输出空间，超阈值晚一轮压缩安全）。
 */
export const MODEL_SPECS: Record<string, { window: number; output: number }> = {
  'deepseek-v4-flash': { window: 1_000_000, output: 128_000 },
}

export const DEFAULT_THEME = "dark" as const

export const DEFAULT_FONT_SIZE = 16
