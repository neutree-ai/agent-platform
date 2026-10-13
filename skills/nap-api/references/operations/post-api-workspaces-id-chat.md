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

**When is the session done?** One request starts one turn, but an agent
that hands work to other agents (`call_agent`) may end that turn while the
calls are still running; each result is then posted to the session as a
further turn, started by the server. `GET /sessions/:id` reports the calls
still outstanding as `pending_agent_calls`. The session has given its final
answer when `chat_status` is not `agent` AND `pending_agent_calls` is `0`
— in every mode. With `sync`, the response carries the same count: above
zero, `final_message` is interim and the rest is read by polling. With
`stream`, the stream closes at the end of the first turn; check the session
afterwards. This applies to sessions started with `source` `api` or `web`.

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
| `reflect_store_id` | string | No |  |

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
| 409 | Another turn is running in the session (`code: "session_busy"`).
A session runs one turn at a time; send again once it has ended. |
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
| `pending_agent_calls` | integer | Yes | Agent calls (call_agent) still outstanding when this turn ended. Above 0 means final_message is interim: the results arrive as further turns in the same session. Poll GET /sessions/{sessionId} until chat_status is not "agent" and pending_agent_calls is 0, then read the messages. |

## Security

- **bearerAuth**
