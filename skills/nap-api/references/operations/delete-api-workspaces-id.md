# DELETE /api/workspaces/{id}

**Resource:** [workspaces](../resources/workspaces.md)
**Delete a workspace and its underlying instance**
**Operation ID:** `delete--api-workspaces-{id}`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

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
