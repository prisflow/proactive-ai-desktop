/**
 * 提示词层：LLM 行为定义（上下文调度器人设、生成器系统提示）。
 * 禁止写字段含义——字段语义的唯一说明源是 schemas 的 description。
 */

/** 上下文调度器人设（initialPrompt）。 */
const INITIAL_PROMPT = '你是__PLUGIN_NAME__。……（人设与协议提示：世界背景、行为边界、何时调用工具、何时收轮，按需完善）。'

module.exports = { INITIAL_PROMPT }
