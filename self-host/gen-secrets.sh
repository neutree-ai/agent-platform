#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# Fill random secrets in values.env
# ============================================================================
# Generates a strong random value for every machine-internal secret that is
# still empty or left at its `change-me` placeholder, and writes it back into
# values.env.
#
# Idempotent: a secret you already set is never overwritten, so re-running
# before an upgrade is safe — JWT_SECRET / SANDBOX_SERVICE_KEY etc. must stay
# stable across install.sh runs or sessions break.
#
# Usage:
#   ./gen-secrets.sh                          # fills self-host/values.env
#   VALUES_FILE=/path/to/values.env ./gen-secrets.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VALUES_FILE="${VALUES_FILE:-$SCRIPT_DIR/values.env}"
EXAMPLE_FILE="$SCRIPT_DIR/values.env.example"

if ! command -v openssl &>/dev/null; then
  echo "ERROR: openssl not found — required to generate secrets." >&2
  exit 1
fi

# Bootstrap values.env from the example on first run.
if [ ! -f "$VALUES_FILE" ]; then
  if [ ! -f "$EXAMPLE_FILE" ]; then
    echo "ERROR: neither $VALUES_FILE nor $EXAMPLE_FILE exists." >&2
    exit 1
  fi
  cp "$EXAMPLE_FILE" "$VALUES_FILE"
  echo "==> Created $VALUES_FILE from values.env.example"
fi

# Machine-internal secrets — safe to auto-generate, no human ever types these.
# ADMIN_PASSWORD / LDAP_BIND_PASSWORD are deliberately excluded: a person needs
# to know or supply those.
SECRET_KEYS=(
  JWT_SECRET
  CREDENTIAL_ENCRYPTION_KEY
  BROWSER_JWT_SECRET
  SANDBOX_JWT_SECRET
  SANDBOX_SERVICE_KEY
  TURN_AUTH_SECRET
  PG_PASSWORD
)

gen() { openssl rand -hex 32; }

# A value still needs filling if it is empty or a change-me* placeholder.
needs_fill() {
  local v="$1"
  [ -z "$v" ] || [[ "$v" == change-me* ]]
}

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

# Space-padded list of keys seen in the file (bash 3.2 — no associative array).
FILLED=" "

while IFS= read -r line || [ -n "$line" ]; do
  matched=""
  for key in "${SECRET_KEYS[@]}"; do
    if [[ "$line" =~ ^${key}= ]]; then
      matched="$key"
      break
    fi
  done
  if [ -n "$matched" ]; then
    cur="${line#*=}"
    cur="${cur%\"}"; cur="${cur#\"}"   # strip surrounding quotes, if any
    if needs_fill "$cur"; then
      echo "${matched}=$(gen)" >> "$TMP"
      echo "    generated ${matched}"
    else
      echo "$line" >> "$TMP"
      echo "    kept      ${matched} (already set)"
    fi
    FILLED+="${matched} "
  else
    echo "$line" >> "$TMP"
  fi
done < "$VALUES_FILE"

# Append any secret key missing from the file entirely.
for key in "${SECRET_KEYS[@]}"; do
  if [[ "$FILLED" != *" ${key} "* ]]; then
    echo "${key}=$(gen)" >> "$TMP"
    echo "    generated ${key} (appended)"
  fi
done

mv "$TMP" "$VALUES_FILE"
trap - EXIT

echo ""
echo "==> Secrets written to $VALUES_FILE"

# Remind about the values a human still has to supply.
admin=$(grep -E '^ADMIN_PASSWORD=' "$VALUES_FILE" | head -1 | cut -d= -f2- || true)
admin="${admin%\"}"; admin="${admin#\"}"
if [ -z "$admin" ] || [[ "$admin" == change-me* ]]; then
  echo ""
  echo "==> Still set this yourself in $VALUES_FILE:"
  echo "    - ADMIN_PASSWORD  (you log in with it)"
fi
