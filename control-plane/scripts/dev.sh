#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY

export DISABLE_SESSION_RECOVERY=1

if [ -z "${KUBECONFIG:-}" ]; then
  echo "KUBECONFIG must be set (mirrord needs cluster access)" >&2
  exit 1
fi

exec mirrord exec -- node --env-file="${ENV_FILE:-.env}" --import tsx --watch src/index.ts
