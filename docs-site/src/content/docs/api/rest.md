---
title: REST API
description: Driving NAP from your own code — Service Token auth, and where the interactive reference lives
---

Everything the web UI does goes through the same REST API, and a **Service Token** is all your own code needs to reach it. A CI job that opens a workspace, a script that bulk-loads prompts, a local agent handing a long task to a hosted one — all the same surface.

## The interactive reference is on your instance

Your own NAP serves it:

```
https://<your-nap-host>/api/docs
```

Signed in, `⌘K` → **API Docs** goes straight there. The machine-readable document sits beside it at `/api/docs/openapi.json`.

It isn't mirrored here on purpose: what your instance serves is generated from the control plane you are actually running, so it matches your version rather than ours.

## Authentication

Create a token in the UI — `⌘K` → **Service Tokens** (route `/integration/tokens`) → **Create Service Token**. It is **shown once**, so copy it then.

Every request carries it:

```
Authorization: Bearer <token>
```

## Base URL and conventions

Paths are relative to your host, so `GET $NAP_BASE_URL/api/workspaces` lists workspaces.

One convention worth knowing before it bites: **URL-encode query parameters that carry a path**. Encode the whole value — slashes inside it are literal, not separators. A raw CJK or slashed value gets a 400 or lands somewhere else.

## The call that does most of the work

There is deliberately **no exec endpoint** for service tokens. Work goes to the agent as a prompt, and the agent has its full toolset behind it — bash, file editing, everything it has in the UI:

```bash
BASE="${NAP_BASE_URL:?}"
NAP_WS="<workspace-id>"

# Start the turn. async returns 202 immediately with a session id.
SID=$(curl -s -X POST "$BASE/api/workspaces/$NAP_WS/chat" \
  -H "Authorization: Bearer $NAP_TOKEN" -H "Content-Type: application/json" \
  -d '{"message":"List the files in the repo and summarize the README","mode":"async","source":"api"}' \
  | jq -r .session_id)

# Then poll the session until the agent stops running, and read the transcript.
```

Turns can also stream, if you'd rather watch it work than wait for it.

Where things are when they aren't where you'd look first:

| You want to | Go to |
|---|---|
| Have the agent do something — run a task, edit files, answer about its work | `POST /api/workspaces/{id}/chat` |
| Read, write or list files in the workspace | the `agent-files` resource |
| Reach the shared `/mnt/afs` volume | the `agent-afs-files` resource — a different mount |
| Create and configure a workspace | `POST /api/workspaces`, then `PUT /api/workspaces/{id}/config` |
| Bulk-manage prompts, templates or skills | the `prompts`, `templates`, `skills` resources |

## Next

Rather than reading operation lists yourself, hand them to an agent: the [nap-api skill](/api/skills/) is generated from this same spec, and it's what lets a local agent drive NAP.
