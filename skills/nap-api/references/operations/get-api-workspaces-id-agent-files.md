# GET /api/workspaces/{id}/agent/files

**Resource:** [agent-files](../resources/agent-files.md)
**Read a file from the workspace filesystem**
**Operation ID:** `get--api-workspaces-{id}-agent-files`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |
| `path` | query | string | Yes | Path inside the workspace filesystem. May contain slashes. |

## Responses

| Status | Description |
|--------|-------------|
| 200 | File contents |
| 404 | Workspace or file not found |
| 502 | Agent unavailable |
| 503 | Workspace not running |

## Security

- **bearerAuth**
