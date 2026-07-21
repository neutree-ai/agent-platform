#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# Neutree Agent Platform — Self-Hosted Installer
# ============================================================================
# Connected (default): images are pulled directly from a public registry and
# prereq charts/manifests are fetched from their public sources.
#
# Air-gapped / offline: point REGISTRY at your own private registry, load the
# image bundle into it with offline/load-images.sh (build the bundle first on a
# connected host with offline/save-images.sh, or use one your vendor delivered),
# and place the prereq charts under prereqs/. The installer then applies the
# offline CNPG/NFS bundles and wires an imagePullSecret from REGISTRY_USERNAME /
# REGISTRY_PASSWORD automatically. No separate installer — the offline path is
# gated on the bundle being present, so the same command serves both.
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
#   A 1-node k3s — like the full profile, just PG_INSTANCES=1 and an in-cluster
#   NFS server for RWX (no external NFS on a single node). Connected: pulls from
#   the public registry. Air-gapped: when offline/nap-images.tar.gz is present it
#   brings up an in-cluster registry and seeds it from the bundle, so no external
#   registry is needed at all. Must run ON the k3s node (uses crane / k3s ctr).
#
# Prerequisites:
#   - kubectl, envsubst on the machine running this script
#   - helm (only if the NFS provisioner isn't pre-installed)
#   - connected: the cluster nodes can reach ghcr.io / docker.io / registry.k8s.io
#   - air-gapped: a registry every node can pull from + the loaded image bundle
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
# path, e.g. ghcr.io/neutree-ai/agent-platform/${APP_PREFIX}-cp:<tag>. Third-party
# images (coturn, gotenberg, language runtimes, …) default to their public
# upstreams (see "Third-party images" below) — an offline/mirrored install
# overrides each to a path under ${REGISTRY}.
export REGISTRY="${REGISTRY:-ghcr.io/neutree-ai/agent-platform}"
# Tag applied to every first-party image. Default :latest; pin to a release tag
# for reproducible installs.
export IMAGE_TAG="${IMAGE_TAG:-latest}"

# --- Naming -----------------------------------------------------------------
# Prefix on every first-party k8s object name (${APP_PREFIX}-cp, ${APP_PREFIX}-pg,
# …) and on the first-party image sub-paths (${REGISTRY}/${APP_PREFIX}-cp).
# For REDISTRIBUTORS ONLY: a non-default prefix requires every first-party
# image to exist under that prefix in your own registry — the public registry
# only hosts nap-* images, so a connected install must keep the default.
# check_app_prefix enforces both this and never changing the prefix of an
# existing install. DB_NAME is the application database created in postgres.
export APP_PREFIX="${APP_PREFIX:-nap}"
export DB_NAME="${DB_NAME:-nap}"

# --- Third-party images -----------------------------------------------------
# Non-first-party images (language runtimes, pause, gotenberg, coturn, nfs).
# Default to their public upstreams; an offline/mirrored install overrides each
# to a ${REGISTRY}/... path that resolves inside an air-gapped registry.
export POSTGRES_IMAGE="${POSTGRES_IMAGE:-ghcr.io/cloudnative-pg/postgresql:16}"
export GOTENBERG_IMAGE="${GOTENBERG_IMAGE:-docker.io/gotenberg/gotenberg:8}"
export COTURN_IMAGE="${COTURN_IMAGE:-docker.io/coturn/coturn:4.6}"
export NFS_SERVER_IMAGE="${NFS_SERVER_IMAGE:-ghcr.io/obeone/nfs-server:2.2.3}"
export RUNTIME_NODE_IMAGE="${RUNTIME_NODE_IMAGE:-docker.io/library/node:22-bookworm}"
export RUNTIME_PYTHON_IMAGE="${RUNTIME_PYTHON_IMAGE:-docker.io/library/python:3.12-bookworm}"
export RUNTIME_GOLANG_IMAGE="${RUNTIME_GOLANG_IMAGE:-docker.io/library/golang:1.23}"
export PAUSE_IMAGE="${PAUSE_IMAGE:-registry.k8s.io/pause:3.9}"

# AFS (AgentFS) ships from its own repo (github.com/neutree-ai/afs) and versions
# independently of the platform, so it lives outside ${REGISTRY}/${IMAGE_TAG}.
# Default to its public image; an offline/mirrored install overrides this.
export AFS_IMAGE="${AFS_IMAGE:-ghcr.io/neutree-ai/afs:latest}"

# Resolve AGENT_IMAGE_PREFIX if it references REGISTRY
AGENT_IMAGE_PREFIX="${AGENT_IMAGE_PREFIX:-${REGISTRY}/${APP_PREFIX}-agent}"
export AGENT_IMAGE_PREFIX

# Registry authentication. Blank for a public / anonymous registry. When both
# username and password are set, the installer creates a 'regcred'
# docker-registry Secret and attaches it as an imagePullSecret to the platform
# ServiceAccounts, CNPG, coturn, and the workspace pods cp spawns.
export REGISTRY_SERVER="${REGISTRY_SERVER:-}"
export REGISTRY_USERNAME="${REGISTRY_USERNAME:-}"
export REGISTRY_PASSWORD="${REGISTRY_PASSWORD:-}"

# imagePullSecret name cp injects into spawned workspace pods. Empty on a
# connected/anonymous install (public agent images); derived as 'regcred' when
# the registry is authenticated. An unauthenticated mirror (e.g. the single-node
# in-cluster registry) needs none, matching create_regcred's condition.
if [ -n "$REGISTRY_USERNAME" ] && [ -n "$REGISTRY_PASSWORD" ]; then
  export IMAGE_PULL_SECRET="${IMAGE_PULL_SECRET:-regcred}"
else
  export IMAGE_PULL_SECRET="${IMAGE_PULL_SECRET:-}"
fi

export KUBECONFIG="${KUBECONFIG:-./kubeconfig.yaml}"

export ADMIN_DISPLAY_NAME="${ADMIN_DISPLAY_NAME:-Admin}"
export AGENT_STORAGE_CLASS="${AGENT_STORAGE_CLASS:-nfs-csi}"
export AFS_STORAGE_SIZE="${AFS_STORAGE_SIZE:-500Gi}"
export AGENT_NODE_SELECTOR="${AGENT_NODE_SELECTOR:-}"

export DEPLOY_PROFILE="${DEPLOY_PROFILE:-multi-node}"
# In-cluster registry config, consumed only by the single-node offline path
# (single_node_load_registry + offline/registry.yaml). Safe to render in any
# profile.
export REGISTRY_NODE_PORT="${REGISTRY_NODE_PORT:-30500}"
export REGISTRY_STORAGE_SIZE="${REGISTRY_STORAGE_SIZE:-20Gi}"
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

# Browser + TURN module
export BROWSER_NODE_PORT="${BROWSER_NODE_PORT:-30085}"
export BROWSER_JWT_SECRET="${BROWSER_JWT_SECRET:-}"
export TURN_HOST="${TURN_HOST:-}"
export TURN_PORT="${TURN_PORT:-3478}"
export TURN_AUTH_SECRET="${TURN_AUTH_SECRET:-}"
export COTURN_NODE_SELECTOR="${COTURN_NODE_SELECTOR:-}"

# --- Service public URLs + OAuth redirect URIs ---------------------------
# Every URL a browser (or an OAuth callback) has to reach from outside the
# cluster is resolved here, once. Each defaults to the NodePort form the
# manifests used to hard-code, so nodeport installs are unchanged; set them in
# values.env when external ingress or a custom domain fronts the services —
# with INGRESS_MODE=external there are no NodePorts for the old default to
# point at, and control-plane would hand out unreachable absolute links.
#
# The callback each service computes MUST equal the redirect_uri registered in
# oauth_clients, or cp returns 400 invalid_client — so both derive from the
# same value and can't drift.
export WEB_PUBLIC_URL="${WEB_PUBLIC_URL:-http://${NAP_HOST}:${NAP_NODE_PORT}}"
export FILES_PUBLIC_URL="${FILES_PUBLIC_URL:-$WEB_PUBLIC_URL}"
export SANDBOX_PUBLIC_URL="${SANDBOX_PUBLIC_URL:-http://${NAP_HOST}:${SANDBOX_NODE_PORT}}"
export BROWSER_PUBLIC_URL="${BROWSER_PUBLIC_URL:-http://${NAP_HOST}:${BROWSER_NODE_PORT}}"

export SANDBOX_SERVICE_URL_RESOLVED="$SANDBOX_PUBLIC_URL"
export BROWSER_SERVICE_URL_RESOLVED="$BROWSER_PUBLIC_URL"
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

# APP_PREFIX is for redistributors only: a non-default prefix implies every
# first-party image was rebuilt or mirrored under that prefix in your own
# registry. Two guards keep it from being mistaken for a cosmetic setting.
check_app_prefix() {
  # A non-default prefix against the default public registry references images
  # that cannot exist there (it only hosts nap-*). Refuse before applying.
  if [ "$APP_PREFIX" != "nap" ] && [ "$REGISTRY" = "ghcr.io/neutree-ai/agent-platform" ]; then
    die "APP_PREFIX=${APP_PREFIX} with the default public REGISTRY, which only hosts nap-* images.
       A non-default APP_PREFIX is for redistributions that rebuild every first-party image
       under that prefix in their own registry. Unset APP_PREFIX unless that is you."
  fi
  # Never change the prefix of an existing install: the render would come up as
  # a second, empty ${APP_PREFIX}-* stack (empty database included) beside the
  # old objects. Detect the existing prefix from its control-plane deployment.
  local existing
  existing=$(kubectl -n "${NAMESPACE}" get deploy -o name 2>/dev/null \
    | sed -n 's|^deployment.apps/\(.*\)-cp$|\1|p' | head -1)
  if [ -n "$existing" ] && [ "$existing" != "$APP_PREFIX" ]; then
    die "namespace '${NAMESPACE}' already has an install with prefix '${existing}' (deployment ${existing}-cp).
       Changing APP_PREFIX on an existing install would deploy a second, empty '${APP_PREFIX}-*' stack
       beside it. Set APP_PREFIX=${existing} to keep the existing install."
  fi
}

# --- Render templates ------------------------------------------------------

render_manifests() {
  log "Rendering manifests to $RENDERED_DIR ..."
  rm -rf "$RENDERED_DIR"
  mkdir -p "$RENDERED_DIR"

  # Explicit variable list — prevents envsubst from replacing k8s $(VAR)
  # references like $(POSTGRES_PASSWORD)
  local VARS='${NAMESPACE}${REGISTRY}${IMAGE_TAG}${APP_PREFIX}${DB_NAME}${NAP_HOST}${NAP_NODE_PORT}'
  VARS+='${IMAGE_PULL_SECRET}'
  VARS+='${POSTGRES_IMAGE}${GOTENBERG_IMAGE}${COTURN_IMAGE}${NFS_SERVER_IMAGE}'
  VARS+='${RUNTIME_NODE_IMAGE}${RUNTIME_PYTHON_IMAGE}${RUNTIME_GOLANG_IMAGE}${PAUSE_IMAGE}'
  VARS+='${AFS_IMAGE}'
  VARS+='${PG_USERNAME}${PG_PASSWORD}${PG_INSTANCES}${PG_STORAGE_SIZE}${PG_STORAGE_CLASS}'
  VARS+='${NFS_SERVER}${NFS_PATH}${NFS_STORAGE_CLASS}'
  VARS+='${JWT_SECRET}${CREDENTIAL_ENCRYPTION_KEY}'
  VARS+='${AGENT_IMAGE_PREFIX}${AGENT_IMAGE_TAG}${AGENT_STORAGE_CLASS}${AGENT_NODE_SELECTOR}'
  VARS+='${LDAP_URL}${LDAP_BIND_DN}${LDAP_BIND_PASSWORD}${LDAP_SEARCH_BASE}'
  VARS+='${LDAP_SEARCH_FILTER}${LDAP_ATTR_USERNAME}${LDAP_ATTR_NAME}${LDAP_ATTR_EMAIL}'
  VARS+='${ADMIN_USERNAME}${ADMIN_PASSWORD}${ADMIN_DISPLAY_NAME}'
  VARS+='${BROWSER_NODE_PORT}${BROWSER_JWT_SECRET}'
  VARS+='${WEB_PUBLIC_URL}${FILES_PUBLIC_URL}${BROWSER_PUBLIC_URL}${SANDBOX_PUBLIC_URL}'
  VARS+='${SANDBOX_NODE_PORT}${SANDBOX_JWT_SECRET}${SANDBOX_SERVICE_KEY}${SANDBOX_DOMAIN}${OPENSANDBOX_URL}'
  VARS+='${SANDBOX_SERVICE_URL_RESOLVED}${BROWSER_SERVICE_URL_RESOLVED}'
  VARS+='${SANDBOX_OAUTH_REDIRECT_URI}${BROWSER_OAUTH_REDIRECT_URI}'
  VARS+='${TURN_HOST}${TURN_PORT}${TURN_AUTH_SECRET}'
  VARS+='${AFS_STORAGE_SIZE}'
  VARS+='${SERVICE_TYPE}'
  VARS+='${PG_SYNC_REPLICAS}'
  VARS+='${SINGLE_NODE_NFS_SIZE}'
  VARS+='${REGISTRY_NODE_PORT}${REGISTRY_STORAGE_SIZE}'

  for tmpl in "$SCRIPT_DIR"/manifests/*.yaml; do
    local name
    name=$(basename "$tmpl")
    envsubst "$VARS" < "$tmpl" > "$RENDERED_DIR/$name"
    log "  rendered $name"
  done

  # registry.yaml is single-node-only offline infra and lives under offline/,
  # not manifests/, so downstream consumers that treat manifests/ as the
  # platform-service set don't render it as a service. Render it into the same
  # output dir so single_node_load_registry can apply it.
  envsubst "$VARS" < "$SCRIPT_DIR/offline/registry.yaml" > "$RENDERED_DIR/registry.yaml"
  log "  rendered registry.yaml (offline)"

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

# --- Registry credentials --------------------------------------------------

# Create the 'regcred' docker-registry Secret in a namespace. No-op on an
# unauthenticated registry (username/password blank) or if it already exists.
create_regcred() {
  local ns="$1"
  if [ -z "$REGISTRY_USERNAME" ] || [ -z "$REGISTRY_PASSWORD" ]; then
    return 0
  fi
  if kubectl -n "$ns" get secret regcred &>/dev/null; then
    log "  imagePullSecret 'regcred' already exists in $ns"
    return 0
  fi
  log "  Creating imagePullSecret in $ns ..."
  kubectl -n "$ns" create secret docker-registry regcred \
    --docker-server="${REGISTRY_SERVER}" \
    --docker-username="${REGISTRY_USERNAME}" \
    --docker-password="${REGISTRY_PASSWORD}"
}

# The shared manifests intentionally carry no imagePullSecrets. For an
# authenticated registry we wire the pull secret at the ServiceAccount level so
# every pod using that SA inherits it. Patched before the workloads are applied
# so their pods get it at creation time. No-op when IMAGE_PULL_SECRET is empty.
attach_pull_secret_to_sa() {
  local ns="$1" sa="$2"
  [ -z "$IMAGE_PULL_SECRET" ] && return 0
  # The default SA is created asynchronously after the namespace, and the cp SA
  # is owned by its manifest — create-if-missing so we can patch it up front.
  # The manifest re-apply later won't drop imagePullSecrets: server-side apply
  # only manages fields present in the applied config, and the SA manifests
  # declare none.
  kubectl -n "$ns" create serviceaccount "$sa" --dry-run=client -o yaml \
    | kubectl apply -f - >/dev/null
  kubectl -n "$ns" patch serviceaccount "$sa" \
    -p "{\"imagePullSecrets\":[{\"name\":\"${IMAGE_PULL_SECRET}\"}]}" >/dev/null
  log "  attached imagePullSecret '${IMAGE_PULL_SECRET}' to sa/$sa in $ns"
}

# CNPG manages its own instance pods, so the pull secret goes on the Cluster
# spec (its native field) rather than a SA. No-op on an unauthenticated registry.
attach_pull_secret_to_cnpg() {
  [ -z "$IMAGE_PULL_SECRET" ] && return 0
  kubectl -n "${NAMESPACE}" patch cluster.postgresql.cnpg.io "${APP_PREFIX}-pg" \
    --type merge \
    -p "{\"spec\":{\"imagePullSecrets\":[{\"name\":\"${IMAGE_PULL_SECRET}\"}]}}" >/dev/null \
    && log "  attached imagePullSecret '${IMAGE_PULL_SECRET}' to cluster/${APP_PREFIX}-pg"
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

  # imagePullSecrets (authenticated registry only)
  if [ -n "$IMAGE_PULL_SECRET" ]; then
    kubectl -n "${NAMESPACE}" patch deployment coturn \
      -p "{\"spec\":{\"template\":{\"spec\":{\"imagePullSecrets\":[{\"name\":\"${IMAGE_PULL_SECRET}\"}]}}}}"
  fi

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
  # Offline bundle (prereqs/cnpg-<ver>.yaml, written by offline/save-images.sh)
  # takes precedence: apply it locally and re-point the operator image at the
  # mirror, since the upstream GHCR image is unreachable in an air-gapped site.
  # Connected default: fetch the manifest from GitHub — it already references
  # CNPG's public GHCR image, so no re-point step.
  local cnpg_yaml="$SCRIPT_DIR/prereqs/cnpg-${CNPG_VERSION}.yaml"
  if [ -f "$cnpg_yaml" ]; then
    log "  Using offline bundle: $cnpg_yaml"
    kapply -f "$cnpg_yaml"
    log "  Re-pointing operator image at ${REGISTRY}/cloudnative-pg:${CNPG_VERSION}"
    kubectl -n cnpg-system set env deployment/cnpg-controller-manager \
      OPERATOR_IMAGE_NAME="${REGISTRY}/cloudnative-pg:${CNPG_VERSION}"
    kubectl -n cnpg-system set image deployment/cnpg-controller-manager \
      manager="${REGISTRY}/cloudnative-pg:${CNPG_VERSION}"
    if [ -n "$IMAGE_PULL_SECRET" ]; then
      create_regcred cnpg-system
      kubectl -n cnpg-system patch deployment cnpg-controller-manager \
        -p "{\"spec\":{\"template\":{\"spec\":{\"imagePullSecrets\":[{\"name\":\"${IMAGE_PULL_SECRET}\"}]}}}}"
    fi
  else
    kapply -f \
      "https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/release-${CNPG_VERSION%.*}/releases/cnpg-${CNPG_VERSION}.yaml"
  fi

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

  # Offline bundle (prereqs/nfs-subdir-external-provisioner-chart.tgz, written by
  # offline/save-images.sh) takes precedence: install from the local chart and
  # re-point the image at the mirror. Connected default: add the upstream helm
  # repo and install from it — the chart's default image (registry.k8s.io/...)
  # is public, so no re-point step.
  local chart_ref extra_args=()
  local offline_chart="$SCRIPT_DIR/prereqs/nfs-subdir-external-provisioner-chart.tgz"
  if [ -f "$offline_chart" ]; then
    log "  Using offline chart: $offline_chart"
    chart_ref="$offline_chart"
    extra_args+=(--set "image.repository=${REGISTRY}/nfs-subdir-external-provisioner")
    if [ -n "$IMAGE_PULL_SECRET" ]; then
      create_regcred "${NAMESPACE}"
      extra_args+=(--set "imagePullSecrets[0].name=${IMAGE_PULL_SECRET}")
    fi
  else
    helm repo add nfs-subdir-external-provisioner \
      https://kubernetes-sigs.github.io/nfs-subdir-external-provisioner/ 2>/dev/null || true
    helm repo update nfs-subdir-external-provisioner
    chart_ref="nfs-subdir-external-provisioner/nfs-subdir-external-provisioner"
  fi

  helm upgrade --install --force nfs-subdir-external-provisioner \
    "$chart_ref" \
    --namespace "${NAMESPACE}" --create-namespace \
    --set nfs.server="${NFS_SERVER}" \
    --set nfs.path="${NFS_PATH}" \
    --set image.tag="${NFS_PROVISIONER_VERSION}" \
    --set storageClass.name="${NFS_STORAGE_CLASS}" \
    --set storageClass.reclaimPolicy=Delete \
    --set storageClass.archiveOnDelete=true \
    --set storageClass.volumeBindingMode=Immediate \
    --set storageClass.allowVolumeExpansion=true \
    --set 'storageClass.mountOptions={vers=4.1,rsize=1048576,wsize=1048576,hard,timeo=600,retrans=2,noresvport}' \
    ${extra_args[@]+"${extra_args[@]}"}

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

# --- Single-node profile: in-cluster registry bootstrap ---------------------

# Air-gapped single-node only. Brings up an in-cluster registry and seeds it
# from the offline image bundle, so workspace pods (which reference a registry
# URL) have a registry to pull from without any external one. Runs only when
# DEPLOY_PROFILE=single-node AND the bundle is present — a connected single-node
# install pulls from the public registry and skips this entirely. Must execute
# on the k3s node itself (uses crane against the in-cluster registry over HTTP).
single_node_load_registry() {
  local archive="${IMAGES_ARCHIVE:-$SCRIPT_DIR/offline/nap-images.tar.gz}"
  if [ ! -f "$archive" ]; then
    log "single-node: no offline bundle at $archive — assuming a connected registry, skipping in-cluster registry."
    return 0
  fi
  if ! command -v crane &>/dev/null; then
    die "single-node offline profile requires crane (single-node-prep/preinstall.sh bundles it)"
  fi

  # Preflight: containerd must know the in-cluster registry NodePort speaks
  # plain HTTP, or pod-side pulls fail with "server gave HTTP response to HTTPS
  # client". single-node-prep/preinstall.sh writes both files, but only once
  # NAP_HOST is set in values.env — if preinstall ran before values.env was
  # filled (or NAP_HOST changed since), they're missing/stale and the failure
  # only surfaces much later (CNPG / app pods stuck ImagePullBackOff). Fail fast
  # here with the exact remedy instead.
  local endpoint="${NAP_HOST}:${REGISTRY_NODE_PORT}"
  local hosts_toml="/var/lib/rancher/k3s/agent/etc/containerd/certs.d/${endpoint}/hosts.toml"
  if ! grep -qF "$endpoint" /etc/rancher/k3s/registries.yaml 2>/dev/null || [ ! -f "$hosts_toml" ]; then
    die "containerd has no plain-HTTP mirror for ${endpoint} (registries.yaml / hosts.toml missing or stale).
       This is written by single-node-prep/preinstall.sh AFTER NAP_HOST is set in values.env.
       Set NAP_HOST=${NAP_HOST:-<this-host-ip>} in values.env, then re-run preinstall:
         sudo IMAGES_ARCHIVE=${archive} <prep-dir>/preinstall.sh
       (preinstall rewrites registries.yaml + hosts.toml and restarts k3s.)"
  fi

  log "Bringing up in-cluster registry ..."
  render_manifests
  kapply -f "$RENDERED_DIR/namespace.yaml"
  kapply -f "$RENDERED_DIR/registry.yaml"
  kubectl -n "${NAMESPACE}" rollout status deployment/nap-registry --timeout=120s || {
    die "nap-registry not ready; check kubectl -n ${NAMESPACE} describe deploy nap-registry"
  }

  local push_endpoint="${NAP_HOST}:${REGISTRY_NODE_PORT}"

  # docker-archive is read sequentially. Reading from .tar.gz forces a full
  # decompression per image (gzip has no random access). Decompress once to a
  # plain .tar so per-image extraction below can seek directly.
  local plain_archive="$archive"
  if [[ "$archive" == *.gz ]]; then
    plain_archive="${archive%.gz}"
    if [ ! -f "$plain_archive" ] || [ "$archive" -nt "$plain_archive" ]; then
      log "Decompressing $archive → $plain_archive (one-time) ..."
      gunzip -k -f "$archive"
    fi
  fi

  # Read manifest.json from the docker-save tarball to get image refs to push.
  # We push these and only these — k3s ctr push hangs under k3s's auto-generated
  # hosts.toml (HTTP host is pull-only), so we use crane against the in-cluster
  # registry over plain HTTP (--insecure).
  log "Reading archive manifest ..."
  local refs
  refs=$(tar -xOf "$plain_archive" manifest.json | python3 -c '
import json, sys
for entry in json.load(sys.stdin):
    for tag in entry.get("RepoTags", []):
        print(tag)
')
  if [ -z "$refs" ]; then
    die "no images parsed from $plain_archive manifest.json"
  fi

  # crane's `push` CLI loads a tarball with tarball.ImageFromPath(path, nil),
  # which only works for single-image tarballs. The multi-image bundle has 20+
  # entries in manifest.json, so feeding the whole archive fails. For each image
  # we materialize a small per-image tarball in /tmp containing just that image's
  # Config + Layers + a filtered manifest.json, push with crane, then delete.
  local total
  total=$(echo "$refs" | wc -l | tr -d ' ')
  log "Pushing $total images to $push_endpoint via crane ..."

  local stage
  stage="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf '$stage'" RETURN

  local i=0
  local src
  while IFS= read -r src; do
    i=$((i + 1))
    # Collapse each source ref to the short name the values.env image vars
    # expect under ${REGISTRY}/<short> — must match offline/load-images.sh.
    local short
    case "$src" in
      *cloudnative-pg/postgresql:*) short="cloudnative-pg-postgresql:${src##*:}" ;;
      *cloudnative-pg/cloudnative-pg:*) short="cloudnative-pg:${src##*:}" ;;
      *sig-storage/nfs-subdir-external-provisioner:*) short="nfs-subdir-external-provisioner:${src##*:}" ;;
      *) short="${src##*/}" ;;
    esac
    # registry:2 (if bundled) stays local: the registry pod uses IfNotPresent +
    # a pre-loaded image, and pushing it to itself is a chicken-and-egg no-op.
    if [ "$short" = "registry:2" ]; then
      log "  [$i/$total] skipping registry:2"
      continue
    fi
    local dst="${push_endpoint}/nap/${short}"
    log "  [$i/$total] $src → $dst"

    local per_image_tar="$stage/img.tar"
    python3 - "$plain_archive" "$src" "$per_image_tar" <<'PY' || die "failed to build per-image tarball for $src"
import io, json, sys, tarfile
src_tar, ref, out_tar = sys.argv[1], sys.argv[2], sys.argv[3]
with tarfile.open(src_tar, "r") as tin:
    manifest = json.load(tin.extractfile("manifest.json"))
    entry = next((e for e in manifest if ref in e.get("RepoTags", [])), None)
    if entry is None:
        sys.exit(f"ref {ref} not found in manifest.json")
    wanted = {entry["Config"]} | set(entry.get("Layers", []))
    # Single-image manifest.json with RepoTags trimmed to just the requested
    # ref (some entries list multiple tags; crane would push all of them).
    new_entry = dict(entry, RepoTags=[ref])
    new_manifest = json.dumps([new_entry]).encode()
    with tarfile.open(out_tar, "w") as tout:
        for name in wanted:
            ti = tin.getmember(name)
            tout.addfile(ti, tin.extractfile(ti))
        ti = tarfile.TarInfo("manifest.json")
        ti.size = len(new_manifest)
        tout.addfile(ti, io.BytesIO(new_manifest))
PY

    crane push --insecure "$per_image_tar" "$dst" >/dev/null || {
      die "crane push failed for $src"
    }
    rm -f "$per_image_tar"
  done <<< "$refs"
  log "Registry seeded with $total images."

  # Decompressed copy is only useful during seeding; the .gz original is the
  # on-disk artifact for any future re-seed. Drop the .tar to reclaim space.
  if [ "$plain_archive" != "$archive" ] && [ -f "$plain_archive" ]; then
    log "Reclaiming $plain_archive ($(du -h "$plain_archive" | cut -f1))"
    rm -f "$plain_archive"
  fi
}

# --- Apply manifests -------------------------------------------------------

apply_manifests() {
  render_manifests

  log "Applying manifests to namespace ${NAMESPACE} ..."

  # Order matters: namespace → regcred → secrets → postgres → services
  kapply -f "$RENDERED_DIR/namespace.yaml"
  # Authenticated registry: create the pull secret and attach it to the SAs so
  # every platform pod (and the workspace pods cp spawns via the default SA)
  # inherits it. No-op on a public/anonymous registry.
  create_regcred "${NAMESPACE}"
  attach_pull_secret_to_sa "${NAMESPACE}" default
  attach_pull_secret_to_sa "${NAMESPACE}" "${APP_PREFIX}-cp"
  kapply -f "$RENDERED_DIR/secrets.yaml"

  log "Creating PostgreSQL cluster ..."
  kapply -f "$RENDERED_DIR/postgres.yaml"
  attach_pull_secret_to_cnpg
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
  # env-runner-k8s owns every workspace mutation since the P1 control inversion:
  # control-plane only writes desired state to workspace_placements, the runner
  # reconciles it into Deployments. Without it, workspaces never start. Apply it
  # before control-plane so the runner is watching before placements are written.
  kapply -f "$RENDERED_DIR/env-runner-k8s.yaml"
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
  for dep in nap-cp nap-cg nap-scheduler nap-skills nap-env-runner-k8s $sandbox_dep $browser_dep afs-controller nap-office-converter; do
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
  for dep in nap-cp nap-cg nap-scheduler nap-skills nap-env-runner-k8s afs-controller $sandbox_dep $browser_dep nap-office-converter; do
    kubectl -n "${NAMESPACE}" rollout restart "deployment/$dep" >/dev/null 2>&1 || true
  done
  if [ "$SANDBOX_ENABLED" = "true" ]; then
    kubectl -n "${NAMESPACE}" rollout restart daemonset/sandbox-image-warmer >/dev/null 2>&1 || true
  fi
  for dep in nap-cp nap-cg nap-scheduler nap-skills nap-env-runner-k8s afs-controller $sandbox_dep $browser_dep nap-office-converter; do
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
check_app_prefix

if [ "$DEPLOY_PROFILE" = "single-node" ]; then
  log "DEPLOY_PROFILE=single-node — 1-node k3s. Connected: pulls from the public"
  log "  registry. Air-gapped: seeds an in-cluster registry from the offline bundle"
  log "  (offline/nap-images.tar.gz) when present."
fi

case "$MODE" in
  --prereqs-only)
    [ "$DEPLOY_PROFILE" = "single-node" ] && single_node_load_registry
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
    [ "$DEPLOY_PROFILE" = "single-node" ] && single_node_load_registry
    install_prereqs
    apply_manifests
    seed_admin
    seed_oauth_clients
    seed_mcp
    log ""
    log "============================================"
    log " Neutree Agent Platform installed successfully!"
    log " Access: http://${NAP_HOST}:${NAP_NODE_PORT}"
    [ "$BROWSER_ENABLED" = true ] && log " Browser: http://${NAP_HOST}:${BROWSER_NODE_PORT}"
    [ "$SANDBOX_ENABLED" = "true" ] && log " Sandbox: http://${NAP_HOST}:${SANDBOX_NODE_PORT}"
    log " Login:  ${ADMIN_USERNAME} / (password from values.env)"
    log "============================================"
    ;;
  *)
    echo "Usage: $0 [--prereqs-only|--manifests-only|--seed-only|--render-only]"
    exit 1
    ;;
esac
