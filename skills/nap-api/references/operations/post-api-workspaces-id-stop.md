# POST /api/workspaces/{id}/stop

**Resource:** [workspaces](../resources/workspaces.md)
**Stop a workspace instance**
**Operation ID:** `post--api-workspaces-{id}-stop`

Interrupts all active sessions, stops the K8s deployment, and resets session chat status.

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Stop initiated |
| 404 | Workspace not found |
| 500 | Internal error |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |

## Security

- **bearerAuth**
