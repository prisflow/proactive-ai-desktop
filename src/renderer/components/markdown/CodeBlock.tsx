import { useCallback, useMemo, useState } from 'react'
import { Copy, Check } from 'lucide-react'
import hljs from 'highlight.js'

function escapeHtml(s: string) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

export function CodeBlock({
  code,
  language,
}: {
  code: string
  language?: string
}) {
  const [copied, setCopied] = useState(false)

  const label = useMemo(() => (language ? language.toUpperCase() : 'CODE'), [language])
  const highlighted = useMemo(() => {
    const text = code.replace(/\n$/, '')
    if (!text.trim()) return { html: '', lang: language }

    try {
      if (language && hljs.getLanguage(language)) {
        const r = hljs.highlight(text, { language, ignoreIllegals: true })
        return { html: r.value, lang: language }
      }
      const r = hljs.highlightAuto(text)
      return { html: r.value, lang: r.language }
    } catch {
      return { html: escapeHtml(text), lang: language }
    }
  }, [code, language])

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 900)
    } catch {
      // Ignore; clipboard may be blocked
    }
  }, [code])

  return (
    <div className="codeblock group relative my-2 overflow-hidden rounded-lg bg-[#fdf6e3]">
      <div className="flex items-center justify-between gap-2 px-3 pt-2">
        <div className="text-[11px] font-semibold tracking-wide text-[#657b83]">
          {(highlighted.lang ? highlighted.lang.toUpperCase() : label) ?? label}
        </div>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-1 rounded-md bg-[#eee8d5] px-2 py-1 text-[11px] font-medium text-[#586e75] hover:bg-[#e6dfcc] active:bg-[#d9d2c0]"
          aria-label="Copy code"
          title="Copy"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="mt-2 max-h-[520px] overflow-auto px-3 pb-3 text-xs leading-relaxed text-[#586e75]">
        <code className="hljs" dangerouslySetInnerHTML={{ __html: highlighted.html }} />
      </pre>
    </div>
  )
}

