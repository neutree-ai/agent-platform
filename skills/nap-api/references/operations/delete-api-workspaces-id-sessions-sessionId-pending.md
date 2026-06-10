# DELETE /api/workspaces/{id}/sessions/{sessionId}/pending

**Resource:** [workspaces](../resources/workspaces.md)
**Drop the queued follow-up message for a session**
**Operation ID:** `delete--api-workspaces-{id}-sessions-{sessionId}-pending`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `sessionId` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Cleared |
| 404 | Workspace or session not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |

## Security

- **bearerAuth**
