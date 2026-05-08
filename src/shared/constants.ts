export const DEFAULT_MODEL = "deepseek-ai/DeepSeek-V3.2"

export const DEFAULT_BASE_URL = "https://api-inference.modelscope.cn/v1"

export const DEFAULT_MAX_TRIGGERS = 3

export const DEFAULT_PROACTIVE_INTERVAL = 60

export const DEFAULT_PROACTIVE_ENABLED = true

export const DEFAULT_TEMPLATE_NAME = "builtin_default"

export const DEFAULT_THEME = "dark"

export const DEFAULT_FONT_SIZE = 16

export const IMPORTANT_INFO_EXTRACTION_RULES = `重要信息提取规则：
- 只提取当前用户消息中的重要信息（只看最后一条用户消息）
- 不要回顾历史对话
- 如果当前消息没什么特别的，important_info返回空数组`

export const RESPONSE_FORMAT_REQUIREMENTS = `返回格式要求：
- 必须返回纯JSON格式，不要使用markdown代码块标记（不要用\`\`\`json）
- 不要添加任何额外的文字说明
- 直接返回JSON对象
- 所有字段必须存在：reply, important_info`

export const RESPONSE_FORMAT_EXAMPLE = `{
    "reply": "你对用户的即时回复内容",
    "important_info": ["当前用户消息中的关键信息"]
}`

export const PROACTIVE_RULES = `重要规则：
- 用户可能在忙，不要打扰太频繁
- 主动发消息是为了关心用户或延续有价值的对话
- 如果没有特别的事情要说，建议不要主动打扰`

export const DEFAULT_SETTINGS = {
  proactiveInterval: DEFAULT_PROACTIVE_INTERVAL,
  recentMessagesCount: 3,
  proactiveEnabled: DEFAULT_PROACTIVE_ENABLED,
  theme: DEFAULT_THEME,
  fontSize: DEFAULT_FONT_SIZE,
}
