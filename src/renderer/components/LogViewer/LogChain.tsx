import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { LogEntry } from '@shared'
import { LEVEL_COLORS, formatTime, worstLevel, shortRunId } from './utils'

/** 调用链树节点：一个 runId 归组为一条调用（含多条 start/end/error 日志），children 为其子调用。 */
interface ChainNode {
  runId: string
  entries: LogEntry[]
  children: ChainNode[]
}

/**
 * 把 getChain 返回的平铺日志数组重建为调用链树。
 * - 按 runId 分组，一个 runId 的 start/end/error 多条日志归为一个节点
 * - 通过 parentRunId 建立父子关系
 * - 根 = 不被链内任何节点引用的 runId（getChain 是双向 BFS，点击的节点可能是子树）
 * - 父节点不在链内（maxDepth 截断）的节点也断开成根，保证每棵子树完整
 */
function buildChainTree(entries: LogEntry[]): ChainNode[] {
  const byRunId = new Map<string, LogEntry[]>()
  for (const e of entries) {
    const list = byRunId.get(e.runId)
    if (list) list.push(e)
    else byRunId.set(e.runId, [e])
  }

  const childMap = new Map<string, string[]>()
  for (const e of entries) {
    if (!e.parentRunId) continue
    if (!byRunId.has(e.parentRunId)) continue
    const list = childMap.get(e.parentRunId)
    if (list) list.push(e.runId)
    else childMap.set(e.parentRunId, [e.runId])
  }

  const built = new Set<string>()
  const build = (runId: string): ChainNode => {
    built.add(runId)
    return {
      runId,
      entries: byRunId.get(runId) ?? [],
      // Set 去重：同一 parentRunId 下可能有多条日志（start/end/error）指向同一 runId，
      // 必须先去重再 build，否则同一节点被构建多次导致 React key 冲突
      children: [...new Set(childMap.get(runId) ?? [])]
        .filter((id) => !built.has(id))
        .map(build),
    }
  }

  const childIds = new Set<string>()
  for (const ids of childMap.values()) for (const id of ids) childIds.add(id)

  const roots: ChainNode[] = []
  for (const runId of byRunId.keys()) {
    if (!childIds.has(runId)) roots.push(build(runId))
  }
  return roots
}

/** 单个调用节点内的某一条日志（start/end/error 等）。消息单行省略，hover 看全文。 */
function EntryLine({ entry }: { entry: LogEntry }) {
  const text = [entry.name, entry.message].filter(Boolean).join(' · ')
  return (
    <div className="flex items-center gap-2 py-0.5 text-[11px] leading-snug">
      <span className="shrink-0 tabular-nums text-[var(--app-muted)]">{formatTime(entry.ts)}</span>
      {entry.event && (
        <span
          className={cn(
            'inline-flex shrink-0 items-center rounded px-1 py-px text-[10px] font-semibold uppercase',
            entry.event === 'error'
              ? 'bg-red-500/15 text-red-400'
              : entry.event === 'start'
                ? 'bg-blue-500/10 text-blue-400'
                : 'bg-slate-500/15 text-[var(--app-muted)]'
          )}
        >
          {entry.event}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-[var(--app-fg)]" title={text || undefined}>
        {text}
      </span>
    </div>
  )
}

/**
 * 递归渲染调用链树节点。缩进由每层的 border-l 容器自然叠加（VS Code 文件树风格），
 * 根节点与高亮节点默认展开，其余节点折叠。
 */
function ChainNodeView({ node, depth, isRoot, highlightRunId }: {
  node: ChainNode
  depth: number
  isRoot: boolean
  highlightRunId?: string
}) {
  const highlighted = node.runId === highlightRunId
  const [open, setOpen] = useState(isRoot || highlighted)

  const tsMin = Math.min(...node.entries.map((e) => e.ts))
  const tsMax = Math.max(...node.entries.map((e) => e.ts))
  const duration = tsMax - tsMin
  const errCount = node.entries.filter((e) => e.level === 'error').length
  const name = node.entries.find((e) => e.name)?.name ?? node.runId
  const level = worstLevel(node.entries)

  return (
    <div>
      <div
        className={cn(
          'group flex items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-[var(--app-hover)]',
          highlighted && 'bg-[var(--app-primary)]/10 ring-1 ring-inset ring-[var(--app-primary)]/40'
        )}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="shrink-0 text-[var(--app-muted)]">
            {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </span>
          <span
            className={cn(
              'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white',
              LEVEL_COLORS[level]
            )}
          >
            {level}
          </span>
          {isRoot && <span className="shrink-0 rounded bg-[var(--app-muted)]/20 px-1 text-[10px] text-[var(--app-muted)]">根</span>}
          {highlighted && <span className="shrink-0 rounded bg-[var(--app-primary)]/20 px-1 text-[10px] text-[var(--app-primary)]">当前</span>}
          <span className="truncate font-medium text-[var(--app-fg)]">{name}</span>
          <span className="shrink-0 font-mono text-[10px] text-[var(--app-muted)] transition-colors group-hover:text-[var(--app-primary)]">
            {shortRunId(node.runId)}
          </span>
          {errCount > 0 && (
            <span className="shrink-0 text-[10px] font-semibold text-red-400">×{errCount} error</span>
          )}
          {duration > 10 && <span className="shrink-0 text-[10px] tabular-nums text-[var(--app-muted)]">{duration}ms</span>}
        </button>
      </div>

      {open && (
        <div className="ml-2.5 border-l border-[color:var(--app-border)] pl-2.5">
          {node.entries.map((e, i) => (
            <EntryLine key={`${e.ts}-${i}`} entry={e} />
          ))}
          {node.children.map((child) => (
            <ChainNodeView key={child.runId} node={child} depth={depth + 1} isRoot={false} highlightRunId={highlightRunId} />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * 调用链树视图。把 getChain 返回的平铺日志以树形展示：
 * 根 → 子调用逐层缩进（border-l 竖线），高亮被点击的 runId，节点展开后显示组内每条日志。
 */
export default function LogChain({ entries, highlightRunId }: {
  entries: LogEntry[]
  highlightRunId?: string
}) {
  const roots = buildChainTree(entries)
  if (roots.length === 0) {
    return <div className="px-4 py-3 text-xs text-[var(--app-muted)]">无关联日志</div>
  }
  return (
    <div className="space-y-1 bg-[var(--app-subtle-section)]/40 px-4 py-3 text-xs">
      {roots.map((root) => (
        <ChainNodeView key={root.runId} node={root} depth={0} isRoot={true} highlightRunId={highlightRunId} />
      ))}
    </div>
  )
}
