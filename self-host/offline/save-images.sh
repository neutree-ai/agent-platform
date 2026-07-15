#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# Save all images + prereqs for an air-gapped Neutree Agent Platform install
# ============================================================================
# Runs on a CONNECTED build host. Produces:
#   nap-images.tar.gz          — all container images (docker save | gzip)
#   ../prereqs/                — CNPG operator YAML + NFS provisioner Helm chart
#
# The image set is DERIVED, not hand-maintained: we render the manifests with
# ./install.sh --render-only and grep the resolved `image:` lines. This keeps
# the bundle authoritative — it can never drift from what the manifests deploy.
# A short supplement adds images that are NOT in any manifest (agent pods are
# spawned dynamically; the CNPG operator + NFS provisioner ship as prereqs).
#
# Build-host prereqs: docker, helm, kubectl, envsubst, curl
#   (kubectl + envsubst are needed by `install.sh --render-only`).
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SELF_HOST_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RENDERED_DIR="$SELF_HOST_DIR/rendered"

OUTPUT="${OUTPUT:-$SCRIPT_DIR/nap-images.tar.gz}"

# First-party image coordinates. Defaults match install.sh; the render below is
# the source of truth for first-party service images, so these only feed the
# agent-image supplement (agents are spawned dynamically, never in a manifest).
REGISTRY="${REGISTRY:-ghcr.io/neutree-ai/agent-platform}"
APP_PREFIX="${APP_PREFIX:-nap}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
AGENT_IMAGE_TAG="${AGENT_IMAGE_TAG:-latest}"
AGENT_IMAGE_PREFIX="${AGENT_IMAGE_PREFIX:-${REGISTRY}/${APP_PREFIX}-agent}"

# Prereq versions are pinned in install.sh — grep them so this script can't
# drift from the versions the installer actually re-points images at.
CNPG_VERSION="$(grep -E '^CNPG_VERSION=' "$SELF_HOST_DIR/install.sh" | head -1 | cut -d'"' -f2)"
NFS_PROVISIONER_VERSION="$(grep -E '^NFS_PROVISIONER_VERSION=' "$SELF_HOST_DIR/install.sh" | head -1 | cut -d'"' -f2)"
[ -n "$CNPG_VERSION" ] || { echo "ERROR: could not read CNPG_VERSION from install.sh" >&2; exit 1; }
[ -n "$NFS_PROVISIONER_VERSION" ] || { echo "ERROR: could not read NFS_PROVISIONER_VERSION from install.sh" >&2; exit 1; }

# --- Derive the first + third-party image set from rendered manifests --------
echo "==> Rendering manifests to derive the authoritative image set ..."
( cd "$SELF_HOST_DIR" && ./install.sh --render-only >/dev/null )
[ -d "$RENDERED_DIR" ] || { echo "ERROR: render produced no $RENDERED_DIR" >&2; exit 1; }

# Pull the resolved `image:` values out of every rendered manifest. envsubst has
# already substituted REGISTRY / *_IMAGE / tags, so these are concrete refs
# (first-party services, postgres, gotenberg, coturn, nfs-server, afs, the
# language runtimes, pause, chromium-headful, and registry:2 from registry.yaml).
RENDERED_IMAGES=()
while IFS= read -r img; do
  [ -n "$img" ] && RENDERED_IMAGES+=("$img")
done < <(
  grep -hE '^[[:space:]]*image:[[:space:]]' "$RENDERED_DIR"/*.yaml \
    | sed -E 's/^[[:space:]]*image:[[:space:]]*//; s/["'\'']//g' \
    | grep -v '\${' \
    | sort -u
)
[ "${#RENDERED_IMAGES[@]}" -gt 0 ] || { echo "ERROR: no image: lines found in rendered manifests" >&2; exit 1; }

# --- Supplement: images NOT present as an `image:` line in any manifest ------
#   - agent images: spawned dynamically by the control-plane, never templated
#   - memory-fuse: passed to cp/env-runner as an env VALUE (the image of a pod
#     they spawn), so it never appears on an `image:` line the render grep sees
#   - CNPG operator image: install.sh applies the operator YAML as a prereq
#   - NFS provisioner image: install.sh installs it via Helm as a prereq
SUPPLEMENT_IMAGES=(
  "${AGENT_IMAGE_PREFIX}-claude-code:${AGENT_IMAGE_TAG}"
  "${AGENT_IMAGE_PREFIX}-codex:${AGENT_IMAGE_TAG}"
  "${REGISTRY}/${APP_PREFIX}-memory-fuse:${IMAGE_TAG}"
  "ghcr.io/cloudnative-pg/cloudnative-pg:${CNPG_VERSION}"
  "registry.k8s.io/sig-storage/nfs-subdir-external-provisioner:${NFS_PROVISIONER_VERSION}"
)

# Merge + de-dup (no bash-4 associative arrays — build host may be bash 3.2).
ALL_IMAGES=()
for img in "${RENDERED_IMAGES[@]}" "${SUPPLEMENT_IMAGES[@]}"; do
  [ -n "$img" ] || continue
  case " ${ALL_IMAGES[*]} " in
    *" $img "*) ;;                # already present
    *) ALL_IMAGES+=("$img") ;;
  esac
done

# Auto-detect host arch; override with PLATFORM=linux/<arch>.
case "$(uname -m)" in
  x86_64)         HOST_PLATFORM="linux/amd64" ;;
  aarch64|arm64)  HOST_PLATFORM="linux/arm64" ;;
  *)              HOST_PLATFORM="linux/$(uname -m)" ;;
esac
PLATFORM="${PLATFORM:-$HOST_PLATFORM}"

echo "==> Fetching ${#ALL_IMAGES[@]} images (${PLATFORM}) ..."
# Set PULL_POLICY=never to skip all pulls (use the local cache only).
for img in "${ALL_IMAGES[@]}"; do
  if docker image inspect "$img" &>/dev/null; then
    echo "    cached  $img"
  elif [ "${PULL_POLICY:-}" = "never" ]; then
    echo "    WARNING: $img not cached and PULL_POLICY=never, skipping"
  else
    echo "    pulling $img"
    docker pull --platform "$PLATFORM" "$img" || {
      echo "ERROR: failed to pull $img — aborting (set PULL_POLICY=never to skip pulls; see save-images.sh)" >&2
      exit 1
    }
  fi
done

echo "==> Saving images to $OUTPUT ..."
docker save "${ALL_IMAGES[@]}" | gzip > "$OUTPUT"
SIZE=$(du -h "$OUTPUT" | cut -f1)
echo "==> Images saved: $OUTPUT ($SIZE)"

# --- Download prereqs for the offline install -------------------------------
PREREQS_DIR="$SELF_HOST_DIR/prereqs"
mkdir -p "$PREREQS_DIR"

echo "==> Downloading CNPG operator manifest (v${CNPG_VERSION}) ..."
curl -fsSL -o "$PREREQS_DIR/cnpg-${CNPG_VERSION}.yaml" \
  "https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/release-${CNPG_VERSION%.*}/releases/cnpg-${CNPG_VERSION}.yaml"
echo "    saved prereqs/cnpg-${CNPG_VERSION}.yaml"

echo "==> Downloading NFS provisioner Helm chart ..."
helm repo add nfs-subdir-external-provisioner \
  https://kubernetes-sigs.github.io/nfs-subdir-external-provisioner/ 2>/dev/null || true
helm repo update nfs-subdir-external-provisioner
# Drop any previous copy so the rename below doesn't get confused by a glob
# matching both the freshly-pulled tarball and the old -chart.tgz.
rm -f "$PREREQS_DIR/nfs-subdir-external-provisioner-chart.tgz"
helm pull nfs-subdir-external-provisioner/nfs-subdir-external-provisioner \
  -d "$PREREQS_DIR"
mv "$PREREQS_DIR"/nfs-subdir-external-provisioner-*.tgz \
   "$PREREQS_DIR/nfs-subdir-external-provisioner-chart.tgz"
echo "    saved prereqs/nfs-subdir-external-provisioner-chart.tgz"

echo ""
echo "==> Done. Deliverables for an air-gapped install:"
echo "    1. self-host/              (this directory)"
echo "    2. $OUTPUT     (container images)"
echo "    3. self-host/prereqs/      (CNPG + NFS provisioner charts, just created)"
echo ""
echo "On the target machine:"
echo "    1. ./offline/load-images.sh --registry <your-registry> --archive $OUTPUT"
echo "       (prints the exact values.env image overrides to paste)"
echo "    2. ./gen-secrets.sh && vi values.env"
echo "    3. ./install.sh"
