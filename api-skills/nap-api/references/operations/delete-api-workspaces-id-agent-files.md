# DELETE /api/workspaces/{id}/agent/files

**Resource:** [agent-files](../resources/agent-files.md)
**Delete a file or directory (recursive)**
**Operation ID:** `delete--api-workspaces-{id}-agent-files`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `path` | query | string | Yes | Path inside the workspace filesystem. May contain slashes. |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Deleted |
| 404 | Workspace not found |
| 502 | Agent unavailable |
| 503 | Workspace not running |

**Success Response Schema** (inline):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | boolean | Yes |  |

## Security

- **bearerAuth**
