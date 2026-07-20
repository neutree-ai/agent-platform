import type * as k8s from '@kubernetes/client-node'
import type { ComputeResources } from '../types/api'
import { type K8sConfig, agentImageFor, defaultCfg } from './config'
import { isPodReady } from './support'

// Workspace pod/deployment spec construction, plus the pure status/annotation
// readers the reconcile paths share. Split from the provider so the pod
// template is a standalone seam: today only buildDeploymentSpec wraps it, but
// any future workload shape (e.g. a multi-replica variant) must reuse the
// exact same template rather than fork the container/sidecar/volume layout.

// Workspace pod spec template version. Bump when buildDeploymentSpec produces
// a structurally different pod for reasons unrelated to per-ws config (e.g.
// platform sidecar added/removed, mount layout changed). Per-ws config like
// memory attachments does NOT bump this — that goes through on-change rebuild.
// Written to the Deployment annotation so future drift checks can decide
// whether to rebuild a stale ws.
// v1: agent + afs-fuse sidecar
// v2: + memory-fuse sidecar scaffold (gated per-ws by attachment presence)
// v3: memory-fuse gains a /var/cache/memory-fuse emptyDir for disk-backed
//     content cache. Without v3 the daemon falls back to in-memory only, so
//     existing v2 pods stay correct — but reconcile will rebuild them on
//     their next start/attach so the cache speedup actually applies.
// v4: sidecar is unconditional on this cluster (gated only by
//     MEMORY_FUSE_IMAGE). The attachment-driven gating we had at v2/v3 is
//     retired now that every ws has a default store attached. Side effect:
//     reconcile no longer fires from attach/detach (count is always >= 1).
// v5: afs-fuse sidecar gains AFS_BOOTSTRAP_URL env so it can self-heal
//     mounts on pod replacement without relying on cp's push path.
// v6: agent probes relaxed — added a startupProbe (up to 600s boot grace)
//     and widened liveness/readiness timeouts so skill-heavy boots and
//     event-loop saturation no longer trip a SIGKILL. The probe spec
//     changed in buildDeploymentSpec without a version bump, so existing
//     v5 Deployments kept the old 1s-timeout / no-startupProbe config and
//     CrashLoopBackOff'd; bumping forces reconcile to rebuild them.
export const CURRENT_TEMPLATE_VERSION = 6
export const TEMPLATE_VERSION_ANNOTATION = 'agent-platform/workspace-version'
export const MEMORY_FUSE_CONTAINER_NAME = 'memory-fuse'

/**
 * The workspace pod template: agent container + optional afs-fuse /
 * memory-fuse privileged sidecars + volumes. This is the single source of
 * truth for what runs inside a workspace pod — {@link buildDeploymentSpec}
 * wraps it in a Deployment, and any other workload wrapper must call this
 * rather than re-declare containers.
 */
export function buildWorkspacePodTemplate(
  labels: Record<string, string>,
  workspaceId: string,
  agentType: string,
  pvcName: string,
  resources?: ComputeResources,
  cfg: K8sConfig = defaultCfg,
): k8s.V1PodTemplateSpec {
  // memory-fuse sidecar is unconditional on any cluster that ships the
  // image. The historical per-ws attachment gating was retired in template
  // v4 once every ws got a default store; keeping it would just be a no-op
  // (count is always >= 1).
  const memoryFuseActive = cfg.memoryFuseImage !== ''

  const agentContainer: k8s.V1Container = {
    name: 'agent',
    image: agentImageFor(cfg, agentType),
    ports: [{ containerPort: 3001, name: 'http' }],
    env: [
      { name: 'WORKSPACE_DIR', value: '/workspace' },
      { name: 'CP_URL', value: cfg.cpServiceUrl },
      { name: 'WORKSPACE_ID', value: workspaceId },
      ...(cfg.afs.enabled
        ? [
            { name: 'AFS_CONTROLLER', value: cfg.afs.controllerAddr },
            { name: 'AFS_FUSE_SERVER', value: cfg.afs.fuseServerAddr },
          ]
        : []),
    ],
    volumeMounts: [
      { name: 'workspace', mountPath: '/workspace' },
      ...(cfg.afs.enabled
        ? [{ name: 'afs-mnt', mountPath: '/mnt/afs', mountPropagation: 'HostToContainer' }]
        : []),
      ...(memoryFuseActive
        ? [{ name: 'memory-mnt', mountPath: '/mnt/memory', mountPropagation: 'HostToContainer' }]
        : []),
    ],
    resources: {
      requests: {
        memory: resources?.memory_request || '256Mi',
        cpu: resources?.cpu_request || '100m',
      },
      limits: {
        memory: resources?.memory_limit || '1Gi',
        cpu: resources?.cpu_limit || '500m',
      },
    },
    // Skills are downloaded/unzipped/symlinked synchronously during boot,
    // before the agent binds :3001 — a skill-heavy workspace (e.g. 29 skills
    // ~2m30s) can take minutes to become reachable. Without a startupProbe the
    // liveness probe starts ticking from initialDelay and SIGKILLs the process
    // mid-boot; the restart wipes /tmp (tmpfs) and re-extracts from zero, so it
    // never finishes → CrashLoopBackOff. The startupProbe holds liveness off
    // until /health first answers, giving boot up to 600s (120 × 5s) of grace.
    startupProbe: {
      httpGet: { path: '/health', port: 3001 as any },
      initialDelaySeconds: 5,
      periodSeconds: 5,
      timeoutSeconds: 3,
      failureThreshold: 120,
    },
    livenessProbe: {
      httpGet: { path: '/health', port: 3001 as any },
      initialDelaySeconds: 5,
      periodSeconds: 30,
      // The agent serves /health on the same single Node event loop that
      // fans out ACP bridge events. Under heavy concurrent sessions (e.g.
      // multi-agent PPT orchestration) a burst of tool-call/message events
      // can starve the loop so a short health GET can't be scheduled in
      // time — the process is busy, not dead. Give generous headroom before
      // a liveness kill so transient saturation doesn't restart the pod.
      timeoutSeconds: 5,
      failureThreshold: 6,
    },
    readinessProbe: {
      httpGet: { path: '/health', port: 3001 as any },
      initialDelaySeconds: 3,
      periodSeconds: 10,
      timeoutSeconds: 3,
      failureThreshold: 3,
    },
  }

  const afsSidecar: k8s.V1Container | undefined = cfg.afs.enabled
    ? {
        name: 'afs-fuse',
        image: cfg.afs.image,
        command: ['afs-fuse'],
        args: ['/etc/afs/fuse-server.toml'],
        env: [
          // Boot-pull endpoint: on sidecar startup the daemon GETs this and
          // re-issues local Mount RPCs for each share. Covers pod-replacement
          // scenarios where cp's deployment-level watch never sees a status
          // transition (cp restart mid-replace, scale events). Mount itself
          // is idempotent (ALREADY_EXISTS swallowed daemon-side).
          {
            name: 'AFS_BOOTSTRAP_URL',
            value: `${cfg.cpServiceUrl}/_cp/workspaces/${workspaceId}/afs-mounts`,
          },
        ],
        securityContext: { privileged: true },
        volumeMounts: [
          { name: 'afs-mnt', mountPath: '/mnt/afs', mountPropagation: 'Bidirectional' },
          { name: 'afs-storage', mountPath: '/data/afs' },
          { name: 'afs-fuse-config', mountPath: '/etc/afs' },
          { name: 'dev-fuse', mountPath: '/dev/fuse' },
        ],
      }
    : undefined

  const memoryFuseSidecar: k8s.V1Container | undefined = memoryFuseActive
    ? {
        name: MEMORY_FUSE_CONTAINER_NAME,
        image: cfg.memoryFuseImage,
        env: [
          { name: 'CP_URL', value: cfg.cpServiceUrl },
          { name: 'WORKSPACE_ID', value: workspaceId },
          // gRPC mount/unmount RPC: bind 0.0.0.0:9102 so cp can dial via the ws
          // Service (same pattern as afs-fuse on :9101). Trust cluster network.
          { name: 'GRPC_LISTEN_ADDR', value: '0.0.0.0:9102' },
        ],
        ports: [{ containerPort: 9102, name: 'memory-fuse' }],
        // Bidirectional mount propagation requires a privileged container —
        // same constraint that afs-fuse runs under. SYS_ADMIN alone isn't
        // enough; the kernel check is on cap_sys_admin + privileged flag.
        securityContext: { privileged: true },
        volumeMounts: [
          { name: 'memory-mnt', mountPath: '/mnt/memory', mountPropagation: 'Bidirectional' },
          // Disk-backed content cache: survives in-container daemon restarts
          // (emptyDir lives with the pod). Pod reschedule clears it; the
          // daemon's boot pull + lazy fetch refills on demand.
          { name: 'memory-cache', mountPath: '/var/cache/memory-fuse' },
          { name: 'dev-fuse', mountPath: '/dev/fuse' },
        ],
      }
    : undefined

  // dev-fuse hostPath is shared by afs-fuse and memory-fuse; declare once if either enabled
  const needsDevFuse = cfg.afs.enabled || memoryFuseActive

  const volumes: k8s.V1Volume[] = [
    { name: 'workspace', persistentVolumeClaim: { claimName: pvcName } },
    ...(cfg.afs.enabled
      ? [
          { name: 'afs-mnt', emptyDir: {} },
          { name: 'afs-storage', persistentVolumeClaim: { claimName: cfg.afs.storagePvc } },
          { name: 'afs-fuse-config', configMap: { name: cfg.afs.configMap } },
        ]
      : []),
    ...(memoryFuseActive
      ? [
          { name: 'memory-mnt', emptyDir: {} },
          { name: 'memory-cache', emptyDir: {} },
        ]
      : []),
    ...(needsDevFuse ? [{ name: 'dev-fuse', hostPath: { path: '/dev/fuse' } }] : []),
  ]

  return {
    metadata: { labels },
    spec: {
      // Agent container runs as `node` (UID/GID 1000 in node:20-slim).
      // nfs-csi mounts are typically world-writable so the missing
      // fsGroup wasn't visible — but block-mode CSIs (ELF, RBD, vSphere
      // CSI, etc.) hand us a fresh ext4 owned root:root / 0755 and the
      // agent then EACCESes on mkdir /workspace/.home/.codex. fsGroup
      // makes kubelet chgrp the mount to 1000 + add group-write; the
      // OnRootMismatch policy avoids re-chown'ing every restart once
      // the workspace has grown large.
      securityContext: {
        fsGroup: 1000,
        fsGroupChangePolicy: 'OnRootMismatch',
      },
      nodeSelector: cfg.nodeSelector,
      ...(cfg.imagePullSecret ? { imagePullSecrets: [{ name: cfg.imagePullSecret }] } : {}),
      containers: [agentContainer, afsSidecar, memoryFuseSidecar].filter(
        (c): c is k8s.V1Container => !!c,
      ),
      volumes,
    },
  }
}

export function buildDeploymentSpec(
  name: string,
  labels: Record<string, string>,
  workspaceId: string,
  agentType: string,
  pvcName: string,
  resources?: ComputeResources,
  cfg: K8sConfig = defaultCfg,
): k8s.V1Deployment {
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: {
      name,
      labels,
      annotations: { [TEMPLATE_VERSION_ANNOTATION]: String(CURRENT_TEMPLATE_VERSION) },
    },
    spec: {
      replicas: 1,
      selector: { matchLabels: labels },
      // Single-replica workspace pods already have a mini-downtime during any
      // restart (agent container is slow to SIGTERM), so Rolling gains no
      // real zero-downtime — and Rolling's double-pod peak frequently
      // fails to schedule on a memory-constrained cluster. Recreate kills
      // the old pod first, freeing its memory request before the new one
      // is placed.
      strategy: { type: 'Recreate' },
      template: buildWorkspacePodTemplate(labels, workspaceId, agentType, pvcName, resources, cfg),
    },
  }
}

/**
 * The auto-scaling workload form: a StatefulSet whose pods all mount the SAME
 * shared ReadWriteMany workspace PVC (via the pod template's `workspace`
 * volume) — deliberately NOT volumeClaimTemplates. StatefulSet is used only for
 * its stable per-ordinal identity: stable DNS (`<name>-<n>.<name>-hl`) so cp
 * routing is stateless, and ordered scale-down (highest ordinal first) so
 * draining has a determinate target. The pod template is byte-identical to the
 * Deployment's — same container/sidecar/volume layout via
 * {@link buildWorkspacePodTemplate} — so there is no second template to drift.
 */
export function buildStatefulSetSpec(
  name: string,
  labels: Record<string, string>,
  workspaceId: string,
  agentType: string,
  pvcName: string,
  replicas: number,
  resources?: ComputeResources,
  cfg: K8sConfig = defaultCfg,
): k8s.V1StatefulSet {
  return {
    apiVersion: 'apps/v1',
    kind: 'StatefulSet',
    metadata: {
      name,
      labels,
      annotations: { [TEMPLATE_VERSION_ANNOTATION]: String(CURRENT_TEMPLATE_VERSION) },
    },
    spec: {
      serviceName: `${name}-hl`,
      replicas,
      // Bring all replicas up/down at once — replicas share the workspace
      // volume and have no inter-pod handshake, so OrderedReady's one-at-a-time
      // gating would only make scale-up needlessly slow. Scale-DOWN still
      // removes the highest ordinal first regardless of this policy.
      podManagementPolicy: 'Parallel',
      selector: { matchLabels: labels },
      template: buildWorkspacePodTemplate(labels, workspaceId, agentType, pvcName, resources, cfg),
      // No volumeClaimTemplates: every pod mounts the one shared RWX PVC named
      // in the pod template. See the function doc.
    },
  }
}

/**
 * Ports every workspace Service exposes: the agent (http), afs-fuse and
 * memory-fuse sidecars. Shared by the static ClusterIP Service and the
 * auto-scaling headless Service so the two shapes can't drift.
 */
export const WORKSPACE_SERVICE_PORTS: k8s.V1ServicePort[] = [
  { port: 3001, targetPort: 3001 as any, name: 'http' },
  { port: 9101, targetPort: 9101 as any, name: 'afs-fuse' },
  { port: 9102, targetPort: 9102 as any, name: 'memory-fuse' },
]

/**
 * The headless Service backing a StatefulSet workspace: `clusterIP: None`, so
 * each pod gets a stable DNS name (`<name>-<ordinal>.<name>-hl.<ns>.svc`) that
 * cp routes to per replica. No ClusterIP Service is created for an auto-scaling
 * workspace — a VIP would round-robin across replicas and defeat session
 * affinity.
 */
export function buildHeadlessServiceSpec(
  name: string,
  labels: Record<string, string>,
): k8s.V1Service {
  return {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: { name: `${name}-hl`, labels },
    spec: {
      clusterIP: 'None',
      selector: labels,
      ports: WORKSPACE_SERVICE_PORTS,
    },
  }
}

/** The HTTP port a workspace agent serves on (mirrors the pod's `http` port). */
export const AGENT_PORT = 3001

/**
 * The in-cluster base URL to reach a workspace's agent on the built-in (k8s)
 * environment. This is the k8s address format, kept in the provider package so
 * cp-core never hardcodes cluster-DNS shape — it asks for an address by
 * (workspace, replica) and gets a URL back.
 *
 * - `replicaId` omitted → the workspace's own Service: `<prefix>-<ws>.<ns>.svc`.
 *   This is the single-replica (static) path and is byte-identical to the
 *   address cp built inline before this seam existed.
 * - `replicaId` given → one specific StatefulSet pod of an auto-scaling
 *   workspace, via its headless Service:
 *   `<prefix>-<ws>-<id>.<prefix>-<ws>-hl.<ns>.svc`. This is the stable
 *   per-ordinal DNS {@link buildStatefulSetSpec} exists to provide.
 *
 * Pure (config + ids → string): no kube client, so cp can call it synchronously
 * on the routing hot path without an API round-trip.
 */
export function builtinReplicaAddress(
  cfg: K8sConfig,
  workspaceId: string,
  replicaId?: number,
): string {
  const base = `${cfg.namePrefix}-${workspaceId}`
  const host =
    replicaId === undefined
      ? `${base}.${cfg.namespace}.svc.cluster.local`
      : `${base}-${replicaId}.${base}-hl.${cfg.namespace}.svc.cluster.local`
  return `http://${host}:${AGENT_PORT}`
}

/**
 * Batch-check K8s deployment statuses for active workspaces.
 * Returns a map of workspaceId → resolved status.
 * Uses a single listNamespacedDeployment call (O(1) K8s API).
 */
export type ReconciledStatus = 'running' | 'stopped' | 'starting' | 'error'

/** Resolve a single deployment to a workspace status. */
export function resolveDeploymentStatus(dep: k8s.V1Deployment | undefined): ReconciledStatus {
  if (!dep || (dep.spec?.replicas ?? 0) === 0) return 'stopped'

  const replicas = dep.spec?.replicas ?? 0
  const readyReplicas = dep.status?.readyReplicas ?? 0

  if (readyReplicas >= replicas) return 'running'

  const progressing = dep.status?.conditions?.find((c) => c.type === 'Progressing')
  if (progressing?.status === 'True') return 'starting'

  return 'error'
}

/**
 * Read the template version stamped on a Deployment (the workspace-version
 * annotation), or null if absent/unparseable. The reconcile loop caches this
 * onto the workspace row so drift checks don't need a live k8s read.
 */
export function deploymentTemplateVersion(dep: k8s.V1Deployment | undefined): number | null {
  const raw = dep?.metadata?.annotations?.[TEMPLATE_VERSION_ANNOTATION]
  if (raw === undefined) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/**
 * Resolve a StatefulSet to a workspace status. Unlike a Deployment there is no
 * Progressing condition to read, so a not-yet-ready set is always 'starting'
 * (the pod's 600s startupProbe grace covers a slow boot); the autoscaler and
 * per-replica readiness live in {@link readyReplicaIdsFromPods}, not here.
 */
export function resolveStatefulSetStatus(sts: k8s.V1StatefulSet | undefined): ReconciledStatus {
  const desired = sts?.spec?.replicas ?? 0
  if (!sts || desired === 0) return 'stopped'
  const ready = sts.status?.readyReplicas ?? 0
  return ready >= 1 ? 'running' : 'starting'
}

/** Parse the ordinal (replica id) out of a StatefulSet pod name, or null. */
function podReplicaOrdinal(podName: string, stsName: string): number | null {
  const prefix = `${stsName}-`
  if (!podName.startsWith(prefix)) return null
  const suffix = podName.slice(prefix.length)
  return /^\d+$/.test(suffix) ? Number(suffix) : null
}

/**
 * The replica ids of the Ready pods of a StatefulSet — the readiness signal cp
 * routes on (reported via the endpoint's readyReplicaIds). Returned sorted.
 */
export function readyReplicaIdsFromPods(pods: k8s.V1Pod[], stsName: string): number[] {
  const ids: number[] = []
  for (const pod of pods) {
    const ordinal = podReplicaOrdinal(pod.metadata?.name ?? '', stsName)
    if (ordinal !== null && isPodReady(pod)) ids.push(ordinal)
  }
  return ids.sort((a, b) => a - b)
}
