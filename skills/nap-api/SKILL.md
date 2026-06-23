---
name: nap-api
description: Manage NAP workspaces, prompts, templates, credentials, service tokens, agent files, providers, tags, shares, schedules via REST. Trigger when the user wants to script or automate NAP outside the UI — e.g. "create a workspace", "rotate a token", "bulk-upload prompts", "list agent files in workspace X", CI integration with NAP.
metadata:
  api-version: "0.1.0"
  openapi-version: "3.1.0"
---

# NAP Control Plane API
REST API for the NAP control plane.

## How to Use This Skill

This API documentation is split into multiple files for on-demand loading.

**Directory structure:**
```
references/
├── resources/      # 15 resource index files
├── operations/     # 158 operation detail files
└── schemas/        # 7 schema groups, 12 schema files
```

**Navigation flow:**
1. Find the resource you need in the list below
2. Read `references/resources/<resource>.md` to see available operations
3. Read `references/operations/<operation>.md` for full details
4. If an operation references a schema, read `references/schemas/<prefix>/<schema>.md`

## Base URL

`https://nap.example.com` — or set `$NAP_BASE_URL` to your deployment's host. Every operation path below is relative to it (e.g. `GET $NAP_BASE_URL/api/workspaces`).

## Authentication

Supported methods: **bearerAuth**. See `references/authentication.md` for details.

## Conventions

- Every operation path is relative to the Base URL above; send `Authorization: Bearer <token>` on every request.
- **URL-encode path-bearing query params** (e.g. `path`): encode the whole value — slashes inside it are literal, not separators. A raw CJK or slashed value will 400 or mis-route.

## Common Intents → Operation

Non-obvious capability routing (when the operation isn't where you'd first look):

| I want to… | Use |
|------------|-----|
| Have the workspace agent do something — run a task, edit files, run commands, answer about its work | Send a natural-language prompt to the in-workspace agent: `POST /api/workspaces/{id}/chat` (see operations/post-api-workspaces-id-chat.md). The agent has a full toolset (bash, file edit, etc.); this is the primary way to get work done in a workspace. There is no direct exec / command endpoint for service tokens by design — route the request through chat. |
| Read / write / list files in a workspace | Workspace filesystem → `agent-files` resource. The shared `/mnt/afs` volume → `agent-afs-files` resource (two distinct mounts). |
| Create / configure / start a workspace | `workspaces` resource — `POST /api/workspaces`, then `PUT /api/workspaces/{id}/config`. |
| Bulk-manage prompts / templates / skills | `prompts`, `templates`, `skills` resources. |
| Issue or rotate a token / credential | `credentials` resource and the service-token operations. |


## Example — drive the agent (async chat + poll)

The most common task, end to end. Send a prompt, poll until the turn ends, read the transcript — no other files needed:

```bash
BASE="${NAP_BASE_URL:-https://nap.example.com}"
WS="<workspace-id>"

# 1. Start the turn. mode=async returns 202 immediately with a session id.
SID=$(curl -s -X POST "$BASE/api/workspaces/$WS/chat" \
  -H "Authorization: Bearer $NAP_TOKEN" -H "Content-Type: application/json" \
  -d '{"message":"List the files in the repo and summarize the README","mode":"async","source":"api"}' \
  | jq -r .session_id)

# 2. Poll the session until the agent stops running.
#    chat_status: "agent" = still working · "idle" = finished · "human" = waiting on you (see pending_message)
while [ "$(curl -s "$BASE/api/workspaces/$WS/sessions/$SID" \
    -H "Authorization: Bearer $NAP_TOKEN" | jq -r .chat_status)" = "agent" ]; do
  sleep 3
done

# 3. Read the full transcript for this turn.
curl -s "$BASE/api/workspaces/$WS/messages?session_id=$SID" \
  -H "Authorization: Bearer $NAP_TOKEN" | jq .
```

Continue the same conversation by POSTing again with this `session_id` in the body. For token-by-token output instead of polling, omit `mode` (or use `mode: "stream"`) and read the `text/event-stream` of UniversalEvent frames.

## Handoff — local agent → NAP cloud agent

A common use of async chat is **delegation**: a local agent (e.g. running on your laptop) hands a chunk of work to a NAP cloud agent that has its own persistent workspace, filesystem, and toolset, then collects the result.

The cloud agent is a **fresh, isolated agent** — it shares none of your local context, conversation, or files. Everything it needs travels through the workspace and the prompt, so front-load it:

- **Stage inputs** — write the files it needs into the workspace first (`PUT /api/workspaces/{id}/agent/files?path=…`, raw body), or tell it a repo to clone. Don't assume it can see your local tree.
- **Write a self-contained, autonomous prompt** — the task, where the inputs live, the acceptance criteria, and how to behave unattended: proceed without asking for approval, reply tersely, and don't echo large files (you'll inspect artifacts directly). A clarifying round-trip is expensive, so decide up front. This prompt is also where you keep the agent from blocking on approval gates — instruct it to proceed rather than ask.

### Driver script

Save this as `handoff.sh` and call it directly, or adapt it. It dispatches a turn, polls until the turn truly ends, and prints the agent's reply. Pass `-s <session_id>` to **continue** an existing session instead of starting a new one — that's how you carry a conversation across calls.

```bash
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
```

The script prints only the agent's final text; read the full turn (tool calls included) with `GET /api/workspaces/{id}/messages?session_id=$SID`, and pull any files the agent produced with `GET /api/workspaces/{id}/agent/files?path=…`.

## Resources

- **workspaces** → `references/resources/workspaces.md` (33 ops)
- **skills** → `references/resources/skills.md` (32 ops)
- **teams** → `references/resources/teams.md` (12 ops)
- **agent-files** → `references/resources/agent-files.md` (11 ops)
- **templates** → `references/resources/templates.md` (11 ops)
- **prompts** → `references/resources/prompts.md` (10 ops)
- **memory-stores** → `references/resources/memory-stores.md` (9 ops)
- **agent-afs-files** → `references/resources/agent-afs-files.md` (8 ops)
- **providers** → `references/resources/providers.md` (8 ops)
- **afs** → `references/resources/afs.md` (6 ops)
- **shares** → `references/resources/shares.md` (5 ops)
- **tags** → `references/resources/tags.md` (5 ops)
- **workspace-memory** → `references/resources/workspace-memory.md` (4 ops)
- **credentials** → `references/resources/credentials.md` (3 ops)
- **chat** → `references/resources/chat.md` (1 ops)
