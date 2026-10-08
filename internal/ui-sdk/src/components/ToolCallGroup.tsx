import { Layers } from 'lucide-react'
import { memo, useMemo, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { useFoldState } from '../lib/fold-state'
import { getToolRenderersVersion, subscribeToolRenderers } from '../tool-renderers/plugin-registry'
import { resolveRenderer } from '../tool-renderers/registry'
import type { ToolCall } from '../types'
import { useAgentType } from './AgentTypeContext'
import { DURATION_THRESHOLD_MS, ToolCallBlock, formatDuration } from './ToolCallBlock'

/** A tool call with the calls its sub-agent made nested under it. */
interface ToolNode {
  tool: ToolCall
  children: ToolNode[]
}

function buildTree(tools: ToolCall[]): ToolNode[] {
  const nodes = new Map<string, ToolNode>()
  for (const tool of tools) nodes.set(tool.id, { tool, children: [] })
  const roots: ToolNode[] = []
  for (const tool of tools) {
    const node = nodes.get(tool.id)
    if (!node) continue
    const parent = tool.parentToolUseId ? nodes.get(tool.parentToolUseId) : undefined
    if (parent && parent !== node) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}

/** Wall-clock span of a set of finished calls, or null while any is unfinished or untimed. */
function getSpan(nodes: ToolNode[]): number | null {
  let start = Number.POSITIVE_INFINITY
  let end = 0
  for (const { tool } of nodes) {
    const finishedAt = tool.resultAt ?? tool.completedAt
    if (!tool.startedAt || !finishedAt) return null
    start = Math.min(start, tool.startedAt)
    end = Math.max(end, finishedAt)
  }
  return end - start
}

/**
 * A run of consecutive tool calls. Two or more sibling calls fold into a
 * summary row that keeps the latest call — and any still running — in view; a
 * sub-agent's calls fold the same way under the call that spawned it.
 */
function ToolCallGroupImpl({
  tools,
  foldKey,
  expandAll = false,
}: {
  tools: ToolCall[]
  /** Identifies this run across unmounts, so the reader's choice survives. */
  foldKey: string
  /** Show every call, whatever the reader folded. */
  expandAll?: boolean
}) {
  const roots = useMemo(() => buildTree(tools), [tools])
  return <Siblings nodes={roots} foldKey={foldKey} expandAll={expandAll} nested={false} />
}

export const ToolCallGroup = memo(ToolCallGroupImpl)

interface LevelProps {
  nodes: ToolNode[]
  foldKey: string
  expandAll: boolean
  nested: boolean
}

function Siblings({ nodes, foldKey, expandAll, nested }: LevelProps) {
  const agentType = useAgentType()
  // A renderer registered later can turn a call into a default-expanded card.
  useSyncExternalStore(subscribeToolRenderers, getToolRenderersVersion)

  // Default-expanded cards carry something the reader has to act on, so they
  // never fold away: each one stands alone and splits the calls around it.
  const segments: ToolNode[][] = []
  let open: ToolNode[] | null = null
  for (const node of nodes) {
    if (resolveRenderer(node.tool, agentType)?.defaultExpanded) {
      segments.push([node])
      open = null
    } else {
      if (!open) {
        open = []
        segments.push(open)
      }
      open.push(node)
    }
  }

  return (
    <>
      {segments.map((segment) =>
        segment.length < 2 ? (
          <ToolNodeView
            key={segment[0].tool.id}
            node={segment[0]}
            foldKey={foldKey}
            expandAll={expandAll}
          />
        ) : (
          <FoldedSegment
            key={segment[0].tool.id}
            nodes={segment}
            foldKey={foldKey}
            expandAll={expandAll}
            nested={nested}
          />
        ),
      )}
    </>
  )
}

function FoldedSegment({ nodes, foldKey, expandAll, nested }: LevelProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useFoldState(`${foldKey}:${nodes[0].tool.id}`)
  const showAll = expanded || expandAll
  const visible = showAll
    ? nodes
    : nodes.filter((node, idx) => idx === nodes.length - 1 || node.tool.result === undefined)
  const failed = nodes.filter((node) => node.tool.isError).length
  const span = getSpan(nodes)

  return (
    <>
      <button
        type="button"
        disabled={expandAll}
        className={`mt-2 -mb-1 flex w-fit items-center gap-2 rounded-full border border-foreground/[0.08] bg-muted px-2.5 py-1 text-mini text-muted-foreground transition-colors enabled:hover:bg-accent enabled:hover:text-accent-foreground ${nested ? 'ml-4' : ''}`}
        onClick={() => setExpanded(!expanded)}
      >
        <Layers className="h-3 w-3 shrink-0" />
        <span className="font-medium text-foreground/80">
          {t('components.chat.toolCallGroup.count', { count: nodes.length })}
        </span>
        {failed > 0 && (
          <span className="text-destructive">
            {t('components.chat.toolCallGroup.failed', { count: failed })}
          </span>
        )}
        {span !== null && span >= DURATION_THRESHOLD_MS && (
          <span className="tabular-nums">{formatDuration(span)}</span>
        )}
        {!expandAll && (
          <span className="border-l border-foreground/[0.12] pl-2">
            {showAll
              ? t('components.chat.toolCallGroup.collapse')
              : t('components.chat.toolCallGroup.showAll')}
          </span>
        )}
      </button>
      {visible.map((node) => (
        <ToolNodeView key={node.tool.id} node={node} foldKey={foldKey} expandAll={expandAll} />
      ))}
    </>
  )
}

function ToolNodeView({
  node,
  foldKey,
  expandAll,
}: {
  node: ToolNode
  foldKey: string
  expandAll: boolean
}) {
  return (
    <>
      <ToolCallBlock tool={node.tool} />
      {node.children.length > 0 && (
        <Siblings nodes={node.children} foldKey={foldKey} expandAll={expandAll} nested />
      )}
    </>
  )
}
