import * as k8s from '@kubernetes/client-node'
import { Hono } from 'hono'
import type { AppEnv } from '../../lib/types'

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

export default cluster
