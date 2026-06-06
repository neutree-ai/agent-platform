import { Spinner } from '@/components/ui/spinner'
import { api } from '@/lib/api/client'
import type {
  AdminAgentType,
  AdminMcpUsage,
  AdminPowerAgent,
  AdminPowerUser,
  AdminSessionSource,
  AdminSkillUsage,
  AdminTokenUsage,
  AdminTotals,
  AdminTrend,
} from '@/lib/api/types'
import { formatTokenCount } from '@/lib/format-tokens'
import i18n from '@/lib/i18n'
import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import { Card, DonutChart, LineChart } from '@tremor/react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

// ── Shared helpers ──

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 pt-4 first:pt-0">
      <h2 className="shrink-0 text-sm font-medium text-foreground">{children}</h2>
      <div className="h-px flex-1 bg-border" />
    </div>
  )
}

function PanelLoading() {
  return (
    <div className="flex items-center justify-center py-8">
      <Spinner />
    </div>
  )
}

function PanelError() {
  return (
    <p className="py-8 text-center text-xs text-muted-foreground">
      {i18n.t('components.admin.dashboardSection.errors.loadFailed')}
    </p>
  )
}

function withQuery<T>(query: UseQueryResult<T>, render: (data: T) => React.ReactNode) {
  if (query.isLoading) return <PanelLoading />
  if (query.error || !query.data) return <PanelError />
  return render(query.data)
}

function RankBar({
  items,
  colorClass,
  format = String,
}: {
  items: { label: string; value: number; sub?: string }[]
  colorClass: string
  /** Render the trailing value (e.g. compact token counts). Defaults to String. */
  format?: (v: number) => string
}) {
  const max = items[0]?.value || 1
  return (
    <div className="space-y-1.5">
      {items.map((item, i) => {
        const pct = (item.value / max) * 100
        return (
          <div
            key={i}
            className="relative flex items-center justify-between rounded px-1.5 py-0.5 text-xs"
          >
            <div
              className={`absolute inset-0 rounded ${colorClass}`}
              style={{ width: `${pct}%` }}
            />
            <span className="relative truncate text-muted-foreground">
              {item.label}
              {item.sub && <span className="ml-1 text-muted-foreground/60">{item.sub}</span>}
            </span>
            <span className="relative shrink-0 font-medium text-foreground">
              {format(item.value)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function MiniDonut<T>({
  query,
  category,
  index,
  colors,
  dotColors,
}: {
  query: UseQueryResult<T[]>
  category: string
  index: string
  colors: string[]
  dotColors: string[]
}) {
  if (query.isLoading) return <Spinner />
  if (query.error || !query.data) return null
  const items = query.data
  return (
    <div className="flex items-center gap-3">
      <DonutChart
        data={items}
        category={category}
        index={index}
        colors={colors}
        className="h-12 w-12"
        showLabel={false}
        showTooltip
      />
      <div className="space-y-0.5">
        {items.map((item: any, i: number) => (
          <div key={item[index]} className="flex items-center gap-1.5 text-xs">
            <span className={`h-1.5 w-1.5 rounded-full ${dotColors[i % dotColors.length]}`} />
            <span className="text-muted-foreground">{item[index]}</span>
            <span className="font-medium text-foreground">{item[category]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Shared donut palette: 8 distinct, dark-mode-legible hues, NO red (tremor's
// `red` renders too dark on the dark donut track, and a red wedge reads as an
// alert). The tremor names drive the ring; each chart-token dot tracks the ring
// colour at the same index so a legend dot matches its slice. chart-4 (red) is
// deliberately skipped; chart-7/8/9 (fuchsia/lime/teal) added in @neutree-ai/theme.
const DONUT_COLORS = ['blue', 'amber', 'emerald', 'violet', 'cyan', 'fuchsia', 'lime', 'teal']
const DONUT_DOTS = [
  'bg-chart-1',
  'bg-chart-2',
  'bg-chart-3',
  'bg-chart-5',
  'bg-chart-6',
  'bg-chart-7',
  'bg-chart-8',
  'bg-chart-9',
]

// ── Overview ──

function UsersCard() {
  const q = useQuery<AdminTotals>({
    queryKey: ['admin', 'totals'],
    queryFn: () => api.getAdminTotals(),
  })
  return (
    <Card className="!bg-card !ring-border !p-4">
      <p className="text-xs text-muted-foreground">
        {i18n.t('components.admin.dashboardSection.overview.users.title')}
      </p>
      {withQuery(q, (t) => (
        <>
          <p className="mt-1 text-2xl font-semibold text-foreground">
            {t.total_users.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-success">
            {i18n.t('components.admin.dashboardSection.overview.users.activeThisWeek', {
              count: t.weekly_active_users,
            })}
          </p>
        </>
      ))}
    </Card>
  )
}

function AgentsCard() {
  const totalsQ = useQuery<AdminTotals>({
    queryKey: ['admin', 'totals'],
    queryFn: () => api.getAdminTotals(),
  })
  const typesQ = useQuery<AdminAgentType[]>({
    queryKey: ['admin', 'agent-types'],
    queryFn: () => api.getAdminAgentTypes(),
  })
  return (
    <Card className="!bg-card !ring-border !p-4">
      <p className="text-xs text-muted-foreground">
        {i18n.t('components.admin.dashboardSection.overview.agents.title')}
      </p>
      {withQuery(totalsQ, (t) => (
        <>
          <p className="mt-1 text-2xl font-semibold text-foreground">
            {t.total_agents.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-success">
            {i18n.t('components.admin.dashboardSection.overview.agents.activeThisWeek', {
              count: t.weekly_active_agents,
            })}
          </p>
        </>
      ))}
      <div className="mt-3 border-t border-border pt-3">
        <MiniDonut
          query={typesQ}
          category="count"
          index="agent_type"
          colors={DONUT_COLORS}
          dotColors={DONUT_DOTS}
        />
      </div>
    </Card>
  )
}

function SessionsCard() {
  const totalsQ = useQuery<AdminTotals>({
    queryKey: ['admin', 'totals'],
    queryFn: () => api.getAdminTotals(),
  })
  const sourcesQ = useQuery<AdminSessionSource[]>({
    queryKey: ['admin', 'session-sources'],
    queryFn: () => api.getAdminSessionSources(),
  })
  return (
    <Card className="!bg-card !ring-border !p-4">
      <p className="text-xs text-muted-foreground">
        {i18n.t('components.admin.dashboardSection.overview.sessions.title')}
      </p>
      {withQuery(totalsQ, (t) => (
        <>
          <p className="mt-1 text-2xl font-semibold text-foreground">
            {t.total_sessions.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-success">
            {i18n.t('components.admin.dashboardSection.overview.sessions.today', {
              count: t.sessions_today,
            })}
          </p>
        </>
      ))}
      <div className="mt-3 border-t border-border pt-3">
        <MiniDonut
          query={sourcesQ}
          category="count"
          index="source"
          colors={DONUT_COLORS}
          dotColors={DONUT_DOTS}
        />
      </div>
    </Card>
  )
}

function InteractionsCard() {
  const q = useQuery<AdminTotals>({
    queryKey: ['admin', 'totals'],
    queryFn: () => api.getAdminTotals(),
  })
  return (
    <Card className="!bg-card !ring-border !p-4">
      <p className="text-xs text-muted-foreground">
        {i18n.t('components.admin.dashboardSection.overview.interactions.title')}
      </p>
      {withQuery(q, (t) => (
        <>
          <p className="mt-1 text-2xl font-semibold text-foreground">
            {t.total_interactions.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-success">
            {i18n.t('components.admin.dashboardSection.overview.interactions.today', {
              count: t.interactions_today,
            })}
          </p>
        </>
      ))}
    </Card>
  )
}

// ── Growth ──

function GrowthPanel() {
  const q = useQuery<AdminTrend[]>({
    queryKey: ['admin', 'trends'],
    queryFn: () => api.getAdminTrends(),
  })
  return (
    <Card className="!bg-card !ring-border !p-4">
      <h3 className="text-xs font-medium text-foreground">
        {i18n.t('components.admin.dashboardSection.panels.growth.title')}
      </h3>
      {withQuery(q, (trends) => (
        <LineChart
          data={trends}
          index="date"
          categories={['agents', 'sessions']}
          colors={['blue', 'cyan']}
          yAxisWidth={48}
          showLegend
          className="mt-4 h-48"
        />
      ))}
    </Card>
  )
}

function WeeklyActivePanel() {
  const q = useQuery<AdminTrend[]>({
    queryKey: ['admin', 'trends'],
    queryFn: () => api.getAdminTrends(),
  })
  return (
    <Card className="!bg-card !ring-border !p-4">
      <h3 className="text-xs font-medium text-foreground">
        {i18n.t('components.admin.dashboardSection.panels.weeklyActive.title')}
      </h3>
      {withQuery(q, (trends) => (
        <LineChart
          data={trends}
          index="date"
          categories={['active_agents']}
          colors={['emerald']}
          yAxisWidth={40}
          showLegend={false}
          className="mt-4 h-48"
        />
      ))}
    </Card>
  )
}

function InteractionVolumePanel() {
  const q = useQuery<AdminTrend[]>({
    queryKey: ['admin', 'trends'],
    queryFn: () => api.getAdminTrends(),
  })
  return (
    <Card className="!bg-card !ring-border !p-4">
      <h3 className="text-xs font-medium text-foreground">
        {i18n.t('components.admin.dashboardSection.panels.interactionVolume.title')}
      </h3>
      {withQuery(q, (trends) => (
        <ResponsiveContainer width="100%" height={192} className="mt-4">
          <ComposedChart data={trends}>
            <CartesianGrid strokeDasharray="3 3" stroke="oklch(var(--border))" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'oklch(var(--muted-foreground))' }} />
            <YAxis
              yAxisId="daily"
              tick={{ fontSize: 11, fill: 'oklch(var(--muted-foreground))' }}
              width={40}
            />
            <YAxis
              yAxisId="cumulative"
              orientation="right"
              tick={{ fontSize: 11, fill: 'oklch(var(--muted-foreground))' }}
              width={48}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'oklch(var(--popover))',
                border: '1px solid oklch(var(--border))',
                borderRadius: 6,
                fontSize: 12,
              }}
              labelStyle={{ color: 'oklch(var(--foreground))' }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar
              yAxisId="daily"
              dataKey="daily_interactions"
              name={i18n.t('components.admin.dashboardSection.chartLabels.daily')}
              fill="oklch(var(--chart-1))"
              radius={[2, 2, 0, 0]}
            />
            <Line
              yAxisId="cumulative"
              dataKey="interactions"
              name={i18n.t('components.admin.dashboardSection.chartLabels.cumulative')}
              stroke="oklch(var(--chart-2))"
              strokeWidth={2}
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      ))}
    </Card>
  )
}

// ── Power Users & Agents ──

function PowerUsersPanel() {
  const q = useQuery<AdminPowerUser[]>({
    queryKey: ['admin', 'power-users'],
    queryFn: () => api.getAdminPowerUsers(),
  })
  return (
    <Card className="!bg-card !ring-border !p-4">
      <h3 className="text-xs font-medium text-foreground">
        {i18n.t('components.admin.dashboardSection.panels.powerUsers.title')}
      </h3>
      {withQuery(q, (users) =>
        users.length === 0 ? (
          <p className="mt-4 text-xs text-muted-foreground">
            {i18n.t('components.admin.dashboardSection.empty.noData')}
          </p>
        ) : (
          <div className="mt-3">
            <RankBar
              colorClass="bg-chart-5/15"
              items={users.map((u) => ({
                label: u.name,
                value: u.interactions,
                sub: i18n.t('components.admin.dashboardSection.labels.agents', {
                  count: u.agent_count,
                }),
              }))}
            />
          </div>
        ),
      )}
    </Card>
  )
}

function PowerAgentsPanel() {
  const q = useQuery<AdminPowerAgent[]>({
    queryKey: ['admin', 'power-agents'],
    queryFn: () => api.getAdminPowerAgents(),
  })
  return (
    <Card className="!bg-card !ring-border !p-4">
      <h3 className="text-xs font-medium text-foreground">
        {i18n.t('components.admin.dashboardSection.panels.powerAgents.title')}
      </h3>
      {withQuery(q, (agents) =>
        agents.length === 0 ? (
          <p className="mt-4 text-xs text-muted-foreground">
            {i18n.t('components.admin.dashboardSection.empty.noData')}
          </p>
        ) : (
          <div className="mt-3">
            <RankBar
              colorClass="bg-chart-1/15"
              items={agents.map((a) => ({
                label: a.name,
                value: a.interactions,
                sub: i18n.t('components.admin.dashboardSection.labels.sessionsByOwner', {
                  count: a.session_count,
                  owner: a.owner,
                }),
              }))}
            />
          </div>
        ),
      )}
    </Card>
  )
}

// ── Skills & MCP ──

function SkillUsagePanel() {
  const q = useQuery<AdminSkillUsage[]>({
    queryKey: ['admin', 'skill-usage'],
    queryFn: () => api.getAdminSkillUsage(),
  })
  return (
    <Card className="!bg-card !ring-border !p-4">
      <h3 className="text-xs font-medium text-foreground">
        {i18n.t('components.admin.dashboardSection.panels.skillUsage.title')}
      </h3>
      <p className="mt-0.5 text-tiny text-muted-foreground">
        {i18n.t('components.admin.dashboardSection.panels.skillUsage.description')}
      </p>
      {withQuery(q, (skill_usage) =>
        skill_usage.length === 0 ? (
          <p className="mt-4 text-xs text-muted-foreground">
            {i18n.t('components.admin.dashboardSection.empty.noSkills')}
          </p>
        ) : (
          <div className="mt-3">
            <RankBar
              colorClass="bg-chart-6/15"
              items={skill_usage.map((s) => ({
                label: s.skill_name,
                value: s.workspace_count,
              }))}
            />
          </div>
        ),
      )}
    </Card>
  )
}

/** Pretty-print MCP server IDs: strip common prefixes and title-case. */
function mcpLabel(id: string): string {
  const stripped = id.replace(/^tos-/, '')
  return stripped
    .split('-')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
}

function McpUsagePanel() {
  const q = useQuery<AdminMcpUsage[]>({
    queryKey: ['admin', 'mcp-usage'],
    queryFn: () => api.getAdminMcpUsage(),
  })
  return (
    <Card className="!bg-card !ring-border !p-4">
      <h3 className="text-xs font-medium text-foreground">
        {i18n.t('components.admin.dashboardSection.panels.mcpUsage.title')}
      </h3>
      <p className="mt-0.5 text-tiny text-muted-foreground">
        {i18n.t('components.admin.dashboardSection.panels.mcpUsage.description')}
      </p>
      {withQuery(q, (mcp_usage) =>
        mcp_usage.length === 0 ? (
          <p className="mt-4 text-xs text-muted-foreground">
            {i18n.t('components.admin.dashboardSection.empty.noMcp')}
          </p>
        ) : (
          <div className="mt-3">
            <RankBar
              colorClass="bg-chart-3/15"
              items={mcp_usage.map((m) => ({
                label: mcpLabel(m.server_id),
                value: m.workspace_count,
              }))}
            />
          </div>
        ),
      )}
    </Card>
  )
}

// ── Token usage (fleet-wide, last 30 days) ──

function useTokenUsage() {
  return useQuery<AdminTokenUsage>({
    queryKey: ['admin', 'token-usage'],
    queryFn: () => api.getAdminTokenUsage(),
  })
}

function TokenOverviewCard() {
  const q = useTokenUsage()
  return (
    <Card className="!bg-card !ring-border !p-4">
      <p className="text-xs text-muted-foreground">
        {i18n.t('components.admin.dashboardSection.overview.tokens.title')}
      </p>
      {withQuery(q, (d) => (
        <>
          <p className="mt-1 text-2xl font-semibold text-foreground">{formatTokenCount(d.total)}</p>
          <p className="mt-1 text-xs text-success">
            {i18n.t('components.admin.dashboardSection.overview.tokens.today', {
              value: formatTokenCount(d.today),
            })}
          </p>
        </>
      ))}
    </Card>
  )
}

function TokenVolumePanel() {
  const q = useTokenUsage()
  return (
    <Card className="!bg-card !ring-border !p-4">
      <h3 className="text-xs font-medium text-foreground">
        {i18n.t('components.admin.dashboardSection.panels.tokenVolume.title')}
      </h3>
      {withQuery(q, (d) => (
        <ResponsiveContainer width="100%" height={192} className="mt-4">
          <BarChart data={d.daily.map((r) => ({ ...r, cache: r.cache_write + r.cache_read }))}>
            {/* Three segments — input / cache / output — in two clearly distinct
             * hues: the input family (primary, cool) and output (warning, warm).
             * Cache (read + write) is input-side, drawn as a dense primary
             * diagonal hatch rather than its own hue. Mirrors the Stats app
             * composition bar. No red anywhere. */}
            <defs>
              <pattern
                id="tok-cache"
                patternUnits="userSpaceOnUse"
                width={4}
                height={4}
                patternTransform="rotate(45)"
              >
                <rect width={4} height={4} fill="oklch(var(--primary) / 0.22)" />
                <line
                  x1={0}
                  y1={0}
                  x2={0}
                  y2={4}
                  stroke="oklch(var(--primary))"
                  strokeWidth={2.5}
                />
              </pattern>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="oklch(var(--border))" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'oklch(var(--muted-foreground))' }} />
            <YAxis
              tick={{ fontSize: 11, fill: 'oklch(var(--muted-foreground))' }}
              width={48}
              tickFormatter={(v: number) => formatTokenCount(Number(v))}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'oklch(var(--popover))',
                border: '1px solid oklch(var(--border))',
                borderRadius: 6,
                fontSize: 12,
              }}
              labelStyle={{ color: 'oklch(var(--foreground))' }}
              formatter={(v) => formatTokenCount(Number(v))}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar
              stackId="t"
              dataKey="cache"
              name={i18n.t('components.admin.dashboardSection.token.cache')}
              fill="url(#tok-cache)"
            />
            <Bar
              stackId="t"
              dataKey="input"
              name={i18n.t('components.admin.dashboardSection.token.input')}
              fill="oklch(var(--primary))"
            />
            <Bar
              stackId="t"
              dataKey="output"
              name={i18n.t('components.admin.dashboardSection.token.output')}
              fill="oklch(var(--warning))"
              radius={[2, 2, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      ))}
    </Card>
  )
}

function TokenTopUsersPanel() {
  const q = useTokenUsage()
  return (
    <Card className="!bg-card !ring-border !p-4">
      <h3 className="text-xs font-medium text-foreground">
        {i18n.t('components.admin.dashboardSection.panels.tokenTopUsers.title')}
      </h3>
      {withQuery(q, (d) =>
        d.topUsers.length === 0 ? (
          <p className="mt-4 text-xs text-muted-foreground">
            {i18n.t('components.admin.dashboardSection.empty.noData')}
          </p>
        ) : (
          <div className="mt-3">
            <RankBar
              colorClass="bg-chart-1/15"
              format={formatTokenCount}
              items={d.topUsers.map((u) => ({ label: u.name, value: u.tokens }))}
            />
          </div>
        ),
      )}
    </Card>
  )
}

function TokenTopAgentsPanel() {
  const q = useTokenUsage()
  return (
    <Card className="!bg-card !ring-border !p-4">
      <h3 className="text-xs font-medium text-foreground">
        {i18n.t('components.admin.dashboardSection.panels.tokenTopAgents.title')}
      </h3>
      {withQuery(q, (d) =>
        d.topWorkspaces.length === 0 ? (
          <p className="mt-4 text-xs text-muted-foreground">
            {i18n.t('components.admin.dashboardSection.empty.noData')}
          </p>
        ) : (
          <div className="mt-3">
            <RankBar
              colorClass="bg-chart-3/15"
              format={formatTokenCount}
              items={d.topWorkspaces.map((w) => ({ label: w.name, value: w.tokens, sub: w.owner }))}
            />
          </div>
        ),
      )}
    </Card>
  )
}

// ── Main Dashboard ──

// instanceId reserved for future per-instance UI state — currently unused.
export function DashboardSection(_: { instanceId: string }) {
  return (
    <div className="@container space-y-3 p-1">
      <SectionTitle>{i18n.t('components.admin.dashboardSection.sections.overview')}</SectionTitle>
      <div className="grid grid-cols-1 gap-3 @md:grid-cols-2 @4xl:grid-cols-3 @6xl:grid-cols-5">
        <UsersCard />
        <AgentsCard />
        <SessionsCard />
        <InteractionsCard />
        <TokenOverviewCard />
      </div>

      <SectionTitle>{i18n.t('components.admin.dashboardSection.sections.growth')}</SectionTitle>
      <div className="grid grid-cols-1 gap-3 @4xl:grid-cols-3">
        <GrowthPanel />
        <WeeklyActivePanel />
        <InteractionVolumePanel />
      </div>

      <SectionTitle>{i18n.t('components.admin.dashboardSection.sections.tokens')}</SectionTitle>
      <div className="grid grid-cols-1 gap-3">
        <TokenVolumePanel />
      </div>
      <div className="grid grid-cols-1 gap-3 @3xl:grid-cols-2">
        <TokenTopUsersPanel />
        <TokenTopAgentsPanel />
      </div>

      <SectionTitle>
        {i18n.t('components.admin.dashboardSection.sections.powerUsersAndAgents')}
      </SectionTitle>
      <div className="grid grid-cols-1 gap-3 @3xl:grid-cols-2">
        <PowerUsersPanel />
        <PowerAgentsPanel />
      </div>

      <SectionTitle>
        {i18n.t('components.admin.dashboardSection.sections.skillsAndMcp')}
      </SectionTitle>
      <div className="grid grid-cols-1 gap-3 @3xl:grid-cols-2">
        <SkillUsagePanel />
        <McpUsagePanel />
      </div>
    </div>
  )
}
