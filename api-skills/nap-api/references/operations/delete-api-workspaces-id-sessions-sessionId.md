# DELETE /api/workspaces/{id}/sessions/{sessionId}

**Resource:** [workspaces](../resources/workspaces.md)
**Delete a session and its messages**
**Operation ID:** `delete--api-workspaces-{id}-sessions-{sessionId}`

Interrupts the agent (if running), then drops the session row and its messages. The workspace chat_status cache is refreshed automatically.

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `sessionId` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Deleted |
| 404 | Workspace not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |

## Security

- **bearerAuth**
