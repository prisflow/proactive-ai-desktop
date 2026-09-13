/**
 * LLM 输出契约：每个生成器一个 JSON Schema。
 * 字段 description 是字段语义的唯一说明源（提示词里不重复）。
 */
const EXAMPLE_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string', description: '回答内容' },
  },
  required: ['answer'],
}

module.exports = { EXAMPLE_SCHEMA }
