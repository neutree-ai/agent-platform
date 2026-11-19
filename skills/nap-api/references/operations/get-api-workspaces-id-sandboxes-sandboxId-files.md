# GET /api/workspaces/{id}/sandboxes/{sandboxId}/files

**Resource:** [workspaces](../resources/workspaces.md)
**Read a file from a sandbox**
**Operation ID:** `get--api-workspaces-{id}-sandboxes-{sandboxId}-files`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `sandboxId` | path | string | Yes |  |
| `path` | query | string | Yes |  |
| `offset` | query | integer,null | No |  |
| `limit` | query | integer | No |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | File content |
| 404 | Workspace or sandbox not found |
| 500 | Sandbox service error |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `content` | string | Yes |  |

## Security

- **bearerAuth**
