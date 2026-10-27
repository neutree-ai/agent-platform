import type * as k8s from '@kubernetes/client-node'
import { describe, expect, it } from 'vitest'
import { KubernetesProvider } from '../../../internal/k8s-provider'
import type { K8sConfig } from '../../../internal/k8s-provider'

// A workspace's ClusterIP Service is the one resource whose creation can fail
// for a cluster-wide reason (ClusterIP range exhausted), so a healthy pod can
// outlive its Service and become reachable by nothing. These tests pin the two
// halves of the answer: every converge path recreates a missing Service, and an
// observation reports 'error' instead of a 'running' that every HTTP hop turns
// into a 502.

const cfg: K8sConfig = {
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

/** A k8s API error shaped the way the client-node library reports one. */
function apiError(statusCode: number, message = 'boom'): Error & { response: unknown } {
  return Object.assign(new Error(message), { response: { statusCode } })
}

function deployment(wsId: string, replicas: number, readyReplicas: number): k8s.V1Deployment {
  return {
    metadata: { name: `nap-${wsId}`, labels: { 'workspace-id': wsId } },
    spec: { replicas },
    status: { readyReplicas },
  } as unknown as k8s.V1Deployment
}

function service(wsId: string, clusterIP = '10.96.0.1', name = `nap-${wsId}`): k8s.V1Service {
  return {
    metadata: { name, labels: { 'workspace-id': wsId } },
    spec: { clusterIP },
  } as unknown as k8s.V1Service
}

type Call = { method: string; args: unknown[] }

/**
 * Fake apps/core API pair recording every call. `services` is the cluster's
 * current Service set; tests seed it and assert on what the provider added.
 */
function makeApis(opts: {
  deployments?: k8s.V1Deployment[]
  statefulSets?: k8s.V1StatefulSet[]
  services?: k8s.V1Service[]
  serviceCreateFails?: boolean
  multiReplica?: boolean
}) {
  const calls: Call[] = []
  const services = [...(opts.services ?? [])]
  const deployments = [...(opts.deployments ?? [])]
  const statefulSets = [...(opts.statefulSets ?? [])]
  const record = (method: string, ...args: unknown[]) => calls.push({ method, args })

  const appsApi = {
    listNamespacedDeployment: async () => {
      record('listNamespacedDeployment')
      return { body: { items: deployments, metadata: { resourceVersion: '1' } } }
    },
    readNamespacedDeployment: async (name: string) => {
      record('readNamespacedDeployment', name)
      const dep = deployments.find((d) => d.metadata?.name === name)
      if (!dep) throw apiError(404)
      return { body: dep }
    },
    createNamespacedDeployment: async (_ns: string, dep: k8s.V1Deployment) => {
      record('createNamespacedDeployment', dep.metadata?.name)
      deployments.push(dep)
      return { body: dep }
    },
    patchNamespacedDeployment: async (name: string) => {
      record('patchNamespacedDeployment', name)
      const dep = deployments.find((d) => d.metadata?.name === name)
      if (!dep) throw apiError(404)
      return { body: dep }
    },
    patchNamespacedDeploymentScale: async (
      name: string,
      _ns: string,
      body: { spec: { replicas: number } },
    ) => {
      record('patchNamespacedDeploymentScale', name)
      const dep = deployments.find((d) => d.metadata?.name === name)
      if (!dep) throw apiError(404)
      dep.spec = { ...dep.spec, replicas: body.spec.replicas } as k8s.V1DeploymentSpec
      return { body: dep }
    },
    deleteNamespacedDeployment: async (name: string) => {
      record('deleteNamespacedDeployment', name)
      const i = deployments.findIndex((d) => d.metadata?.name === name)
      if (i < 0) throw apiError(404)
      deployments.splice(i, 1)
      return { body: {} }
    },
    listNamespacedStatefulSet: async () => {
      record('listNamespacedStatefulSet')
      return { body: { items: statefulSets } }
    },
    readNamespacedStatefulSet: async (name: string) => {
      const sts = statefulSets.find((s) => s.metadata?.name === name)
      if (!sts) throw apiError(404)
      return { body: sts }
    },
    createNamespacedStatefulSet: async (_ns: string, sts: k8s.V1StatefulSet) => {
      record('createNamespacedStatefulSet', sts)
      statefulSets.push(sts)
      return { body: sts }
    },
    patchNamespacedStatefulSet: async (name: string, _ns: string, patch: unknown) => {
      record('patchNamespacedStatefulSet', patch)
      const sts = statefulSets.find((s) => s.metadata?.name === name)
      if (!sts) throw apiError(404)
      return { body: sts }
    },
    patchNamespacedStatefulSetScale: async (name: string) => {
      record('patchNamespacedStatefulSetScale', name)
      throw apiError(404)
    },
  } as unknown as k8s.AppsV1Api

  const coreApi = {
    listNamespacedService: async () => {
      record('listNamespacedService')
      return { body: { items: services } }
    },
    readNamespacedService: async (name: string) => {
      record('readNamespacedService', name)
      const svc = services.find((s) => s.metadata?.name === name)
      if (!svc) throw apiError(404)
      return { body: svc }
    },
    createNamespacedService: async (_ns: string, svc: k8s.V1Service) => {
      record('createNamespacedService', svc.metadata?.name)
      if (opts.serviceCreateFails) {
        throw apiError(
          500,
          'Internal error occurred: failed to allocate a serviceIP: range is full',
        )
      }
      services.push(svc)
      return { body: svc }
    },
    deleteNamespacedService: async (name: string) => {
      record('deleteNamespacedService', name)
      const i = services.findIndex((s) => s.metadata?.name === name)
      if (i < 0) throw apiError(404)
      services.splice(i, 1)
      return { body: {} }
    },
    createNamespacedPersistentVolumeClaim: async (
      _ns: string,
      pvc: k8s.V1PersistentVolumeClaim,
    ) => {
      record('createNamespacedPersistentVolumeClaim', pvc.metadata?.name)
      return { body: pvc }
    },
    listNamespacedStatefulSet: async () => ({ body: { items: [] } }),
    listNamespacedPod: async () => ({ body: { items: [] } }),
  } as unknown as k8s.CoreV1Api

  const provider = new KubernetesProvider(appsApi, coreApi, {} as k8s.KubeConfig, {
    ...cfg,
    multiReplica: opts.multiReplica ?? false,
  })
  return {
    provider,
    calls,
    services,
    deployments,
    methods: () => calls.map((c) => c.method),
  }
}

describe('observation reflects Service presence', () => {
  it('observeAll: running Deployment with no Service reports error, not running', async () => {
    const { provider } = makeApis({ deployments: [deployment('ws1', 1, 1)], services: [] })
    const observed = await provider.observeAll()
    expect(observed.get('ws1')).toMatchObject({
      phase: 'error',
      message: expect.stringContaining('Service missing'),
    })
  })

  it('observeAll: running Deployment with its Service reports running, no message', async () => {
    const { provider } = makeApis({
      deployments: [deployment('ws1', 1, 1)],
      services: [service('ws1')],
    })
    const observed = await provider.observeAll()
    expect(observed.get('ws1')?.phase).toBe('running')
    expect(observed.get('ws1')?.message).toBeUndefined()
  })

  it('observeAll: a stopped workspace with no Service stays stopped, not error', async () => {
    // Reclaiming a stopped workspace's Service is legitimate — start() puts it
    // back — so it must not show up as a failure in the meantime.
    const { provider } = makeApis({ deployments: [deployment('ws1', 0, 0)], services: [] })
    expect((await provider.observeAll()).get('ws1')?.phase).toBe('stopped')
  })

  it('observeAll: the auto-scaling headless Service does not count as the ClusterIP one', async () => {
    const { provider } = makeApis({
      deployments: [deployment('ws1', 1, 1)],
      services: [service('ws1', 'None', 'nap-ws1-hl')],
    })
    expect((await provider.observeAll()).get('ws1')?.phase).toBe('error')
  })

  it('observe: same verdict for a single workspace', async () => {
    const missing = makeApis({ deployments: [deployment('ws1', 1, 1)], services: [] })
    expect((await missing.provider.observe('ws1')).phase).toBe('error')

    const present = makeApis({
      deployments: [deployment('ws1', 1, 1)],
      services: [service('ws1')],
    })
    expect((await present.provider.observe('ws1')).phase).toBe('running')
  })

  it('observe: skips the Service read when the phase cannot be running', async () => {
    const stopped = makeApis({ deployments: [deployment('ws1', 0, 0)], services: [] })
    await stopped.provider.observe('ws1')
    expect(stopped.methods()).not.toContain('readNamespacedService')
  })
})

describe('stop releases the ClusterIP', () => {
  it('stop: deletes the Service, and start puts it back', async () => {
    const { provider, services } = makeApis({
      deployments: [deployment('ws1', 1, 1)],
      services: [service('ws1')],
    })
    await provider.stop('ws1', 'static')
    expect(services).toHaveLength(0)

    await provider.start('ws1', 'static')
    expect(services.map((s) => s.metadata?.name)).toEqual(['nap-ws1'])
  })

  it('stop: tolerates a Service that is already gone', async () => {
    const { provider } = makeApis({ deployments: [deployment('ws1', 1, 1)], services: [] })
    await expect(provider.stop('ws1', 'static')).resolves.toBeUndefined()
  })

  // The auto-scaling shape routes through a headless Service, which holds no
  // ClusterIP, so there is nothing to release on the way down.
  it('stop: releases nothing for the auto-scaling shape', async () => {
    const { provider, methods } = makeApis({ deployments: [], services: [] })

    await provider.stop('ws1', 'auto-scaling')

    expect(methods()).not.toContain('deleteNamespacedService')
  })
})

describe('converge paths repair a missing Service', () => {
  it('start: recreates the Service of a stopped workspace whose Service was reclaimed', async () => {
    const { provider, services, methods } = makeApis({
      deployments: [deployment('ws1', 0, 0)],
      services: [],
    })
    await provider.start('ws1', 'static')
    expect(methods()).toContain('createNamespacedService')
    expect(services.map((s) => s.metadata?.name)).toEqual(['nap-ws1'])
  })

  // A ClusterIP Service on the auto-scaling shape would burn an IP it never
  // routes with — and round-robin across replicas if anything used it.
  it('start: does not create a ClusterIP Service for the auto-scaling shape', async () => {
    const { provider, methods } = makeApis({ deployments: [], services: [] })

    await provider.start('ws1', 'auto-scaling')

    expect(methods()).not.toContain('createNamespacedService')
  })

  it('apply: recreates the Service of an existing workspace before rebuilding', async () => {
    const { provider, methods } = makeApis({
      deployments: [deployment('ws1', 1, 1)],
      services: [],
    })
    await provider.apply('ws1', {
      agentType: 'claude-code',
      resources: {},
      version: 1,
      runtimeMode: 'static',
    })
    expect(methods()).toContain('createNamespacedService')
  })
})

describe('creating a workspace orders the Service before the Deployment', () => {
  const freshSpec = {
    agentType: 'claude-code',
    resources: {},
    version: 1,
    runtimeMode: 'static',
  } as const

  it('creates the Service first', async () => {
    const { provider, methods } = makeApis({})
    await provider.apply('ws1', freshSpec)
    const order = methods()
    expect(order.indexOf('createNamespacedService')).toBeLessThan(
      order.indexOf('createNamespacedDeployment'),
    )
  })

  it('a full ClusterIP range leaves no Deployment behind', async () => {
    // The failure that started this: the Service could not be allocated. With
    // the Service first, no Deployment exists, so observe() says 'unknown' and
    // reconcile keeps retrying — instead of a running-but-unreachable workspace
    // that no drift trigger ever revisits.
    const { provider, deployments } = makeApis({ serviceCreateFails: true })
    await expect(provider.apply('ws1', freshSpec)).rejects.toThrow('range is full')
    expect(deployments).toHaveLength(0)
  })
})

// The auto-scaling shape converges its StatefulSet in place, so a restart or a
// rollout of a moving image tag only replaces pods if the template changes. The
// spec's restart token is that change; scaling carries the token over and must
// leave the template alone.
describe('auto-scaling restart token', () => {
  const autoScalingSpec = (restartToken?: string) => ({
    agentType: 'codex',
    resources: {},
    version: 1,
    runtimeMode: 'auto-scaling' as const,
    replicas: 2,
    ...(restartToken !== undefined ? { restartToken } : {}),
  })
  const templateOf = (sts: k8s.V1StatefulSet) => sts.spec?.template
  const patchedTemplate = (call: Call | undefined) =>
    (call?.args[0] as { spec: { template: k8s.V1PodTemplateSpec } }).spec.template

  it('stamps the token on the pod template of a new StatefulSet', async () => {
    const { provider, calls } = makeApis({ multiReplica: true })
    await provider.apply('ws1', autoScalingSpec('7'))
    const created = calls.find((c) => c.method === 'createNamespacedStatefulSet')
    const annotations = templateOf(created?.args[0] as k8s.V1StatefulSet)?.metadata?.annotations
    expect(annotations?.['agent-platform/restart-token']).toBe('7')
  })

  it('changes the template only when the token changes', async () => {
    const { provider, calls } = makeApis({ multiReplica: true })
    await provider.apply('ws1', autoScalingSpec('7'))
    const created = templateOf(
      calls.find((c) => c.method === 'createNamespacedStatefulSet')?.args[0] as k8s.V1StatefulSet,
    )
    await provider.apply('ws1', autoScalingSpec('7'))
    await provider.apply('ws1', autoScalingSpec('8'))
    const [same, restarted] = calls.filter((c) => c.method === 'patchNamespacedStatefulSet')
    expect(patchedTemplate(same)).toEqual(created)
    expect(
      patchedTemplate(restarted)?.metadata?.annotations?.['agent-platform/restart-token'],
    ).toBe('8')
  })
})

describe('drift reads cover both workload shapes', () => {
  const statefulSet = (wsId: string, image: string): k8s.V1StatefulSet =>
    ({
      metadata: {
        name: `nap-${wsId}`,
        labels: { 'workspace-id': wsId },
        annotations: { 'agent-platform/workspace-version': '8' },
      },
      spec: { replicas: 2, template: { spec: { containers: [{ name: 'agent', image }] } } },
    }) as unknown as k8s.V1StatefulSet

  it('getInstanceSpecMarkers falls back to the StatefulSet', async () => {
    const { provider } = makeApis({
      multiReplica: true,
      statefulSets: [statefulSet('ws1', 'nap-agent-codex:latest')],
    })
    expect(await provider.getInstanceSpecMarkers('ws1')).toEqual({
      templateVersion: 8,
      agentImage: 'nap-agent-codex:latest',
      hasMemoryFuseSidecar: false,
    })
  })

  it('listWorkspaceWorkloads returns Deployments and StatefulSets together', async () => {
    const { provider } = makeApis({
      multiReplica: true,
      deployments: [deployment('ws1', 1, 1)],
      statefulSets: [statefulSet('ws2', 'nap-agent-codex:latest')],
    })
    expect([...(await provider.listWorkspaceWorkloads()).keys()].sort()).toEqual(['ws1', 'ws2'])
  })

  it('listWorkspaceWorkloads skips the StatefulSet list where the shape cannot exist', async () => {
    const { provider, methods } = makeApis({ deployments: [deployment('ws1', 1, 1)] })
    expect([...(await provider.listWorkspaceWorkloads()).keys()]).toEqual(['ws1'])
    expect(methods()).not.toContain('listNamespacedStatefulSet')
  })
})
