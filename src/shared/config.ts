import {
  DEFAULT_MODEL,
  DEFAULT_BASE_URL,
  DEFAULT_SETTINGS,
  DEFAULT_MAX_TRIGGERS,
  DEFAULT_PROACTIVE_INTERVAL,
  DEFAULT_PROACTIVE_ENABLED,
  DEFAULT_TEMPLATE_NAME,
  DEFAULT_THEME,
  DEFAULT_FONT_SIZE,
  IMPORTANT_INFO_EXTRACTION_RULES,
  RESPONSE_FORMAT_REQUIREMENTS,
  RESPONSE_FORMAT_EXAMPLE,
  PROACTIVE_RULES,
} from './constants'
import { PROMPT_TEMPLATES } from './prompt-templates'
import { DEFAULT_LOCALE, type AppLocale } from './locale'
import { getBuiltinRolePrompt, getSystemPromptTail } from './prompt-i18n'

export {
  DEFAULT_MODEL,
  DEFAULT_BASE_URL,
  DEFAULT_SETTINGS,
  DEFAULT_MAX_TRIGGERS,
  DEFAULT_PROACTIVE_INTERVAL,
  DEFAULT_PROACTIVE_ENABLED,
  DEFAULT_TEMPLATE_NAME,
  DEFAULT_THEME,
  DEFAULT_FONT_SIZE,
  IMPORTANT_INFO_EXTRACTION_RULES,
  RESPONSE_FORMAT_REQUIREMENTS,
  RESPONSE_FORMAT_EXAMPLE,
  PROACTIVE_RULES,
  PROMPT_TEMPLATES,
}

export function buildSystemPrompt(
  rolePrompt: string,
  maxTriggers: number = DEFAULT_MAX_TRIGGERS,
  locale: AppLocale = DEFAULT_LOCALE
): string {
  return `${rolePrompt}\n\n${getSystemPromptTail(locale, maxTriggers)}`
}

export function getTemplateSystemPrompt(
  templateKey: string,
  maxTriggers: number = DEFAULT_MAX_TRIGGERS,
  locale: AppLocale = DEFAULT_LOCALE
): string {
  const role = getBuiltinRolePrompt(templateKey, locale)
  return buildSystemPrompt(role, maxTriggers, locale)
}
