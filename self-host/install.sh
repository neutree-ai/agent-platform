#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# Neutree Agent Platform — Self-Hosted Installer (CONNECTED variant)
# ============================================================================
# This is the connected / online installer: the target cluster MUST be able to
# reach the public internet. Images are pulled directly from a public registry
# and prereq charts/manifests are fetched from their public sources. There is
# no offline image bundle, no in-cluster registry, no HTTP registry mirror.
# (For air-gapped / offline sites, use the separate offline "super" installer.)
#
# Usage:
#   ./install.sh                  # Full install (prereqs + manifests + seed admin)
#   ./install.sh --prereqs-only   # Only install CNPG operator + NFS provisioner
#   ./install.sh --manifests-only # Only render + apply k8s manifests
#   ./install.sh --seed-only      # Only seed admin user (via K8s Job)
#   ./install.sh --render-only    # Only render manifests to rendered/ (dry run)
#
# Single-node profile (DEPLOY_PROFILE=single-node in values.env, or
#   --profile=single-node CLI flag):
#   A 1-node k3s that pulls images straight from the public registry — exactly
#   like the full profile, just PG_INSTANCES=1 and an in-cluster NFS server for
#   RWX (no external NFS available on a single node). It brings up NO in-cluster
#   registry and loads NO tarball.
#
# Prerequisites:
#   - kubectl, envsubst on the machine running this script
#   - helm (only if the NFS provisioner isn't pre-installed)
#   - the cluster nodes can reach ghcr.io / docker.io / registry.k8s.io
#   - values.env filled in from values.env.example

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RENDERED_DIR="$SCRIPT_DIR/rendered"

# --- Load configuration ---------------------------------------------------

VALUES_FILE="${VALUES_FILE:-$SCRIPT_DIR/values.env}"

if [ ! -f "$VALUES_FILE" ]; then
  echo "ERROR: $VALUES_FILE not found."
  echo "Copy values.env.example to values.env and fill in your configuration."
  exit 1
fi

# Source values (export all for envsubst)
set -a
source "$VALUES_FILE"
set +a

# --- Image registry --------------------------------------------------------
# Every first-party service image lives as a sub-path under one public registry
# path, e.g. ghcr.io/neutree-ai/agent-platform/nap-cp:<tag>. Third-party images
# (postgres, coturn, gotenberg, language runtimes, …) are pulled from their own
# upstream public locations and are hardcoded in the manifests, not under
# ${REGISTRY}.
export REGISTRY="${REGISTRY:-ghcr.io/neutree-ai/agent-platform}"
# Tag applied to every first-party image. Default :latest; pin to a release tag
# for reproducible installs.
export IMAGE_TAG="${IMAGE_TAG:-latest}"

# Resolve AGENT_IMAGE_PREFIX if it references REGISTRY
AGENT_IMAGE_PREFIX="${AGENT_IMAGE_PREFIX:-${REGISTRY}/nap-agent}"
export AGENT_IMAGE_PREFIX

export KUBECONFIG="${KUBECONFIG:-./kubeconfig.yaml}"

export ADMIN_DISPLAY_NAME="${ADMIN_DISPLAY_NAME:-Admin}"
export AGENT_STORAGE_CLASS="${AGENT_STORAGE_CLASS:-nfs-csi}"
export AFS_STORAGE_SIZE="${AFS_STORAGE_SIZE:-500Gi}"
export AGENT_NODE_SELECTOR="${AGENT_NODE_SELECTOR:-}"

export DEPLOY_PROFILE="${DEPLOY_PROFILE:-multi-node}"
# Backing PVC size for the in-cluster NFS server (single-node only).
export SINGLE_NODE_NFS_SIZE="${SINGLE_NODE_NFS_SIZE:-100Gi}"

# CNPG requires maxSyncReplicas < instances. Single-instance clusters can't
# do sync replication, so set both bounds to 0 there.
if [ "${PG_INSTANCES:-3}" = "1" ]; then
  export PG_SYNC_REPLICAS="${PG_SYNC_REPLICAS:-0}"
else
  export PG_SYNC_REPLICAS="${PG_SYNC_REPLICAS:-1}"
fi

# --- Optional modules — all default off; user opts in via values.env ---
# Toggle keys; everything else under the same module is gated on these.
export SANDBOX_ENABLED="${SANDBOX_ENABLED:-false}"
export BROWSER_ENABLED="${BROWSER_ENABLED:-false}"
export LDAP_ENABLED="${LDAP_ENABLED:-false}"
# COTURN bundled with browser — mirrors BROWSER_ENABLED, no separate toggle.
export COTURN_ENABLED="$BROWSER_ENABLED"

# --- Ingress mode --------------------------------------------------------
# INGRESS_MODE controls how nap-cp / nap-browser / nap-sandbox are exposed:
#   nodeport  (default) — Service type NodePort, *_NODE_PORT applied
#   external             — Service type ClusterIP, customer's own ingress
#                          fronts these services. nodePort lines are stripped
#                          from the rendered manifests because ClusterIP
#                          services reject the nodePort field.
# TURN/coturn is always hostPort UDP — ingress doesn't apply.
export INGRESS_MODE="${INGRESS_MODE:-nodeport}"
case "$INGRESS_MODE" in
  nodeport) export SERVICE_TYPE="NodePort" ;;
  external) export SERVICE_TYPE="ClusterIP" ;;
  *) echo "ERROR: INGRESS_MODE must be 'nodeport' or 'external' (got: $INGRESS_MODE)" >&2; exit 1 ;;
esac

# Sandbox module
export SANDBOX_NODE_PORT="${SANDBOX_NODE_PORT:-30086}"
export SANDBOX_JWT_SECRET="${SANDBOX_JWT_SECRET:-}"
export SANDBOX_SERVICE_KEY="${SANDBOX_SERVICE_KEY:-}"
export SANDBOX_DOMAIN="${SANDBOX_DOMAIN:-}"
export SANDBOX_NODE_SELECTOR="${SANDBOX_NODE_SELECTOR:-}"
# In-cluster URL of the (separately-installed) OpenSandbox server. Defaults to
# the server svc in this namespace; override if you install OpenSandbox into its
# own namespace (e.g. http://opensandbox-server.opensandbox-system.svc:80).
export OPENSANDBOX_URL="${OPENSANDBOX_URL:-http://opensandbox-server.${NAMESPACE}.svc:80}"
# Public URL users (and the OAuth callback) reach sandbox at. Override when
# external ingress / a custom domain fronts the service; empty derives the
# NodePort form (unchanged behavior).
export SANDBOX_PUBLIC_URL="${SANDBOX_PUBLIC_URL:-}"

# Browser + TURN module
export BROWSER_NODE_PORT="${BROWSER_NODE_PORT:-30085}"
export BROWSER_JWT_SECRET="${BROWSER_JWT_SECRET:-}"
export TURN_HOST="${TURN_HOST:-}"
export TURN_PORT="${TURN_PORT:-3478}"
export TURN_AUTH_SECRET="${TURN_AUTH_SECRET:-}"
export COTURN_NODE_SELECTOR="${COTURN_NODE_SELECTOR:-}"
# Public URL users (and the OAuth callback) reach the browser service at.
# Same override semantics as SANDBOX_PUBLIC_URL.
export BROWSER_PUBLIC_URL="${BROWSER_PUBLIC_URL:-}"

# --- Service public URLs + OAuth redirect URIs ---------------------------
# The URL each service computes its own /api/auth/callback from MUST match the
# redirect_uri registered in oauth_clients, or cp returns 400 invalid_client.
# Resolve both from a single source here so they can't drift. PUBLIC_URL wins;
# otherwise derive the NodePort form (the value baked into the manifests before
# this override existed).
if [ -n "$SANDBOX_PUBLIC_URL" ]; then
  export SANDBOX_SERVICE_URL_RESOLVED="$SANDBOX_PUBLIC_URL"
else
  export SANDBOX_SERVICE_URL_RESOLVED="http://${TOS_HOST}:${SANDBOX_NODE_PORT}"
fi
if [ -n "$BROWSER_PUBLIC_URL" ]; then
  export BROWSER_SERVICE_URL_RESOLVED="$BROWSER_PUBLIC_URL"
else
  export BROWSER_SERVICE_URL_RESOLVED="http://${TOS_HOST}:${BROWSER_NODE_PORT}"
fi
# Redirect URIs feed the seed-oauth-clients job; empty when the module is off,
# so the seed script skips that client.
if [ "$SANDBOX_ENABLED" = "true" ]; then
  export SANDBOX_OAUTH_REDIRECT_URI="${SANDBOX_SERVICE_URL_RESOLVED}/api/auth/callback"
else
  export SANDBOX_OAUTH_REDIRECT_URI=""
fi
if [ "$BROWSER_ENABLED" = "true" ]; then
  export BROWSER_OAUTH_REDIRECT_URI="${BROWSER_SERVICE_URL_RESOLVED}/api/auth/callback"
else
  export BROWSER_OAUTH_REDIRECT_URI=""
fi

# LDAP module — clear all fields when disabled so cp can't pick up stale vals.
if [ "$LDAP_ENABLED" != "true" ]; then
  export LDAP_URL=""
  export LDAP_BIND_DN=""
  export LDAP_BIND_PASSWORD=""
  export LDAP_SEARCH_BASE=""
  export LDAP_SEARCH_FILTER=""
  export LDAP_ATTR_USERNAME=""
  export LDAP_ATTR_NAME=""
  export LDAP_ATTR_EMAIL=""
else
  export LDAP_URL="${LDAP_URL:-}"
  export LDAP_BIND_DN="${LDAP_BIND_DN:-}"
  export LDAP_BIND_PASSWORD="${LDAP_BIND_PASSWORD:-}"
  export LDAP_SEARCH_BASE="${LDAP_SEARCH_BASE:-}"
  # Schema overrides — leave empty to use cp defaults
  # (filter=(objectClass=inetOrgPerson), username=sn, name=cn, email=mail).
  export LDAP_SEARCH_FILTER="${LDAP_SEARCH_FILTER:-}"
  export LDAP_ATTR_USERNAME="${LDAP_ATTR_USERNAME:-}"
  export LDAP_ATTR_NAME="${LDAP_ATTR_NAME:-}"
  export LDAP_ATTR_EMAIL="${LDAP_ATTR_EMAIL:-}"
fi

# --- Prereq version pins ---------------------------------------------------
# Kept identical to the offline installer so both flavors track the same
# validated upstream versions.
CNPG_VERSION="1.28.1"
NFS_PROVISIONER_VERSION="v4.0.2"

# --- Helpers ---------------------------------------------------------------

log()  { echo "==> $*"; }
warn() { echo "WARNING: $*" >&2; }

# Server-side apply with force-conflicts: install.sh is the source of truth,
# always overwrite fields owned by other managers (e.g. previous client-side
# applies, manual kubectl edits, helm). Use this for every kubectl apply.
kapply() { kubectl apply --server-side --force-conflicts "$@"; }
die()  { echo "ERROR: $*" >&2; exit 1; }

check_prereqs() {
  local missing=()
  for cmd in kubectl envsubst; do
    command -v "$cmd" &>/dev/null || missing+=("$cmd")
  done
  if [ ${#missing[@]} -gt 0 ]; then
    die "Missing required tools: ${missing[*]}"
  fi
}

# --- Render templates ------------------------------------------------------

render_manifests() {
  log "Rendering manifests to $RENDERED_DIR ..."
  rm -rf "$RENDERED_DIR"
  mkdir -p "$RENDERED_DIR"

  # Explicit variable list — prevents envsubst from replacing k8s $(VAR)
  # references like $(POSTGRES_PASSWORD)
  local VARS='${NAMESPACE}${REGISTRY}${IMAGE_TAG}${TOS_HOST}${TOS_NODE_PORT}'
  VARS+='${PG_USERNAME}${PG_PASSWORD}${PG_INSTANCES}${PG_STORAGE_SIZE}${PG_STORAGE_CLASS}'
  VARS+='${NFS_SERVER}${NFS_PATH}${NFS_STORAGE_CLASS}'
  VARS+='${JWT_SECRET}${CREDENTIAL_ENCRYPTION_KEY}'
  VARS+='${AGENT_IMAGE_PREFIX}${AGENT_IMAGE_TAG}${AGENT_STORAGE_CLASS}${AGENT_NODE_SELECTOR}'
  VARS+='${LDAP_URL}${LDAP_BIND_DN}${LDAP_BIND_PASSWORD}${LDAP_SEARCH_BASE}'
  VARS+='${LDAP_SEARCH_FILTER}${LDAP_ATTR_USERNAME}${LDAP_ATTR_NAME}${LDAP_ATTR_EMAIL}'
  VARS+='${ADMIN_USERNAME}${ADMIN_PASSWORD}${ADMIN_DISPLAY_NAME}'
  VARS+='${BROWSER_NODE_PORT}${BROWSER_JWT_SECRET}'
  VARS+='${SANDBOX_NODE_PORT}${SANDBOX_JWT_SECRET}${SANDBOX_SERVICE_KEY}${SANDBOX_DOMAIN}${OPENSANDBOX_URL}'
  VARS+='${SANDBOX_SERVICE_URL_RESOLVED}${BROWSER_SERVICE_URL_RESOLVED}'
  VARS+='${SANDBOX_OAUTH_REDIRECT_URI}${BROWSER_OAUTH_REDIRECT_URI}'
  VARS+='${TURN_HOST}${TURN_PORT}${TURN_AUTH_SECRET}'
  VARS+='${AFS_STORAGE_SIZE}'
  VARS+='${SERVICE_TYPE}'
  VARS+='${PG_SYNC_REPLICAS}'
  VARS+='${SINGLE_NODE_NFS_SIZE}'

  for tmpl in "$SCRIPT_DIR"/manifests/*.yaml; do
    local name
    name=$(basename "$tmpl")
    envsubst "$VARS" < "$tmpl" > "$RENDERED_DIR/$name"
    log "  rendered $name"
  done

  # External ingress mode: strip `nodePort:` lines from Service specs.
  # k8s rejects nodePort on ClusterIP, but we keep the value in values.env
  # so a later switch back to nodeport mode just works.
  if [ "$INGRESS_MODE" = "external" ]; then
    for f in control-plane.yaml browser-service.yaml sandbox-service.yaml; do
      [ -f "$RENDERED_DIR/$f" ] || continue
      # BSD sed (macOS) and GNU sed both honor -i with '' / no arg differently.
      # Use a portable two-step (tmp + mv) to avoid quoting headaches.
      sed '/^[[:space:]]*nodePort:[[:space:]]/d' "$RENDERED_DIR/$f" > "$RENDERED_DIR/$f.tmp"
      mv "$RENDERED_DIR/$f.tmp" "$RENDERED_DIR/$f"
    done
    log "  INGRESS_MODE=external — stripped nodePort lines from Service specs"
  fi

  log "Manifests rendered to $RENDERED_DIR/"
}

# --- helpers for upgrade-time field-conflict situations --------------------

# v4 changed coturn + afs-controller to `strategy: type: Recreate`. If a
# pre-existing Deployment (e.g. from a v3 install) has the default
# RollingUpdate strategy, server-side apply leaves the old
# `spec.strategy.rollingUpdate` field behind, which validation rejects as
# "Forbidden: may not be specified when strategy `type` is 'Recreate'".
# Detect and delete the conflicting Deployment so apply re-creates it
# cleanly. PVCs and Services are untouched.
ensure_recreate_strategy() {
  local dep="$1"
  local existing
  existing=$(kubectl -n "${NAMESPACE}" get deployment "$dep" -o jsonpath='{.spec.strategy.type}' 2>/dev/null || echo "")
  if [ -n "$existing" ] && [ "$existing" != "Recreate" ]; then
    log "  $dep currently has strategy.type=$existing; deleting so v4 manifest (Recreate) applies cleanly"
    kubectl -n "${NAMESPACE}" delete deployment "$dep" --wait=true --ignore-not-found=true
  fi
}

# --- coturn (TURN server) --------------------------------------------------

# Patch the rendered coturn manifest with optional nodeSelector, apply, wait
# for the pod, and confirm TURN_HOST.
apply_coturn() {
  if [ "$BROWSER_ENABLED" != "true" ]; then
    log "BROWSER_ENABLED=false — skipping coturn (browser-only)."
    return 0
  fi
  if [ "$COTURN_ENABLED" != "true" ]; then
    log "COTURN_ENABLED=false — skipping coturn deployment."
    return 0
  fi
  if [ -z "$TURN_AUTH_SECRET" ]; then
    die "COTURN_ENABLED=true but TURN_AUTH_SECRET is empty — generate one with: openssl rand -hex 32"
  fi
  if [ -z "$TURN_HOST" ]; then
    die "COTURN_ENABLED=true but TURN_HOST is empty — set it explicitly in values.env (kubelet auto-detect is unreliable on multi-NIC nodes; use the LAN IP browsers can reach, e.g. 192.168.x.x)"
  fi

  log "Deploying coturn ..."
  ensure_recreate_strategy coturn
  kapply -f "$RENDERED_DIR/coturn.yaml"

  # nodeSelector + matching tolerations (so tainted nodes still accept)
  if [ -n "$COTURN_NODE_SELECTOR" ]; then
    local ns_json="{"
    local first=true
    IFS=',' read -ra PAIRS <<< "$COTURN_NODE_SELECTOR"
    for pair in "${PAIRS[@]}"; do
      local k="${pair%%=*}" v="${pair#*=}"
      $first || ns_json+=","
      ns_json+="\"$k\":\"$v\""
      first=false
    done
    ns_json+="}"
    kubectl -n "${NAMESPACE}" patch deployment coturn \
      -p "{\"spec\":{\"template\":{\"spec\":{\"nodeSelector\":$ns_json,\"tolerations\":[{\"operator\":\"Exists\"}]}}}}"
  fi

  log "Waiting for coturn pod to be ready ..."
  kubectl -n "${NAMESPACE}" rollout status deployment/coturn --timeout=120s || {
    warn "coturn not ready within 120s — check: kubectl -n ${NAMESPACE} describe deploy coturn"
    return 0
  }

  log "Using configured TURN_HOST=$TURN_HOST"
}

# --- Install prereqs -------------------------------------------------------

install_cnpg_operator() {
  log "Installing CloudNativePG operator v${CNPG_VERSION} ..."
  # Connected variant: always fetch the operator manifest from GitHub. The
  # manifest already references CNPG's public GHCR image, so there's no
  # registry re-point step.
  kapply -f \
    "https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/release-${CNPG_VERSION%.*}/releases/cnpg-${CNPG_VERSION}.yaml"

  kubectl rollout status deployment -n cnpg-system cnpg-controller-manager --timeout=180s
  log "CNPG operator ready."
}

install_nfs_provisioner() {
  # Skip if the StorageClass already exists (e.g., pre-provisioned by the cluster)
  if kubectl get storageclass "${NFS_STORAGE_CLASS}" &>/dev/null; then
    log "NFS StorageClass '${NFS_STORAGE_CLASS}' already exists, skipping provisioner install."
    return 0
  fi

  # Single-node profile: bring up the in-cluster NFS server first; the
  # provisioner pod will CrashLoopBackOff if it can't mount on first start.
  if [ "$DEPLOY_PROFILE" = "single-node" ]; then
    log "Deploying in-cluster NFS server (nap-nfs-server) ..."
    render_manifests
    kapply -f "$RENDERED_DIR/namespace.yaml"
    kapply -f "$RENDERED_DIR/nfs-server.yaml"
    kubectl -n "${NAMESPACE}" rollout status deployment/nap-nfs-server --timeout=180s || {
      die "nap-nfs-server not ready; check: kubectl -n ${NAMESPACE} describe deploy nap-nfs-server"
    }

    # Resolve the svc clusterIP and feed it to NFS_SERVER. We can't use the
    # DNS name (nap-nfs-server.<ns>.svc.cluster.local) because the actual
    # `mount -t nfs` is issued by kubelet on the host, whose /etc/resolv.conf
    # doesn't point at coredns — the lookup fails and the mount times out
    # with EAGAIN. ClusterIP is stable for the lifetime of the svc.
    local nfs_svc_ip
    nfs_svc_ip=$(kubectl -n "${NAMESPACE}" get svc nap-nfs-server -o jsonpath='{.spec.clusterIP}')
    [ -n "$nfs_svc_ip" ] || die "nap-nfs-server svc has no clusterIP"
    export NFS_SERVER="$nfs_svc_ip"
    export NFS_PATH="/"
    log "Resolved in-cluster NFS server at ${NFS_SERVER}:${NFS_PATH}"
  fi

  log "Installing NFS provisioner (server=${NFS_SERVER}, path=${NFS_PATH}) ..."

  if ! command -v helm &>/dev/null; then
    die "helm is required to install NFS provisioner. Install helm or pre-install the provisioner."
  fi

  # Connected variant: always add the upstream helm repo and install from it.
  # The chart's default image (registry.k8s.io/sig-storage/...) is public, so
  # no registry re-point step is needed.
  helm repo add nfs-subdir-external-provisioner \
    https://kubernetes-sigs.github.io/nfs-subdir-external-provisioner/ 2>/dev/null || true
  helm repo update nfs-subdir-external-provisioner

  helm upgrade --install --force nfs-subdir-external-provisioner \
    nfs-subdir-external-provisioner/nfs-subdir-external-provisioner \
    --namespace "${NAMESPACE}" --create-namespace \
    --set nfs.server="${NFS_SERVER}" \
    --set nfs.path="${NFS_PATH}" \
    --set image.tag="${NFS_PROVISIONER_VERSION}" \
    --set storageClass.name="${NFS_STORAGE_CLASS}" \
    --set storageClass.reclaimPolicy=Delete \
    --set storageClass.archiveOnDelete=true \
    --set storageClass.volumeBindingMode=Immediate \
    --set storageClass.allowVolumeExpansion=true \
    --set 'storageClass.mountOptions={vers=4.1,rsize=1048576,wsize=1048576,hard,timeo=600,retrans=2,noresvport}'

  log "NFS provisioner installed. StorageClass: ${NFS_STORAGE_CLASS}"
}

install_prereqs() {
  install_cnpg_operator
  install_nfs_provisioner
  # Code Sandbox is an optional, decoupled capability. OpenSandbox is NOT
  # installed by this script — it's a third-party component you install
  # yourself via its official Helm charts. See README "Enabling Code Sandbox".
  if [ "$SANDBOX_ENABLED" = "true" ]; then
    log "SANDBOX_ENABLED=true — assuming OpenSandbox is already installed and reachable"
    log "  at OPENSANDBOX_URL (see README 'Enabling Code Sandbox'). Deploying nap-sandbox only."
  fi
}

# --- Apply manifests -------------------------------------------------------

apply_manifests() {
  render_manifests

  log "Applying manifests to namespace ${NAMESPACE} ..."

  # Order matters: namespace → secrets → postgres → services
  kapply -f "$RENDERED_DIR/namespace.yaml"
  kapply -f "$RENDERED_DIR/secrets.yaml"

  log "Creating PostgreSQL cluster ..."
  kapply -f "$RENDERED_DIR/postgres.yaml"
  log "Waiting for PostgreSQL cluster to be ready (this may take a few minutes) ..."
  # Use the fully-qualified resource name: the bare `cluster` short name is
  # ambiguous if the target cluster also has Cluster API CRDs installed
  # (clusters.cluster.x-k8s.io), in which case kubectl resolves to the wrong group.
  kubectl -n "${NAMESPACE}" wait cluster.postgresql.cnpg.io/nap-pg --for=condition=Ready --timeout=300s || {
    warn "PostgreSQL cluster not ready within 300s — check: kubectl -n ${NAMESPACE} describe cluster.postgresql.cnpg.io nap-pg"
    warn "Continuing anyway; services will retry DB connections."
  }

  # coturn needs the nap-browser-secret (TURN_AUTH_SECRET) but must be applied
  # before browser-service so we can resolve TURN_HOST from its hostIP.
  apply_coturn
  # Re-render so browser-service picks up the resolved TURN_HOST.
  render_manifests

  kapply -f "$RENDERED_DIR/channel-gateway.yaml"
  kapply -f "$RENDERED_DIR/scheduler.yaml"
  kapply -f "$RENDERED_DIR/skills-content-service.yaml"
  kapply -f "$RENDERED_DIR/control-plane.yaml"
  if [ "$SANDBOX_ENABLED" = "true" ]; then
    kapply -f "$RENDERED_DIR/sandbox-service.yaml"
    kapply -f "$RENDERED_DIR/sandbox-image-warmer.yaml"
  else
    log "SANDBOX_ENABLED=false — skipping sandbox-service."
    kubectl -n "${NAMESPACE}" delete deployment/nap-sandbox service/nap-sandbox \
      --ignore-not-found=true
    kubectl -n "${NAMESPACE}" delete daemonset/sandbox-image-warmer \
      --ignore-not-found=true
  fi
  if [ "$BROWSER_ENABLED" = true ]; then
    kapply -f "$RENDERED_DIR/browser-service.yaml"
  else
    log "BROWSER_ENABLED=false — skipping browser-service."
    # Remove a browser-service left over from a previous install/run.
    kubectl -n "${NAMESPACE}" delete deployment/nap-browser service/nap-browser \
      --ignore-not-found=true
  fi
  ensure_recreate_strategy afs-controller
  kapply -f "$RENDERED_DIR/afs.yaml"
  kapply -f "$RENDERED_DIR/office-converter.yaml"
  if [ "$SANDBOX_ENABLED" = "true" ] && [ -n "$SANDBOX_NODE_SELECTOR" ]; then
    # Convert "key1=val1,key2=val2" to JSON nodeSelector
    local ns_json="{"
    local first=true
    IFS=',' read -ra PAIRS <<< "$SANDBOX_NODE_SELECTOR"
    for pair in "${PAIRS[@]}"; do
      local k="${pair%%=*}" v="${pair#*=}"
      $first || ns_json+=","
      ns_json+="\"$k\":\"$v\""
      first=false
    done
    ns_json+="}"
    kubectl -n "${NAMESPACE}" patch daemonset sandbox-image-warmer \
      -p "{\"spec\":{\"template\":{\"spec\":{\"nodeSelector\":$ns_json}}}}"
    log "  Applied SANDBOX_NODE_SELECTOR to image warmer"
  fi

  # Optional deployments only exist when their toggle is on; gather actual
  # set so the rollout loops below don't warn on missing deployments.
  local sandbox_dep=""
  [ "$SANDBOX_ENABLED" = "true" ] && sandbox_dep="nap-sandbox"
  local browser_dep=""
  [ "$BROWSER_ENABLED" = true ] && browser_dep="nap-browser"

  log "Waiting for deployments to be ready ..."
  for dep in nap-cp nap-cg nap-scheduler nap-skills $sandbox_dep $browser_dep afs-controller nap-office-converter; do
    kubectl -n "${NAMESPACE}" rollout status "deployment/$dep" --timeout=180s || {
      warn "$dep not ready within 180s"
    }
  done

  # Force a rollout for every first-party deployment so :latest-tag image digest
  # changes are picked up even when the PodSpec is byte-identical (server-side
  # apply alone won't replace pods in that case). Restart is idempotent + cheap
  # on fresh installs (pods were just created). Excluded: nap-pg (operator-
  # managed via CNPG).
  log "Refreshing :latest-tag deployments to pick up new image digests ..."
  for dep in nap-cp nap-cg nap-scheduler nap-skills afs-controller $sandbox_dep $browser_dep nap-office-converter; do
    kubectl -n "${NAMESPACE}" rollout restart "deployment/$dep" >/dev/null 2>&1 || true
  done
  if [ "$SANDBOX_ENABLED" = "true" ]; then
    kubectl -n "${NAMESPACE}" rollout restart daemonset/sandbox-image-warmer >/dev/null 2>&1 || true
  fi
  for dep in nap-cp nap-cg nap-scheduler nap-skills afs-controller $sandbox_dep $browser_dep nap-office-converter; do
    kubectl -n "${NAMESPACE}" rollout status "deployment/$dep" --timeout=180s || {
      warn "$dep restart not ready within 180s"
    }
  done

  log "All manifests applied."
}

# --- Seed admin user -------------------------------------------------------

seed_admin() {
  log "Seeding admin user (${ADMIN_USERNAME}) via K8s Job ..."

  render_manifests

  # Delete previous seed job if exists
  kubectl -n "${NAMESPACE}" delete job nap-seed-admin --ignore-not-found=true

  kapply -f "$RENDERED_DIR/seed-admin-job.yaml"

  log "Waiting for seed job to complete ..."
  kubectl -n "${NAMESPACE}" wait job/nap-seed-admin --for=condition=Complete --timeout=120s || {
    warn "Seed job did not complete within 120s."
    log "Check logs: kubectl -n ${NAMESPACE} logs job/nap-seed-admin"
    return 1
  }

  # Show logs
  kubectl -n "${NAMESPACE}" logs job/nap-seed-admin

  log "Admin user seeded."
}

seed_oauth_clients() {
  # sandbox/browser log in as fixed OAuth clients; their rows must exist in
  # oauth_clients or login fails with 400 invalid_client. Skip entirely when
  # neither module is enabled (the job would register nothing).
  if [ -z "$SANDBOX_OAUTH_REDIRECT_URI" ] && [ -z "$BROWSER_OAUTH_REDIRECT_URI" ]; then
    log "Sandbox/browser disabled — skipping OAuth client seed."
    return 0
  fi

  log "Seeding sandbox/browser OAuth clients via K8s Job ..."

  render_manifests

  kubectl -n "${NAMESPACE}" delete job nap-seed-oauth-clients --ignore-not-found=true

  kapply -f "$RENDERED_DIR/seed-oauth-clients-job.yaml"

  log "Waiting for OAuth client seed job to complete ..."
  kubectl -n "${NAMESPACE}" wait job/nap-seed-oauth-clients --for=condition=Complete --timeout=120s || {
    warn "OAuth client seed job did not complete within 120s."
    log "Check logs: kubectl -n ${NAMESPACE} logs job/nap-seed-oauth-clients"
    return 1
  }

  kubectl -n "${NAMESPACE}" logs job/nap-seed-oauth-clients
  log "OAuth clients seeded."
}

seed_mcp() {
  log "Seeding MCP catalog via K8s Job ..."

  render_manifests

  kubectl -n "${NAMESPACE}" delete job nap-seed-mcp --ignore-not-found=true

  kapply -f "$RENDERED_DIR/seed-mcp-job.yaml"

  log "Waiting for MCP seed job to complete ..."
  kubectl -n "${NAMESPACE}" wait job/nap-seed-mcp --for=condition=Complete --timeout=120s || {
    warn "MCP seed job did not complete within 120s."
    log "Check logs: kubectl -n ${NAMESPACE} logs job/nap-seed-mcp"
    return 1
  }

  kubectl -n "${NAMESPACE}" logs job/nap-seed-mcp
  log "MCP catalog seeded."
}

# --- Main ------------------------------------------------------------------

# --profile=single-node sets DEPLOY_PROFILE override; consume + shift.
case "${1:-}" in
  --profile=single-node)
    DEPLOY_PROFILE=single-node
    shift
    ;;
  --profile=*)
    die "unknown profile: ${1#--profile=}"
    ;;
esac
export DEPLOY_PROFILE

MODE="${1:-full}"

check_prereqs

if [ "$DEPLOY_PROFILE" = "single-node" ]; then
  log "DEPLOY_PROFILE=single-node — 1-node k3s pulling images from the public registry."
fi

case "$MODE" in
  --prereqs-only)
    install_prereqs
    ;;
  --manifests-only)
    apply_manifests
    ;;
  --seed-only)
    seed_admin
    seed_oauth_clients
    seed_mcp
    ;;
  --render-only)
    render_manifests
    log "Dry run complete. Check $RENDERED_DIR/"
    ;;
  full|"")
    install_prereqs
    apply_manifests
    seed_admin
    seed_oauth_clients
    seed_mcp
    log ""
    log "============================================"
    log " Neutree Agent Platform installed successfully!"
    log " Access: http://${TOS_HOST}:${TOS_NODE_PORT}"
    [ "$BROWSER_ENABLED" = true ] && log " Browser: http://${TOS_HOST}:${BROWSER_NODE_PORT}"
    [ "$SANDBOX_ENABLED" = "true" ] && log " Sandbox: http://${TOS_HOST}:${SANDBOX_NODE_PORT}"
    log " Login:  ${ADMIN_USERNAME} / (password from values.env)"
    log "============================================"
    ;;
  *)
    echo "Usage: $0 [--prereqs-only|--manifests-only|--seed-only|--render-only]"
    exit 1
    ;;
esac
