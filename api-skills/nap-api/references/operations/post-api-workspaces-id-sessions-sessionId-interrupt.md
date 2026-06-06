# POST /api/workspaces/{id}/sessions/{sessionId}/interrupt

**Resource:** [workspaces](../resources/workspaces.md)
**Interrupt a single session (soft stop, preserves history)**
**Operation ID:** `post--api-workspaces-{id}-sessions-{sessionId}-interrupt`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `sessionId` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Interrupt attempted |
| 404 | Workspace not found |
| 503 | Workspace not running |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |
| `interrupted` | boolean | No |  |

## Security

- **bearerAuth**
