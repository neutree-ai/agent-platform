# POST /api/workspaces/{id}/chat

**Resource:** [chat](../resources/chat.md)
**Start (or continue) a chat turn with a workspace agent**
**Operation ID:** `post--api-workspaces-{id}-chat`

Triggers a turn against the workspace agent. Three delivery modes via
`body.mode`:

- `stream` (default) — `text/event-stream` of UniversalEvent frames.
- `sync` — block until the turn ends, return aggregated JSON. Weak for
  long turns; kept for compatibility.
- `async` (recommended) — `202 Accepted` with `{ session_id }` as soon as
  the session exists; the turn keeps running server-side. Poll
  `GET /sessions/:id` and read `GET /messages?session_id=` for results.

When `mode` is absent, the legacy `body.stream` flag (`true` → stream,
`false` → sync) and then the `Accept` header are consulted; default SSE.

SSE events follow the agent UniversalEvent schema. Frame shape is
documented as the `UniversalEvent` component (discriminated on `type`):
session.started, item.started, item.delta, item.completed,
question.requested, session.ended, error. Each frame is emitted on a
single `data: <json>\n\n` line.

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Request Body

**Required:** Yes

**Content Types:** `application/json`

**Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message` | string | Yes |  |
| `session_id` | string,null | No |  |
| `images` | object[] | No |  |
| `source` | enum: api, web, slack... | No |  |
| `mode` | enum: stream, sync, async | No |  |
| `stream` | boolean | No |  |

**`images` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `data` | string | Yes |  |
| `media_type` | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Chat turn output.

In SSE mode (default) the response is `text/event-stream` carrying
UniversalEvent frames. In JSON mode (`body.stream: false` or
`Accept: application/json`) the server blocks until the turn
ends and returns the aggregated object documented below. |
| 202 | Async mode (`body.mode: "async"`) — the turn was accepted and is
running server-side. Returns the session id to poll for results. |
| 400 | Invalid body |
| 404 | Workspace not found |
| 502 | Agent unavailable |
| 503 | Workspace not running |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `session_id` | string | Yes |  |
| `final_message` | string | Yes |  |
| `messages` | object[] | Yes |  |
| `stats` | object,null | Yes |  |
| `reason` | enum: ended, timeout, error... | Yes |  |
| `error` | string,null | Yes |  |

## Security

- **bearerAuth**
