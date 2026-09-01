import { useState } from 'react'
import { ChevronDown, ChevronUp, GitBranch } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { LogEntry } from '@shared'
import { getLogChain } from '@/api'
import { LEVEL_COLORS, formatTime, displayName, type AggRow } from './utils'
import LogChain from './LogChain'

/**
 * 聚合后的日志行（一个 runId 一行）。
 * - 首行显示成败徽章（OK/FAIL/原级别）、来源、名称、耗时、消息（时间见链路视图）
 * - 点击行展开：该 runId 的原始日志 JSON 数组（可复制）+ 错误堆栈
 * - 行尾"链路"按钮：按 runId 拉取调用链树，再次点击收起
 */
export default function LogRow({ row }: { row: AggRow }) {
  const [expanded, setExpanded] = useState(false)
  const [chainOpen, setChainOpen] = useState(false)
  const [chainEntries, setChainEntries] = useState<LogEntry[] | null>(null)
  const [chainLoading, setChainLoading] = useState(false)
  const [chainError, setChainError] = useState<string | null>(null)

  /** 切换调用链面板：首次打开时拉取，之后复用缓存结果。 */
  const handleChainToggle = async () => {
    if (chainOpen) {
      setChainOpen(false)
      return
    }
    setChainOpen(true)
    if (chainEntries) return
    setChainLoading(true)
    setChainError(null)
    try {
      const data = await getLogChain(row.runId)
      setChainEntries(data)
    } catch (e) {
      setChainError(e instanceof Error ? e.message : String(e))
    } finally {
      setChainLoading(false)
    }
  }

  // 成败徽章：end.ok 明确时优先显示 OK/FAIL，否则回退到原级别
  const badge =
    row.ok === false
      ? { label: 'FAIL', cls: 'bg-red-500' }
      : row.ok === true && row.level === 'info'
        ? { label: 'OK', cls: 'bg-emerald-500' }
        : { label: row.level.toUpperCase(), cls: LEVEL_COLORS[row.level] || 'bg-[var(--app-muted)]' }
  const disp = displayName(row.source ?? undefined, row.name)

  return (
    <div className="border-b border-[color:var(--app-border)] last:border-b-0">
      {/* 首行：详情切换按钮 + 链路按钮（兄弟关系，避免 button 嵌套） */}
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className={cn(
            'flex min-w-0 flex-1 items-start gap-3 px-4 py-2 text-left transition-colors hover:bg-[var(--app-hover)]',
            expanded && 'bg-[var(--app-hover)]'
          )}
        >
          <span className="shrink-0 pt-0.5 text-[11px] tabular-nums text-[var(--app-muted)]">
            {formatTime(row.ts)}
          </span>
          <span
            className={cn(
              'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white',
              badge.cls
            )}
          >
            {badge.label}
          </span>
          <div className="min-w-0 flex-1 text-xs">
            {disp.source && <span className="text-[var(--app-muted)]">{disp.source} · </span>}
            <span className="text-[var(--app-fg)]">{disp.name}</span>
            {row.message && (
              <p className="mt-1 whitespace-pre-wrap break-words leading-relaxed">{row.message}</p>
            )}
          </div>
          <span className="shrink-0 pt-0.5 text-[var(--app-muted)]">
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </span>
        </button>

        <button
          type="button"
          onClick={() => void handleChainToggle()}
          title="查看调用链"
          className={cn(
            'shrink-0 border-l border-[color:var(--app-border)] px-3 text-[var(--app-muted)] transition-colors hover:bg-[var(--app-hover)] hover:text-[var(--app-primary)]',
            chainOpen && 'bg-[var(--app-hover)] text-[var(--app-primary)]'
          )}
        >
          <GitBranch size={14} />
        </button>
      </div>

      {/* 展开区：该 runId 的原始日志数组（原样 JSON，可复制）+ 错误堆栈 */}
      {expanded && (
        <div className="space-y-2 px-4 pb-3 pt-1">
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[color:var(--app-border-strong)] bg-[var(--app-subtle-section)] p-3 font-mono text-[11px] leading-relaxed text-[var(--app-fg)]">
            {JSON.stringify(row.entries, null, 2)}
          </pre>
          {row.entries.map(
            (e) =>
              e.stack && (
                <pre key={e.ts} className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-300">
                  {e.stack}
                </pre>
              )
          )}
        </div>
      )}

      {/* 调用链面板 */}
      {chainOpen && (
        <div className="border-t border-[color:var(--app-border)]">
          {chainLoading && <div className="px-4 py-3 text-xs text-[var(--app-muted)]">加载调用链…</div>}
          {chainError && <div className="px-4 py-3 text-xs text-red-400">加载失败：{chainError}</div>}
          {!chainLoading && !chainError && chainEntries && (
            <LogChain entries={chainEntries} highlightRunId={row.runId} />
          )}
        </div>
      )}
    </div>
  )
}
