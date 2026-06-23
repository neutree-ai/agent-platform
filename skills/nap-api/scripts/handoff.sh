#!/usr/bin/env bash
# Hand a task to a NAP cloud agent (async chat) and print its reply.
#
# Usage:
#   ./handoff.sh "implement what TASK.md describes"     # new session
#   ./handoff.sh -s <session_id> "now add tests"        # continue a session
#   echo "long task text..." | ./handoff.sh -           # task from stdin
#
# Env: NAP_TOKEN (required), NAP_BASE_URL (default https://nap.example.com),
#      NAP_WS (required, target workspace id),
#      POLL_INTERVAL (default 3s), POLL_MAX (default 200 polls).
#
# Keep this file ASCII-only: macOS bash 3.2 miscounts quotes when the *source*
# holds multibyte chars. Task text is argv, not source, so it may be any language.
set -euo pipefail

BASE="${NAP_BASE_URL:-https://nap.example.com}"
WS="${NAP_WS:?set NAP_WS to the target workspace id}"
INTERVAL="${POLL_INTERVAL:-3}"
MAX="${POLL_MAX:-200}"
TOKEN="$(printenv NAP_TOKEN || true)"
[ -n "$TOKEN" ] || { echo "error: NAP_TOKEN not set" >&2; exit 1; }

SID=""
if [ "${1:-}" = "-s" ]; then
  SID="${2:-}"; shift 2
  [ -n "$SID" ] || { echo "error: -s requires a session_id" >&2; exit 1; }
fi
MSG="${1:-}"; [ "$MSG" = "-" ] && MSG="$(cat)"
[ -n "$MSG" ] || { echo "error: no task message provided" >&2; exit 1; }

auth=(-H "Authorization: Bearer $TOKEN")

# 1. Start (new) or continue (-s) the turn. async returns a session_id at once.
#    Including session_id in the body continues that conversation.
body=$(jq -n --arg m "$MSG" --arg s "$SID" \
  '{message:$m, mode:"async", source:"api"} + (if $s=="" then {} else {session_id:$s} end)')
SID=$(curl -s -X POST "$BASE/api/workspaces/$WS/chat" "${auth[@]}" \
  -H "Content-Type: application/json" -d "$body" | jq -r '.session_id // empty')
[ -n "$SID" ] || { echo "error: no session_id returned" >&2; exit 1; }
echo "session_id: $SID" >&2

# 2. Poll until the turn truly ends, then read the latest result.
#    Any non-"agent" status means the turn handed back (idle, human, ...) -- we
#    don't need to tell them apart. But a just-issued POST can briefly still read
#    the PREVIOUS turn's status, so also require the last message to be this
#    turn's assistant reply before treating the turn as done.
i=0
while :; do
  i=$((i+1))
  st=$(curl -s "$BASE/api/workspaces/$WS/sessions/$SID" "${auth[@]}" | jq -r '.chat_status // "unknown"')
  msgs=$(curl -s "$BASE/api/workspaces/$WS/messages?session_id=$SID" "${auth[@]}")
  last_role=$(echo "$msgs" | jq -r 'last | .role // "none"')
  printf '\r  polling... %s / last=%s (%d)   ' "$st" "$last_role" "$i" >&2
  if [ "$st" != "agent" ] && [ "$last_role" = "assistant" ]; then
    echo >&2
    echo "$msgs" | jq -r '[.[] | select(.role=="assistant")] | last | (.content // "")
      | if . == "" then "[no text reply; likely tool actions -- continue with -s to ask more]" else . end'
    break
  fi
  [ "$i" -ge "$MAX" ] && { echo >&2; echo "error: timed out after $MAX polls (status=$st)" >&2; exit 2; }
  sleep "$INTERVAL"
done
echo "continue with: $0 -s $SID \"...\"" >&2
