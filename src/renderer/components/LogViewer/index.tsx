import { useCallback, useEffect, useRef, useState } from 'react'
import { X, RefreshCw, Trash2, Terminal, BarChart3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { LogEntry, LogQuery, Conversation } from '@shared'
import { queryAllLogs, clearLogs, getUsageTotals, getDailyUsage, getHourlyUsage, getContextDaily, clearUsage, listConversations } from '@/api'
import { useTranslation } from 'react-i18next'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts'
import LogRow from './LogRow'
import { aggregateLogs, type AggRow } from './utils'

function LargeTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const order = ['cached', 'uncached', 'output']
  const sorted = [...payload].sort((a: any, b: any) => order.indexOf(a.dataKey) - order.indexOf(b.dataKey))
  const total = payload.reduce((s: number, p: any) => s + (p.value || 0), 0)
  const hit = payload.find((p: any) => p.dataKey === 'cached')?.value ?? 0
  const prompt = (payload.find((p: any) => p.dataKey === 'cached')?.value ?? 0) + (payload.find((p: any) => p.dataKey === 'uncached')?.value ?? 0)
  const hitRate = prompt ? ((hit / prompt) * 100).toFixed(1) : '0.0'
  const nameMap: Record<string, string> = {
    cached: '输入（命中缓存）',
    uncached: '输入（未命中缓存）',
    output: '输出',
  }
  // 小时格式化 08:00 -> 08:00~09:00
  const displayLabel = /^\d{2}:\d{2}$/.test(String(label)) ? `${label}~${String(Number(String(label).slice(0,2))+1).padStart(2,'0')}:00` : label
  return (
    <div className="rounded-2xl bg-white px-5 py-4 shadow-xl border border-black/[0.06] min-w-[240px]">
      <div className="flex justify-between items-center mb-2">
        <span className="text-[15px] font-medium text-zinc-900">{displayLabel}</span>
        <span className="text-[15px] font-bold text-zinc-900">{total.toLocaleString()}</span>
      </div>
      <div className="space-y-1.5">
        {sorted.map((p: any) => (
          <div key={p.dataKey} className="flex justify-between items-center text-sm">
            <span className="flex items-center gap-2 text-zinc-600"><span className="h-3 w-3 rounded-sm" style={{ background: p.color || p.fill }} />{nameMap[p.dataKey] || p.name}</span>
            <span className="font-medium text-zinc-900">{Number(p.value).toLocaleString()}</span>
          </div>
        ))}
        <div className="pt-1 text-xs text-zinc-500 text-right">命中率 {hitRate}%</div>
      </div>
    </div>
  )
}

export default function LogViewer({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const [rows, setRows] = useState<AggRow[]>([])
  const [loading, setLoading] = useState(false)
  const [conversations, setConversations] = useState<Conversation[]>([])
  /** 选中的对话 ID（'' = 全部）。 */
  const [filterConvId, setFilterConvId] = useState('')
  const [totals, setTotals] = useState<{ promptTokens: number; completionTokens: number; cachedTokens: number; totalTokens: number; hitRate: number } | null>(null)
  const [view, setView] = useState<'logs' | 'tokens'>('logs')
  const [daily, setDaily] = useState<Array<{ day: string; promptTokens: number; completionTokens: number; cachedTokens: number; hitRate: number }>>([])
  const [hourly, setHourly] = useState<Array<{ hour: string; promptTokens: number; completionTokens: number; cachedTokens: number; hitRate: number; toolCalls: number; textCalls: number }>>([])
  const [contextDaily, setContextDaily] = useState<Array<{ day: string; contexts: Record<string, number> }>>([])
  const [days, setDays] = useState(7)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(600)

  const rowH = 48
  const overscan = 8

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    try {
      const q: LogQuery = { limit: 500 }
      if (filterConvId) q.conversationId = filterConvId
      const [data, usage] = await Promise.all([queryAllLogs(q), getUsageTotals().catch(() => null)])
      setRows(aggregateLogs(data))
      if (usage) setTotals(usage)
    } catch {
    } finally {
      setLoading(false)
    }
  }, [filterConvId])

  const fetchConversations = useCallback(async () => {
    try {
      setConversations(await listConversations())
    } catch {}
  }, [])

  const fetchDaily = useCallback(async () => {
    try {
      const [d, h, c] = await Promise.all([getDailyUsage(days), getHourlyUsage().catch(() => []), getContextDaily().catch(() => [])])
      setDaily(d)
      setHourly(h as any)
      setContextDaily(c as any)
    } catch {}
  }, [days])

  useEffect(() => {
    void fetchLogs()
    void fetchDaily()
    void fetchConversations()
    timerRef.current = setInterval(() => {
      void fetchLogs()
      void fetchConversations()
      if (view === 'tokens') void fetchDaily()
    }, 3000)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [fetchLogs, fetchDaily, fetchConversations, view])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => setScrollTop(el.scrollTop)
    const onResize = () => setViewportH(el.clientHeight)
    el.addEventListener('scroll', onScroll)
    window.addEventListener('resize', onResize)
    onResize()
    return () => {
      el.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
    }
  }, [view, rows.length])

  const handleClear = useCallback(async () => {
    try {
      await clearLogs()
      setRows([])
    } catch {}
  }, [])

  const handleClearTokens = useCallback(async () => {
    try {
      await clearUsage()
      setDaily([])
      setHourly([])
      setContextDaily([])
      setTotals({ promptTokens: 0, completionTokens: 0, cachedTokens: 0, totalTokens: 0, hitRate: 0 })
      void fetchDaily()
    } catch {}
  }, [fetchDaily])

  const totalH = rows.length * rowH
  const startIdx = Math.max(0, Math.floor(scrollTop / rowH) - overscan)
  const endIdx = Math.min(rows.length, Math.ceil((scrollTop + viewportH) / rowH) + overscan)
  const visible = rows.slice(startIdx, endIdx)
  const offsetY = startIdx * rowH

  const hourlyChartData = hourly.map((h) => ({
    hour: h.hour,
    cached: h.cachedTokens,
    uncached: Math.max(0, h.promptTokens - h.cachedTokens),
    output: h.completionTokens,
  }))
  const weeklyChartData = daily.map((d) => ({
    day: d.day,
    cached: d.cachedTokens,
    uncached: Math.max(0, d.promptTokens - d.cachedTokens),
    output: d.completionTokens,
  }))
  const contextChartData = (() => {
    const contexts = new Set<string>()
    for (const d of contextDaily) for (const k of Object.keys(d.contexts)) contexts.add(k)
    const list = Array.from(contexts).slice(0, 5)
    if (list.length === 0) return daily.map((d) => ({ day: d.day, main: 0, cultivation: 0 }))
    return daily.map((d) => {
      const row: Record<string, string | number> = { day: d.day }
      const ctxMap = contextDaily.find((c) => c.day === d.day)?.contexts || {}
      for (const c of list) row[c] = ctxMap[c] || 0
      return row
    })
  })()
  const contextKeys = (() => {
    const s = new Set<string>()
    for (const d of contextDaily) for (const k of Object.keys(d.contexts)) s.add(k)
    return Array.from(s).slice(0, 5)
  })()

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-[var(--app-overlay)] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="mx-auto my-4 flex h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-5xl flex-col overflow-hidden rounded-2xl border border-[color:var(--app-border-strong)] bg-[var(--app-surface)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[color:var(--app-border-strong)] px-5 py-4">
          <div className="flex items-center gap-3">
            <Terminal size={20} className="shrink-0 text-[var(--app-primary)]" />
            <h2 className="text-lg font-semibold tracking-tight text-[var(--app-fg)]">{t('logs.title', '系统日志')}</h2>
          </div>
          <div className="flex items-center gap-3">
            {/* 对话筛选器：按对话名 + 创建日期筛选日志（同名对话靠日期区分） */}
            <Select value={filterConvId} onValueChange={setFilterConvId}>
              <SelectTrigger className="h-8 w-[220px] text-xs">
                <SelectValue placeholder={t('logs.filterAll', '全部对话')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t('logs.filterAll', '全部对话')}</SelectItem>
                {conversations.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.title} · {new Date(c.createdAt).toLocaleDateString('zh-CN')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {totals && (
              <button
                type="button"
                onClick={() => setView((v) => (v === 'logs' ? 'tokens' : 'logs'))}
                className={cn(
                  'flex items-center gap-3 rounded-full border px-3 py-1.5 text-xs transition-colors',
                  view === 'tokens'
                    ? 'border-[color:var(--app-primary)] bg-[var(--app-primary)] text-white'
                    : 'border-[color:var(--app-border-strong)] bg-[var(--app-surface-muted)] text-[var(--app-muted)] hover:bg-[var(--app-surface)] hover:text-[var(--app-fg)] hover:border-[color:var(--app-primary)]',
                )}
              >
                <span className="flex items-center gap-1.5">
                  <span className={cn('h-2 w-2 rounded-full', view === 'tokens' ? 'bg-white' : 'bg-[#1e40af]')} />↑{totals.promptTokens.toLocaleString()}
                </span>
                <span className={cn('h-3 w-px', view === 'tokens' ? 'bg-white/40' : 'bg-[color:var(--app-border-strong)]')} />
                <span className="flex items-center gap-1.5">
                  <span className={cn('h-2 w-2 rounded-full', view === 'tokens' ? 'bg-white' : 'bg-[#3b82f6]')} />↓{totals.completionTokens.toLocaleString()}
                </span>
                <span className={cn('h-3 w-px', view === 'tokens' ? 'bg-white/40' : 'bg-[color:var(--app-border-strong)]')} />
                <span>{totals.hitRate}% hit</span>
                <BarChart3 size={14} className={cn('ml-1', view === 'tokens' ? 'opacity-100' : 'opacity-60')} />
              </button>
            )}
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void fetchLogs()} disabled={loading}>
              <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 border-red-500/30 text-xs text-red-400 hover:bg-red-500/10" onClick={() => void handleClear()}>
              <Trash2 size={14} />
            </Button>
            <Button type="button" variant="ghost" size="icon" className="shrink-0 rounded-full" onClick={onClose}>
              <X size={20} />
            </Button>
          </div>
        </header>

        {view === 'tokens' ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3 p-4 overflow-hidden">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">{t('logs.tokenTitle', 'Token 使用')}</h3>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs border-red-500/30 text-red-400 hover:bg-red-500/10" onClick={() => void handleClearTokens()}>
                  <Trash2 size={12} />{t('logs.clear', '清空')}
                </Button>
                <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
                  <SelectTrigger className="h-7 w-[110px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">{t('logs.range7', '近 7 天')}</SelectItem>
                    <SelectItem value="14">{t('logs.range14', '近 14 天')}</SelectItem>
                    <SelectItem value="30">{t('logs.range30', '近 30 天')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-[1.6] flex-col rounded-xl bg-[#f8f9fb] p-3">
              <div className="mb-2 text-xs font-medium text-zinc-600">今日分时 · 每小时</div>
              <div className="flex-1 min-h-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hourlyChartData} barCategoryGap="30%">
                    <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} interval={3} />
                    <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))} />
                    <Tooltip cursor={{ fill: 'transparent' }} content={<LargeTooltip />} />
                    <Bar dataKey="output" stackId="a" fill="#1e40af" activeBar={{ fill: '#1e3a8a' }} />
                    <Bar dataKey="uncached" stackId="a" fill="#60a5fa" activeBar={{ fill: '#3b82f6' }} />
                    <Bar dataKey="cached" stackId="a" fill="#bfdbfe" radius={[4, 4, 0, 0]} activeBar={{ fill: '#93c5fd' }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="grid flex-1 min-h-0 grid-cols-5 gap-3">
              <div className="col-span-3 rounded-xl bg-[#f8f9fb] p-3 flex flex-col">
                <div className="mb-2 text-xs font-medium text-zinc-700">今日请求 · 按小时</div>
                <div className="flex-1 min-h-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={hourly.slice(-12).map((h) => ({ hour: h.hour, value: (h.toolCalls ?? 0) + (h.textCalls ?? 0) }))}>
                      <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} interval={2} tickFormatter={(v: string) => v} />
                      <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip
                        cursor={{ stroke: 'transparent' }}
                        content={({ active, payload, label }: any) => {
                          if (!active || !payload?.length) return null
                          const displayLabel = /^\d{2}:\d{2}$/.test(String(label)) ? `${label}~${String(Number(String(label).slice(0,2))+1).padStart(2,'0')}:00` : label
                          return (
                            <div className="rounded-2xl bg-white px-5 py-4 shadow-xl border border-black/[0.06] min-w-[180px]">
                              <div className="flex justify-between items-center mb-1">
                                <span className="text-[13px] font-medium text-zinc-900">{displayLabel}</span>
                                <span className="text-[13px] font-bold text-zinc-900">{Number(payload[0].value).toLocaleString()}</span>
                              </div>
                              <div className="text-xs text-zinc-500">请求次数</div>
                            </div>
                          )
                        }}
                      />
                      <Area type="monotone" dataKey="value" stroke="#2563eb" fill="#bfdbfe" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#2563eb', fill: '#fff' }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="col-span-2 rounded-xl bg-[#f8f9fb] p-3 flex flex-col">
                <div className="mb-2 text-xs font-medium text-zinc-700">当周 Tokens</div>
                <div className="flex-1 min-h-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={weeklyChartData}>
                      <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))} />
                      <Tooltip content={<LargeTooltip />} cursor={{ fill: 'transparent' }} />
                      <Bar dataKey="output" stackId="a" fill="#1e40af" activeBar={{ fill: '#1e3a8a' }} />
                      <Bar dataKey="uncached" stackId="a" fill="#60a5fa" activeBar={{ fill: '#2563eb' }} />
                      <Bar dataKey="cached" stackId="a" fill="#bfdbfe" radius={[4, 4, 0, 0]} activeBar={{ fill: '#93c5fd' }} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {rows.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-[var(--app-muted)]">
                <Terminal size={32} className="opacity-30" />
                <p className="text-sm">暂无日志</p>
              </div>
            ) : (
              <div className="relative" style={{ height: totalH }}>
                <div className="absolute inset-x-0 py-2" style={{ transform: `translateY(${offsetY}px)` }}>
                  {visible.map((row) => (
                    <LogRow key={row.runId} row={row} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex shrink-0 items-center justify-between border-t border-[color:var(--app-border-strong)] bg-[var(--app-surface-muted)] px-5 py-2 text-[11px] text-[var(--app-muted)]">
          <span>{view === 'logs' ? `${rows.length} 条日志 · 每 3 秒刷新 · 虚拟渲染` : `${daily.length} 天 · 蓝色深度`}</span>
          <span>{loading && '加载中…'}</span>
        </div>
      </div>
    </div>
  )
}
