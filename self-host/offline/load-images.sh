#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# Load the offline image bundle and push every image to a target registry
# ============================================================================
# Usage:
#   ./load-images.sh --registry registry.example.com/nap --archive nap-images.tar.gz
#
# Retags every image in the bundle to ${TARGET_REGISTRY}/<short> and pushes it,
# then prints the exact values.env overrides to paste. <short> collapses each
# source ref the same way install.sh's single_node_load_registry does, so the
# two air-gap paths (external mirror vs. in-cluster registry) stay in lockstep.

# Container CLI: docker, or nerdctl on containerd-only hosts (K3s, plain
# containerd). Both expose identical load/tag/push/image-inspect subcommands.
# Override with CONTAINER_CLI=... if autodetection picks the wrong one.
CONTAINER_CLI="${CONTAINER_CLI:-}"
if [ -z "$CONTAINER_CLI" ]; then
  if command -v docker &>/dev/null; then
    CONTAINER_CLI=docker
  elif command -v nerdctl &>/dev/null; then
    CONTAINER_CLI=nerdctl
  else
    echo "ERROR: neither docker nor nerdctl found." >&2
    echo "Install one, or set CONTAINER_CLI explicitly." >&2
    exit 1
  fi
fi

ARCHIVE=""
TARGET_REGISTRY=""
INSECURE=false
# First-party object/image prefix the bundle was built with (values.env
# APP_PREFIX). Only used to locate the first-party source registry in the loaded
# images; a deployment built with a non-default prefix passes --app-prefix
# <prefix> to match.
APP_PREFIX="${APP_PREFIX:-nap}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --registry)           TARGET_REGISTRY="$2"; shift 2 ;;
    --archive)            ARCHIVE="$2"; shift 2 ;;
    --app-prefix)         APP_PREFIX="$2"; shift 2 ;;
    --insecure-registry)  INSECURE=true; shift ;;
    *)                    echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [ -z "$TARGET_REGISTRY" ] || [ -z "$ARCHIVE" ]; then
  echo "Usage: $0 --registry <target-registry> --archive <tar-file> [--app-prefix <prefix>] [--insecure-registry]"
  echo ""
  echo "  --app-prefix <prefix>  first-party image prefix (default: nap). Set this"
  echo "                         to the values.env APP_PREFIX the bundle was built"
  echo "                         with, if it was not the default."
  echo "  --insecure-registry    push over plain HTTP (registry without TLS)"
  echo ""
  echo "Example:"
  echo "  $0 --registry registry.example.com/nap --archive nap-images.tar.gz"
  exit 1
fi

# Plain-HTTP registry support. nerdctl/docker default to HTTPS; an HTTP-only
# registry returns "server gave HTTP response to HTTPS client" without this.
PUSH_OPTS=""
if [ "$INSECURE" = true ]; then
  if [ "$CONTAINER_CLI" = "nerdctl" ]; then
    PUSH_OPTS="--insecure-registry"
  else
    echo "WARNING: --insecure-registry has no effect with docker." >&2
    echo "         Add \"$TARGET_REGISTRY\" host to daemon.json insecure-registries" >&2
    echo "         and restart the docker daemon." >&2
  fi
fi

if [ ! -f "$ARCHIVE" ]; then
  echo "ERROR: Archive not found: $ARCHIVE"
  exit 1
fi

# Remove trailing slash
TARGET_REGISTRY="${TARGET_REGISTRY%/}"

echo "==> Loading images from $ARCHIVE (via $CONTAINER_CLI) ..."
"$CONTAINER_CLI" load -i "$ARCHIVE"

# --- Short-name mapping -----------------------------------------------------
# Collapse a source ref to the <short> used under ${TARGET_REGISTRY}/<short>.
# MUST stay identical to install.sh single_node_load_registry.
short_name() {
  case "$1" in
    *cloudnative-pg/postgresql:*)                    echo "cloudnative-pg-postgresql:${1##*:}" ;;
    *cloudnative-pg/cloudnative-pg:*)                echo "cloudnative-pg:${1##*:}" ;;
    *sig-storage/nfs-subdir-external-provisioner:*)  echo "nfs-subdir-external-provisioner:${1##*:}" ;;
    *)                                               echo "${1##*/}" ;;
  esac
}

# Resolve a source ref to whatever form is actually present locally. docker
# normalizes docker.io refs (docker.io/library/node:22-bookworm → node:22-bookworm,
# docker.io/coturn/coturn:4.6 → coturn/coturn:4.6) while nerdctl keeps the full
# form. Try the ref as written, then the docker-normalized variants.
resolve_local_ref() {
  local ref="$1" v
  for v in "$ref" "${ref#docker.io/library/}" "${ref#docker.io/}"; do
    if "$CONTAINER_CLI" image inspect "$v" &>/dev/null; then echo "$v"; return 0; fi
  done
  return 1
}

retag_push() {
  # retag_push <source-ref>
  local src short dst local_ref
  src="$1"
  short="$(short_name "$src")"
  dst="${TARGET_REGISTRY}/${short}"
  if local_ref="$(resolve_local_ref "$src")"; then
    echo "    $local_ref → $dst"
    "$CONTAINER_CLI" tag "$local_ref" "$dst"
    "$CONTAINER_CLI" push $PUSH_OPTS "$dst"
  else
    echo "    WARNING: $src not found in loaded images, skipping"
  fi
}

# --- First-party images -----------------------------------------------------
# Every first-party image (services + agents + chromium-headful) lives under one
# source registry — the values.env REGISTRY the bundle was built with. Derive it
# from the loaded ${APP_PREFIX}-cp image (cp is always present, whatever the
# prefix), excluding the target registry: a previous (possibly failed) run
# leaves retagged ${TARGET_REGISTRY}/... images in the local store, and matching
# one of those would point the sweep at the wrong registry.
SOURCE_REGISTRY=$("$CONTAINER_CLI" images --format '{{.Repository}}' \
  | grep -E "/${APP_PREFIX}-cp$" \
  | grep -vF "${TARGET_REGISTRY}/" \
  | head -1 | sed "s|/${APP_PREFIX}-cp$||")

if [ -z "$SOURCE_REGISTRY" ]; then
  echo "ERROR: could not find a '${APP_PREFIX}-cp' image in the loaded bundle." >&2
  echo "       Is $ARCHIVE the correct bundle, and does its APP_PREFIX match?" >&2
  echo "       Pass --app-prefix <prefix> if the bundle used a non-default one." >&2
  exit 1
fi
echo "==> Source registry: $SOURCE_REGISTRY  (app-prefix: $APP_PREFIX)"

# Push EVERY image under ${SOURCE_REGISTRY}/ — services, agents, chromium-headful,
# and any future first-party image — to ${TARGET_REGISTRY}/<basename>. Deriving
# the set from the loaded images (rather than a hard-coded list) keeps it correct
# across app-prefix changes and as first-party images are added. afs ships from
# its own repo (ghcr.io/neutree-ai/afs), so it's a third-party entry below.
echo "==> Retagging and pushing first-party images to ${TARGET_REGISTRY} ..."
while IFS= read -r local_ref; do
  [ -n "$local_ref" ] || continue
  case "$local_ref" in
    "${SOURCE_REGISTRY}/"*) retag_push "$local_ref" ;;
  esac
done < <("$CONTAINER_CLI" images --format '{{.Repository}}:{{.Tag}}')

# --- Third-party images -----------------------------------------------------
# Absolute source refs (their registries differ from SOURCE_REGISTRY). registry:2
# is intentionally NOT here: multi-node targets pull from this registry directly
# and never run the in-cluster registry, so registry:2 is only used by the
# single-node preinstall path (imported straight into containerd).
THIRD_PARTY_SRCS=(
  "ghcr.io/cloudnative-pg/postgresql:16"
  "ghcr.io/cloudnative-pg/cloudnative-pg:1.28.1"
  "registry.k8s.io/sig-storage/nfs-subdir-external-provisioner:v4.0.2"
  "docker.io/gotenberg/gotenberg:8"
  "docker.io/coturn/coturn:4.6"
  "ghcr.io/obeone/nfs-server:2.2.3"
  "docker.io/library/node:22-bookworm"
  "docker.io/library/python:3.12-bookworm"
  "docker.io/library/golang:1.23"
  "registry.k8s.io/pause:3.9"
  "ghcr.io/neutree-ai/afs:latest"
)

echo "==> Retagging and pushing third-party images ..."
for src in "${THIRD_PARTY_SRCS[@]}"; do
  retag_push "$src"
done

echo ""
echo "==> All images pushed to ${TARGET_REGISTRY}"
echo ""
echo "============================================================================"
echo "Paste these into your values.env (uncomment the third-party block):"
echo "============================================================================"
echo "REGISTRY=${TARGET_REGISTRY}"
[ "$APP_PREFIX" != "nap" ] && echo "APP_PREFIX=${APP_PREFIX}"
echo "POSTGRES_IMAGE=${TARGET_REGISTRY}/cloudnative-pg-postgresql:16"
echo "GOTENBERG_IMAGE=${TARGET_REGISTRY}/gotenberg:8"
echo "COTURN_IMAGE=${TARGET_REGISTRY}/coturn:4.6"
echo "NFS_SERVER_IMAGE=${TARGET_REGISTRY}/nfs-server:2.2.3"
echo "RUNTIME_NODE_IMAGE=${TARGET_REGISTRY}/node:22-bookworm"
echo "RUNTIME_PYTHON_IMAGE=${TARGET_REGISTRY}/python:3.12-bookworm"
echo "RUNTIME_GOLANG_IMAGE=${TARGET_REGISTRY}/golang:1.23"
echo "PAUSE_IMAGE=${TARGET_REGISTRY}/pause:3.9"
echo "AFS_IMAGE=${TARGET_REGISTRY}/afs:latest"
echo "============================================================================"
echo "The CNPG operator + NFS provisioner images are pushed too; install.sh"
echo "re-points them at \${REGISTRY} automatically when the offline prereqs are"
echo "present, so no extra values.env entry is needed for those."
