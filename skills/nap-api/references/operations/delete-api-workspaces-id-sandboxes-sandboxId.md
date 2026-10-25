# DELETE /api/workspaces/{id}/sandboxes/{sandboxId}

**Resource:** [workspaces](../resources/workspaces.md)
**Kill a workspace sandbox**
**Operation ID:** `delete--api-workspaces-{id}-sandboxes-{sandboxId}`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `sandboxId` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Killed |
| 404 | Workspace not found |
| 500 | Sandbox service error |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |

## Security

- **bearerAuth**
