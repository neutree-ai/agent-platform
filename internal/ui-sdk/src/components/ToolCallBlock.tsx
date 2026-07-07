import { ChevronDown, ChevronRight } from 'lucide-react'
import { memo, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { useLazyToolRenderers } from '../lazy'
import { getToolRenderersVersion, subscribeToolRenderers } from '../tool-renderers/plugin-registry'
import { DefaultInput, DefaultResult } from '../tool-renderers/defaults'
import {
  getToolDisplayName,
  resolveRenderer,
  unwrapExecuteDispatchName,
} from '../tool-renderers/registry'
import { jsonPreview } from '../tool-renderers/types'
import type { ToolCall } from '../types'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible'
import { Spinner } from '../ui/spinner'
import { useAgentType } from './AgentTypeContext'

const NOOP_SUBSCRIBE = () => () => {}
const ZERO = () => 0

// ── Duration formatting ──

const DURATION_THRESHOLD_MS = 1000

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`
}

function getToolDuration(tool: ToolCall): number | null {
  // Total duration: from tool_call started to tool_result returned
  if (tool.startedAt && tool.resultAt) return tool.resultAt - tool.startedAt
  // Fallback: just the inference part (started to completed)
  if (tool.startedAt && tool.completedAt) return tool.completedAt - tool.startedAt
  return null
}

// ── Main component ──

function ToolCallBlockImpl({ tool }: { tool: ToolCall }) {
  const { t } = useTranslation()
  const agentType = useAgentType()
  const lazy = useLazyToolRenderers()
  // Re-render when a host registers a renderer (via registerToolRenderer) — or
  // when the lazy-descriptor registry changes — so a card swaps from skeleton /
  // default to the real renderer the moment it lands.
  useSyncExternalStore(subscribeToolRenderers, getToolRenderersVersion)
  useSyncExternalStore(lazy?.subscribe ?? NOOP_SUBSCRIBE, lazy?.getVersion ?? ZERO)
  const effectiveName = unwrapExecuteDispatchName(tool.name, tool.input)
  const renderer = resolveRenderer(tool, agentType)
  // No synchronous renderer yet — if a host-provided lazy source owns this tool,
  // show a skeleton and kick off the bundle load; the subscriptions above
  // re-render once it registers.
  const lazyPluginId = renderer ? null : (lazy?.getPluginId(getToolDisplayName(effectiveName)) ?? null)
  useEffect(() => {
    if (lazyPluginId && lazy) lazy.load(lazyPluginId).catch(() => {})
  }, [lazyPluginId, lazy])
  const [expanded, setExpanded] = useState(renderer?.defaultExpanded ?? false)
  const preview = useMemo(
    () => renderer?.getPreview(tool) ?? jsonPreview(tool.input),
    [renderer, tool],
  )
  const duration = getToolDuration(tool)
  const isSubAgent = !!tool.parentToolUseId

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <div
        className={`my-2 rounded-md border border-foreground/[0.08] bg-muted/40 text-xs overflow-hidden transition-colors ${isSubAgent ? 'ml-4 border-l-2 border-l-info/40' : ''}`}
      >
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full min-w-0 items-center gap-2 overflow-hidden px-2.5 py-1.5 text-left hover:bg-muted/60"
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/70" />
            ) : (
              <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/70" />
            )}
            <span
              className="shrink-0 truncate font-mono text-xs text-foreground/80"
              title={getToolDisplayName(effectiveName)}
            >
              {getToolDisplayName(effectiveName)}
            </span>
            {preview && (
              <span
                className="min-w-0 truncate font-mono text-tiny text-muted-foreground/80"
                title={preview}
              >
                {preview}
              </span>
            )}
            {tool.result !== undefined && (
              <span className="ml-auto flex items-center gap-2 shrink-0">
                {duration !== null && duration >= DURATION_THRESHOLD_MS && (
                  <span className="text-mini tabular-nums text-muted-foreground/70">
                    {formatDuration(duration)}
                  </span>
                )}
                <span
                  aria-label={
                    tool.isError
                      ? t('components.chat.toolCallBlock.status.error')
                      : t('components.chat.toolCallBlock.status.done')
                  }
                  title={
                    tool.isError
                      ? t('components.chat.toolCallBlock.status.error')
                      : t('components.chat.toolCallBlock.status.done')
                  }
                  className={`h-1.5 w-1.5 rounded-full ${tool.isError ? 'bg-destructive' : 'bg-success'}`}
                />
              </span>
            )}
            {tool.result === undefined && <Spinner size="sm" className="ml-auto shrink-0" />}
          </button>
        </CollapsibleTrigger>
        {expanded && (
          <CollapsibleContent forceMount>
            <div className="border-t border-foreground/[0.06] p-2.5 space-y-2">
              {lazyPluginId ? (
                <LazyRendererSkeleton />
              ) : (
                <>
                  {renderer?.renderInput(tool) ?? <DefaultInput tool={tool} />}
                  {tool.result !== undefined &&
                    (renderer?.renderResult(tool) ?? <DefaultResult tool={tool} />)}
                </>
              )}
            </div>
          </CollapsibleContent>
        )}
      </div>
    </Collapsible>
  )
}

export const ToolCallBlock = memo(ToolCallBlockImpl)

/** Skeleton shown while a lazy plugin's tool-renderer bundle is loading. Once it
 *  registers, the parent re-renders with the real card and this disappears. */
function LazyRendererSkeleton() {
  return (
    <div className="animate-pulse space-y-2" aria-hidden>
      <div className="h-3 w-1/3 rounded bg-muted-foreground/15" />
      <div className="h-3 w-2/3 rounded bg-muted-foreground/10" />
      <div className="h-12 w-full rounded bg-muted-foreground/10" />
    </div>
  )
}
