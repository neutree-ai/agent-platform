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

A ready-to-run driver ships with this skill at **`scripts/handoff.sh`** — call it directly or adapt it. It dispatches a turn, polls until the turn truly ends, and prints the agent's reply. Pass `-s <session_id>` to **continue** an existing session instead of starting a new one — that's how you carry a conversation across calls.

```bash
export NAP_TOKEN=<service-token> NAP_WS=<workspace-id>   # NAP_BASE_URL defaults to https://nap.example.com

scripts/handoff.sh "implement what TASK.md describes"    # new session -> prints session_id + reply
scripts/handoff.sh -s <session_id> "now add tests"       # continue that session
echo "long task text..." | scripts/handoff.sh -          # task from stdin
```

The poll loop treats any non-`agent` `chat_status` as the turn handing back (idle, human, …) — but also requires the last message to be this turn's assistant reply, guarding against a just-issued POST briefly reading the previous turn's status. It prints only the agent's final text; read the full turn (tool calls included) with `GET /api/workspaces/{id}/messages?session_id=…`, and pull any files the agent produced with `GET /api/workspaces/{id}/agent/files?path=…`.

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
