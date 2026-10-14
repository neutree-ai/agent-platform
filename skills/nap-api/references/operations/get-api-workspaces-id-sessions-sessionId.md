# GET /api/workspaces/{id}/sessions/{sessionId}

**Resource:** [workspaces](../resources/workspaces.md)
**Get a single session (lightweight, sidebar shape)**
**Operation ID:** `get--api-workspaces-{id}-sessions-{sessionId}`

Returns a lite shape with id, name, chat_status, status, last_active_at, a 40-char preview of the first user message, and the last turn's context gauge. Use GET /workspaces/:id/sessions for the full ApiSession list.

This is the endpoint to poll after an async chat. The session is done when `chat_status` is not `agent` AND `pending_agent_calls` is `0`: a session whose agent called other agents can sit at `idle` between turns while it waits for their results, which arrive as further turns.

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `sessionId` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Session |
| 404 | Workspace or session not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes |  |
| `name` | string | Yes |  |
| `chat_status` | string | Yes |  |
| `status` | string | Yes |  |
| `last_active_at` | string | Yes |  |
| `preview` | string | Yes |  |
| `pending_message` | object,null | Yes |  |
| `pending_agent_calls` | integer | Yes | Calls this session's agent made to other agents (call_agent) whose results have not come back yet. Each result is posted to the session as a further turn, so the session is done only when chat_status is not "agent" AND this is 0. |
| `last_turn_stats` | object,null | Yes |  |

## Security

- **bearerAuth**
