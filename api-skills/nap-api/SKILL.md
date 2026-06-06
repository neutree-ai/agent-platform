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
