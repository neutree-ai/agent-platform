import { describe, expect, it } from 'vitest'
import type { ComputeResources } from '../../../internal/types/api'
import { type K8sConfig, buildDeploymentSpec } from './k8s'

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
