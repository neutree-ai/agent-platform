# GET /api/workspaces/{id}/sessions/{sessionId}

**Resource:** [workspaces](../resources/workspaces.md)
**Get a single session (lightweight, sidebar shape)**
**Operation ID:** `get--api-workspaces-{id}-sessions-{sessionId}`

Returns a lite shape with id, name, chat_status, status, and a 40-char preview of the first user message. Use GET /workspaces/:id/sessions for the full ApiSession list.

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
| `preview` | string | Yes |  |
| `pending_message` | object,null | Yes |  |

## Security

- **bearerAuth**
