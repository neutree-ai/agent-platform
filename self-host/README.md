# Neutree Agent Platform — Self-Hosted (Connected)

This is the **connected / online** self-host installer. It assumes the target
Kubernetes cluster can reach the public internet: container images are pulled
directly from public registries (ghcr.io / docker.io / registry.k8s.io) and
prerequisite charts/manifests are fetched from their public sources. There is
no offline image bundle, no in-cluster registry, and no host image-loading step.

> For fully air-gapped / offline sites, use the separate offline installer
> (which ships an image tarball, an in-cluster registry, and a host-prep step).

The **minimal install** brings up the core platform only. The Code Sandbox and
Remote Browser capabilities are **optional and off by default** — enable them
later (see [Optional capabilities](#optional-capabilities)) without reinstalling.

## One-line install

`get.sh` wraps the whole flow below — download, secrets, values.env, install —
into a single command. Configuration lands in `/opt/nap/values.env`; re-running
the same line refreshes the installer and upgrades in place.

**No Kubernetes yet** — a bare Linux host; installs k3s (plus helm / envsubst
if missing), autodetects the node IP, generates the admin password and prints
the login URL + credentials at the end:

```bash
curl -sfL https://nap.docs.neutree.ai/get.sh | sudo sh -
```

**Existing Kubernetes cluster** — uses your current kubeconfig; you must name
the host users reach the platform at and an RWX storage backend (external NFS,
or a pre-existing RWX StorageClass):

```bash
curl -sfL https://nap.docs.neutree.ai/get.sh \
  | sh -s -- --k8s --host=<ip-or-hostname> --nfs-server=<ip> --nfs-path=</export/path>
# or with an existing RWX StorageClass:
#   ... | sh -s -- --k8s --host=<ip-or-hostname> --storage-class=<rwx-storageclass>
```

Useful knobs: `NAP_HOST` / `NAP_ADMIN_PASSWORD` env overrides,
`--version=<tag>` to pin a release, `--dir=` to relocate the install dir, and
`--prepare-only` to generate `values.env` for review and install on the next
run. `get.sh --help` lists everything.

Everything below is the manual path — the same steps, under your control.

## Prerequisites

- A Kubernetes cluster (multi-node) **or** a single k3s node (single-node profile).
- The cluster nodes can pull from `ghcr.io`, `docker.io`, and `registry.k8s.io`.
- On the machine running the installer: `kubectl`, `envsubst`, `helm`, `openssl`.
- A kubeconfig for the target cluster.

## Quick start (multi-node / full profile)

```bash
git clone <this-repo> && cd self-host        # or download + extract
cp values.env.example values.env
./gen-secrets.sh                              # fills random machine secrets
vi values.env                                 # set NAP_HOST, ADMIN_PASSWORD, storage, etc.
./install.sh
```

`install.sh` will:

1. Install the prerequisites (CloudNativePG operator, NFS subdir provisioner)
   from their public upstream sources.
2. Render the manifests with your `values.env` and apply them.
3. Seed the admin user, OAuth clients, and the MCP catalog via one-shot Jobs.

When it finishes, open `http://<NAP_HOST>:<NAP_NODE_PORT>` and log in with the
admin username / password from `values.env`.

## Single-node profile

A single k3s node, pulling images straight from the public registry. Same as
the full profile except `PG_INSTANCES=1` and an **in-cluster NFS server** for
RWX storage (a single node has no external NFS). It does **not** bring up an
in-cluster registry and does **not** load any tarball.

```bash
cp values.env.single-node.example values.env
./gen-secrets.sh
vi values.env                                 # set NAP_HOST + ADMIN_PASSWORD
./install.sh --profile=single-node
```

Run this on a host that has a working k3s and a kubeconfig at
`/etc/rancher/k3s/k3s.yaml` (the default in the single-node example).

## Configuration

Everything is driven by `values.env`. Key knobs:

| Setting | Purpose |
| --- | --- |
| `REGISTRY` | Public registry path that holds all first-party images (`${REGISTRY}/<svc>:<tag>`). Default points at the official public registry; override only to use a mirror. |
| `IMAGE_TAG` | Tag for all first-party images. `latest` by default; pin to a release tag for reproducibility. |
| `NAP_HOST` / `NAP_NODE_PORT` | Where users reach the web UI. |
| `INGRESS_MODE` | `nodeport` (default) or `external` (your own ingress fronts the HTTP services; nodePort lines are stripped). |
| `PG_*` / `NFS_*` | PostgreSQL and shared-storage settings. |
| `SANDBOX_ENABLED` / `BROWSER_ENABLED` / `LDAP_ENABLED` | Optional capabilities, all off by default. |

See the comments in `values.env.example` for the full list.

## Optional capabilities

Both are decoupled from the core install — enable either one at any time by
editing `values.env` and re-running `./install.sh` (it's idempotent).

### Remote Browser

Lets agents drive a real browser that users watch live over WebRTC. NAP ships
the browser service and a bundled TURN relay (coturn); enabling it is just
configuration. The headful Chromium itself runs from a published image
(`${REGISTRY}/chromium-headful`) built from the upstream
[onkernel/kernel-images](https://github.com/onkernel/kernel-images) project
(Apache-2.0; see [NOTICE](../NOTICE)) — no extra setup on your side.

1. In `values.env` set:
   ```bash
   BROWSER_ENABLED=true
   TURN_HOST=<LAN/WAN IP browsers can reach>   # the node's reachable IP
   # gen-secrets.sh already filled BROWSER_JWT_SECRET / TURN_AUTH_SECRET
   ```
2. Re-run `./install.sh`. It deploys `nap-browser` + `coturn` and registers the
   browser OAuth client.

### Enabling Code Sandbox

Lets agents run code and serve temporary web previews. This is powered by
**OpenSandbox** (github.com/alibaba/OpenSandbox), a **third-party** component
that NAP does **not** install for you — you install it from its upstream Helm
charts, then point NAP at it.

> Why separate: OpenSandbox does not publish an installable umbrella/server
> chart as a release asset; the official path is to install from a source
> checkout. Keeping it out of NAP's installer avoids coupling the core install
> to that flow.

1. **Install OpenSandbox** (controller + server) per its official method —
   clone the repo and `helm install` the umbrella chart from source:
   ```bash
   git clone https://github.com/alibaba/OpenSandbox && cd OpenSandbox/kubernetes/charts
   helm dependency build opensandbox
   helm install opensandbox ./opensandbox \
     --namespace nap --create-namespace \
     -f <path-to>/optional/sandbox/opensandbox-values.yaml
   ```
   `optional/sandbox/opensandbox-values.yaml` is a ready-to-use reference: it
   pins the public Docker Hub images (the chart defaults to Alibaba ACR) and
   runs OpenSandbox in the `nap` namespace so NAP's default `OPENSANDBOX_URL`
   resolves. Adjust the namespace there if NAP runs elsewhere.

2. **Mount NAP's sandbox pod template** so OpenSandbox spawns sandbox workloads
   the way NAP expects:
   ```bash
   kubectl -n nap create configmap opensandbox-sandbox-template \
     --from-file=sandbox-template.yaml=optional/sandbox/batchsandbox-template.yaml
   ```
   The reference `opensandbox-values.yaml` already points
   `batchsandbox_template_file` at `/etc/opensandbox/sandbox-template.yaml`;
   mount the configmap there on `opensandbox-server` (volume + volumeMount), or
   bake it into your OpenSandbox values.

3. **Enable it in NAP.** In `values.env`:
   ```bash
   SANDBOX_ENABLED=true
   # OPENSANDBOX_URL: leave blank if OpenSandbox runs in NAP's namespace;
   # otherwise set e.g. http://opensandbox-server.opensandbox-system.svc:80
   # gen-secrets.sh already filled SANDBOX_JWT_SECRET / SANDBOX_SERVICE_KEY
   ```
4. Re-run `./install.sh`. It deploys `nap-sandbox` (which talks to OpenSandbox
   at `OPENSANDBOX_URL`) and registers the sandbox OAuth client. NAP does not
   touch OpenSandbox itself.

## Installer modes

```bash
./install.sh                  # full install (prereqs + manifests + seed)
./install.sh --prereqs-only   # only CNPG + NFS provisioner
./install.sh --manifests-only # only render + apply k8s manifests
./install.sh --seed-only      # only seed admin / OAuth clients / MCP
./install.sh --render-only    # render manifests to rendered/ without applying
```

## Documentation

This README plus the inline comments in `values.env.example` are the reference
for configuration and the optional capabilities. A hosted docs site (deployment,
upgrade, and operations guides) is planned.
