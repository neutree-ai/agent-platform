import type * as k8s from '@kubernetes/client-node'
import { describe, expect, it } from 'vitest'
import { buildWorkspacePodTemplate } from '../../../internal/k8s-provider'
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
  namePrefix: 'tos',
  agentImagePrefix: 'nap-agent',
  agentImageTag: 'latest',
  storageClass: 'nfs-csi',
  imagePullSecret: '',
  nodeSelector: undefined,
  workspaceStorageSize: '10Gi',
  cpServiceUrl: 'http://nap-cp:3000',
  memoryFuseImage: '',
  afs: {
    enabled: false,
    image: '',
    controllerAddr: 'afs-controller.nap.svc:9100',
    fuseServerAddr: '127.0.0.1:9101',
    storagePvc: 'afs-shared-storage',
    configMap: 'afs-fuse-config',
  },
}

const labels = { app: 'tos', component: 'workspace', 'workspace-id': 'ws1' }
const args = ['tos-ws1', labels, 'ws1', 'claude-code', 'tos-ws1-workspace'] as const

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
      'tos-ws1-workspace',
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
      'tos-ws1-workspace',
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
