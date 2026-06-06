import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api/client'
import type { McpCatalogEntry } from '@/lib/api/types'
import { cn } from '@/lib/utils'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, ChevronRight, Link, Loader2, Plus, Trash2, Unlink } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BuilderCapsEditor } from './BuilderCapsEditor'

// ─── Catalog-driven MCP server registry ──────────────────────────

interface KnownServerParam {
  header: string
  label: string
  type: 'number' | 'text'
  default: string
}

interface KnownServerDef {
  label: string
  description: string
  url: string
  params: KnownServerParam[]
  required?: boolean
  group: string
}

function catalogToKnown(catalog: McpCatalogEntry[]): {
  servers: Record<string, KnownServerDef>
  groups: { group: string; servers: [string, KnownServerDef][] }[]
  keys: string[]
} {
  const servers: Record<string, KnownServerDef> = {}
  for (const entry of catalog) {
    servers[entry.id] = {
      label: entry.label,
      description: entry.description,
      url: entry.url,
      params: entry.params as KnownServerParam[],
      required: entry.required,
      group: entry.group,
    }
  }

  const groups: { group: string; servers: [string, KnownServerDef][] }[] = []
  const seen = new Map<string, number>()
  for (const [key, def] of Object.entries(servers)) {
    const idx = seen.get(def.group)
    if (idx !== undefined) {
      groups[idx].servers.push([key, def])
    } else {
      seen.set(def.group, groups.length)
      groups.push({ group: def.group, servers: [[key, def]] })
    }
  }

  return { servers, groups, keys: Object.keys(servers) }
}

// ─── Types & helpers ──────────────────────────────────────────────

type OAuthState = { connected: boolean; expires_at?: string } | null | 'loading' | 'error'

interface McpServerConfig {
  type?: string
  url?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  headers?: Record<string, string>
  [key: string]: unknown
}

interface McpConfig {
  mcpServers?: Record<string, McpServerConfig>
}

interface StructuredDraft {
  mode: 'struct'
  name: string
  transport: 'http' | 'stdio'
  url: string
  command: string
  args: string
  headers: { key: string; value: string }[]
  env: { key: string; value: string }[]
}

interface RawDraft {
  mode: 'raw'
  name: string
  json: string
}

type CustomDraft = StructuredDraft | RawDraft

/** Check if a config can be fully represented in struct mode */
function canStructure(cfg: McpServerConfig): boolean {
  const isStdio = cfg.type === 'stdio' || cfg.type === 'command' || !!cfg.command
  const isHttp = !isStdio
  const knownKeys = new Set(['type', 'url', 'headers', 'command', 'args', 'env'])
  const hasUnknown = Object.keys(cfg).some((k) => !knownKeys.has(k))
  if (hasUnknown) return false
  if (isHttp && cfg.type && cfg.type !== 'http' && cfg.type !== 'streamable-http') return false
  return true
}

function configToDraft(name: string, cfg: McpServerConfig): CustomDraft {
  if (!canStructure(cfg)) {
    return { mode: 'raw', name, json: JSON.stringify(cfg, null, 2) }
  }
  const isStdio = cfg.type === 'stdio' || cfg.type === 'command' || !!cfg.command
  return {
    mode: 'struct',
    name,
    transport: isStdio ? 'stdio' : 'http',
    url: cfg.url || '',
    command: cfg.command || '',
    args: (cfg.args ?? []).join(' '),
    headers: Object.entries(cfg.headers ?? {}).map(([key, value]) => ({ key, value })),
    env: Object.entries(cfg.env ?? {}).map(([key, value]) => ({ key, value: String(value) })),
  }
}

function draftToConfig(draft: CustomDraft): McpServerConfig {
  if (draft.mode === 'raw') {
    try {
      return JSON.parse(draft.json)
    } catch {
      return {}
    }
  }
  if (draft.transport === 'stdio') {
    const cfg: McpServerConfig = { type: 'stdio', command: draft.command }
    const args = draft.args.trim()
    if (args) cfg.args = args.split(/\s+/)
    const env = Object.fromEntries(
      draft.env.filter((e) => e.key.trim()).map((e) => [e.key, e.value]),
    )
    if (Object.keys(env).length > 0) cfg.env = env
    return cfg
  }
  const cfg: McpServerConfig = { type: 'http', url: draft.url }
  const headers = Object.fromEntries(
    draft.headers.filter((h) => h.key.trim()).map((h) => [h.key, h.value]),
  )
  if (Object.keys(headers).length > 0) cfg.headers = headers
  return cfg
}

function emptyDraft(): StructuredDraft {
  return {
    mode: 'struct',
    name: '',
    transport: 'http',
    url: '',
    command: '',
    args: '',
    headers: [],
    env: [],
  }
}

function parseMcp(raw: string): McpConfig {
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

/** Build the JSON string from structured state */
function buildMcpJson(
  knownServers: Record<string, KnownServerDef>,
  enabled: Record<string, boolean>,
  paramValues: Record<string, Record<string, string>>,
  customs: CustomDraft[],
): string {
  const mcpServers: Record<string, unknown> = {}

  for (const [key, def] of Object.entries(knownServers)) {
    if (!enabled[key] && !def.required) continue
    const entry: McpServerConfig = { type: 'http', url: def.url }
    const headers: Record<string, string> = {}
    for (const p of def.params) {
      const val = paramValues[key]?.[p.header]
      if (val && val !== p.default) {
        headers[p.header] = val
      }
    }
    // tos-platform's Builder caps live outside catalog params (server-specific UX).
    if (key === 'tos-platform') {
      const v = paramValues[key]?.['X-Builder']
      if (v) headers['X-Builder'] = v
    }
    if (Object.keys(headers).length > 0) entry.headers = headers
    mcpServers[key] = entry
  }

  for (const c of customs) {
    if (c.name.trim()) mcpServers[c.name] = draftToConfig(c)
  }

  return JSON.stringify({ mcpServers }, null, 2)
}

/** Parse current JSON into structured state */
function parseStructuredState(
  raw: string,
  knownServers: Record<string, KnownServerDef>,
  knownKeys: string[],
) {
  const parsed = parseMcp(raw)
  const servers = parsed.mcpServers ?? {}

  const enabled: Record<string, boolean> = {}
  const paramValues: Record<string, Record<string, string>> = {}

  for (const [key, def] of Object.entries(knownServers)) {
    enabled[key] = def.required || key in servers
    paramValues[key] = {}
    const serverHeaders = (servers[key] as McpServerConfig)?.headers ?? {}
    for (const p of def.params) {
      paramValues[key][p.header] = serverHeaders[p.header] ?? p.default
    }
    if (key === 'tos-platform') {
      paramValues[key]['X-Builder'] = serverHeaders['X-Builder'] ?? ''
    }
  }

  const customs: CustomDraft[] = Object.entries(servers)
    .filter(([k]) => !knownKeys.includes(k))
    .map(([name, cfg]) => configToDraft(name, cfg as McpServerConfig))

  return { enabled, paramValues, customs }
}

// ─── Server fields form ───────────────────────────────────────────

function ServerFields({
  draft,
  onChange,
  showName,
}: {
  draft: StructuredDraft
  onChange: (patch: Partial<StructuredDraft>) => void
  showName: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-2">
      {showName && (
        <Input
          className="h-7 text-xs"
          placeholder={t('components.mcpConfigEditor.placeholders.serverName')}
          value={draft.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      )}
      <div className="inline-flex rounded-md border border-border text-mini">
        <button
          type="button"
          className={`px-2 py-0.5 rounded-l-md transition-colors ${draft.transport === 'http' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
          onClick={() => onChange({ transport: 'http' })}
        >
          {t('components.mcpConfigEditor.transport.http')}
        </button>
        <button
          type="button"
          className={`px-2 py-0.5 rounded-r-md transition-colors ${draft.transport === 'stdio' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
          onClick={() => onChange({ transport: 'stdio' })}
        >
          {t('components.mcpConfigEditor.transport.stdio')}
        </button>
      </div>

      {draft.transport === 'http' ? (
        <>
          <Input
            className="h-7 text-xs font-mono"
            placeholder={t('components.mcpConfigEditor.placeholders.httpUrl')}
            value={draft.url}
            onChange={(e) => onChange({ url: e.target.value })}
          />
          <KVFields
            label={t('components.mcpConfigEditor.fields.headers')}
            items={draft.headers}
            onChange={(headers) => onChange({ headers })}
            keyPlaceholder={t('components.mcpConfigEditor.placeholders.headerName')}
            valuePlaceholder={t('components.mcpConfigEditor.placeholders.value')}
          />
        </>
      ) : (
        <>
          <Input
            className="h-7 text-xs font-mono"
            placeholder={t('components.mcpConfigEditor.placeholders.command')}
            value={draft.command}
            onChange={(e) => onChange({ command: e.target.value })}
          />
          <Input
            className="h-7 text-xs font-mono"
            placeholder={t('components.mcpConfigEditor.placeholders.args')}
            value={draft.args}
            onChange={(e) => onChange({ args: e.target.value })}
          />
          <KVFields
            label={t('components.mcpConfigEditor.fields.environment')}
            items={draft.env}
            onChange={(env) => onChange({ env })}
            keyPlaceholder={t('components.mcpConfigEditor.placeholders.envKey')}
            valuePlaceholder={t('components.mcpConfigEditor.placeholders.envValue')}
          />
        </>
      )}
    </div>
  )
}

function KVFields({
  label,
  items,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
}: {
  label: string
  items: { key: string; value: string }[]
  onChange: (items: { key: string; value: string }[]) => void
  keyPlaceholder: string
  valuePlaceholder: string
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-1">
      {items.length > 0 && (
        <div className="space-y-1">
          {items.map((item, i) => (
            <div key={i} className="flex items-center gap-1">
              <Input
                className="h-6 text-tiny font-mono flex-1"
                placeholder={keyPlaceholder}
                value={item.key}
                onChange={(e) => {
                  const next = [...items]
                  next[i] = { ...next[i], key: e.target.value }
                  onChange(next)
                }}
              />
              <Input
                className="h-6 text-tiny font-mono flex-1"
                placeholder={valuePlaceholder}
                value={item.value}
                onChange={(e) => {
                  const next = [...items]
                  next[i] = { ...next[i], value: e.target.value }
                  onChange(next)
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => onChange(items.filter((_, j) => j !== i))}
              >
                <Trash2 className="h-2.5 w-2.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        className="text-mini text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => onChange([...items, { key: '', value: '' }])}
      >
        {t('components.mcpConfigEditor.actions.addField', { label })}
      </button>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────

interface McpConfigEditorProps {
  value: string
  onChange: (value: string) => void
  workspaceId?: string
}

export function McpConfigEditor({ value, onChange, workspaceId }: McpConfigEditorProps) {
  const { t } = useTranslation()
  const catalogQuery = useQuery({
    queryKey: ['mcp-catalog'],
    queryFn: () => api.getMcpCatalog(),
    staleTime: 5 * 60 * 1000,
  })
  const catalog = useMemo(() => catalogToKnown(catalogQuery.data ?? []), [catalogQuery.data])

  const [rawMode, setRawMode] = useState(false)
  const [rawDraft, setRawDraft] = useState('')

  const [enabled, setEnabled] = useState<Record<string, boolean>>({})
  const [paramValues, setParamValues] = useState<Record<string, Record<string, string>>>({})
  const [customs, setCustoms] = useState<CustomDraft[]>([])

  const [adding, setAdding] = useState(false)
  const [newDraft, setNewDraft] = useState<StructuredDraft>(emptyDraft())

  // OAuth discover state per origin: undefined = not checked, 'loading' = in progress,
  // 'error' = failed, null = no OAuth needed, object = OAuth status
  const [oauthStatus, setOauthStatus] = useState<Record<string, OAuthState>>({})

  // Auto-discover OAuth for all servers (built-in + custom) that have URLs
  useEffect(() => {
    const urls = new Map<string, string>() // origin → url
    for (const [key, def] of Object.entries(catalog.servers)) {
      if (enabled[key] && def.url) {
        try {
          urls.set(new URL(def.url).origin, def.url)
        } catch {}
      }
    }
    for (const c of customs) {
      if (c.mode === 'struct' && c.transport === 'http' && c.url) {
        try {
          urls.set(new URL(c.url).origin, c.url)
        } catch {}
      } else if (c.mode === 'raw') {
        try {
          const cfg = JSON.parse(c.json) as McpServerConfig
          if (cfg.url) urls.set(new URL(cfg.url).origin, cfg.url)
        } catch {}
      }
    }
    if (urls.size === 0) return

    const origins = [...urls.keys()]
    // Set loading state for all origins being discovered
    setOauthStatus((prev) => {
      const next = { ...prev }
      for (const o of origins) {
        if (next[o] === undefined) next[o] = 'loading'
      }
      return next
    })

    // Fetch token status in parallel
    const tokenStatusPromise = api
      .getMcpOAuthStatus(origins)
      .catch(() => ({}) as Record<string, { connected: boolean }>)

    // Discover each origin independently — update UI as each completes
    for (const origin of origins) {
      ;(async () => {
        const tokenStatus = await tokenStatusPromise
        try {
          const r = await api.discoverMcpOAuth(urls.get(origin)!)
          setOauthStatus((prev) => ({
            ...prev,
            [origin]: r.oauth_required ? (tokenStatus[origin] ?? { connected: false }) : null,
          }))
        } catch {
          setOauthStatus((prev) => ({ ...prev, [origin]: 'error' }))
        }
      })()
    }
  }, [enabled, customs])

  function renderOAuthBadge(
    origin: string | null,
    state: OAuthState | undefined,
    className?: string,
  ) {
    if (!origin || state === undefined || state === null) return null
    if (state === 'loading') {
      return (
        <span
          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-mini text-muted-foreground bg-muted/50 ${className ?? ''}`}
        >
          <Loader2 className="h-2.5 w-2.5 animate-spin" />
          {t('components.mcpConfigEditor.oauth.checking')}
        </span>
      )
    }
    if (state === 'error') {
      return (
        <span
          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-mini text-destructive bg-destructive/10 ${className ?? ''}`}
        >
          <AlertCircle className="h-2.5 w-2.5" />
          {t('components.mcpConfigEditor.oauth.unreachable')}
        </span>
      )
    }
    if (state.connected) {
      return (
        <button
          type="button"
          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-mini text-success bg-success/10 hover:bg-success/20 transition-colors ${className ?? ''}`}
          onClick={(e) => {
            e.preventDefault()
            handleDisconnect(origin)
          }}
        >
          <Link className="h-2.5 w-2.5" />
          {t('components.mcpConfigEditor.oauth.connected')}
        </button>
      )
    }
    return (
      <button
        type="button"
        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-mini text-warning bg-warning/10 hover:bg-warning/20 transition-colors ${className ?? ''}`}
        onClick={(e) => {
          e.preventDefault()
          handleConnect(origin)
        }}
        disabled={!workspaceId}
      >
        <Unlink className="h-2.5 w-2.5" />
        {t('components.mcpConfigEditor.oauth.connect')}
      </button>
    )
  }

  function handleConnect(serverOrigin: string) {
    if (!workspaceId) return
    // Open CP's authorize endpoint directly — CP proxies to MCP server and redirects to OAuth provider
    const params = new URLSearchParams({ server_origin: serverOrigin, workspace_id: workspaceId })
    window.open(`/api/mcp-oauth/authorize?${params}`, 'mcp-oauth', 'width=600,height=700,popup=yes')
  }

  function handleDisconnect(serverOrigin: string) {
    api.disconnectMcpOAuth(serverOrigin).then(() => {
      setOauthStatus((prev) => ({ ...prev, [serverOrigin]: { connected: false } }))
    })
  }

  // Listen for OAuth popup completion
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'mcp-oauth-complete' && e.data.server_origin) {
        const origin = e.data.server_origin as string
        api.getMcpOAuthStatus([origin]).then((status) => {
          setOauthStatus((prev) => ({ ...prev, [origin]: status[origin] ?? { connected: false } }))
        })
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>({})

  // Sync from value prop
  useEffect(() => {
    const state = parseStructuredState(value, catalog.servers, catalog.keys)
    setEnabled(state.enabled)
    setParamValues(state.paramValues)
    setCustoms(state.customs)
    // Auto-open groups that have enabled servers or required servers
    const openState: Record<string, boolean> = {}
    for (const { group, servers } of catalog.groups) {
      const hasRequired = servers.some(([, d]) => d.required)
      const hasEnabled = servers.some(([k]) => state.enabled[k])
      openState[group] = hasRequired || hasEnabled
    }
    setGroupOpen(openState)
  }, [value, catalog])

  function emitChange(
    en: Record<string, boolean>,
    pv: Record<string, Record<string, string>>,
    cu: CustomDraft[],
  ) {
    onChange(buildMcpJson(catalog.servers, en, pv, cu))
  }

  function toggleServer(key: string) {
    if (catalog.servers[key]?.required) return
    const next = { ...enabled, [key]: !enabled[key] }
    setEnabled(next)
    emitChange(next, paramValues, customs)
  }

  function updateParam(serverKey: string, header: string, val: string) {
    const next = { ...paramValues, [serverKey]: { ...paramValues[serverKey], [header]: val } }
    setParamValues(next)
    emitChange(enabled, next, customs)
  }

  function updateCustom(index: number, patch: Partial<StructuredDraft> | Partial<RawDraft>) {
    const next = customs.map((c, i) => (i === index ? ({ ...c, ...patch } as CustomDraft) : c))
    setCustoms(next)
    emitChange(enabled, paramValues, next)
  }

  function removeCustom(index: number) {
    const next = customs.filter((_, i) => i !== index)
    setCustoms(next)
    emitChange(enabled, paramValues, next)
  }

  function addCustom() {
    const name = newDraft.name.trim()
    if (!name) return
    const next = [...customs, { ...newDraft, name }]
    setCustoms(next)
    setAdding(false)
    setNewDraft(emptyDraft())
    emitChange(enabled, paramValues, next)
  }

  if (catalogQuery.isLoading) {
    return (
      <div className="flex items-center gap-1.5 py-4 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        {t('components.mcpConfigEditor.states.loadingCatalog')}
      </div>
    )
  }

  return (
    <div className="space-y-3 text-xs">
      {/* Mode toggle */}
      <div className="flex justify-end">
        <div className="inline-flex rounded-md border border-border text-mini">
          <button
            type="button"
            className={`px-2 py-0.5 rounded-l-md transition-colors ${!rawMode ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
            onClick={() => setRawMode(false)}
          >
            {t('components.mcpConfigEditor.modes.structured')}
          </button>
          <button
            type="button"
            className={`px-2 py-0.5 rounded-r-md transition-colors ${rawMode ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
            onClick={() => {
              setRawMode(true)
              setRawDraft(prettyJson(value))
            }}
          >
            {t('components.mcpConfigEditor.modes.raw')}
          </button>
        </div>
      </div>

      {rawMode ? (
        <Textarea
          className="min-h-[300px] font-mono text-tiny focus-visible:ring-inset"
          value={rawDraft}
          onChange={(e) => {
            setRawDraft(e.target.value)
            try {
              JSON.parse(e.target.value)
              onChange(e.target.value)
            } catch {
              // don't emit invalid JSON
            }
          }}
        />
      ) : (
        <>
          {/* Known servers — collapsible groups */}
          {catalog.groups.map(({ group, servers }) => {
            const enabledCount = servers.filter(([k]) => enabled[k]).length

            return (
              <Collapsible
                key={group}
                open={groupOpen[group] ?? false}
                onOpenChange={(open) => setGroupOpen((prev) => ({ ...prev, [group]: open }))}
              >
                <CollapsibleTrigger className="flex items-center gap-1.5 w-full py-0.5 group">
                  <ChevronRight className="h-3 w-3 text-muted-foreground/50 transition-transform group-data-[state=open]:rotate-90" />
                  <span className="text-tiny font-medium text-muted-foreground/70">{group}</span>
                  <span
                    className={cn(
                      'rounded-full px-1.5 text-micro leading-[16px]',
                      enabledCount > 0
                        ? 'bg-primary/15 text-primary'
                        : 'bg-muted-foreground/10 text-muted-foreground/50',
                    )}
                  >
                    {enabledCount}/{servers.length}
                  </span>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-1.5 mt-1.5">
                  {servers.map(([key, def]) => {
                    let knownOrigin: string | null = null
                    try {
                      knownOrigin = new URL(def.url).origin
                    } catch {}
                    const knownOauth = knownOrigin ? oauthStatus[knownOrigin] : undefined

                    return (
                      <div
                        key={key}
                        className={`rounded border p-2.5 transition-colors ${enabled[key] ? 'border-border bg-background/60' : 'border-border/50 bg-muted/30'}`}
                      >
                        <label
                          className={`flex items-center gap-2 ${def.required ? 'cursor-default' : 'cursor-pointer'}`}
                        >
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 rounded"
                            checked={!!enabled[key]}
                            disabled={def.required}
                            onChange={() => toggleServer(key)}
                          />
                          <span
                            className={`font-medium ${enabled[key] ? 'text-foreground' : 'text-muted-foreground'}`}
                          >
                            {def.label}
                          </span>
                          {def.required && (
                            <span className="rounded bg-primary/15 px-1.5 py-0.5 text-mini text-primary">
                              Required
                            </span>
                          )}
                          {enabled[key] && renderOAuthBadge(knownOrigin, knownOauth, 'ml-auto')}
                        </label>
                        {def.description && (
                          <div className="mt-1 ml-5 text-mini text-muted-foreground/70">
                            {def.description}
                          </div>
                        )}

                        {enabled[key] && def.params.length > 0 && (
                          <div className="mt-2 ml-5 space-y-1.5">
                            {def.params.map((p) => {
                              const current = paramValues[key]?.[p.header] ?? p.default
                              return (
                                <div key={p.header} className="flex items-center gap-2">
                                  <span className="text-tiny text-muted-foreground w-24">
                                    {p.label}
                                  </span>
                                  <Input
                                    className="h-6 w-20 font-mono text-tiny text-center"
                                    type={p.type}
                                    min={p.type === 'number' ? 0 : undefined}
                                    value={current}
                                    onChange={(e) => updateParam(key, p.header, e.target.value)}
                                  />
                                </div>
                              )
                            })}
                          </div>
                        )}
                        {enabled[key] && key === 'tos-platform' && (
                          <div className="mt-2 ml-5">
                            <BuilderCapsEditor
                              value={paramValues[key]?.['X-Builder'] ?? ''}
                              onChange={(v) => updateParam(key, 'X-Builder', v)}
                            />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </CollapsibleContent>
              </Collapsible>
            )
          })}

          {/* Custom servers */}
          {customs.map((draft, i) => {
            let serverOrigin: string | null = null
            if (draft.mode === 'struct' && draft.transport === 'http' && draft.url) {
              try {
                serverOrigin = new URL(draft.url).origin
              } catch {}
            }
            const oauth = serverOrigin ? oauthStatus[serverOrigin] : null
            const typeLabel =
              draft.mode === 'raw'
                ? t('components.mcpConfigEditor.labels.json')
                : t(`components.mcpConfigEditor.transport.${draft.transport}`)

            return (
              <div
                key={draft.name}
                className="rounded border border-border bg-background/60 p-3 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{draft.name}</span>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-mini text-muted-foreground">
                      {typeLabel}
                    </span>
                    {renderOAuthBadge(serverOrigin, oauth)}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-destructive hover:text-destructive"
                    onClick={() => removeCustom(i)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                {draft.mode === 'raw' ? (
                  <Textarea
                    className="min-h-[80px] font-mono text-tiny focus-visible:ring-inset"
                    value={draft.json}
                    onChange={(e) => updateCustom(i, { json: e.target.value })}
                  />
                ) : (
                  <ServerFields
                    draft={draft}
                    onChange={(patch) => updateCustom(i, patch)}
                    showName={false}
                  />
                )}
              </div>
            )
          })}

          {/* Add custom */}
          {adding ? (
            <div className="space-y-2 rounded border border-dashed border-border p-3">
              <ServerFields
                draft={newDraft}
                onChange={(patch) => setNewDraft((d) => ({ ...d, ...patch }))}
                showName
              />
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setAdding(false)
                    setNewDraft(emptyDraft())
                  }}
                >
                  {t('common.cancel')}
                </Button>
                <Button size="sm" onClick={addCustom} disabled={!newDraft.name.trim()}>
                  {t('components.mcpConfigEditor.actions.add')}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full gap-1.5 text-xs"
              onClick={() => setAdding(true)}
            >
              <Plus className="h-3 w-3" />
              {t('components.mcpConfigEditor.actions.addServer')}
            </Button>
          )}
        </>
      )}
    </div>
  )
}
