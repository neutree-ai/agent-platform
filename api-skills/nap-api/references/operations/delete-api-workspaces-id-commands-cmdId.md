# DELETE /api/workspaces/{id}/commands/{cmdId}

**Resource:** [workspaces](../resources/workspaces.md)
**Delete a command**
**Operation ID:** `delete--api-workspaces-{id}-commands-{cmdId}`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `cmdId` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Deleted |
| 404 | Workspace or command not found |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |

## Security

- **bearerAuth**
