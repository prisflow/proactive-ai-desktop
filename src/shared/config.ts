import {
  DEFAULT_MODEL,
  DEFAULT_BASE_URL,
  DEFAULT_SETTINGS,
  DEFAULT_PROACTIVE_INTERVAL,
  DEFAULT_PROACTIVE_ENABLED,
  DEFAULT_TEMPLATE_NAME,
  DEFAULT_THEME,
  DEFAULT_FONT_SIZE,
  IMPORTANT_INFO_EXTRACTION_RULES,
  RESPONSE_FORMAT_REQUIREMENTS,
  RESPONSE_FORMAT_EXAMPLE,
} from './constants'
import { PROMPT_TEMPLATES } from './prompt-templates'
import { DEFAULT_LOCALE, type AppLocale } from './locale'
import { getBuiltinRolePrompt, getSystemPromptTail } from './prompt-i18n'

export {
  DEFAULT_MODEL,
  DEFAULT_BASE_URL,
  DEFAULT_SETTINGS,
  DEFAULT_PROACTIVE_INTERVAL,
  DEFAULT_PROACTIVE_ENABLED,
  DEFAULT_TEMPLATE_NAME,
  DEFAULT_THEME,
  DEFAULT_FONT_SIZE,
  IMPORTANT_INFO_EXTRACTION_RULES,
  RESPONSE_FORMAT_REQUIREMENTS,
  RESPONSE_FORMAT_EXAMPLE,
  PROMPT_TEMPLATES,
}

export function buildSystemPrompt(
  rolePrompt: string,
  locale: AppLocale = DEFAULT_LOCALE
): string {
  return `${rolePrompt}\n\n${getSystemPromptTail(locale)}`
}

export function getTemplateSystemPrompt(
  templateKey: string,
  locale: AppLocale = DEFAULT_LOCALE
): string {
  const role = getBuiltinRolePrompt(templateKey, locale)
  return buildSystemPrompt(role, locale)
}
