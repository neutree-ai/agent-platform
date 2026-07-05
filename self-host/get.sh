#!/bin/sh
# ============================================================================
# Neutree Agent Platform — one-line installer (CONNECTED)
# ============================================================================
# Bootstraps a connected (online) self-host install with a single command.
# POSIX sh — this script is meant to be piped from curl:
#
#   Single node, no Kubernetes (installs k3s for you; run as root):
#     curl -sfL https://nap.docs.neutree.ai/get.sh | sh -
#
#   Existing Kubernetes cluster (uses your current kubeconfig):
#     curl -sfL .../get.sh | sh -s -- --k8s --host=<ip-or-hostname> \
#       --nfs-server=<ip> --nfs-path=</export/path>
#     # or, with a pre-existing RWX StorageClass instead of NFS:
#     curl -sfL .../get.sh | sh -s -- --k8s --host=<ip-or-hostname> \
#       --storage-class=<rwx-storageclass>
#
# What it does:
#   1. (single-node) installs k3s if missing, plus envsubst / helm / openssl
#   2. downloads the self-host installer for the requested version
#   3. generates values.env — all machine secrets, autodetected host IP,
#      and a random admin password (printed at the end)
#   4. runs install.sh
#
# Config lives OUTSIDE the refreshed installer tree (default
# /opt/nap/values.env) and is never regenerated once it exists — re-running
# the same one-liner refreshes the installer and upgrades in place.
#
# Flags:
#   --k8s                 target an existing cluster instead of installing k3s
#   --host=HOST           IP/hostname users reach the platform at
#                         (required with --k8s; autodetected on single-node)
#   --nfs-server=IP       external NFS server for RWX storage (--k8s only)
#   --nfs-path=PATH       export path on that NFS server (--k8s only)
#   --storage-class=SC    existing RWX StorageClass, alternative to NFS (--k8s only)
#   --version=REF         branch or tag to install (default: main; a vX.Y.Z tag
#                         also pins IMAGE_TAG to that release)
#   --dir=DIR             install dir (default: /opt/nap)
#   --prepare-only        fetch + generate values.env, but don't install —
#                         review/edit values.env, then re-run without this flag
#
# Env overrides (same precedence as flags, flags win):
#   NAP_HOST, NAP_ADMIN_PASSWORD, NAP_VERSION, NAP_INSTALL_DIR, NAP_REPO,
#   KUBECONFIG (--k8s mode; defaults to ~/.kube/config)

set -eu

REPO="${NAP_REPO:-neutree-ai/agent-platform}"
VERSION="${NAP_VERSION:-main}"
INSTALL_DIR="${NAP_INSTALL_DIR:-/opt/nap}"
MODE="single-node"
HOST="${NAP_HOST:-}"
ADMIN_PASSWORD_OVERRIDE="${NAP_ADMIN_PASSWORD:-}"
NFS_SERVER_ARG=""
NFS_PATH_ARG=""
STORAGE_CLASS_ARG=""
PREPARE_ONLY=false

log()  { echo "==> $*"; }
warn() { echo "WARNING: $*" >&2; }
die()  { echo "ERROR: $*" >&2; exit 1; }

usage() {
  # $0 is "sh" when piped from curl, so the usage text is inlined here
  # rather than read back from the header comment.
  cat <<'EOF'
Neutree Agent Platform — one-line installer (connected)

Single node, no Kubernetes (installs k3s for you; run as root):
  curl -sfL .../get.sh | sh -

Existing Kubernetes cluster (uses your current kubeconfig):
  curl -sfL .../get.sh | sh -s -- --k8s --host=<ip-or-hostname> \
    --nfs-server=<ip> --nfs-path=</export/path>
  curl -sfL .../get.sh | sh -s -- --k8s --host=<ip-or-hostname> \
    --storage-class=<rwx-storageclass>

Flags:
  --k8s                 target an existing cluster instead of installing k3s
  --host=HOST           IP/hostname users reach the platform at
                        (required with --k8s; autodetected on single-node)
  --nfs-server=IP       external NFS server for RWX storage (--k8s only)
  --nfs-path=PATH       export path on that NFS server (--k8s only)
  --storage-class=SC    existing RWX StorageClass, alternative to NFS (--k8s only)
  --version=REF         branch or tag to install (default: main; a vX.Y.Z tag
                        also pins IMAGE_TAG to that release)
  --dir=DIR             install dir (default: /opt/nap)
  --prepare-only        fetch + generate values.env, but don't install —
                        review/edit values.env, then re-run without this flag

Env overrides (flags win):
  NAP_HOST, NAP_ADMIN_PASSWORD, NAP_VERSION, NAP_INSTALL_DIR, NAP_REPO,
  KUBECONFIG (--k8s mode; defaults to ~/.kube/config)
EOF
}

# --- Parse flags -------------------------------------------------------------

for arg in "$@"; do
  case "$arg" in
    --k8s)              MODE="k8s" ;;
    --host=*)           HOST="${arg#*=}" ;;
    --nfs-server=*)     NFS_SERVER_ARG="${arg#*=}" ;;
    --nfs-path=*)       NFS_PATH_ARG="${arg#*=}" ;;
    --storage-class=*)  STORAGE_CLASS_ARG="${arg#*=}" ;;
    --version=*)        VERSION="${arg#*=}" ;;
    --dir=*)            INSTALL_DIR="${arg#*=}" ;;
    --prepare-only)     PREPARE_ONLY=true ;;
    -h|--help)          usage; exit 0 ;;
    *)                  die "unknown flag: $arg (see --help)" ;;
  esac
done

VALUES_FILE="$INSTALL_DIR/values.env"
SELF_HOST_DIR="$INSTALL_DIR/self-host"

# --- Helpers -----------------------------------------------------------------

# Replace KEY=... in values.env. awk -v mangles backslashes, so values with
# backslashes are unsupported (none of the values we set contain any).
set_kv() {
  key="$1"; val="$2"
  awk -v k="$key" -v v="$val" 'BEGIN { FS = OFS = "=" }
    $1 == k { print k "=" v; next } { print }' "$VALUES_FILE" > "$VALUES_FILE.tmp"
  mv "$VALUES_FILE.tmp" "$VALUES_FILE"
}

get_kv() {
  grep "^$1=" "$VALUES_FILE" | tail -1 | cut -d= -f2-
}

# Default-route source IP — the address other machines on the LAN reach us at.
detect_host_ip() {
  addr="$(ip route get 1 2>/dev/null \
    | awk '{ for (i = 1; i < NF; i++) if ($i == "src") { print $(i+1); exit } }')"
  [ -n "$addr" ] || addr="$(hostname -I 2>/dev/null | awk '{ print $1 }')"
  echo "$addr"
}

# --- Dependency install (single-node, root, Linux) ---------------------------

pkg_install() {
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq && apt-get install -y -qq "$@"
  elif command -v dnf >/dev/null 2>&1; then dnf install -y -q "$@"
  elif command -v yum >/dev/null 2>&1; then yum install -y -q "$@"
  elif command -v zypper >/dev/null 2>&1; then zypper --non-interactive install "$@"
  elif command -v apk >/dev/null 2>&1; then apk add --no-cache "$@"
  else
    return 1
  fi
}

ensure_envsubst() {
  command -v envsubst >/dev/null 2>&1 && return 0
  log "Installing envsubst (gettext) ..."
  # Debian/Ubuntu ship envsubst in gettext-base; everyone else in gettext.
  pkg_install gettext-base 2>/dev/null || pkg_install gettext \
    || die "envsubst not found and no supported package manager — install gettext manually"
  command -v envsubst >/dev/null 2>&1 || die "gettext installed but envsubst still missing"
}

ensure_helm() {
  command -v helm >/dev/null 2>&1 && return 0
  log "Installing helm ..."
  # get-helm-3 is a bash script; install.sh / gen-secrets.sh need bash anyway.
  command -v bash >/dev/null 2>&1 || pkg_install bash || die "bash is required"
  curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash \
    || die "helm install failed — install helm manually and re-run"
}

ensure_openssl() {
  command -v openssl >/dev/null 2>&1 && return 0
  log "Installing openssl ..."
  pkg_install openssl || die "openssl not found — install it manually"
}

# --- k3s (single-node) --------------------------------------------------------

ensure_k3s() {
  if command -v k3s >/dev/null 2>&1; then
    log "k3s already installed — reusing it."
  else
    log "Installing k3s ..."
    curl -sfL https://get.k3s.io | sh -
  fi
  export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
  log "Waiting for the k3s node to be Ready ..."
  kubectl wait node --all --for=condition=Ready --timeout=300s \
    || die "k3s node not Ready within 300s — check: journalctl -u k3s"
}

# --- Fetch the self-host installer --------------------------------------------

fetch_self_host() {
  case "$VERSION" in
    v[0-9]*) ref="refs/tags/$VERSION" ;;
    *)       ref="refs/heads/$VERSION" ;;
  esac
  url="https://codeload.github.com/$REPO/tar.gz/$ref"
  log "Downloading installer ($REPO @ $VERSION) ..."

  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  # Download to a file first (not `curl | tar`) so a network failure is
  # reported as such instead of surfacing as a confusing tar/extract error.
  curl -fsSL -o "$tmp/src.tar.gz" "$url" || die "download failed: $url"
  tar -xzf "$tmp/src.tar.gz" -C "$tmp" || die "could not extract $url"
  src="$(find "$tmp" -mindepth 2 -maxdepth 2 -type d -name self-host | head -1)"
  [ -n "$src" ] || die "self-host/ not found in the downloaded tarball"

  # Refresh the installer tree; values.env lives outside it and survives.
  rm -rf "$SELF_HOST_DIR"
  mkdir -p "$INSTALL_DIR"
  mv "$src" "$SELF_HOST_DIR"
  rm -rf "$tmp"
  trap - EXIT
}

# --- values.env ----------------------------------------------------------------

prepare_values() {
  if [ -f "$VALUES_FILE" ]; then
    log "Reusing existing $VALUES_FILE — config flags are ignored on re-runs."
    # Exception: an explicit release tag still bumps IMAGE_TAG, so
    # `--version=vX.Y.Z` on a re-run means "upgrade to that release".
    case "$VERSION" in
      v[0-9]*)
        set_kv IMAGE_TAG "$VERSION"
        log "Pinned IMAGE_TAG=$VERSION"
        ;;
    esac
    return 0
  fi

  if [ "$MODE" = "single-node" ]; then
    cp "$SELF_HOST_DIR/values.env.single-node.example" "$VALUES_FILE"
  else
    cp "$SELF_HOST_DIR/values.env.example" "$VALUES_FILE"
  fi

  VALUES_FILE="$VALUES_FILE" "$SELF_HOST_DIR/gen-secrets.sh"

  # Host: required input on --k8s; autodetected on single-node.
  if [ -z "$HOST" ] && [ "$MODE" = "single-node" ]; then
    HOST="$(detect_host_ip)"
    [ -n "$HOST" ] && log "Autodetected node IP: $HOST (override with --host= / NAP_HOST=)"
  fi
  [ -n "$HOST" ] || die "could not determine the host address — pass --host=<ip-or-hostname>"
  set_kv TOS_HOST "$HOST"

  # Admin password: generated unless supplied; printed in the final summary.
  admin_password="$ADMIN_PASSWORD_OVERRIDE"
  [ -n "$admin_password" ] || admin_password="$(openssl rand -hex 8)"
  set_kv ADMIN_PASSWORD "$admin_password"

  # A release tag pins the image tag too, for a reproducible install.
  case "$VERSION" in
    v[0-9]*) set_kv IMAGE_TAG "$VERSION" ;;
  esac

  if [ "$MODE" = "k8s" ]; then
    kubeconfig="${KUBECONFIG:-$HOME/.kube/config}"
    [ -f "$kubeconfig" ] || die "kubeconfig not found: $kubeconfig (set KUBECONFIG)"
    set_kv KUBECONFIG "$kubeconfig"

    if [ -n "$STORAGE_CLASS_ARG" ]; then
      # Pre-existing RWX StorageClass: install.sh skips the NFS provisioner
      # when NFS_STORAGE_CLASS already exists in the cluster.
      set_kv NFS_STORAGE_CLASS "$STORAGE_CLASS_ARG"
      set_kv AGENT_STORAGE_CLASS "$STORAGE_CLASS_ARG"
    elif [ -n "$NFS_SERVER_ARG" ] && [ -n "$NFS_PATH_ARG" ]; then
      set_kv NFS_SERVER "$NFS_SERVER_ARG"
      set_kv NFS_PATH "$NFS_PATH_ARG"
      set_kv AGENT_STORAGE_CLASS "$(get_kv NFS_STORAGE_CLASS)"
    else
      die "--k8s needs RWX storage: pass --nfs-server= + --nfs-path=, or --storage-class="
    fi
  fi

  log "Wrote $VALUES_FILE"
}

# --- Main -----------------------------------------------------------------------

if [ "$MODE" = "single-node" ]; then
  [ "$(uname -s)" = "Linux" ] || die "single-node mode requires Linux (it installs k3s); use --k8s against an existing cluster"
  [ "$(id -u)" = "0" ] || die "single-node mode must run as root (it installs k3s and system packages) — re-run with sudo"
else
  command -v kubectl >/dev/null 2>&1 || die "--k8s mode requires kubectl on this machine"
fi

mkdir -p "$INSTALL_DIR" 2>/dev/null \
  || die "cannot create $INSTALL_DIR — re-run with sudo or pass --dir=<writable-path>"

command -v curl >/dev/null 2>&1 || die "curl is required"
command -v tar  >/dev/null 2>&1 || die "tar is required"

fetch_self_host
if [ "$MODE" = "single-node" ]; then
  ensure_openssl
  ensure_envsubst
  ensure_helm
else
  command -v openssl  >/dev/null 2>&1 || die "openssl is required"
  command -v envsubst >/dev/null 2>&1 || die "envsubst is required (package: gettext / gettext-base)"
  command -v helm     >/dev/null 2>&1 || die "helm is required (the NFS provisioner installs from its helm chart)"
fi
prepare_values

if [ "$PREPARE_ONLY" = "true" ]; then
  log "--prepare-only: review $VALUES_FILE, then re-run without --prepare-only to install."
  exit 0
fi

if [ "$MODE" = "single-node" ]; then
  ensure_k3s
  ( cd "$SELF_HOST_DIR" && VALUES_FILE="$VALUES_FILE" ./install.sh --profile=single-node )
else
  ( cd "$SELF_HOST_DIR" && VALUES_FILE="$VALUES_FILE" ./install.sh )
fi

# --- Summary ---------------------------------------------------------------------

echo ""
log "============================================================"
log " Neutree Agent Platform is up."
log ""
log "   URL:      http://$(get_kv TOS_HOST):$(get_kv TOS_NODE_PORT)"
log "   Login:    $(get_kv ADMIN_USERNAME) / $(get_kv ADMIN_PASSWORD)"
log ""
log " Config:  $VALUES_FILE  (credentials live here — keep it safe)"
log " Upgrade: re-run the same one-line command."
log "============================================================"
