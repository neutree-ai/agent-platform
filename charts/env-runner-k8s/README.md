# env-runner-k8s (remote BYOI runner)

Run agent-platform workspaces in **your own** Kubernetes cluster. The runner
connects **outbound** to the control plane — pull-only, token-authenticated, no
inbound access to your cluster — reconciles workspace pods locally, and tunnels
control-plane traffic over that one connection.

## Prerequisites

1. Register an environment on the platform (UI: **Environments → New**), note its
   id, and issue a **runner token** for it (**Environments → Tokens**).
2. Know your cluster's agent image settings (ask your platform operator):
   `agentImagePrefix`, `agentImageTag`, `memoryFuseImage`, a `storageClass`.

## Install

```bash
helm install my-env ./charts/env-runner-k8s \
  --namespace agent-runner --create-namespace \
  --set controlPlane.url=https://platform.example.com \
  --set envToken.token=env_xxxxxxxx \
  --set provider.storageClass=standard
```

Or with an existing Secret holding the token under key `token`:

```bash
--set envToken.existingSecret=my-env-token
```

Once running, the environment shows **online** on the platform (heartbeat), and
you can create workspaces on it.

## What it supports

- **persistentMemory** — yes (set `provider.memoryFuseImage`); memory tunnels
  back to the control plane, no extra infra in your cluster.
- **sharedFs (afs)** — not yet on remote environments; the runner advertises
  `sharedFs=false` and the platform won't place afs-requiring workspaces here.

## Notes

- One replica (the runner mutates cluster state; the chart uses `Recreate`).
- Only outbound HTTPS/WSS to `controlPlane.url` is required.
- RBAC is namespace-scoped to the release namespace (pods/services/pvc +
  deployments). Workspaces are created in `provider.namespace`.
