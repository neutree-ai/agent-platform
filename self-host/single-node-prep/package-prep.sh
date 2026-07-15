#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# Build the single-node-prep tarball.
# ============================================================================
# Output:
#   ../../nap-self-host-single-node-prep-<arch>-<fp8>.tar.gz
#
# The filename carries an 8-char content fingerprint, NOT the platform release.
# The prep bundle changes far less often than the platform itself — it only
# depends on pinned tool versions, the nfs-common debs, and preinstall.sh. The
# fingerprint is derived from exactly those inputs, so two builds cut for
# different platform releases produce an IDENTICAL filename whenever the prep
# content is unchanged. Customers compare the filename: same fp → skip
# re-upload / re-download; new fp → prep really changed.
#
# Bundles:
#   preinstall.sh
#   k3s-<arch>                          (binary; symlinked as kubectl by preinstall)
#   k3s-airgap-images-<arch>.tar.gz
#   helm / envsubst / crane             (CLI tools install.sh depends on)
#   k9s                                 (k8s TUI for on-host debugging)
#   nfs-debs/                           (offline nfs-common for no-apt hosts)
#
# The in-cluster NFS server image is a public image already carried by the main
# bundle (offline/nap-images.tar.gz), so it is NOT special-cased here.
#
# Usage:
#   ./package-prep.sh --arch amd64 [--version <label>]
#   ./package-prep.sh --arch arm64 [--version <label>]
# --version is optional metadata only (recorded as built_with= in VERSION);
# it does not affect the fingerprint or the filename.
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
K3S_VERSION="${K3S_VERSION:-v1.32.5+k3s1}"
# Pinned for reproducible builds. Bump deliberately.
HELM_VERSION="${HELM_VERSION:-v3.16.4}"
ENVSUBST_VERSION="${ENVSUBST_VERSION:-v1.4.3}"   # a8m/envsubst (Go reimpl, single static binary)
CRANE_VERSION="${CRANE_VERSION:-v0.20.2}"         # google/go-containerregistry
K9S_VERSION="${K9S_VERSION:-v0.50.18}"            # derailed/k9s

VERSION=""
ARCH=""
while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --arch)    ARCH="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done
[ -n "$ARCH" ] || { echo "--arch required (amd64|arm64)" >&2; exit 1; }

case "$ARCH" in
  amd64) K3S_BIN_URL_SUFFIX="" ; K3S_AIRGAP_SUFFIX="amd64" ;;
  arm64) K3S_BIN_URL_SUFFIX="-arm64" ; K3S_AIRGAP_SUFFIX="arm64" ;;
  *) echo "unsupported arch: $ARCH" >&2; exit 1 ;;
esac

STAGING="$(mktemp -d)"
trap "rm -rf $STAGING" EXIT
DEST="$STAGING/single-node-prep"
mkdir -p "$DEST"

echo "==> Staging preinstall.sh"
install -m 0755 "$SCRIPT_DIR/preinstall.sh" "$DEST/preinstall.sh"

K3S_BASE="https://github.com/k3s-io/k3s/releases/download/${K3S_VERSION//+/%2B}"
echo "==> Downloading k3s binary ($K3S_VERSION, $ARCH)"
curl -fsSL -o "$DEST/k3s-$ARCH" "$K3S_BASE/k3s$K3S_BIN_URL_SUFFIX"
chmod +x "$DEST/k3s-$ARCH"

echo "==> Downloading k3s airgap images ($ARCH)"
curl -fsSL -o "$DEST/k3s-airgap-images-$ARCH.tar.gz" \
  "$K3S_BASE/k3s-airgap-images-$K3S_AIRGAP_SUFFIX.tar.gz"

# --- Bundled CLI tools (so a no-apt host still has helm / envsubst / crane / kubectl) ---
TMP_DL="$(mktemp -d)"
trap "rm -rf $STAGING $TMP_DL" EXIT

echo "==> Downloading helm $HELM_VERSION ($ARCH)"
curl -fsSL -o "$TMP_DL/helm.tar.gz" \
  "https://get.helm.sh/helm-${HELM_VERSION}-linux-${ARCH}.tar.gz"
tar -xzf "$TMP_DL/helm.tar.gz" -C "$TMP_DL"
install -m 0755 "$TMP_DL/linux-${ARCH}/helm" "$DEST/helm"

echo "==> Downloading envsubst $ENVSUBST_VERSION ($ARCH)"
# a8m/envsubst release artifact naming: envsubst-Linux-x86_64 / envsubst-Linux-arm64
case "$ARCH" in
  amd64) envsubst_asset="envsubst-Linux-x86_64" ;;
  arm64) envsubst_asset="envsubst-Linux-arm64" ;;
esac
curl -fsSL -o "$DEST/envsubst" \
  "https://github.com/a8m/envsubst/releases/download/${ENVSUBST_VERSION}/${envsubst_asset}"
chmod 0755 "$DEST/envsubst"

echo "==> Downloading crane $CRANE_VERSION ($ARCH)"
# go-containerregistry release artifact naming: go-containerregistry_Linux_x86_64.tar.gz / _arm64.tar.gz
case "$ARCH" in
  amd64) crane_asset="go-containerregistry_Linux_x86_64.tar.gz" ;;
  arm64) crane_asset="go-containerregistry_Linux_arm64.tar.gz" ;;
esac
curl -fsSL -o "$TMP_DL/crane.tar.gz" \
  "https://github.com/google/go-containerregistry/releases/download/${CRANE_VERSION}/${crane_asset}"
tar -xzf "$TMP_DL/crane.tar.gz" -C "$TMP_DL" crane
install -m 0755 "$TMP_DL/crane" "$DEST/crane"

echo "==> Downloading k9s $K9S_VERSION ($ARCH)"
# derailed/k9s release artifact naming: k9s_Linux_amd64.tar.gz / k9s_Linux_arm64.tar.gz
curl -fsSL -o "$TMP_DL/k9s.tar.gz" \
  "https://github.com/derailed/k9s/releases/download/${K9S_VERSION}/k9s_Linux_${ARCH}.tar.gz"
tar -xzf "$TMP_DL/k9s.tar.gz" -C "$TMP_DL" k9s
install -m 0755 "$TMP_DL/k9s" "$DEST/k9s"

# Host needs mount.nfs (nfs-common) to mount the in-cluster nap-nfs-server svc
# for nfs-subdir-external-provisioner. Cloud images / minimal Ubuntu installs
# don't ship it. Fetch the deb + transitive deps from a clean Ubuntu container
# so airgapped hosts can dpkg -i them in preinstall.sh.
echo "==> Fetching nfs-common debs (linux/$ARCH, Ubuntu 24.04) for prep bundle"
mkdir -p "$DEST/nfs-debs"
DEB_TMP="$(mktemp -d)"
trap "rm -rf $STAGING $TMP_DL $DEB_TMP" EXIT
docker run --rm --platform "linux/$ARCH" -v "$DEB_TMP:/out" -w /out ubuntu:24.04 bash -c '
  set -e
  apt-get update -qq
  pkgs=$(apt-get install -s -y --no-install-recommends nfs-common | awk "/^Inst / {print \$2}")
  apt-get download $pkgs
'
mv "$DEB_TMP"/*.deb "$DEST/nfs-debs/"
echo "==> Staged $(ls "$DEST/nfs-debs" | wc -l) nfs-common debs ($(du -sh "$DEST/nfs-debs" | cut -f1))"

# --- Content fingerprint --------------------------------------------------
# Deterministic identity of the prep bundle, independent of build time and of
# the platform release. Derived from the inputs that actually determine content:
#   - pinned tool versions (each version string fully determines the downloaded
#     binary — no need to hash the bytes, which wouldn't be reproducible anyway)
#   - sha256 of preinstall.sh (the only script we author here)
#   - sorted nfs-debs filenames (deb names carry arch + Ubuntu version, so they
#     shift exactly when the offline nfs-common set changes)
# The sorted manifest is hashed; first 8 hex chars go into the filename.
FP_MANIFEST="$(mktemp)"
{
  echo "arch=$ARCH"
  echo "k3s=$K3S_VERSION"
  echo "helm=$HELM_VERSION"
  echo "envsubst=$ENVSUBST_VERSION"
  echo "crane=$CRANE_VERSION"
  echo "k9s=$K9S_VERSION"
  echo "preinstall.sha256=$(sha256sum "$DEST/preinstall.sh" | awk '{print $1}')"
  (cd "$DEST/nfs-debs" && ls | sed 's/^/deb:/')
} | LC_ALL=C sort > "$FP_MANIFEST"
FP="$(sha256sum "$FP_MANIFEST" | awk '{print $1}')"
FP8="${FP:0:8}"
echo "==> Prep content fingerprint: $FP8"

# VERSION records the fingerprint (the real identity) + component versions.
# built_with is informational only — the platform release this prep happened to
# be cut alongside. It is NOT part of the fingerprint, so re-cutting prep for a
# new platform release with unchanged inputs yields the same fp / same filename.
cat > "$DEST/VERSION" <<EOF
fingerprint=$FP8
built_with=${VERSION:-unspecified}
k3s=$K3S_VERSION
helm=$HELM_VERSION
envsubst=$ENVSUBST_VERSION
crane=$CRANE_VERSION
k9s=$K9S_VERSION
arch=$ARCH
EOF
cp "$FP_MANIFEST" "$DEST/PREP_FINGERPRINT_INPUTS"
rm -f "$FP_MANIFEST"

OUT="$SCRIPT_DIR/../../nap-self-host-single-node-prep-${ARCH}-${FP8}.tar.gz"
echo "==> Packaging $OUT"
tar -C "$STAGING" -czf "$OUT" single-node-prep
ls -lh "$OUT"
