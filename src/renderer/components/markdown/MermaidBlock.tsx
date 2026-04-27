import { memo, useEffect, useMemo, useState } from 'react'
import mermaid from 'mermaid'
import { Code2, Eye } from 'lucide-react'

type ViewMode = 'preview' | 'source'

let mermaidInitialized = false
const mermaidSvgCache = new Map<string, string>()

function initMermaidOnce() {
  if (mermaidInitialized) return
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    themeVariables: {
      background: '#fdf6e3',
      primaryColor: '#eee8d5',
      primaryTextColor: '#586e75',
      primaryBorderColor: '#d9d2c0',
      secondaryColor: '#eee8d5',
      secondaryTextColor: '#586e75',
      secondaryBorderColor: '#d9d2c0',
      tertiaryColor: '#fdf6e3',
      tertiaryTextColor: '#586e75',
      tertiaryBorderColor: '#d9d2c0',
      lineColor: '#93a1a1',
      textColor: '#586e75',
      fontFamily:
        'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
    },
  })
  mermaidInitialized = true
}

export const MermaidBlock = memo(function MermaidBlock({ chart }: { chart: string }) {
  const normalizedChart = useMemo(() => chart.replace(/\n$/, ''), [chart])
  const [mode, setMode] = useState<ViewMode>('preview')
  const [svg, setSvg] = useState<string>(() => mermaidSvgCache.get(normalizedChart) || '')
  const [error, setError] = useState<string>('')

  useEffect(() => {
    if (mode !== 'preview') return
    if (!normalizedChart.trim()) return

    const cached = mermaidSvgCache.get(normalizedChart)
    if (cached) {
      setSvg(cached)
      setError('')
      return
    }

    initMermaidOnce()

    let cancelled = false
    ;(async () => {
      try {
        setError('')
        setSvg('')
        const id = `m_${Math.random().toString(36).slice(2)}`
        const result = await mermaid.render(id, normalizedChart)
        if (cancelled) return
        mermaidSvgCache.set(normalizedChart, result.svg)
        setSvg(result.svg)
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Mermaid render failed')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [mode, normalizedChart])

  return (
    <div className="my-2 relative rounded-lg bg-[#fdf6e3]">
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
        <button
          type="button"
          onClick={() => setMode('preview')}
          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${
            mode === 'preview'
              ? 'bg-[#268bd2] text-white'
              : 'bg-[#eee8d5] text-[#586e75] hover:bg-[#e6dfcc]'
          }`}
          aria-pressed={mode === 'preview'}
        >
          <Eye className="h-3.5 w-3.5" />
          预览
        </button>
        <button
          type="button"
          onClick={() => setMode('source')}
          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${
            mode === 'source'
              ? 'bg-[#268bd2] text-white'
              : 'bg-[#eee8d5] text-[#586e75] hover:bg-[#e6dfcc]'
          }`}
          aria-pressed={mode === 'source'}
        >
          <Code2 className="h-3.5 w-3.5" />
          源码
        </button>
      </div>

      {mode === 'source' ? (
        <pre className="max-h-[420px] overflow-auto rounded-lg bg-[#fdf6e3] p-3 pt-10 text-xs leading-relaxed text-[#586e75]">
          <code>{normalizedChart}</code>
        </pre>
      ) : error ? (
        <div className="rounded-lg bg-[#dc322f]/10 p-3 pt-10 text-sm text-[#dc322f]">{error}</div>
      ) : svg ? (
        <div className="mermaid-svg overflow-auto p-3 pt-10" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <div className="rounded-lg bg-[#eee8d5] p-3 pt-10 text-sm text-[#657b83]">Rendering…</div>
      )}
    </div>
  )
})

