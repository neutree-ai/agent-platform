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
  services?: k8s.V1Service[]
  serviceCreateFails?: boolean
}) {
  const calls: Call[] = []
  const services = [...(opts.services ?? [])]
  const deployments = [...(opts.deployments ?? [])]
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
    readNamespacedStatefulSet: async () => {
      throw apiError(404)
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

  const provider = new KubernetesProvider(appsApi, coreApi, {} as k8s.KubeConfig, cfg)
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
