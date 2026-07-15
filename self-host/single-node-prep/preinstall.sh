#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# Single-Node Preinstall
# ============================================================================
# Prepares a bare Linux host (Ubuntu 24.04+ recommended) to run the single-node
# profile: installs k3s, drops in helm/envsubst/crane/k9s, and seeds k3s
# containerd with the offline image tarball so install.sh can come up without
# any external registry. NFS runs in-cluster (nap-nfs-server pod), so no NFS
# server package is required on the host — only the mount.nfs client.
#
# Idempotent. Re-run after package upgrades or values.env changes.
#
# Bundled artifacts (siblings to this script after extraction):
#   k3s-<arch>                          k3s binary (also symlinked as kubectl)
#   k3s-airgap-images-<arch>.tar.gz     pause / coredns / local-path-provisioner
#   helm / envsubst / crane             CLI tools install.sh depends on
#   k9s                                 k8s TUI for on-host debugging
#
# Reads the host image bundle from:
#   ../offline/nap-images.tar.gz        (from the main self-host tarball)
#   or $IMAGES_ARCHIVE if set.
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

case "$(uname -m)" in
  x86_64)        ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "unsupported arch: $(uname -m)" >&2; exit 1 ;;
esac

log() { echo "==> $*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "preinstall.sh must run as root (sudo ./preinstall.sh)" >&2
    exit 1
  fi
}

install_k3s() {
  if command -v k3s &>/dev/null; then
    log "k3s already installed ($(k3s --version | head -1))"
    return 0
  fi
  local bin="$SCRIPT_DIR/k3s-$ARCH"
  local airgap="$SCRIPT_DIR/k3s-airgap-images-$ARCH.tar.gz"
  [ -f "$bin" ] || { echo "missing $bin" >&2; exit 1; }
  [ -f "$airgap" ] || { echo "missing $airgap" >&2; exit 1; }

  log "Installing k3s binary"
  install -m 0755 "$bin" /usr/local/bin/k3s

  log "Staging k3s airgap images"
  mkdir -p /var/lib/rancher/k3s/agent/images
  cp "$airgap" /var/lib/rancher/k3s/agent/images/

  # Disable traefik (we expose via NodePort) + servicelb (single-node, not needed).
  log "Starting k3s server"
  cat > /etc/systemd/system/k3s.service <<'UNIT'
[Unit]
Description=Lightweight Kubernetes
After=network-online.target

[Service]
Type=notify
ExecStart=/usr/local/bin/k3s server --disable=traefik --disable=servicelb --write-kubeconfig-mode=644
Restart=always
RestartSec=5s
LimitNOFILE=1048576
LimitNPROC=infinity
LimitCORE=infinity
TasksMax=infinity
TimeoutStartSec=0
Delegate=yes
KillMode=process

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable --now k3s
  log "Waiting for k3s API to respond ..."
  for _ in $(seq 1 60); do
    k3s kubectl get nodes &>/dev/null && break
    sleep 2
  done
  k3s kubectl get nodes
}

install_kubectl_symlink() {
  # k3s is multi-call: when invoked as `kubectl` it dispatches the same way as
  # `k3s kubectl ...`. install.sh's check_prereqs requires `kubectl` on PATH;
  # symlinking avoids shipping a separate kubectl binary.
  local link=/usr/local/bin/kubectl
  if [ -L "$link" ] && [ "$(readlink "$link")" = "/usr/local/bin/k3s" ]; then
    log "kubectl symlink already in place"
    return 0
  fi
  log "Linking kubectl → k3s"
  ln -sf /usr/local/bin/k3s "$link"
}

install_bundled_bin() {
  # install_bundled_bin <name> <version-substring>
  # Drop bundled binary to /usr/local/bin/<name> unless an equivalent is
  # already there (cheap idempotency check via version output).
  local name="$1"
  local marker="$2"
  local src="$SCRIPT_DIR/$name"
  local dst="/usr/local/bin/$name"
  [ -f "$src" ] || { echo "missing bundled binary: $src" >&2; exit 1; }
  if [ -x "$dst" ] && "$dst" --version 2>&1 | grep -q -- "$marker"; then
    log "$name already installed at $dst ($marker)"
    return 0
  fi
  log "Installing $name → $dst"
  install -m 0755 "$src" "$dst"
}

install_cli_tools() {
  # Versions kept in sync with package-prep.sh. The grep markers are loose on
  # purpose — we just want to skip reinstall when the bundled version matches.
  install_bundled_bin helm     "v3.16.4"
  install_bundled_bin envsubst "v1.4.3"
  install_bundled_bin crane    "0.20.2"
  install_bundled_bin k9s      "v0.50.18"
}

import_images() {
  local archive="${IMAGES_ARCHIVE:-}"
  if [ -z "$archive" ]; then
    # Default layout: prep tarball is extracted *inside* self-host/, so
    #   $SCRIPT_DIR = .../self-host/single-node-prep
    #   archive    = .../self-host/offline/nap-images.tar.gz
    # Customers sometimes extract the prep tarball as a sibling of self-host/
    # instead. Probe both before bailing.
    for cand in \
      "$SCRIPT_DIR/../offline/nap-images.tar.gz" \
      "$SCRIPT_DIR/../self-host/offline/nap-images.tar.gz" \
      "$(dirname "$SCRIPT_DIR")/self-host/offline/nap-images.tar.gz"; do
      if [ -f "$cand" ]; then archive="$cand"; break; fi
    done
  fi
  if [ ! -f "$archive" ]; then
    die "nap-images.tar.gz not found near $SCRIPT_DIR — extract the main self-host tarball alongside single-node-prep (or set IMAGES_ARCHIVE)"
  fi
  log "Importing $archive into k3s containerd (primes registry:2 + 3rd-party for install.sh)"
  k3s ctr -n k8s.io images import "$archive"
}

configure_registries() {
  # Tell k3s containerd that the in-cluster registry NodePort speaks plain HTTP;
  # otherwise pod-side pulls would fail the TLS handshake.
  # NAP_HOST + REGISTRY_NODE_PORT are read from values.env (sourced below if present).
  local values_file="${VALUES_FILE:-}"
  if [ -z "$values_file" ]; then
    for cand in \
      "$SCRIPT_DIR/../values.env" \
      "$SCRIPT_DIR/../self-host/values.env" \
      "$(dirname "$SCRIPT_DIR")/self-host/values.env"; do
      if [ -f "$cand" ]; then values_file="$cand"; break; fi
    done
  fi
  if [ -f "$values_file" ]; then
    set -a; source "$values_file"; set +a
  fi
  local host="${NAP_HOST:-}"
  local port="${REGISTRY_NODE_PORT:-30500}"
  if [ -z "$host" ]; then
    log "WARNING: NAP_HOST not set in $values_file — skipping registries.yaml (re-run preinstall after editing values.env)"
    return 0
  fi
  local endpoint="${host}:${port}"
  log "Configuring k3s containerd to treat $endpoint as plain HTTP"
  mkdir -p /etc/rancher/k3s
  cat > /etc/rancher/k3s/registries.yaml <<YAML
mirrors:
  "${endpoint}":
    endpoint:
      - "http://${endpoint}"
YAML
  if systemctl is-active --quiet k3s; then
    systemctl restart k3s
    for _ in $(seq 1 30); do
      k3s kubectl get nodes &>/dev/null && break
      sleep 2
    done
  fi

  # k3s auto-generates hosts.toml with the HTTP host limited to `pull, resolve`.
  # Push falls back to the HTTPS `server` field which our registry doesn't
  # serve → ctr push hangs on the TLS handshake. Override the file so the HTTP
  # endpoint also carries the `push` capability. K3s only regenerates this on
  # restart; we don't restart k3s during install.sh, so the override sticks.
  local hosts_dir="/var/lib/rancher/k3s/agent/etc/containerd/certs.d/${endpoint}"
  mkdir -p "$hosts_dir"
  cat > "$hosts_dir/hosts.toml" <<TOML
# Override of k3s default — required so push can use plain HTTP.
server = "http://${endpoint}/v2"
capabilities = ["pull", "resolve", "push"]

[host]

[host."http://${endpoint}/v2"]
  capabilities = ["pull", "resolve", "push"]
TOML
  log "Wrote $hosts_dir/hosts.toml (push capability over HTTP)"
}

check_nfs_client() {
  # Host needs mount.nfs (from nfs-common on Debian/Ubuntu, nfs-utils on RHEL)
  # so kubelet can mount the in-cluster nap-nfs-server svc for the
  # nfs-subdir-external-provisioner pod. install.sh has no way to provide this
  # post-hoc — the mount happens before the storage class is usable.
  if [ -x /sbin/mount.nfs ] || command -v mount.nfs &>/dev/null; then
    log "/sbin/mount.nfs present"
    return 0
  fi
  local debs_dir="$SCRIPT_DIR/nfs-debs"
  if [ -d "$debs_dir" ] && [ -n "$(ls -A "$debs_dir" 2>/dev/null)" ]; then
    log "Installing nfs-common offline from $debs_dir"
    # Two-pass dpkg -i tolerates ordering issues from intra-set deps. apt-get
    # would pull in some transitional packages (python3 meta etc) whose post-
    # install scripts are noisy in lean environments; we tolerate non-zero
    # exit as long as /sbin/mount.nfs ends up in place (the only thing we
    # actually need from this set).
    dpkg -i "$debs_dir"/*.deb 2>/dev/null || true
    dpkg -i "$debs_dir"/*.deb 2>&1 | tail -20 || true
  elif command -v apt-get &>/dev/null; then
    log "nfs-debs/ not staged; falling back to online apt-get install nfs-common"
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends nfs-common \
      || die "apt-get install nfs-common failed — host needs offline nfs-debs/ or apt access"
  else
    die "mount.nfs not found, no offline nfs-debs/, no apt-get — install nfs-common / nfs-utils manually"
  fi
  [ -x /sbin/mount.nfs ] || die "mount.nfs still missing after package install"
}

load_nfs_modules() {
  # Two host kernel modules are needed for in-cluster NFS:
  #   nfsd — nap-nfs-server container mounts nfsd + rpc_pipefs at startup
  #   nfs  — nfs-subdir provisioner / kubelet mounting the NFS export
  # The client `nfs` module is usually autoloaded by mount.nfs, but some distros
  # (observed on Ubuntu 24.04 / kernel 6.8, also some minimal VM templates) ship
  # neither loaded, so load both explicitly.
  local mod
  for mod in nfs nfsd; do
    if lsmod | grep -q "^${mod} "; then
      log "$mod kernel module already loaded"
    else
      log "Loading $mod kernel module"
      modprobe "$mod" || die "modprobe $mod failed — install kernel modules (e.g. apt-get install linux-modules-extra-\$(uname -r)) or run on a host whose kernel supports NFS"
    fi
  done
  # Persist across reboots.
  if [ ! -f /etc/modules-load.d/nfs.conf ] || ! grep -q '^nfsd$' /etc/modules-load.d/nfs.conf 2>/dev/null; then
    printf 'nfs\nnfsd\n' > /etc/modules-load.d/nfs.conf
    log "Wrote /etc/modules-load.d/nfs.conf"
  fi
}

main() {
  require_root
  install_k3s
  install_kubectl_symlink
  install_cli_tools
  check_nfs_client
  load_nfs_modules
  import_images
  configure_registries
  log ""
  if [ -f /etc/rancher/k3s/registries.yaml ]; then
    # configure_registries wrote the HTTP-mirror config (NAP_HOST was set) —
    # everything's primed, go straight to install.
    log "Preinstall complete. registries.yaml in place. Next:"
    log "  cd .. && ./install.sh --profile=single-node"
  else
    # NAP_HOST wasn't set, so configure_registries skipped registries.yaml.
    # install.sh's single-node preflight will reject this — fill NAP_HOST and
    # re-run preinstall so the HTTP-mirror config gets written.
    log "Preinstall done, but registries.yaml was NOT written — NAP_HOST is unset in values.env."
    log "Single-node install needs it. Fill values.env FIRST, then re-run preinstall:"
    log "  cp ../values.env.single-node.example ../values.env   # if not already"
    log "  vi ../values.env   # set NAP_HOST (+ ADMIN_PASSWORD, secrets)"
    log "  sudo ./preinstall.sh   # re-run; now registries.yaml picks up NAP_HOST"
    log "  cd .. && ./install.sh --profile=single-node"
  fi
}

main "$@"
