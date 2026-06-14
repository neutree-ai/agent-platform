import * as k8s from '@kubernetes/client-node'
import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'
import { listStreamingWorkspaceIds } from '../../services/db/sessions'
import * as k8sService from '../../services/k8s'
import { computeWorkspaceDrift, reconcileWorkspacePod } from '../../services/workspace-reconcile'

const cluster = new Hono<AppEnv>()

function parseCpuMillis(val?: string): number {
  if (!val) return 0
  if (val.endsWith('m')) return Number.parseInt(val)
  return Number.parseFloat(val) * 1000
}
function parseMemMi(val?: string): number {
  if (!val) return 0
  if (val.endsWith('Gi')) return Number.parseFloat(val) * 1024
  if (val.endsWith('Mi')) return Number.parseFloat(val)
  if (val.endsWith('Ki')) return Number.parseFloat(val) / 1024
  if (val.endsWith('G')) return Number.parseFloat(val) * 953.674
  if (val.endsWith('M')) return Number.parseFloat(val) * 0.953674
  return 0
}

cluster.get('/', async (c) => {
  const kc = new k8s.KubeConfig()
  if (process.env.KUBECONFIG) {
    kc.loadFromFile(process.env.KUBECONFIG)
  } else {
    kc.loadFromDefault()
  }
  const coreApi = kc.makeApiClient(k8s.CoreV1Api)
  const appsApi = kc.makeApiClient(k8s.AppsV1Api)

  const [nodesRes, podsRes, deploymentsRes] = await Promise.all([
    coreApi.listNode(),
    coreApi.listNamespacedPod(
      process.env.K8S_NAMESPACE || 'default',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined, // no label filter — we need all pods for per-node totals
    ),
    appsApi.listNamespacedDeployment(
      process.env.K8S_NAMESPACE || 'default',
      undefined,
      undefined,
      undefined,
      undefined,
      'app=tos,component=workspace',
    ),
  ])

  const nodes = nodesRes.body.items.map((n) => {
    const nodeGroup =
      n.metadata?.labels?.['cape.infrastructure.cluster.x-k8s.io/node-group'] || 'unknown'
    const isControlPlane = !!n.metadata?.labels?.['node-role.kubernetes.io/control-plane']
    return {
      name: n.metadata?.name || '',
      group: isControlPlane ? 'controlplane' : nodeGroup,
      cpu_capacity: parseCpuMillis(n.status?.allocatable?.cpu),
      mem_capacity_mi: parseMemMi(n.status?.allocatable?.memory),
      cpu_requested: 0,
      mem_requested_mi: 0,
      pod_count: 0,
      tos_pod_count: 0,
      sbx_pod_count: 0,
    }
  })
  const nodeMap = new Map(nodes.map((n) => [n.name, n]))

  for (const pod of podsRes.body.items) {
    if (pod.status?.phase !== 'Running') continue
    const node = nodeMap.get(pod.spec?.nodeName || '')
    if (!node) continue
    node.pod_count++
    for (const container of pod.spec?.containers || []) {
      node.cpu_requested += parseCpuMillis(container.resources?.requests?.cpu)
      node.mem_requested_mi += parseMemMi(container.resources?.requests?.memory)
    }
  }

  const tiers = { small: 0, medium: 0, large: 0 }
  for (const dep of deploymentsRes.body.items) {
    const wsId = dep.metadata?.labels?.['workspace-id']
    if (!wsId) continue
    const nodeName = podsRes.body.items.find(
      (p) => p.metadata?.labels?.['workspace-id'] === wsId && p.status?.phase === 'Running',
    )?.spec?.nodeName
    if (nodeName) {
      const node = nodeMap.get(nodeName)
      if (node) node.tos_pod_count++
    }
    const cpuReq = parseCpuMillis(
      dep.spec?.template?.spec?.containers?.[0]?.resources?.requests?.cpu,
    )
    if (cpuReq >= 1000) tiers.large++
    else if (cpuReq >= 250) tiers.medium++
    else tiers.small++
  }

  let totalSandboxes = 0
  for (const pod of podsRes.body.items) {
    if (pod.status?.phase !== 'Running') continue
    if (!('batch-sandbox.sandbox.opensandbox.io/pod-index' in (pod.metadata?.labels ?? {})))
      continue
    const node = nodeMap.get(pod.spec?.nodeName || '')
    if (!node) continue
    node.sbx_pod_count++
    totalSandboxes++
  }

  const groups = new Map<string, typeof nodes>()
  for (const node of nodes) {
    const list = groups.get(node.group) || []
    list.push(node)
    groups.set(node.group, list)
  }

  const nodeGroups = Array.from(groups.entries()).map(([group, groupNodes]) => ({
    group,
    nodes: groupNodes.map((n) => ({
      name: n.name,
      cpu_capacity: n.cpu_capacity,
      mem_capacity_mi: Math.round(n.mem_capacity_mi),
      cpu_requested: n.cpu_requested,
      mem_requested_mi: Math.round(n.mem_requested_mi),
      cpu_free: n.cpu_capacity - n.cpu_requested,
      mem_free_mi: Math.round(n.mem_capacity_mi - n.mem_requested_mi),
      pod_count: n.pod_count,
      tos_pod_count: n.tos_pod_count,
      sbx_pod_count: n.sbx_pod_count,
    })),
    totals: {
      cpu_capacity: groupNodes.reduce((s, n) => s + n.cpu_capacity, 0),
      mem_capacity_mi: Math.round(groupNodes.reduce((s, n) => s + n.mem_capacity_mi, 0)),
      cpu_requested: groupNodes.reduce((s, n) => s + n.cpu_requested, 0),
      mem_requested_mi: Math.round(groupNodes.reduce((s, n) => s + n.mem_requested_mi, 0)),
      node_count: groupNodes.length,
      pod_count: groupNodes.reduce((s, n) => s + n.pod_count, 0),
      tos_pod_count: groupNodes.reduce((s, n) => s + n.tos_pod_count, 0),
      sbx_pod_count: groupNodes.reduce((s, n) => s + n.sbx_pod_count, 0),
    },
  }))

  return c.json({
    node_groups: nodeGroups,
    workspace_tiers: tiers,
    total_workspaces: deploymentsRes.body.items.length,
    total_sandboxes: totalSandboxes,
  })
})

/**
 * Batch "rebuild stale" sweep — the fleet/ops counterpart of the per-workspace
 * POST /workspaces/:id/rebuild action, built on the SAME drift core. For every
 * agent workspace whose Deployment drifts from the current platform template,
 * reconcile (rebuild) it; for ones already in sync, roll the pods so a moving
 * `:latest` image is re-pulled. Workspaces with a live streaming turn are
 * skipped so a rollout never kills an in-flight session.
 *
 * Admin-authorized; also callable headless by the rollout pipeline via the
 * static x-plugin-admin-token bypass (see index.ts).
 *
 * Body (all optional): {
 *   agentType?: string,   // only this agent type (by image); default all
 *   activeWindow?: string,// PG interval for the streaming skip; default '10 minutes'
 *   concurrency?: number, // parallel reconciles; default 16
 *   dryRun?: boolean,     // report drift without mutating; default false
 * }
 */
cluster.post('/rebuild-stale', async (c) => {
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>)
  const agentType = typeof body.agentType === 'string' ? body.agentType : undefined
  const activeWindow = typeof body.activeWindow === 'string' ? body.activeWindow : '10 minutes'
  const concurrency = Math.max(1, Math.min(32, Number(body.concurrency) || 16))
  const dryRun = body.dryRun === true

  const wantImage = agentType ? k8sService.getAgentImage(agentType) : null

  const { deployments } = await k8sService.listWorkspaceDeployments()
  const targets: string[] = []
  let stoppedSkipped = 0
  for (const [wsId, dep] of deployments) {
    if (wantImage) {
      const image = dep.spec?.template?.spec?.containers?.find((x) => x.name === 'agent')?.image
      if (image !== wantImage) continue
    }
    // Skip stopped workspaces. rebuildInstance is delete+recreate, and the
    // recreated Deployment defaults to replicas=1 — so reconciling a stopped
    // (replicas=0) workspace would resurrect it. Stopped workspaces pick up
    // the new template on their next start (reconcile-on-start), so the sweep
    // must leave them as-is.
    if ((dep.spec?.replicas ?? 0) === 0) {
      stoppedSkipped++
      continue
    }
    targets.push(wsId)
  }

  const streaming = new Set(await listStreamingWorkspaceIds(activeWindow))

  const result = {
    total: targets.length,
    stoppedSkipped,
    rebuilt: [] as string[],
    restarted: [] as string[],
    inSync: 0,
    skipped: [] as string[],
    failed: [] as { workspaceId: string; error: string }[],
  }

  let cursor = 0
  async function worker() {
    while (cursor < targets.length) {
      const wsId = targets[cursor++]
      if (streaming.has(wsId)) {
        result.skipped.push(wsId)
        continue
      }
      try {
        const drift = await computeWorkspaceDrift(wsId)
        if (!drift.hasInstance) continue
        if (drift.reasons.length > 0) {
          if (dryRun) {
            result.rebuilt.push(wsId)
          } else {
            const { rebuilt } = await reconcileWorkspacePod(wsId)
            if (rebuilt) result.rebuilt.push(wsId)
            else result.inSync++
          }
        } else if (dryRun) {
          result.inSync++
        } else {
          // In sync, but roll the pod so a moving :latest tag is re-pulled.
          await k8sService.restartInstance(wsId)
          result.restarted.push(wsId)
        }
      } catch (e: any) {
        result.failed.push({ workspaceId: wsId, error: e?.message || String(e) })
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker))

  console.log(
    `[rebuild-stale] agentType=${agentType ?? 'all'} dryRun=${dryRun} total=${result.total} ` +
      `rebuilt=${result.rebuilt.length} restarted=${result.restarted.length} ` +
      `inSync=${result.inSync} skipped=${result.skipped.length} ` +
      `stoppedSkipped=${result.stoppedSkipped} failed=${result.failed.length}`,
  )

  return c.json(result, result.failed.length > 0 ? 207 : 200)
})

export default cluster
