# GET /api/workspaces/{id}/sandboxes/{sandboxId}/directory

**Resource:** [workspaces](../resources/workspaces.md)
**List a directory inside a sandbox**
**Operation ID:** `get--api-workspaces-{id}-sandboxes-{sandboxId}-directory`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `sandboxId` | path | string | Yes |  |
| `path` | query | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Directory entries |
| 404 | Workspace or sandbox not found |
| 500 | Sandbox service error |

## Security

- **bearerAuth**
