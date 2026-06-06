import { Spinner } from '@/components/ui/spinner'
import { api } from '@/lib/api/client'
import type { AdminCluster, AdminClusterNodeGroup } from '@/lib/api/types'
import i18n from '@/lib/i18n'
import { useQuery } from '@tanstack/react-query'
import { Card } from '@tremor/react'

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 pt-4 first:pt-0">
      <h2 className="shrink-0 text-sm font-medium text-foreground">{children}</h2>
      <div className="h-px flex-1 bg-border" />
    </div>
  )
}

function formatCpu(millis: number): string {
  if (millis >= 1000) return `${(millis / 1000).toFixed(1)} cores`
  return `${millis}m`
}

function formatMem(mi: number): string {
  if (mi >= 1024) return `${(mi / 1024).toFixed(1)} GiB`
  return `${Math.round(mi)} MiB`
}

function pct(used: number, total: number): number {
  return total > 0 ? Math.round((used / total) * 100) : 0
}

function UsageBar({ used, total, label }: { used: number; total: number; label: string }) {
  const p = pct(used, total)
  const color = p >= 85 ? 'bg-destructive' : p >= 70 ? 'bg-warning' : 'bg-success'
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium text-foreground">{p}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${p}%` }} />
      </div>
    </div>
  )
}

function OverviewCards({ data }: { data: AdminCluster }) {
  const workerGroups = data.node_groups.filter((g) => g.group !== 'controlplane')
  const totalCpu = workerGroups.reduce((s, g) => s + g.totals.cpu_capacity, 0)
  const totalMem = workerGroups.reduce((s, g) => s + g.totals.mem_capacity_mi, 0)
  const usedCpu = workerGroups.reduce((s, g) => s + g.totals.cpu_requested, 0)
  const usedMem = workerGroups.reduce((s, g) => s + g.totals.mem_requested_mi, 0)
  const totalNodes = workerGroups.reduce((s, g) => s + g.totals.node_count, 0)
  const totalPods = workerGroups.reduce((s, g) => s + g.totals.pod_count, 0)

  return (
    <div className="grid grid-cols-1 gap-3 @md:grid-cols-2 @5xl:grid-cols-5">
      <Card className="!bg-card !ring-border !p-4">
        <p className="text-xs text-muted-foreground">
          {i18n.t('components.admin.infraSection.overview.workerNodes.title')}
        </p>
        <p className="mt-1 text-2xl font-semibold text-foreground">{totalNodes}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {i18n.t('components.admin.infraSection.overview.workerNodes.runningPods', {
            count: totalPods,
          })}
        </p>
      </Card>
      <Card className="!bg-card !ring-border !p-4">
        <p className="text-xs text-muted-foreground">
          {i18n.t('components.admin.infraSection.overview.workspaces.title')}
        </p>
        <p className="mt-1 text-2xl font-semibold text-foreground">{data.total_workspaces}</p>
        <div className="mt-2 flex gap-2 text-xs text-muted-foreground">
          <span className="rounded bg-muted px-1.5 py-0.5">S: {data.workspace_tiers.small}</span>
          <span className="rounded bg-muted px-1.5 py-0.5">M: {data.workspace_tiers.medium}</span>
          <span className="rounded bg-muted px-1.5 py-0.5">L: {data.workspace_tiers.large}</span>
        </div>
      </Card>
      <Card className="!bg-card !ring-border !p-4">
        <p className="text-xs text-muted-foreground">
          {i18n.t('components.admin.infraSection.overview.sandboxes.title')}
        </p>
        <p className="mt-1 text-2xl font-semibold text-foreground">{data.total_sandboxes}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {i18n.t('components.admin.infraSection.labels.nodes', {
            count: data.node_groups.find((g) => g.group === 'sandbox')?.totals.node_count ?? 0,
          })}
        </p>
      </Card>
      <Card className="!bg-card !ring-border !p-4">
        <p className="text-xs text-muted-foreground">
          {i18n.t('components.admin.infraSection.overview.cpuWorkers.title')}
        </p>
        <p className="mt-1 text-2xl font-semibold text-foreground">{formatCpu(usedCpu)}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {i18n.t('components.admin.infraSection.labels.ofValue', { value: formatCpu(totalCpu) })}
        </p>
        <div className="mt-2">
          <UsageBar
            used={usedCpu}
            total={totalCpu}
            label={i18n.t('components.admin.infraSection.labels.requested')}
          />
        </div>
      </Card>
      <Card className="!bg-card !ring-border !p-4">
        <p className="text-xs text-muted-foreground">
          {i18n.t('components.admin.infraSection.overview.memoryWorkers.title')}
        </p>
        <p className="mt-1 text-2xl font-semibold text-foreground">{formatMem(usedMem)}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {i18n.t('components.admin.infraSection.labels.ofValue', { value: formatMem(totalMem) })}
        </p>
        <div className="mt-2">
          <UsageBar
            used={usedMem}
            total={totalMem}
            label={i18n.t('components.admin.infraSection.labels.requested')}
          />
        </div>
      </Card>
    </div>
  )
}

function NodeGroupTable({ group }: { group: AdminClusterNodeGroup }) {
  const shortName = (name: string) => {
    const parts = name.split('-')
    return parts.slice(-1)[0] || name
  }

  return (
    <Card className="!bg-card !ring-border !p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-foreground">
          {group.group}
          <span className="ml-2 text-muted-foreground">
            {i18n.t('components.admin.infraSection.labels.nodes', {
              count: group.totals.node_count,
            })}
          </span>
        </h3>
        <span className="text-xs text-muted-foreground">
          {group.group === 'sandbox'
            ? i18n.t('components.admin.infraSection.labels.sandboxesAndPods', {
                sandboxes: group.totals.sbx_pod_count,
                pods: group.totals.pod_count,
              })
            : i18n.t('components.admin.infraSection.labels.workspacesAndPods', {
                workspaces: group.totals.tos_pod_count,
                pods: group.totals.pod_count,
              })}
        </span>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="pb-2 pr-4 font-medium">
                {i18n.t('components.admin.infraSection.table.node')}
              </th>
              <th className="pb-2 pr-4 font-medium">
                {i18n.t('components.admin.infraSection.table.cpu')}
              </th>
              <th className="pb-2 pr-4 font-medium">
                {i18n.t('components.admin.infraSection.table.memory')}
              </th>
              <th className="pb-2 pr-4 font-medium">
                {i18n.t('components.admin.infraSection.table.pods')}
              </th>
              <th className="pb-2 font-medium">{group.group === 'sandbox' ? 'SBX' : 'NAP'}</th>
            </tr>
          </thead>
          <tbody>
            {group.nodes.map((node) => {
              const cpuPct = pct(node.cpu_requested, node.cpu_capacity)
              const memPct = pct(node.mem_requested_mi, node.mem_capacity_mi)
              const cpuColor =
                cpuPct >= 85 ? 'text-destructive' : cpuPct >= 70 ? 'text-warning' : 'text-success'
              const memColor =
                memPct >= 85 ? 'text-destructive' : memPct >= 70 ? 'text-warning' : 'text-success'
              return (
                <tr key={node.name} className="border-b border-border/50">
                  <td className="py-2 pr-4 font-mono text-foreground">{shortName(node.name)}</td>
                  <td className="py-2 pr-4">
                    <span className={cpuColor}>{formatCpu(node.cpu_requested)}</span>
                    <span className="text-muted-foreground"> / {formatCpu(node.cpu_capacity)}</span>
                    <span className="ml-1 text-muted-foreground/60">({cpuPct}%)</span>
                  </td>
                  <td className="py-2 pr-4">
                    <span className={memColor}>{formatMem(node.mem_requested_mi)}</span>
                    <span className="text-muted-foreground">
                      {' '}
                      / {formatMem(node.mem_capacity_mi)}
                    </span>
                    <span className="ml-1 text-muted-foreground/60">({memPct}%)</span>
                  </td>
                  <td className="py-2 pr-4 text-foreground">{node.pod_count}</td>
                  <td className="py-2 text-foreground">
                    {group.group === 'sandbox' ? node.sbx_pod_count : node.tos_pod_count}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="text-muted-foreground font-medium">
              <td className="pt-2 pr-4">{i18n.t('components.admin.infraSection.table.total')}</td>
              <td className="pt-2 pr-4">
                {formatCpu(group.totals.cpu_requested)} / {formatCpu(group.totals.cpu_capacity)}
                <span className="ml-1 text-muted-foreground/60">
                  ({pct(group.totals.cpu_requested, group.totals.cpu_capacity)}%)
                </span>
              </td>
              <td className="pt-2 pr-4">
                {formatMem(group.totals.mem_requested_mi)} /{' '}
                {formatMem(group.totals.mem_capacity_mi)}
                <span className="ml-1 text-muted-foreground/60">
                  ({pct(group.totals.mem_requested_mi, group.totals.mem_capacity_mi)}%)
                </span>
              </td>
              <td className="pt-2 pr-4">{group.totals.pod_count}</td>
              <td className="pt-2">
                {group.group === 'sandbox'
                  ? group.totals.sbx_pod_count
                  : group.totals.tos_pod_count}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  )
}

function PoolCapacityCard({
  title,
  group,
  tiers,
}: {
  title: string
  group: AdminClusterNodeGroup
  tiers: { name: string; cpu: number; mem: number; desc: string }[]
}) {
  const freeCpu = group.totals.cpu_capacity - group.totals.cpu_requested
  const freeMem = group.totals.mem_capacity_mi - group.totals.mem_requested_mi

  return (
    <Card className="!bg-card !ring-border !p-4">
      <h3 className="text-xs font-medium text-foreground">{title}</h3>
      <p className="mt-0.5 text-tiny text-muted-foreground">
        {i18n.t('components.admin.infraSection.capacity.additionalHeadroom')}
      </p>
      <div className="mt-3 grid grid-cols-3 gap-3">
        {tiers.map((tier) => {
          const byCpu = Math.floor(freeCpu / tier.cpu)
          const byMem = Math.floor(freeMem / tier.mem)
          const estimate = Math.min(byCpu, byMem)
          return (
            <div key={tier.name} className="rounded-lg border border-border p-3 text-center">
              <p className="text-lg font-semibold text-foreground">~{estimate}</p>
              <p className="text-xs font-medium text-foreground">{tier.name}</p>
              <p className="text-tiny text-muted-foreground">{tier.desc}</p>
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-tiny text-muted-foreground">
        {i18n.t('components.admin.infraSection.capacity.bottleneck', {
          resource:
            freeMem / tiers[0].mem < freeCpu / tiers[0].cpu
              ? i18n.t('components.admin.infraSection.table.memory')
              : i18n.t('components.admin.infraSection.table.cpu'),
          cpu: formatCpu(freeCpu),
          memory: formatMem(freeMem),
        })}
      </p>
    </Card>
  )
}

function CapacityEstimate({ data }: { data: AdminCluster }) {
  const agentGroup = data.node_groups.find((g) => g.group === 'agent')
  const sandboxGroup = data.node_groups.find((g) => g.group === 'sandbox')

  if (!agentGroup && !sandboxGroup) return null

  const workspaceTiers = [
    { name: 'Small', cpu: 100, mem: 256, desc: '100m / 256Mi' },
    { name: 'Medium', cpu: 250, mem: 512, desc: '250m / 512Mi' },
    { name: 'Large', cpu: 1000, mem: 2048, desc: '1 core / 2Gi' },
  ]

  const sandboxTiers = [
    { name: 'Default', cpu: 500, mem: 512, desc: '500m / 512Mi' },
    { name: 'Large', cpu: 1000, mem: 1024, desc: '1 core / 1Gi' },
    { name: 'XL', cpu: 2000, mem: 2048, desc: '2 cores / 2Gi' },
  ]

  return (
    <div className="grid gap-3 @3xl:grid-cols-2">
      {agentGroup && (
        <PoolCapacityCard
          title="Agent Pool — Workspaces"
          group={agentGroup}
          tiers={workspaceTiers}
        />
      )}
      {sandboxGroup && (
        <PoolCapacityCard
          title="Sandbox Pool — Sandboxes"
          group={sandboxGroup}
          tiers={sandboxTiers}
        />
      )}
    </div>
  )
}

// instanceId reserved for future per-instance UI state — currently unused.
export function InfraSection(_: { instanceId: string }) {
  const q = useQuery<AdminCluster>({
    queryKey: ['admin', 'cluster'],
    queryFn: () => api.getAdminCluster(),
    refetchInterval: 60_000,
  })

  if (q.isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner />
      </div>
    )
  }

  if (q.error || !q.data) {
    return (
      <p className="py-8 text-center text-xs text-muted-foreground">
        {i18n.t('components.admin.infraSection.errors.loadFailed')}
      </p>
    )
  }

  const data = q.data
  // Sort: agent first, then dev, then controlplane
  const sortOrder: Record<string, number> = { agent: 0, sandbox: 1, dev: 2, controlplane: 3 }
  const sortedGroups = [...data.node_groups].sort(
    (a, b) => (sortOrder[a.group] ?? 9) - (sortOrder[b.group] ?? 9),
  )

  return (
    <div className="@container space-y-3 p-1">
      <SectionTitle>
        {i18n.t('components.admin.infraSection.sections.clusterOverview')}
      </SectionTitle>
      <OverviewCards data={data} />

      <SectionTitle>
        {i18n.t('components.admin.infraSection.sections.capacityEstimate')}
      </SectionTitle>
      <CapacityEstimate data={data} />

      <SectionTitle>{i18n.t('components.admin.infraSection.sections.nodeGroups')}</SectionTitle>
      {sortedGroups.map((group) => (
        <NodeGroupTable key={group.group} group={group} />
      ))}
    </div>
  )
}
