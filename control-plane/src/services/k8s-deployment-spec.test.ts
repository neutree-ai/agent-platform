import type * as k8s from '@kubernetes/client-node'
import { describe, expect, it } from 'vitest'
import {
  buildHeadlessServiceSpec,
  buildStatefulSetSpec,
  buildWorkspacePodTemplate,
  readyReplicaIdsFromPods,
  resolveStatefulSetStatus,
} from '../../../internal/k8s-provider'
import type { ComputeResources } from '../../../internal/types/api'
import {
  type K8sConfig,
  buildDeploymentSpec,
  deploymentTemplateVersion,
  resolveDeploymentStatus,
} from './k8s'

// Golden-master snapshots for buildDeploymentSpec. This locks the exact
// Deployment shape so the upcoming KubernetesProvider extraction (step 3b/3c)
// can be verified byte-for-byte against today's output. Config is passed
// explicitly so permutations don't depend on process.env.

const baseCfg: K8sConfig = {
  namespace: 'nap',
  namePrefix: 'nap',
  agentImagePrefix: 'nap-agent',
  agentImageTag: 'latest',
  storageClass: 'nfs-csi',
  imagePullSecret: '',
  nodeSelector: undefined,
  workspaceStorageSize: '10Gi',
  cpServiceUrl: 'http://nap-cp:3000',
  memoryFuseImage: '',
  multiReplica: false,
  afs: {
    enabled: false,
    image: '',
    controllerAddr: 'afs-controller.nap.svc:9100',
    fuseServerAddr: '127.0.0.1:9101',
    storagePvc: 'afs-shared-storage',
    configMap: 'afs-fuse-config',
  },
}

const labels = { app: 'nap', component: 'workspace', 'workspace-id': 'ws1' }
const args = ['nap-ws1', labels, 'ws1', 'claude-code', 'nap-ws1-workspace'] as const

describe('buildDeploymentSpec golden master', () => {
  it('minimal: afs off, memory off, no nodeselector/pullsecret/resources', () => {
    expect(buildDeploymentSpec(...args, undefined, baseCfg)).toMatchSnapshot()
  })

  it('afs enabled', () => {
    const cfg: K8sConfig = {
      ...baseCfg,
      afs: { ...baseCfg.afs, enabled: true, image: 'nap-afs-fuse:latest' },
    }
    expect(buildDeploymentSpec(...args, undefined, cfg)).toMatchSnapshot()
  })

  it('memory-fuse enabled', () => {
    const cfg: K8sConfig = { ...baseCfg, memoryFuseImage: 'nap-memory-fuse:latest' }
    expect(buildDeploymentSpec(...args, undefined, cfg)).toMatchSnapshot()
  })

  it('full: afs + memory + resources + nodeselector + pullsecret', () => {
    const cfg: K8sConfig = {
      ...baseCfg,
      imagePullSecret: 'regcred',
      nodeSelector: { 'node-group': 'agent' },
      memoryFuseImage: 'nap-memory-fuse:latest',
      afs: { ...baseCfg.afs, enabled: true, image: 'nap-afs-fuse:latest' },
    }
    const resources: ComputeResources = {
      cpu_request: '500m',
      cpu_limit: '2000m',
      memory_request: '1Gi',
      memory_limit: '4Gi',
      storage: '20Gi',
    }
    expect(buildDeploymentSpec(...args, resources, cfg)).toMatchSnapshot()
  })
})

describe('buildWorkspacePodTemplate', () => {
  // The pod template is the single source of truth for what runs inside a
  // workspace pod; buildDeploymentSpec must embed it verbatim. Locks the
  // extraction so a future second wrapper can't drift from the Deployment.
  it('is embedded verbatim as the Deployment template (full config)', () => {
    const cfg: K8sConfig = {
      ...baseCfg,
      imagePullSecret: 'regcred',
      nodeSelector: { 'node-group': 'agent' },
      memoryFuseImage: 'nap-memory-fuse:latest',
      afs: { ...baseCfg.afs, enabled: true, image: 'nap-afs-fuse:latest' },
    }
    const resources: ComputeResources = { cpu_request: '500m', memory_request: '1Gi' }
    const dep = buildDeploymentSpec(...args, resources, cfg)
    const template = buildWorkspacePodTemplate(
      labels,
      'ws1',
      'claude-code',
      'nap-ws1-workspace',
      resources,
      cfg,
    )
    expect(dep.spec?.template).toEqual(template)
  })

  it('is embedded verbatim as the Deployment template (minimal config)', () => {
    const dep = buildDeploymentSpec(...args, undefined, baseCfg)
    const template = buildWorkspacePodTemplate(
      labels,
      'ws1',
      'claude-code',
      'nap-ws1-workspace',
      undefined,
      baseCfg,
    )
    expect(dep.spec?.template).toEqual(template)
  })
})

// Minimal Deployment shapes for the status/annotation readers. Cast through
// unknown: the k8s client types require far more fields than the functions read.
function dep(input: {
  replicas?: number
  readyReplicas?: number
  progressing?: 'True' | 'False'
  annotations?: Record<string, string>
}): k8s.V1Deployment {
  return {
    metadata: { annotations: input.annotations },
    spec: { replicas: input.replicas },
    status: {
      readyReplicas: input.readyReplicas,
      conditions:
        input.progressing === undefined
          ? undefined
          : [{ type: 'Progressing', status: input.progressing }],
    },
  } as unknown as k8s.V1Deployment
}

describe('resolveDeploymentStatus', () => {
  it('no deployment → stopped', () => {
    expect(resolveDeploymentStatus(undefined)).toBe('stopped')
  })

  it('replicas 0 → stopped', () => {
    expect(resolveDeploymentStatus(dep({ replicas: 0, readyReplicas: 0 }))).toBe('stopped')
  })

  it('replicas unset → stopped', () => {
    expect(resolveDeploymentStatus(dep({}))).toBe('stopped')
  })

  it('ready >= desired → running', () => {
    expect(resolveDeploymentStatus(dep({ replicas: 1, readyReplicas: 1 }))).toBe('running')
  })

  it('not ready but Progressing=True → starting', () => {
    expect(
      resolveDeploymentStatus(dep({ replicas: 1, readyReplicas: 0, progressing: 'True' })),
    ).toBe('starting')
  })

  it('not ready and Progressing=False → error', () => {
    expect(
      resolveDeploymentStatus(dep({ replicas: 1, readyReplicas: 0, progressing: 'False' })),
    ).toBe('error')
  })

  it('not ready with no conditions → error', () => {
    expect(resolveDeploymentStatus(dep({ replicas: 1, readyReplicas: 0 }))).toBe('error')
  })
})

describe('deploymentTemplateVersion', () => {
  const ANNOTATION = 'agent-platform/workspace-version'

  it('reads a numeric annotation', () => {
    expect(deploymentTemplateVersion(dep({ annotations: { [ANNOTATION]: '6' } }))).toBe(6)
  })

  it('no deployment → null', () => {
    expect(deploymentTemplateVersion(undefined)).toBeNull()
  })

  it('annotation absent → null', () => {
    expect(deploymentTemplateVersion(dep({ annotations: {} }))).toBeNull()
  })

  it('unparseable annotation → null', () => {
    expect(deploymentTemplateVersion(dep({ annotations: { [ANNOTATION]: 'v6' } }))).toBeNull()
  })
})

describe('buildStatefulSetSpec', () => {
  it('golden master: shared RWX PVC, headless serviceName, parallel mgmt, N replicas', () => {
    expect(buildStatefulSetSpec(...args, 3, undefined, baseCfg)).toMatchSnapshot()
  })

  it('embeds the same pod template as the Deployment (no template drift)', () => {
    const sts = buildStatefulSetSpec(...args, 2, undefined, baseCfg)
    const template = buildWorkspacePodTemplate(
      labels,
      'ws1',
      'claude-code',
      'nap-ws1-workspace',
      undefined,
      baseCfg,
    )
    expect(sts.spec?.template).toEqual(template)
    // The Deployment wraps the identical template, so both workloads run
    // byte-identical pods.
    const dep = buildDeploymentSpec(...args, undefined, baseCfg)
    expect(sts.spec?.template).toEqual(dep.spec?.template)
  })

  it('uses no volumeClaimTemplates — all replicas share one PVC', () => {
    const sts = buildStatefulSetSpec(...args, 3, undefined, baseCfg)
    expect(sts.spec?.volumeClaimTemplates).toBeUndefined()
    const wsVolume = sts.spec?.template.spec?.volumes?.find((v) => v.name === 'workspace')
    expect(wsVolume?.persistentVolumeClaim?.claimName).toBe('nap-ws1-workspace')
  })

  it('serviceName is the headless service; replicas + policy passed through', () => {
    const sts = buildStatefulSetSpec(...args, 4, undefined, baseCfg)
    expect(sts.spec?.serviceName).toBe('nap-ws1-hl')
    expect(sts.spec?.podManagementPolicy).toBe('Parallel')
    expect(sts.spec?.replicas).toBe(4)
  })
})

describe('buildHeadlessServiceSpec', () => {
  it('is clusterIP:None, named <name>-hl, selects the workspace pods', () => {
    const svc = buildHeadlessServiceSpec('nap-ws1', labels)
    expect(svc.metadata?.name).toBe('nap-ws1-hl')
    expect(svc.spec?.clusterIP).toBe('None')
    expect(svc.spec?.selector).toEqual(labels)
    expect(svc.spec?.ports?.map((p) => p.port)).toEqual([3001, 9101, 9102])
  })
})

describe('resolveStatefulSetStatus', () => {
  const sts = (input: { replicas?: number; readyReplicas?: number }): k8s.V1StatefulSet =>
    ({
      spec: { replicas: input.replicas },
      status: { readyReplicas: input.readyReplicas },
    }) as unknown as k8s.V1StatefulSet

  it('no statefulset → stopped', () => {
    expect(resolveStatefulSetStatus(undefined)).toBe('stopped')
  })
  it('replicas 0 → stopped', () => {
    expect(resolveStatefulSetStatus(sts({ replicas: 0, readyReplicas: 0 }))).toBe('stopped')
  })
  it('at least one ready → running', () => {
    expect(resolveStatefulSetStatus(sts({ replicas: 3, readyReplicas: 1 }))).toBe('running')
  })
  it('desired > 0 but none ready → starting', () => {
    expect(resolveStatefulSetStatus(sts({ replicas: 2, readyReplicas: 0 }))).toBe('starting')
  })
})

describe('readyReplicaIdsFromPods', () => {
  const pod = (name: string, readies: boolean[]): k8s.V1Pod =>
    ({
      metadata: { name },
      status: { containerStatuses: readies.map((ready) => ({ ready })) },
    }) as unknown as k8s.V1Pod

  it('returns sorted ordinals of pods whose containers are all ready', () => {
    const pods = [
      pod('tos-ws1-2', [true, true]),
      pod('tos-ws1-0', [true]),
      pod('tos-ws1-1', [true, false]), // a container not ready → excluded
    ]
    expect(readyReplicaIdsFromPods(pods, 'tos-ws1')).toEqual([0, 2])
  })

  it('ignores pods with no container statuses', () => {
    expect(readyReplicaIdsFromPods([pod('tos-ws1-0', [])], 'tos-ws1')).toEqual([])
  })

  it('ignores names that are not <stsName>-<int>', () => {
    const pods = [
      pod('tos-ws1-0', [true]),
      pod('tos-ws1-abc', [true]), // non-numeric suffix
      pod('other-ws-0', [true]), // a different statefulset
      pod('tos-ws1', [true]), // no ordinal
    ]
    expect(readyReplicaIdsFromPods(pods, 'tos-ws1')).toEqual([0])
  })
})
